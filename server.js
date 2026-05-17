const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { WebSocketServer } = require('ws');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT    = 3000;
const API_KEY = 'phabbase2026';

app.use(cors());
app.use(express.json());

let logs    = [];
let players = [];

// ── COMPTES ADMIN ─────────────────────────────────────────────
// Rôles : owner > admin > moderateur > lecteur
let accounts = [
  {
    id: '1',
    username: 'admin',
    password: hashPwd('phabbase2026'),
    role: 'owner',
    createdAt: new Date().toISOString(),
    createdBy: 'système',
  }
];

// Permissions par rôle
const PERMS = {
  owner:      { voir_logs:true, ban:true, kick:true, warn:true, clear_logs:true, gerer_comptes:true },
  admin:      { voir_logs:true, ban:true, kick:true, warn:true, clear_logs:true, gerer_comptes:false },
  moderateur: { voir_logs:true, ban:false, kick:true, warn:true, clear_logs:false, gerer_comptes:false },
  lecteur:    { voir_logs:true, ban:false, kick:false, warn:false, clear_logs:false, gerer_comptes:false },
};

// Sessions actives
let sessions = {};

function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd + 'phab_salt_2026').digest('hex');
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getSession(req) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions[token]) return null;
  const s = sessions[token];
  if (Date.now() > s.expires) { delete sessions[token]; return null; }
  return s;
}

// ── MIDDLEWARE ────────────────────────────────────────────────
function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Clé API invalide' });
  next();
}

function requireSession(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Non connecté' });
  req.session = s;
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Non connecté' });
    const perms = PERMS[s.role] || {};
    if (!perms[perm]) return res.status(403).json({ error: 'Permission refusée' });
    req.session = s;
    next();
  };
}

// ── WEBSOCKET ─────────────────────────────────────────────────
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const s = token && sessions[token];
  if (!s) { ws.close(); return; }
  ws.send(JSON.stringify({ event: 'init', data: { logs: logs.slice(0, 200), players, role: s.role, perms: PERMS[s.role] } }));
  ws.on('close', () => {});
});

// ── AUTH ROUTES ───────────────────────────────────────────────

// POST /auth/login
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });
  const acc = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!acc || acc.password !== hashPwd(password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const token = genToken();
  sessions[token] = {
    token, userId: acc.id, username: acc.username, role: acc.role,
    expires: Date.now() + 8 * 3600 * 1000, // 8h
  };
  console.log('[AUTH] Connexion : ' + acc.username + ' (' + acc.role + ')');
  res.json({ success: true, token, username: acc.username, role: acc.role, perms: PERMS[acc.role] });
});

// POST /auth/logout
app.post('/auth/logout', requireSession, (req, res) => {
  delete sessions[req.session.token];
  res.json({ success: true });
});

// GET /auth/me
app.get('/auth/me', requireSession, (req, res) => {
  res.json({ success: true, username: req.session.username, role: req.session.role, perms: PERMS[req.session.role] });
});

// ── COMPTES (gestion) ─────────────────────────────────────────

// GET /api/accounts
app.get('/api/accounts', requirePerm('gerer_comptes'), (req, res) => {
  res.json({ success: true, accounts: accounts.map(a => ({ id:a.id, username:a.username, role:a.role, createdAt:a.createdAt, createdBy:a.createdBy })) });
});

// POST /api/accounts
app.post('/api/accounts', requirePerm('gerer_comptes'), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Champs requis' });
  if (!PERMS[role]) return res.status(400).json({ error: 'Rôle invalide' });
  if (accounts.find(a => a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Nom d\'utilisateur déjà pris' });
  }
  const acc = { id: Date.now().toString(), username, password: hashPwd(password), role, createdAt: new Date().toISOString(), createdBy: req.session.username };
  accounts.push(acc);
  console.log('[AUTH] Nouveau compte : ' + username + ' (' + role + ') par ' + req.session.username);
  res.json({ success: true, account: { id:acc.id, username:acc.username, role:acc.role } });
});

