// =============================================================================
// Eden Worth Battery Simulator · backend server
// Node + Express + better-sqlite3, single-file keep-it-simple architecture
// =============================================================================
import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------------
// Config (env-driven)
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || '/data/battery-sim.db';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';  // set in .env
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;

if (!AUTH_PASSWORD) {
  console.error('FATAL: AUTH_PASSWORD not set — refusing to start.');
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Database
// -----------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    data TEXT NOT NULL,        -- JSON blob of all sim parameters
    created_by TEXT,           -- username who created it
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );

  CREATE TABLE IF NOT EXISTS project_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    data TEXT NOT NULL,
    changed_by TEXT,
    changed_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_history_project ON project_history(project_id, changed_at DESC);

  -- Model feedback: prose comments from reviewers (peer review, post-mortem, ideas)
  -- Intentionally NOT auto-applied to the physics model. You/Kyle triage them.
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,             -- NULL = general/model-wide feedback
    author TEXT NOT NULL,
    comment TEXT NOT NULL,
    status TEXT DEFAULT 'open',  -- open | accepted | rejected | implemented
    resolution_note TEXT,         -- what was done about it
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_project ON feedback(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS user_activity (
    username TEXT PRIMARY KEY,
    last_seen TEXT NOT NULL,
    current_project TEXT
  );
`);

// Seed initial feedback if table is empty — documents peer review already applied
const feedbackCount = db.prepare('SELECT COUNT(*) as c FROM feedback').get().c;
if (feedbackCount === 0) {
  db.prepare(`INSERT INTO feedback(project_id, author, comment, status, resolution_note,
                                   resolved_by, resolved_at, created_at)
              VALUES(NULL, ?, ?, 'implemented', ?, ?, ?, ?)`).run(
    'peer-review',
    'The documentation suggests nRF91 peak power could easily reach 500 mA when battery is at 3.0 V, but 50 to 100 mA less when battery is fully charged (3.7 V used in documents). So in addition to the average load on the battery, the peak currents coupled with the voltage sag of the higher internal resistance batteries may make the outcome worse, and favour the hybrid battery even more.',
    'Implemented in v3.5 as voltage-scaled modem peak current modifier. User-toggleable per project (Custom Modifiers panel). Model: I_actual(V) = I_nominal × (3.6V / V_terminal), capped at 1.8×. Default OFF to preserve backward-compat with existing saved projects.',
    'Dale', new Date().toISOString(), new Date().toISOString()
  );

  // Kyle's v3.5-era feedback — captured open, pending triage
  db.prepare(`INSERT INTO feedback(project_id, author, comment, status, created_at)
              VALUES(NULL, ?, ?, 'open', ?)`).run(
    'Kyle',
    'Please add peak current consideration to the model in conjunction with the average currents. Also allow setting the min and max operational voltages would be ideal (to model under-voltage events). Can you incorporate a complete LTE power profile, specifically the search/attach phase and TAU. Eg. the Nordic Online Power Profiler, but that only shows the best case, not the attach and peak currents.',
    new Date().toISOString()
  );

  // Kyle's follow-up on TX power class and poor-coverage retries
  db.prepare(`INSERT INTO feedback(project_id, author, comment, status, resolution_note,
                                   resolved_by, resolved_at, created_at)
              VALUES(NULL, ?, ?, 'implemented', ?, ?, ?, ?)`).run(
    'Kyle',
    'Can assume 23 dBm as the max output power, but there is also the repeated TXs to consider in poor environment. (Suggests adding: poor-coverage retry scenarios to the LTE preset menu, and/or a retry-rate modifier in Custom Modifiers to capture the Balco-style failure mode where marginal RF conditions cause the modem to retry multiple times per transmission, multiplying active-phase duration by 2-10x.)',
    'Implemented in v3.6 via (a) three new poor-coverage LTE presets (fair coverage 2.4×, NB-IoT CE1 8×, CE2 fringe ~27×), and (b) new coverageRetryMultiplier modifier in Custom Modifiers panel with both discrete dropdown (good/fair/poor/fringe) and override slider (1–40×). Multiplier scales active-phase duration in simulate loop. PC3 23dBm confirmed as default assumption across presets; PC5 option pending clarification on whether any EW products use 20dBm mode.',
    'Dale', new Date().toISOString(), new Date().toISOString()
  );

  // Dale's own v3.7 correction — fixed incorrect product/backhaul/cell mappings
  db.prepare(`INSERT INTO feedback(project_id, author, comment, status, resolution_note,
                                   resolved_by, resolved_at, created_at)
              VALUES(NULL, ?, ?, 'implemented', ?, ?, ?, ?)`).run(
    'Dale',
    'Built-in projects had incorrect product/backhaul/cell assignments — Optima Pulse was marked as LoRaWAN (actually NB-IoT with 2× ER18505M A-cell pack), Optima Enviro needs both LoRa AND NB-IoT variants (Hay Shepherd has both), SenseAll is LoRa-only for now (not NB-IoT), eco-SENSE is multi-radio (LoRa AU915/AS923 and NB-IoT). Also missing: Water Rat NB-IoT project, Farmo Water Pressure with 2× ER18505M Fanso spiral pack. Cell library only had one generic HPC; actual stocked variants are HPC1520/1530/1550 (Long Sing) with different 5Ω load voltages. ER34615M capacity was wrong (13 Ah should be 14 Ah).',
    'Rewrote BUILTIN_PROJECTS in v3.7 with correct mappings verified against Confluence (Farmo Product Documentation, LoRaWAN Hay Shepherd, senseAll pages). CELLS dict expanded from 3 to 6 cells: ER34615 (19Ah), ER34615M (14Ah, corrected), ER34615+HPC1520/1530/1550 (three real Long Sing variants with their actual 5Ω load voltage specs from drawings P101001460/70/80), ER18505M_2P (7Ah Fanso pack used in Optima Pulse and Farmo Water Pressure). CELL_FAMILIES grouping added so compareMode compares within family (D-cell alternatives / HPC sizing) rather than all 6 cells. Built-in projects now: Optima Pulse NB-IoT, Optima Enviro Shepherd LoRa + NB-IoT, eco-SENSE LoRa AU915/AS923/NB-IoT, SenseAll LoRa AS923, EW PRO68 GSM, Water Rat NB-IoT, Farmo Water Pressure NB-IoT, Dog Tracker. Optima Enviro generic excluded (unreleased).',
    'Dale', new Date().toISOString(), new Date().toISOString()
  );

  // v3.8 — Design tab (Mode B reverse spec)
  db.prepare(`INSERT INTO feedback(project_id, author, comment, status, resolution_note,
                                   resolved_by, resolved_at, created_at)
              VALUES(NULL, ?, ?, 'implemented', ?, ?, ?, ?)`).run(
    'Dale',
    'Add reverse design mode — instead of picking a cell and seeing how long it lasts (forward), state requirements (target lifespan, environment, backhaul, TX rate) and have the tool recommend feasible configs. Also a what-if dashboard (Mode C) for side-by-side scenario comparison.',
    'Implemented Mode B in v3.8 as new Design tab. User specifies 5 requirement sections (lifespan target, environment preset + sliders, backhaul technology, TX frequency + coverage quality, shelf time). Clicking Analyse runs 36 simulations (6 cells × 6 TX frequencies) and returns: (a) ACHIEVABLE/MARGINAL/INFEASIBLE verdict card with narrative, (b) ranked cell list sorted by margin-vs-target, (c) scatter plot showing feasibility envelope (life vs TX freq per cell) with target line overlay. Mode C (side-by-side what-if dashboard) deferred to later release.',
    'Dale', new Date().toISOString(), new Date().toISOString()
  );

  console.log('[battery-sim] seeded 5 initial feedback entries');
}

// -----------------------------------------------------------------------------
// Auth — simple shared password, signed cookie sessions
// -----------------------------------------------------------------------------
function signToken(username) {
  const payload = { u: username, exp: Date.now() + SESSION_DAYS * 86400 * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.ew_auth;
  const session = verifyToken(token);
  if (!session) return res.status(401).json({ error: 'not authenticated' });
  req.user = session.u;
  // Touch activity
  db.prepare(`INSERT INTO user_activity(username, last_seen) VALUES(?, ?)
              ON CONFLICT(username) DO UPDATE SET last_seen=excluded.last_seen`)
    .run(req.user, new Date().toISOString());
  next();
}

// -----------------------------------------------------------------------------
// App
// -----------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);  // we're behind Nginx Proxy Manager
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Health check (for Nginx Proxy Manager / uptime monitoring)
app.get('/healthz', (_req, res) => res.json({ ok: true, version: '3.8.11' }));

// -----------------------------------------------------------------------------
// Auth endpoints
// -----------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing credentials' });
  if (password !== AUTH_PASSWORD) {
    // Tiny artificial delay to slow brute force, no need for formal rate-limit here
    return setTimeout(() => res.status(401).json({ error: 'invalid credentials' }), 400);
  }
  const token = signToken(username);
  res.cookie('ew_auth', token, {
    httpOnly: true, sameSite: 'lax', secure: true,
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
  res.json({ ok: true, username });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('ew_auth');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = verifyToken(req.cookies?.ew_auth);
  if (!session) return res.status(401).json({ error: 'not authenticated' });
  res.json({ username: session.u });
});

// -----------------------------------------------------------------------------
// Project CRUD
// -----------------------------------------------------------------------------
app.get('/api/projects', requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT id, name, description, data, created_by, created_at,
                                  updated_at, updated_by FROM projects ORDER BY updated_at DESC`).all();
  const projects = {};
  for (const r of rows) {
    try {
      projects[r.id] = {
        ...JSON.parse(r.data),
        name: r.name, description: r.description,
        createdBy: r.created_by, createdAt: r.created_at,
        updatedBy: r.updated_by, updatedAt: r.updated_at,
      };
    } catch {}
  }
  res.json({ projects });
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { id, name, description, data } = req.body || {};
  if (!name || !data) return res.status(400).json({ error: 'name and data required' });
  const projectId = id || `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const dataJson = JSON.stringify(data);
  db.prepare(`INSERT INTO projects(id, name, description, data, created_by, created_at, updated_at, updated_by)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(projectId, name, description || '', dataJson, req.user, now, now, req.user);
  db.prepare(`INSERT INTO project_history(project_id, data, changed_by, changed_at)
              VALUES(?, ?, ?, ?)`).run(projectId, dataJson, req.user, now);
  res.json({ id: projectId, name, description, data, createdBy: req.user, createdAt: now, updatedBy: req.user, updatedAt: now });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, description, data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data required' });
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const now = new Date().toISOString();
  const dataJson = JSON.stringify(data);
  db.prepare(`UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description),
              data = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
    .run(name, description, dataJson, now, req.user, id);
  db.prepare(`INSERT INTO project_history(project_id, data, changed_by, changed_at)
              VALUES(?, ?, ?, ?)`).run(id, dataJson, req.user, now);
  // Trim history: keep only last 50 versions per project
  db.prepare(`DELETE FROM project_history WHERE project_id = ?
              AND id NOT IN (SELECT id FROM project_history WHERE project_id = ?
                             ORDER BY changed_at DESC LIMIT 50)`).run(id, id);
  res.json({ ok: true, updatedAt: now, updatedBy: req.user });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/projects/:id/history', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, changed_by, changed_at FROM project_history
                           WHERE project_id = ? ORDER BY changed_at DESC LIMIT 50`).all(req.params.id);
  res.json({ history: rows });
});

