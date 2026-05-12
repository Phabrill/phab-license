const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { WebSocketServer } = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT    = 3000;
const API_KEY = 'phabbase2026';

app.use(cors());
app.use(express.json());

let logs    = [];
let players = [];

function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Clé API invalide' });
  next();
}

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connecté (' + wss.clients.size + ' total)');
  ws.send(JSON.stringify({ event: 'init', data: { logs: logs.slice(0, 100), players } }));
  ws.on('close', () => console.log('[WS] Client déconnecté'));
});

app.post('/api/log', checkApiKey, (req, res) => {
  const { type, player, player_id, reason, admin, server } = req.body;
  if (!type || !player) return res.status(400).json({ error: 'type et player requis' });
  const log = {
    id: Date.now(), type: type.toLowerCase(), player,
    player_id: player_id || '?', reason: reason || '—',
    admin: admin || 'Système', server: server || 'Serveur',
    time: new Date().toISOString(),
  };
  logs.unshift(log);
  if (logs.length > 500) logs = logs.slice(0, 500);
  broadcast('new_log', log);
  console.log('[LOG] ' + log.type.toUpperCase() + ' | ' + log.player + ' | ' + log.reason);
  res.json({ success: true, log });
});

app.post('/api/players', checkApiKey, (req, res) => {
  const { playerList } = req.body;
  if (!Array.isArray(playerList)) return res.status(400).json({ error: 'playerList doit être un tableau' });
  players = playerList;
  broadcast('players_update', players);
  res.json({ success: true, count: players.length });
});

app.get('/api/logs', checkApiKey, (req, res) => {
  let result = [...logs];
  if (req.query.type) result = result.filter(l => l.type === req.query.type);
  if (req.query.player) result = result.filter(l => l.player.toLowerCase().includes(req.query.player.toLowerCase()));
  result = result.slice(0, parseInt(req.query.limit) || 50);
  res.json({ success: true, total: logs.length, logs: result });
});

app.get('/api/players', checkApiKey, (req, res) => {
  res.json({ success: true, count: players.length, players });
});

app.get('/api/stats', checkApiKey, (req, res) => {
  const today = new Date().toDateString();
  const todayLogs = logs.filter(l => new Date(l.time).toDateString() === today);
  res.json({ success: true, stats: {
    players_online: players.length, logs_total: logs.length,
    logs_today: todayLogs.length,
    bans_today: todayLogs.filter(l => l.type === 'ban').length,
    kicks_today: todayLogs.filter(l => l.type === 'kick').length,
    warns_today: todayLogs.filter(l => l.type === 'warn').length,
  }});
});

app.get('/', (req, res) => {
  res.json({ name: 'Phab Logs Backend', version: '1.0.0', status: 'online',
    clients: wss.clients.size, logs_in_memory: logs.length,
    players_online: players.length, uptime_seconds: Math.floor(process.uptime()) });
});

server.listen(PORT, () => {
  console.log('✅ Phab Backend démarré sur http://localhost:' + PORT);
  console.log('🔴 WebSocket temps réel actif');
  console.log('🔑 Clé API : ' + API_KEY);
});
