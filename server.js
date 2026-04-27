const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const MAX_FRAMES = 50;
const SERVER_TTL = 60_000;

app.use(express.json({ limit: '1mb' }));

// serverId → { lastSeen, cameras: Map, players: Map }
const servers = new Map();

// 🔥 NOUVEAU : quel serveur est actuellement regardé
let activeViewer = null;

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

// ─── POST /report ───────────────────────────────────────────────
app.post('/report', (req, res) => {
    const { serverId, cameraId, cframe, fov, frames, joins, leaves } = req.body;
    if (!serverId) return res.status(400).json({ error: 'serverId obligatoire' });

    const srv = getOrCreateServer(serverId);
    srv.lastSeen = Date.now();

    if (cameraId && frames?.length > 0) {
        const existing = srv.cameras.get(cameraId);
        const merged = [...(existing?.frames ?? []), ...frames];
        srv.cameras.set(cameraId, {
            cframe, fov,
            frames: merged.length > MAX_FRAMES ? merged.slice(-MAX_FRAMES) : merged,
            timestamp: Date.now(),
        });
    }

    if (cameraId && !frames) {
        srv.cameras.set(cameraId, {
            cframe, fov,
            frames: srv.cameras.get(cameraId)?.frames ?? [],
            timestamp: Date.now(),
        });
    }

    joins?.forEach(p  => srv.players.set(p.userId, p));
    leaves?.forEach(id => srv.players.delete(id));

    // ✅ active contrôlé par MessagingService désormais
    // On garde le fallback pour Studio (MessagingService indisponible)
    const shouldBeActive = (activeViewer === serverId);
    res.json({ ok: true, active: shouldBeActive });
});

// ─── POST /watch (clic sur un serveur) ──────────────────────────
app.post('/watch', (req, res) => {
    const { serverId } = req.body;
    if (!serverId) return res.status(400).json({ error: 'serverId obligatoire' });

    const oldServer = activeViewer;
    activeViewer = serverId;

    console.log(`[Watch] ${oldServer || 'aucun'} → ${serverId}`);
    res.json({ ok: true, watching: serverId, stopped: oldServer });
});

// ─── POST /unwatch ─────────────────────────────────────────────
app.post('/unwatch', (req, res) => {  // ✅ Plus de underscore, body peut être vide
    const old = activeViewer;
    activeViewer = null;
    console.log(`[Watch] Arrêt de ${old}`);
    res.json({ ok: true, stopped: old });
});

// ─── GET /servers ────────────────────────────────────────────────
app.get('/servers', (_req, res) => {
    const now = Date.now();
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

    const payload = {
        ...cam,
        skinCache: Array.from(srv.players.values()),
    };
    cam.frames = []; // flush

    res.json(payload);
});

// ─── Cleanup périodique ──────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of servers) {
        if (now - data.lastSeen >= SERVER_TTL) {
            servers.delete(id);
            // Si le serveur qui expire était le viewer actif, on libère
            if (activeViewer === id) {
                activeViewer = null;
            }
        }
    }
}, 30_000);

app.listen(PORT, () => console.log(`[Monitor] Backend on-demand actif sur :${PORT}`));
