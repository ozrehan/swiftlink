// SwiftLink — full-stack URL shortener with click analytics
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    code TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    referrer TEXT,
    user_agent TEXT,
    FOREIGN KEY (code) REFERENCES links(code) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks(code);
  PRAGMA foreign_keys = ON;
`);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidAlias(a) {
  return typeof a === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(a);
}

function shortUrl(req, code) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/${code}`;
}

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// ---------- API ----------

// List all links with click counts
app.get('/api/links', (req, res) => {
  const rows = db.prepare(`
    SELECT l.code, l.url, l.created_at, COUNT(c.id) AS clicks
    FROM links l LEFT JOIN clicks c ON c.code = l.code
    GROUP BY l.code ORDER BY l.created_at DESC
  `).all();
  res.json(rows.map(r => ({ ...r, shortUrl: shortUrl(req, r.code) })));
});

// Create a short link
app.post('/api/links', (req, res) => {
  const { url, alias } = req.body || {};
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'A valid http(s) URL is required.' });
  }
  let code;
  if (alias !== undefined && alias !== null && alias !== '') {
    if (!isValidAlias(alias)) {
      return res.status(400).json({ error: 'Alias must be 1-64 chars: letters, numbers, _ or -.' });
    }
    code = alias;
  } else {
    do { code = randomCode(6); }
    while (db.prepare('SELECT 1 FROM links WHERE code = ?').get(code));
  }
  try {
    db.prepare('INSERT INTO links (code, url) VALUES (?, ?)').run(code, url);
  } catch (e) {
    if (e.code === 'ERR_SQLITE_CONSTRAINT_PRIMARYKEY' || String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Alias already in use.' });
    }
    throw e;
  }
  const row = db.prepare('SELECT code, url, created_at FROM links WHERE code = ?').get(code);
  res.status(201).json({ ...row, shortUrl: shortUrl(req, code) });
});

// Per-link stats
app.get('/api/links/:code/stats', (req, res) => {
  const link = db.prepare('SELECT code, url, created_at FROM links WHERE code = ?').get(req.params.code);
  if (!link) return res.status(404).json({ error: 'Link not found.' });

  const totalClicks = db.prepare('SELECT COUNT(*) AS n FROM clicks WHERE code = ?').get(link.code).n;

  const dayRows = db.prepare(`
    SELECT date(ts) AS day, COUNT(*) AS n FROM clicks
    WHERE code = ? AND ts >= datetime('now', '-14 days')
    GROUP BY day ORDER BY day
  `).all(link.code);
  const byDay = Object.fromEntries(dayRows.map(r => [r.day, r.n]));
  const clicksPerDay = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    clicksPerDay.push({ date: d, clicks: byDay[d] || 0 });
  }

  const topReferrers = db.prepare(`
    SELECT COALESCE(NULLIF(referrer, ''), '(direct)') AS referrer, COUNT(*) AS n
    FROM clicks WHERE code = ? GROUP BY referrer ORDER BY n DESC LIMIT 10
  `).all(link.code).map(r => ({ referrer: r.referrer, clicks: r.n }));

  res.json({ ...link, totalClicks, clicksPerDay, topReferrers });
});

// QR code PNG for the short URL
app.get('/api/links/:code/qr', async (req, res) => {
  const link = db.prepare('SELECT code FROM links WHERE code = ?').get(req.params.code);
  if (!link) return res.status(404).json({ error: 'Link not found.' });
  try {
    const png = await QRCode.toBuffer(shortUrl(req, link.code), { width: 256, margin: 2 });
    res.type('png').send(png);
  } catch {
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// Delete a link (and its clicks)
app.delete('/api/links/:code', (req, res) => {
  db.prepare('DELETE FROM clicks WHERE code = ?').run(req.params.code);
  const info = db.prepare('DELETE FROM links WHERE code = ?').run(req.params.code);
  if (info.changes === 0) return res.status(404).json({ error: 'Link not found.' });
  res.status(204).end();
});

// ---------- Redirect (must come after /api routes, before static) ----------
app.get('/:code', (req, res, next) => {
  const link = db.prepare('SELECT url FROM links WHERE code = ?').get(req.params.code);
  if (!link) return next();
  db.prepare('INSERT INTO clicks (code, referrer, user_agent) VALUES (?, ?, ?)')
    .run(req.params.code, req.get('referer') || req.get('referrer') || null, req.get('user-agent') || null);
  res.redirect(302, link.url);
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`SwiftLink listening on port ${PORT}`));
}

module.exports = { app, db };
