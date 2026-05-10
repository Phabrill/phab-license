const express = require('express');
const cors = require('cors');
const app = express();

const PORT = 3000;
const API_KEY = 'CHANGE_MOI_CLE_SECRETE'; // ← Change cette clé !

app.use(cors());
app.use(express.json());

// Stockage en mémoire (remplace par une base de données si besoin)
let logs = [];
let players = [];

// ── MIDDLEWARE : vérification clé API ──────────────────────────────
function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Clé API invalide' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════
//  ROUTES — RÉCEPTION (FiveM → Backend)
// ══════════════════════════════════════════════════════════════════

// POST /api/log — Reçoit un log depuis FiveM
app.post('/api/log', checkApiKey, (req, res) => {
  const { type, player, player_id, reason, admin, server } = req.body;

  if (!type || !player) {
    return res.status(400).json({ error: 'Champs manquants: type, player requis' });
  }

  const log = {
    id: Date.now(),
    type: type.toLowerCase(),       // ban, kick, warn, chat, join, money...
    player,
    player_id: player_id || '?',
    reason: reason || '—',
    admin: admin || 'Système',
    server: server || 'Serveur',
    time: new Date().toISOString(),
  };

  logs.unshift(log);
  if (logs.length > 500) logs = logs.slice(0, 500); // Garde les 500 derniers

  console.log(`[LOG] ${log.type.toUpperCase()} | ${log.player} | ${log.reason}`);
  res.json({ success: true, log });
});

// POST /api/players — Met à jour la liste des joueurs connectés
app.post('/api/players', checkApiKey, (req, res) => {
  const { playerList } = req.body;
  if (!Array.isArray(playerList)) {
    return res.status(400).json({ error: 'playerList doit être un tableau' });
  }
  players = playerList;
  res.json({ success: true, count: players.length });
});

// ══════════════════════════════════════════════════════════════════
//  ROUTES — LECTURE (Panel → Backend)
// ══════════════════════════════════════════════════════════════════

// GET /api/logs — Récupère les logs (avec filtres optionnels)
app.get('/api/logs', checkApiKey, (req, res) => {
  let result = [...logs];

  // Filtre par type
  if (req.query.type) {
    result = result.filter(l => l.type === req.query.type);
  }

  // Filtre par joueur
  if (req.query.player) {
    const q = req.query.player.toLowerCase();
    result = result.filter(l => l.player.toLowerCase().includes(q));
  }

  // Limite
  const limit = parseInt(req.query.limit) || 50;
  result = result.slice(0, limit);

  res.json({ success: true, total: logs.length, logs: result });
});

// GET /api/players — Récupère les joueurs connectés
app.get('/api/players', checkApiKey, (req, res) => {
  res.json({ success: true, count: players.length, players });
});

// GET /api/stats — Stats globales
app.get('/api/stats', checkApiKey, (req, res) => {
  const today = new Date().toDateString();
  const todayLogs = logs.filter(l => new Date(l.time).toDateString() === today);

  res.json({
    success: true,
    stats: {
      players_online: players.length,
      logs_total: logs.length,
      logs_today: todayLogs.length,
      bans_today: todayLogs.filter(l => l.type === 'ban').length,
      kicks_today: todayLogs.filter(l => l.type === 'kick').length,
      warns_today: todayLogs.filter(l => l.type === 'warn').length,
    }
  });
});

// GET / — Page de statut
app.get('/', (req, res) => {
  res.json({
    name: 'Phab Logs Backend',
    version: '1.0.0',
    status: 'online',
    logs_in_memory: logs.length,
    players_online: players.length,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ── DÉMARRAGE ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Phab Backend démarré sur http://localhost:${PORT}`);
  console.log(`🔑 Clé API : ${API_KEY}`);
  console.log(`📋 Routes disponibles:`);
  console.log(`   POST /api/log       → Envoyer un log (FiveM)`);
  console.log(`   POST /api/players   → Mettre à jour joueurs (FiveM)`);
  console.log(`   GET  /api/logs      → Lire les logs (panel)`);
  console.log(`   GET  /api/players   → Lire les joueurs (panel)`);
  console.log(`   GET  /api/stats     → Statistiques`);
});