app.get('/api/projects/:id/history/:historyId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data, changed_by, changed_at FROM project_history WHERE id = ?')
    .get(req.params.historyId);
  if (!row) return res.status(404).json({ error: 'not found' });
  try { res.json({ ...JSON.parse(row.data), changedBy: row.changed_by, changedAt: row.changed_at }); }
  catch { res.status(500).json({ error: 'corrupt history entry' }); }
});

// -----------------------------------------------------------------------------
// Bulk import/export
// -----------------------------------------------------------------------------
app.post('/api/projects/bulk', requireAuth, (req, res) => {
  const { projects } = req.body || {};
  if (!projects || typeof projects !== 'object') {
    return res.status(400).json({ error: 'projects object required' });
  }
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO projects(id, name, description, data, created_by, created_at, updated_at, updated_by)
                             VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(id) DO UPDATE SET
                               name = excluded.name,
                               description = excluded.description,
                               data = excluded.data,
                               updated_at = excluded.updated_at,
                               updated_by = excluded.updated_by`);
  const tx = db.transaction((entries) => {
    for (const [id, proj] of entries) {
      const { name, description, ...rest } = proj;
      upsert.run(id, name || 'Unnamed', description || '', JSON.stringify(rest),
                 proj.createdBy || req.user, proj.createdAt || now, now, req.user);
    }
  });
  tx(Object.entries(projects));
  res.json({ ok: true, count: Object.keys(projects).length });
});

// -----------------------------------------------------------------------------
// Team activity
// -----------------------------------------------------------------------------
app.get('/api/team/activity', requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT username, last_seen FROM user_activity
                           WHERE last_seen > datetime('now', '-7 days')
                           ORDER BY last_seen DESC`).all();
  res.json({ users: rows });
});

