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

function broadcastAllPlayers() {
    const gamePlayers = Array.from(players.values()).map(p => ({ username: p.username, isTalking: p.isTalking, source: 'game' }));
    const webSessions = Array.from(voiceSessions.values()).map(s => ({ username: s.username, isTalking: s.isTalking, source: 'web' }));
    const all = [...gamePlayers, ...webSessions];
    io.emit('players:all', all);
}

app.post('/api/update', (req, res) => {
    const { userId, username, position, isTalking } = req.body;
    if (!userId || !position) return res.status(400).json({ error: 'Missing' });
    players.set(userId, { username, position, isTalking: !!isTalking, lastUpdate: Date.now() });
    broadcastProximity();
    broadcastAllPlayers();
    res.json({ ok: true });
});

app.post('/api/talking', (req, res) => {
    const { userId, isTalking } = req.body;
    const p = players.get(userId);
    if (p) { p.isTalking = isTalking; broadcastProximity(); broadcastAllPlayers(); }
    res.json({ ok: true });
});

app.post('/api/leave', (req, res) => {
    players.delete(req.body.userId);
    broadcastAllPlayers();
    res.json({ ok: true });
});

io.on('connection', (socket) => {
    socket.on('register', ({ username }) => {
        voiceSessions.set(socket.id, { username, socketId: socket.id, isTalking: false });
        socket.emit('registered', { ok: true });
        broadcastAllPlayers();
    });

    socket.on('voice:connect', ({ username }) => {
        voiceSessions.set(socket.id, { username, socketId: socket.id, isTalking: false });
        socket.emit('connected', { ok: true, message: 'Connecté au vocal' });
        broadcastAllPlayers();
    });

    socket.on('voice:disconnect', ({ username }) => {
        voiceSessions.delete(socket.id);
        broadcastAllPlayers();
    });

    socket.on('voice:talking', ({ username, isTalking }) => {
        const session = voiceSessions.get(socket.id);
        if (session) { session.isTalking = isTalking; }
        broadcastAllPlayers();
    });

    socket.on('disconnect', () => {
        const session = voiceSessions.get(socket.id);
        if (session) { voiceSessions.delete(socket.id); broadcastAllPlayers(); }
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, p] of players) if (now - p.lastUpdate > 10000) { players.delete(id); broadcastAllPlayers(); }
}, 3000);

server.listen(PORT, () => console.log(`[VoiceSystem] Server on :${PORT}`));
