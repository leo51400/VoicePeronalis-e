const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MAX_DISTANCE = 50;

// Stockage des joueurs
const gamePlayers = new Map();
const webSessions = new Map();

// Configuration STUN
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

function getDistance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function broadcastProximity() {
  const all = Array.from(gamePlayers.values());
  for (const p of all) {
    const nearby = [];
    for (const op of all) {
      if (op.userId === p.userId || !op.isTalking) continue;
      const d = getDistance(p.position, op.position);
      if (d <= MAX_DISTANCE) nearby.push({ username: op.username, distance: Math.round(d), volume: Math.round(100 - (d / MAX_DISTANCE) * 100) });
    }
    if (p.socketId) io.to(p.socketId).emit('nearby', nearby);
  }
}

function broadcastAllPlayers() {
  const all = [];
  for (const p of gamePlayers.values()) {
    all.push({ username: p.username, isTalking: p.isTalking, source: 'game' });
  }
  for (const s of webSessions.values()) {
    if (!all.find(a => a.username === s.username)) {
      all.push({ username: s.username, isTalking: s.isTalking, source: 'web' });
    }
  }
  io.emit('players:all', all);
}

// Routes API Roblox
app.post('/api/update', (req, res) => {
  const { userId, username, position, isTalking } = req.body;
  if (!userId || !position) return res.status(400).json({ error: 'Missing' });
  gamePlayers.set(userId, { userId, username, position, isTalking: !!isTalking, lastUpdate: Date.now() });
  broadcastProximity();
  broadcastAllPlayers();
  res.json({ ok: true });
});

app.post('/api/talking', (req, res) => {
  const { userId, isTalking } = req.body;
  const p = gamePlayers.get(userId);
  if (p) { p.isTalking = isTalking; broadcastProximity(); broadcastAllPlayers(); }
  res.json({ ok: true });
});

app.post('/api/leave', (req, res) => {
  gamePlayers.delete(req.body.userId);
  broadcastAllPlayers();
  res.json({ ok: true });
});

// Route pour vérifier le pseudo
app.post('/verifier-pseudo', (req, res) => {
  const { nom } = req.body;

  if (!nom || nom.length < 3) {
    return res.json({ ok: false, erreur: 'Pseudo invalide (min 3 caractères)' });
  }

  const nomExact = nom.trim();
  const inGame = Array.from(gamePlayers.values()).find(p => p.username === nomExact);

  if (!inGame) {
    return res.json({ ok: false, erreur: 'Vous devez être connecté en jeu Roblox' });
  }

  if (webSessions.has(nomExact)) {
    return res.json({ ok: false, erreur: 'Ce joueur est déjà connecté au vocal' });
  }

  res.json({ ok: true, nomExact, inGame: true });
});

// Route pour les credentials ICE
app.get('/turn-credentials', (req, res) => {
  res.json({ iceServers });
});

// Socket.IO - Gestion des connexions
io.on('connection', (socket) => {
  console.log('[SOCKET] Nouvelle connexion:', socket.id);
  let nomJoueur = null;

  socket.on('rejoindre', ({ nom }) => {
    const inGame = Array.from(gamePlayers.values()).find(p => p.username === nom);
    if (!inGame) {
      socket.emit('force-deconnexion', { raison: 'Vous devez être connecté en jeu Roblox' });
      return;
    }

    if (webSessions.has(nom)) {
      socket.emit('force-deconnexion', { raison: 'Nom déjà utilisé' });
      return;
    }

    nomJoueur = nom;
    webSessions.set(socket.id, { username: nom, isTalking: false, userId: inGame.userId });
    inGame.socketId = socket.id;

    console.log('[JOUEUR] Connecté:', nom);
    socket.emit('joueur-valide');
    broadcastAllPlayers();
  });

  socket.on('signal', ({ pour, de, signal }) => {
    const session = Array.from(webSessions.entries()).find(([id, s]) => s.username === pour);
    if (session) {
      const [socketId] = session;
      io.to(socketId).emit('signal', { de, signal });
    }
  });

  socket.on('voice:talking', ({ username, isTalking }) => {
    const session = webSessions.get(socket.id);
    if (session) { session.isTalking = isTalking; }
    broadcastAllPlayers();
  });

  socket.on('disconnect', () => {
    if (nomJoueur) {
      console.log('[JOUEUR] Déconnecté:', nomJoueur);
      io.emit('joueur-parti', { nom: nomJoueur });
      webSessions.delete(socket.id);
      broadcastAllPlayers();
    }
  });
});

// Envoyer la liste des peers actifs
function envoyerListePeers() {
  const nomsActifs = Array.from(webSessions.values()).map(s => s.username);
  io.emit('peers-actifs', nomsActifs);
}

// Nettoyage des joueurs inactifs
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of gamePlayers) {
    if (now - p.lastUpdate > 10000) { gamePlayers.delete(id); broadcastAllPlayers(); }
  }
}, 3000);

server.listen(PORT, () => {
  console.log(`[SERVEUR] Chat vocal démarré sur le port ${PORT}`);
  console.log(`[SERVEUR] Accès: http://localhost:${PORT}`);
});