// -----------------------------------------------------------------------------
// Model feedback — prose comments from reviewers
// -----------------------------------------------------------------------------
// These are NOT auto-applied. They get triaged manually. The point is to have
// a durable record of every suggestion, who made it, and what was done about it.
// -----------------------------------------------------------------------------
app.get('/api/feedback', requireAuth, (req, res) => {
  const { project_id, status } = req.query;
  let sql = 'SELECT * FROM feedback WHERE 1=1';
  const params = [];
  if (project_id) { sql += ' AND project_id = ?'; params.push(project_id); }
  else if (project_id === '') { sql += ' AND project_id IS NULL'; }  // general only
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json({ feedback: db.prepare(sql).all(...params) });
});

app.post('/api/feedback', requireAuth, (req, res) => {
  const { project_id, comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'comment required' });
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO feedback(project_id, author, comment, status, created_at)
                             VALUES(?, ?, ?, 'open', ?)`)
    .run(project_id || null, req.user, comment.trim(), now);
  res.json({ id: result.lastInsertRowid, author: req.user, comment: comment.trim(),
             status: 'open', created_at: now, project_id: project_id || null });
});

app.put('/api/feedback/:id', requireAuth, (req, res) => {
  const { status, resolution_note } = req.body || {};
  if (!status || !['open', 'accepted', 'rejected', 'implemented'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE feedback SET status = ?, resolution_note = ?,
                             resolved_by = ?, resolved_at = ? WHERE id = ?`)
    .run(status, resolution_note || null, req.user, now, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, resolved_by: req.user, resolved_at: now });
});

app.delete('/api/feedback/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Static files — serve the frontend
// -----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html', maxAge: '5m',
}));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// -----------------------------------------------------------------------------
// Startup
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[battery-sim] listening on port ${PORT}`);
  console.log(`[battery-sim] database: ${DB_PATH}`);
  console.log(`[battery-sim] started at ${new Date().toISOString()}`);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[battery-sim] ${sig} received, closing db`);
    db.close();
    process.exit(0);
  });
}
