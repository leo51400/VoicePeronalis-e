const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MAX_DISTANCE = 50;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const gamePlayers = new Map();
const webSessions = new Map();

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

const audioDir = path.join(__dirname, 'temp_audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

app.post('/api/process-audio', (req, res) => {
    const { audioData, format = 'mp3', bitrate = '128k' } = req.body;
    if (!audioData) return res.status(400).json({ error: 'Missing audio data' });

    const inputPath = path.join(audioDir, `input_${Date.now()}.webm`);
    const outputPath = path.join(audioDir, `output_${Date.now()}.${format}`);

    fs.writeFileSync(inputPath, Buffer.from(audioData, 'base64'));

    ffmpeg(inputPath)
        .toFormat(format)
        .audioBitrate(bitrate)
        .on('end', () => {
            const processed = fs.readFileSync(outputPath);
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
            res.json({ success: true, audioData: processed.toString('base64'), format });
        })
        .on('error', (err) => {
            fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            res.status(500).json({ error: 'FFmpeg processing failed', details: err.message });
        })
        .save(outputPath);
});

io.on('connection', (socket) => {
    socket.on('register', ({ username }) => {
        const inGame = Array.from(gamePlayers.values()).find(p => p.username === username);
        if (!inGame) {
            socket.emit('registered', { ok: false, error: 'Joueur non connecté en jeu' });
            return;
        }
        webSessions.set(socket.id, { username, isTalking: false, userId: inGame.userId });
        inGame.socketId = socket.id;
        socket.emit('registered', { ok: true });
        broadcastAllPlayers();
    });

    socket.on('voice:connect', ({ username }) => {
        const inGame = Array.from(gamePlayers.values()).find(p => p.username === username);
        if (!inGame) {
            socket.emit('connected', { ok: false, error: 'Connectez-vous d\'abord en jeu' });
            return;
        }
        webSessions.set(socket.id, { username, isTalking: false, userId: inGame.userId });
        inGame.socketId = socket.id;
        socket.emit('connected', { ok: true, message: 'Connecté au vocal' });
        broadcastAllPlayers();
    });

    socket.on('voice:disconnect', ({ username }) => {
        webSessions.delete(socket.id);
        broadcastAllPlayers();
    });

    socket.on('voice:talking', ({ username, isTalking }) => {
        const session = webSessions.get(socket.id);
        if (session) { session.isTalking = isTalking; }
        broadcastAllPlayers();
    });

    socket.on('disconnect', () => {
        webSessions.delete(socket.id);
        broadcastAllPlayers();
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, p] of gamePlayers) {
        if (now - p.lastUpdate > 10000) { gamePlayers.delete(id); broadcastAllPlayers(); }
    }
}, 3000);

server.listen(PORT, () => console.log(`[VoiceSystem] Server on :${PORT}`));