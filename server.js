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

app.post('/api/update', (req, res) => {
    const { userId, username, position, isTalking } = req.body;
    if (!userId || !position) return res.status(400).json({ error: 'Missing' });
    players.set(userId, { username, position, isTalking: !!isTalking, socketId: players.get(userId)?.socketId, lastUpdate: Date.now() });
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
    io.emit('playerLeft', req.body.userId);
    res.json({ ok: true });
});

io.on('connection', (socket) => {
    socket.on('register', ({ username }) => {
        for (const [id, p] of players) {
            if (p.username === username) { p.socketId = socket.id; break; }
        }
        socket.emit('registered');
    });

    socket.on('connect', ({ username }) => {
        for (const [id, p] of players) {
            if (p.username === username) {
                p.socketId = socket.id;
                socket.emit('connected', { nearby: [] });
                break;
            }
        }
    });

    socket.on('talking', ({ username, isTalking }) => {
        for (const [id, p] of players) {
            if (p.username === username) { p.isTalking = isTalking; break; }
        }
        broadcastProximity();
    });

    socket.on('muteAll', () => {});
    socket.on('disconnect', () => {
        for (const [id, p] of players) if (p.socketId === socket.id) p.socketId = null;
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, p] of players) if (now - p.lastUpdate > 10000) players.delete(id);
}, 3000);

server.listen(PORT, () => console.log(`[VoiceSystem] Render server on :${PORT}`));