// DELETE /api/accounts/:id
app.delete('/api/accounts/:id', requirePerm('gerer_comptes'), (req, res) => {
  const idx = accounts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Compte introuvable' });
  if (accounts[idx].role === 'owner' && accounts.filter(a=>a.role==='owner').length <= 1) {
    return res.status(400).json({ error: 'Impossible de supprimer le dernier owner' });
  }
  const name = accounts[idx].username;
  accounts.splice(idx, 1);
  res.json({ success: true });
  console.log('[AUTH] Compte supprimé : ' + name);
});

// PATCH /api/accounts/:id
app.patch('/api/accounts/:id', requirePerm('gerer_comptes'), (req, res) => {
  const acc = accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Compte introuvable' });
  if (req.body.role && PERMS[req.body.role]) acc.role = req.body.role;
  if (req.body.password) acc.password = hashPwd(req.body.password);
  res.json({ success: true });
});

// ── LOGS ──────────────────────────────────────────────────────

app.post('/api/log', checkApiKey, (req, res) => {
  const { type, player, player_id, reason, admin, unique_id, server } = req.body;
  if (!type || !player) return res.status(400).json({ error: 'type et player requis' });
  const log = {
    id: Date.now(), type: (type||'info').toLowerCase(), player,
    player_id: player_id||'?', unique_id: unique_id||'N/A',
    reason: reason||'—', admin: admin||'Système',
    server: server||'Serveur', time: new Date().toISOString(),
  };
  logs.unshift(log);
  if (logs.length > 1000) logs = logs.slice(0,1000);
  broadcast('new_log', log);
  console.log('[LOG] '+log.type.toUpperCase()+' | '+log.player+(log.unique_id!=='N/A'?' #'+log.unique_id:'')+' | '+log.reason.substring(0,50));
  res.json({ success: true, log });
});

app.get('/api/logs', requirePerm('voir_logs'), (req, res) => {
  let result = [...logs];
  if (req.query.type)   result = result.filter(l=>l.type===req.query.type);
  if (req.query.player) result = result.filter(l=>(l.player||'').toLowerCase().includes(req.query.player.toLowerCase()));
  result = result.slice(0, parseInt(req.query.limit)||100);
  res.json({ success: true, total: logs.length, logs: result });
});

app.delete('/api/logs', requirePerm('clear_logs'), (req, res) => {
  logs = [];
  broadcast('logs_cleared', {});
  res.json({ success: true });
});

app.post('/api/players', checkApiKey, (req, res) => {
  const { playerList } = req.body;
  if (!Array.isArray(playerList)) return res.status(400).json({ error: 'Array requis' });
  players = playerList;
  broadcast('players_update', players);
  res.json({ success: true, count: players.length });
});

app.get('/api/players', requirePerm('voir_logs'), (req, res) => {
  res.json({ success: true, count: players.length, players });
});

app.get('/api/stats', requirePerm('voir_logs'), (req, res) => {
  const today=new Date().toDateString();
  const td=logs.filter(l=>new Date(l.time).toDateString()===today);
  res.json({ success: true, stats: {
    players_online: players.length, logs_total: logs.length, logs_today: td.length,
    bans_today: td.filter(l=>l.type==='ban').length,
    kicks_today: td.filter(l=>l.type==='kick').length,
    warns_today: td.filter(l=>l.type==='warn').length,
  }});
});

app.get('/', (req, res) => {
  res.json({ name:'Phab Logs Backend', version:'2.0.0', status:'online',
    accounts: accounts.length, logs: logs.length, players: players.length,
    uptime: Math.floor(process.uptime()) });
});

server.listen(PORT, () => {
  console.log('✅ Phab Backend v2.0.0 — http://localhost:'+PORT);
  console.log('👤 Compte owner par défaut : admin / phabbase2026');
  console.log('🔴 WebSocket actif');
});
