const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Cap sur le nombre de frames stockées par caméra (évite OOM)
const MAX_FRAMES = 50;
// Durée d'inactivité avant suppression d'un serveur (ms)
const SERVER_TTL = 60_000;

app.use(express.json({ limit: '1mb' }));

// serverId → { lastSeen: number, cameras: Map, players: Map }
const servers = new Map();

// ─── Helpers ────────────────────────────────────────────────────
function getOrCreateServer(serverId) {
    if (!servers.has(serverId)) {
        servers.set(serverId, {
            lastSeen: Date.now(),
            cameras: new Map(),
            players: new Map(),
        });
    }
    return servers.get(serverId);
}

// ─── POST /report ────────────────────────────────────────────────
app.post('/report', (req, res) => {
    const { serverId, cameraId, cframe, fov, frames, joins, leaves } = req.body;
    if (!serverId) return res.status(400).json({ error: 'serverId obligatoire' });

    const srv = getOrCreateServer(serverId);
    srv.lastSeen = Date.now();

    if (cameraId) {
        // On fusionne les nouvelles frames avec un cap pour éviter la fuite mémoire
        const existing = srv.cameras.get(cameraId);
        const prevFrames = existing?.frames ?? [];
        const merged = [...prevFrames, ...(frames ?? [])];

        srv.cameras.set(cameraId, {
            cframe,
            fov,
            frames: merged.length > MAX_FRAMES ? merged.slice(-MAX_FRAMES) : merged,
            timestamp: Date.now(),
        });
    }

    joins?.forEach(p  => srv.players.set(p.userId, p));
    leaves?.forEach(id => srv.players.delete(id));

    res.json({ ok: true });
});

// ─── GET /servers ────────────────────────────────────────────────
app.get('/servers', (_req, res) => {
    const now = Date.now();
    const active = [];

    for (const [id, data] of servers) {
        if (now - data.lastSeen < SERVER_TTL) {
            active.push(id);
        } else {
            servers.delete(id); // nettoyage inline
        }
    }

    res.json(active);
});

// ─── GET /camera ─────────────────────────────────────────────────
app.get('/camera', (req, res) => {
    const { serverId, cameraId } = req.query;
    const srv = servers.get(serverId);
    if (!srv) return res.status(404).json({ error: 'serveur inconnu' });

    const cam = srv.cameras.get(cameraId);
    if (!cam) return res.status(404).json({ error: 'caméra inconnue' });

    // On vide les frames après envoi pour éviter de renvoyer les mêmes données
    const payload = {
        ...cam,
        skinCache: Array.from(srv.players.values()),
    };
    cam.frames = []; // flush

    res.json(payload);
});

// ─── Cleanup périodique (filet de sécurité) ──────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of servers) {
        if (now - data.lastSeen >= SERVER_TTL) servers.delete(id);
    }
}, 30_000);

app.listen(PORT, () => console.log(`[Monitor] Backend actif sur :${PORT}`));
