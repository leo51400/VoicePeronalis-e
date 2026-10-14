const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Stockage en mémoire des joueurs
const players = new Map(); // userId -> { userId, username, position, isTalking, socketId }
const userSockets = new Map(); // userId -> socket

// Middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// API ROBLOX - Reçoit positions depuis le jeu
// ============================================
app.post('/api/update', (req, res) => {
    const { userId, username, position, isTalking } = req.body;
    
    if (!userId || !position) {
        return res.status(400).json({ error: 'Missing required fields: userId, position' });
    }
    
    const playerData = {
        userId: String(userId),
        username: username || `Player_${userId}`,
        position: {
            x: Number(position.x) || 0,
            y: Number(position.y) || 0,
            z: Number(position.z) || 0
        },
        isTalking: Boolean(isTalking),
        lastUpdate: Date.now()
    };
    
    players.set(String(userId), playerData);
    
    // Broadcast à tous les clients web connectés
    io.emit('player:update', playerData);
    
    // Calcule la proximité pour ce joueur
    updateProximityForUser(String(userId));
    
    res.json({ success: true });
});

// ============================================
// HEALTH CHECK pour Render
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', players: players.size, uptime: process.uptime() });
});

// ============================================
// SOCKET.IO - Connexion clients web
// ============================================
io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);
    
    // Rejoindre avec userId
    socket.on('join', (userId) => {
        const uid = String(userId);
        socket.userId = uid;
        userSockets.set(uid, socket);
        socket.join(uid);
        
        // Envoie l'état actuel de tous les joueurs
        const allPlayers = Array.from(players.values());
        socket.emit('players:state', allPlayers);
        
        // Calcule proximité pour ce joueur
        updateProximityForUser(uid);
        
        console.log(`[Socket] User joined: ${uid}`);
    });
    
    // Toggle micro depuis le site web
    socket.on('voice:toggle', ({ userId, isTalking }) => {
        const uid = String(userId);
        const player = players.get(uid);
        if (player) {
            player.isTalking = Boolean(isTalking);
            player.lastUpdate = Date.now();
            
            // Notifie Roblox via l'API (optionnel - Roblox poll déjà)
            io.emit('player:update', player);
            updateProximityForUser(uid);
        }
    });
    
    // WebRTC Signaling - Relay entre peers
    socket.on('signal', ({ to, from, signal }) => {
        const targetSocket = userSockets.get(String(to));
        if (targetSocket) {
            targetSocket.emit('signal', { from: String(from), signal });
        }
    });
    
    // Demande de connexion WebRTC vers un joueur proche
    socket.on('webrtc:connect', ({ targetUserId }) => {
        const targetSocket = userSockets.get(String(targetUserId));
        if (targetSocket) {
            targetSocket.emit('webrtc:incoming', { from: socket.userId });
        }
    });
    
    socket.on('webrtc:answer', ({ to, answer }) => {
        const targetSocket = userSockets.get(String(to));
        if (targetSocket) {
            targetSocket.emit('webrtc:answer', { from: socket.userId, answer });
        }
    });
    
    socket.on('ice:candidate', ({ to, candidate }) => {
        const targetSocket = userSockets.get(String(to));
        if (targetSocket) {
            targetSocket.emit('ice:candidate', { from: socket.userId, candidate });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.userId) {
            userSockets.delete(socket.userId);
            console.log(`[Socket] Disconnected: ${socket.userId}`);
        }
    });
});

// ============================================
// PROXIMITÉ - Calcule qui est à portée (50 studs)
// ============================================
function updateProximityForUser(userId) {
    const player = players.get(userId);
    if (!player) return;
    
    const nearby = [];
    const maxDistance = 50; // studs
    
    for (const [id, other] of players) {
        if (id === userId) continue;
        if (!other.isTalking) continue; // Seulement ceux qui parlent
        
        const dx = other.position.x - player.position.x;
        const dy = other.position.y - player.position.y;
        const dz = other.position.z - player.position.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        if (distance <= maxDistance) {
            let volume = 1.0;
            if (distance > 30) {
                volume = Math.max(0, 1 - (distance - 30) / 20); // Fade 30-50
            }
            
            nearby.push({
                userId: id,
                username: other.username,
                distance: Math.round(distance),
                volume: Math.round(volume * 100)
            });
        }
    }
    
    // Envoie à ce joueur spécifique
    const socket = userSockets.get(userId);
    if (socket) {
        socket.emit('proximity:update', nearby);
    }
}

// ============================================
// NETTOYAGE - Supprime joueurs inactifs
// ============================================
setInterval(() => {
    const now = Date.now();
    for (const [id, player] of players) {
        if (now - player.lastUpdate > 30000) { // 30s sans update
            players.delete(id);
            io.emit('player:left', id);
        }
    }
}, 10000);

// ============================================
// DÉMARRAGE
// ============================================
server.listen(PORT, () => {
    console.log(`🚀 VoiceChat VRMT Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready for WebRTC signaling`);
    console.log(`📍 Proximity range: 50 studs (fade 30-50)`);
    console.log(`🌐 Ready for Render deployment`);
});

module.exports = { app, server, io };