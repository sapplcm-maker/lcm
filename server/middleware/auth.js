/* Session middleware — DB-backed sessions with sliding + absolute expiry. */
'use strict';
const { db } = require('../db');

const SID_COOKIE = 'lcm.sid';
const SESSION_TTL_FALLBACK = 24 * 60 * 60 * 1000;       // 24 h sliding
const ABSOLUTE_TTL_FALLBACK = 7 * 24 * 60 * 60 * 1000;  // 7 d absolute

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function sessionCookieOpts(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' };
}

function clearSessionCookie(res, req) {
  res.clearCookie(SID_COOKIE, { ...sessionCookieOpts(req), maxAge: 0 });
}

function loadSession(req, res, next) {
  req.user = null;
  req.session = null;
  const sid = req.cookies ? req.cookies[SID_COOKIE] : undefined;
  if (!sid) return next();

  const row = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);
  if (!row) { clearSessionCookie(res, req); return next(); }

  const settings = getSettings();
  const sliding = (+settings.session_inactivity_minutes || 1440) * 60000;
  const absolute = (+settings.session_absolute_days || 7) * 86400000;
  const createdMs = Date.parse(String(row.created_at).replace(' ', 'T') + 'Z') || Date.now();
  const now = Date.now();

  if (now > row.expires_at || now - createdMs > absolute) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    clearSessionCookie(res, req);
    return next();
  }

  // Sliding renewal when more than half the window has elapsed.
  if (row.expires_at - now < sliding / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(now + sliding, sid);
  }

  const user = db.prepare(
    `SELECT u.*, r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
  ).get(row.user_id);
  if (!user) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    clearSessionCookie(res, req);
    return next();
  }

  user.perms = db.prepare(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
  ).all(user.role_id).map((x) => x.code);

  req.session = { sid, csrf_token: row.csrf_token, created_ms: createdMs };
  req.user = user;
  next();
}

module.exports = { loadSession, getSettings, sessionCookieOpts, clearSessionCookie, SID_COOKIE };
