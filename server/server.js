/* =====================================================================
 * LCM-OMES — Application entry point
 * ===================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const express = require('express');
const helmet = require('helmet');
const multerError = require('multer').MulterError;
const { db } = require('./db');
const { loadSession, SID_COOKIE } = require('./middleware/auth');
const { ensureCsrfCookie, csrfProtect } = require('./middleware/csrf');

// Auto-bootstrap: if the database has no users yet (fresh deploy), seed it
// so the portal is immediately usable (Replit/Render/office PC all benefit).
{
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    console.log('[i] Empty database detected — seeding initial data…');
    const seed = spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
    if (seed.status !== 0) console.warn('[!] Seeding had issues — continuing anyway.');
  }
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- Security headers ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: false, // enabled automatically when HTTPS terminates at this server
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---- Cookie parser (tiny, dependency-free) ----
app.use((req, res, next) => {
  req.cookies = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) {
      const k = part.slice(0, i).trim();
      try { req.cookies[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { req.cookies[k] = part.slice(i + 1).trim(); }
    }
  }
  next();
});

app.use(loadSession);

// Every /api request gets a CSRF cookie; mutating requests are validated.
app.use('/api', ensureCsrfCookie, csrfProtect);

// ---- Static frontend ----
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h' }));

// ---- API routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/members', require('./routes/members'));
app.use('/api/schedules', require('./routes/schedule'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/evaluations', require('./routes/evaluations'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/files', require('./routes/files'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---- 404 + error handling ----
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err instanceof multerError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'Upload error: ' + err.message });
  }
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[✓] LCM Ministry Portal listening on http://localhost:${PORT}`);
  console.log(`    Static:  ${PUBLIC_DIR}`);
  console.log(`    DB:      ${db.name}`);
});

module.exports = app;
