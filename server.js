const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MAX_DISTANCE = 50;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const players = new Map();
const voiceSessions = new Map();
const usernameToSocket = new Map();

function getDistance(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function broadcastProximity() {
    const all = Array.from(players.entries());
    for (const [id, p] of all) {
        const nearby = [];
        for (const [oid, op] of all) {
            if (oid === id || !op.isTalking) continue;
            const d = getDistance(p.position, op.position);
            if (d <= MAX_DISTANCE) nearby.push({ id: oid, username: op.username, distance: Math.round(d), volume: Math.round(100 - (d / MAX_DISTANCE) * 100) });
        }
        if (p.socketId) io.to(p.socketId).emit('nearby', nearby);
    }
}

function broadcastVoicePlayers() {
    const sessions = Array.from(voiceSessions.values()).map(s => ({ username: s.username, isTalking: s.isTalking }));
    io.emit('voice:players', sessions);
}

app.post('/api/update', (req, res) => {
    const { userId, username, position, isTalking } = req.body;
    if (!userId || !position) return res.status(400).json({ error: 'Missing' });
    players.set(userId, { username, position, isTalking: !!isTalking, lastUpdate: Date.now() });
    broadcastProximity();
    res.json({ ok: true });
});

app.post('/api/talking', (req, res) => {
    const { userId, isTalking } = req.body;
    const p = players.get(userId);
    if (p) { p.isTalking = isTalking; broadcastProximity(); }
    res.json({ ok: true });
});

app.post('/api/leave', (req, res) => {
    players.delete(req.body.userId);
    res.json({ ok: true });
});

io.on('connection', (socket) => {
    console.log('[Socket] Connected:', socket.id);

    socket.on('register', ({ username }) => {
        console.log('[Socket] Register:', username);
        voiceSessions.set(socket.id, { username, socketId: socket.id, isTalking: false });
        usernameToSocket.set(username, socket.id);
        socket.emit('registered', { ok: true });
        broadcastVoicePlayers();
    });

    socket.on('voice:connect', ({ username }) => {
        console.log('[Socket] Voice connect:', username);
        voiceSessions.set(socket.id, { username, socketId: socket.id, isTalking: false });
        usernameToSocket.set(username, socket.id);
        socket.emit('connected', { ok: true, message: 'Connecté au vocal' });
        broadcastVoicePlayers();
    });

    socket.on('voice:disconnect', ({ username }) => {
        console.log('[Socket] Voice disconnect:', username);
        voiceSessions.delete(socket.id);
        usernameToSocket.delete(username);
        broadcastVoicePlayers();
    });

    socket.on('voice:talking', ({ username, isTalking }) => {
        const session = voiceSessions.get(socket.id);
        if (session) { session.isTalking = isTalking; }
        broadcastVoicePlayers();
    });

    socket.on('disconnect', () => {
        console.log('[Socket] Disconnected:', socket.id);
        const session = voiceSessions.get(socket.id);
        if (session) {
            usernameToSocket.delete(session.username);
            voiceSessions.delete(socket.id);
            broadcastVoicePlayers();
        }
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, p] of players) if (now - p.lastUpdate > 10000) players.delete(id);
}, 3000);

server.listen(PORT, () => console.log(`[VoiceSystem] Server running on :${PORT}`));
