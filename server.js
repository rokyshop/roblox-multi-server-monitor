const express = require('express');
const app  = express();
const PORT = process.env.PORT || 3000;

const MAX_FRAMES = 300;   // ~15s à 20fps
const SERVER_TTL = 60_000;

app.use(express.json({ limit: '2mb' }));

// serverId → { lastSeen, cameras: Map, players: Map }
const servers = new Map();
let activeViewer = null;

function getOrCreate(serverId) {
    if (!servers.has(serverId)) {
        servers.set(serverId, {
            lastSeen: Date.now(),
            cameras:  new Map(),
            players:  new Map(),
        });
    }
    return servers.get(serverId);
}

// ─── POST /report ────────────────────────────────────────────────
app.post('/report', (req, res) => {
    const { serverId, cameraId, cframe, fov, frames, joins, leaves } = req.body;
    if (!serverId) return res.status(400).json({ error: 'serverId manquant' });

    const srv = getOrCreate(serverId);
    srv.lastSeen = Date.now();

    if (cameraId) {
        const existing   = srv.cameras.get(cameraId) ?? { frames: [] };
        const merged     = frames?.length
            ? [...existing.frames, ...frames]
            : existing.frames;
        const trimmed    = merged.length > MAX_FRAMES
            ? merged.slice(-MAX_FRAMES)
            : merged;

        srv.cameras.set(cameraId, {
            cframe:    cframe ?? existing.cframe,
            fov:       fov    ?? existing.fov ?? 70,
            frames:    trimmed,
            timestamp: Date.now(),
        });
    }

    joins?.forEach(p  => srv.players.set(p.userId, p));
    leaves?.forEach(id => srv.players.delete(id));

    // Fallback Studio : contrôle via /report si MessagingService indispo
    const shouldBeActive = (activeViewer === serverId);
    res.json({ ok: true, active: shouldBeActive });
});

// ─── POST /watch ─────────────────────────────────────────────────
app.post('/watch', (req, res) => {
    const { serverId } = req.body;
    if (!serverId) return res.status(400).json({ error: 'serverId manquant' });
    const old = activeViewer;
    activeViewer = serverId;
    console.log(`[Watch] ${old ?? 'aucun'} → ${serverId}`);
    res.json({ ok: true, watching: serverId, stopped: old });
});

// ─── POST /unwatch ───────────────────────────────────────────────
app.post('/unwatch', (req, res) => {
    const old = activeViewer;
    activeViewer = null;
    console.log(`[Unwatch] ${old ?? 'aucun'}`);
    res.json({ ok: true, stopped: old });
});

// ─── GET /servers ────────────────────────────────────────────────
app.get('/servers', (_req, res) => {
    const now    = Date.now();
    const active = [];
    for (const [id, data] of servers) {
        if (now - data.lastSeen < SERVER_TTL) {
            active.push(id);
        } else {
            servers.delete(id);
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

    // Flush les frames après envoi
    const frames  = cam.frames;
    cam.frames    = [];

    res.json({
        cframe:    cam.cframe,
        fov:       cam.fov,
        frames,
        skinCache: Array.from(srv.players.values()),
        timestamp: cam.timestamp,
    });
});

// ─── Cleanup ─────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of servers) {
        if (now - data.lastSeen >= SERVER_TTL) {
            if (activeViewer === id) activeViewer = null;
            servers.delete(id);
        }
    }
}, 30_000);

app.listen(PORT, () => console.log(`[Monitor] Actif sur :${PORT}`));
