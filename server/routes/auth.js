/* Auth routes — login, logout, session management, password change/reset. */
'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/rbac');
const { limiter, clearKey } = require('../middleware/ratelimit');
const { rotateCsrf } = require('../middleware/csrf');
const { audit } = require('../middleware/audit');
const { sessionCookieOpts, clearSessionCookie, getSettings, SID_COOKIE } = require('../middleware/auth');
const { required, isUsername, passwordPolicy } = require('../middleware/validate');

const router = express.Router();

const PUBLIC_SETTINGS = ['site_name', 'org_name', 'org_location', 'release_mode', 'allow_self_evaluation', 'password_min_length', 'edit_window_minutes', 'evaluation_grace_days'];

function publicSettings() {
  const s = getSettings();
  const out = {};
  for (const k of PUBLIC_SETTINGS) out[k] = s[k];
  return out;
}

function publicUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

function newSession(req, userId) {
  const settings = getSettings();
  const sliding = (+settings.session_inactivity_minutes || 1440) * 60000;
  const sid = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(sid,user_id,expires_at,ip,user_agent) VALUES(?,?,?,?,?)')
    .run(sid, userId, Date.now() + sliding, req.ip || null, (req.headers['user-agent'] || '').slice(0, 200));
  return sid;
}

function loadMemberContext(userId) {
  const committees = db.prepare(
    `SELECT c.id, c.name, c.code, cm.role_in_committee
     FROM committee_members cm JOIN committees c ON c.id = cm.committee_id
     WHERE cm.user_id = ? AND cm.is_active = 1 AND c.is_active = 1`
  ).all(userId);
  const profile = db.prepare('SELECT * FROM member_profiles WHERE user_id = ?').get(userId) || {};
  return { committees, profile };
}

// ---- CSRF bootstrap (public) ----
router.get('/csrf', (req, res) => {
  const t = (req.cookies && req.cookies['lcm.csrf']) || req.csrfCookieToken || '';
  res.json({ token: t });
});

// ---- Login ----
router.post('/login', (req, res) => {
  const [username, password] = [String(req.body.username || '').trim(), String(req.body.password || '')];
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const ipKey = `login:ip:${req.ip}`;
  const userKey = `login:user:${username.toLowerCase()}`;
  const ipLim = limiter(ipKey, 30, 15 * 60 * 1000);   // per IP: generous (shared NATs)
  const userLim = limiter(userKey, 5, 15 * 60 * 1000); // per username: strict
  if (!ipLim.ok || !userLim.ok) {
    audit(req, 'auth.login_blocked', 'user', null, { username });
    return res.status(429).json({ error: 'Too many failed attempts. Please wait 15 minutes and try again.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    audit(req, 'auth.login_failed', 'user', user ? user.id : null, { username });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  if (user.status !== 'active') {
    audit(req, 'auth.login_blocked', 'user', user.id, { username, reason: 'status=' + user.status });
    return res.status(403).json({ error: user.status === 'suspended' ? 'This account is suspended. Contact the administrator.' : 'This account is not active. Contact the administrator.' });
  }

  clearKey(ipKey);
  clearKey(userKey);

  const sid = newSession(req, user.id);
  const token = rotateCsrf(res, sid);
  res.cookie(SID_COOKIE, sid, sessionCookieOpts(req));
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id);
  audit(req, 'auth.login', 'user', user.id, { username: user.username });

  res.json({
    token,
    user: publicUser({ ...user, perms: [], role_code: '' }),
    settings: publicSettings(),
    must_change_password: !!user.must_change_password,
  });
});

// ---- Logout ----
router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(req.session.sid);
  audit(req, 'auth.logout', 'user', req.user.id, { username: req.user.username });
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

// ---- Current user (full context) ----
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Session invalid' });
  user.perms = req.user.perms;
  user.role_code = req.user.role_code;
  user.role_name = req.user.role_name;
  const ctx = loadMemberContext(user.id);
  const unreadNotifications = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
  const unreadThreads = db.prepare(
    `SELECT COUNT(*) c FROM message_thread_participants p
     JOIN message_threads t ON t.id = p.thread_id
     WHERE p.user_id = ? AND (p.last_read_at IS NULL OR EXISTS (
        SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.sender_id != ? AND m.created_at > p.last_read_at
     ))`
  ).get(user.id, user.id).c;
  res.json({
    user: publicUser(user),
    committees: ctx.committees,
    profile: ctx.profile,
    settings: publicSettings(),
    unread: { notifications: unreadNotifications, threads: unreadThreads },
    must_change_password: !!user.must_change_password,
  });
});

// ---- Change password ----
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password: current, new_password: next } = req.body;
  if (!current || !next) return res.status(400).json({ error: 'Current and new password are required.' });
  const settings = getSettings();
  const minLen = +settings.password_min_length || 8;
  const policyErr = passwordPolicy(next, minLen);
  if (policyErr) return res.status(400).json({ error: policyErr });
  if (next === current) return res.status(400).json({ error: 'New password must be different from the current password.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) {
    audit(req, 'auth.change_password_failed', 'user', user.id, {});
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime(\'now\') WHERE id = ?')
    .run(bcrypt.hashSync(next, 10), user.id);
  // Revoke all other sessions for security
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND sid != ?').run(user.id, req.session.sid);
  audit(req, 'auth.change_password', 'user', user.id, { username: user.username });
  res.json({ ok: true });
});

// ---- Own sessions ----
router.get('/sessions', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT sid, ip, user_agent, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ sessions: rows.map((r) => ({ ...r, current: r.sid === req.session.sid })) });
});

router.delete('/sessions/:sid', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE sid = ? AND user_id = ?').get(req.params.sid, req.user.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(req.params.sid);
  audit(req, 'auth.session_revoke', 'session', null, { sid: req.params.sid });
  res.json({ ok: true });
});

// ---- Forgot password (self-service request → notifies admins) ----
router.post('/forgot-password', (req, res) => {
  const username = String(req.body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Username is required.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (user) {
    db.prepare('INSERT INTO notifications(user_id,type,title,body) VALUES(?,?,?,?)')
      .run(user.id, 'account', 'Password reset requested', 'A password reset was requested for your account. Please contact the administrator to receive a new password.');
    const admins = db.prepare('SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code = ?) AND status = ?').all('admin', 'active');
    for (const a of admins) {
      db.prepare('INSERT INTO notifications(user_id,type,title,body) VALUES(?,?,?,?)')
        .run(a.id, 'account', 'Password reset requested', `${user.first_name} ${user.last_name} (${user.username}) requested a password reset.`);
    }
    audit(req, 'auth.forgot_password', 'user', user.id, { username });
  }
  // Always return the same response to avoid account enumeration
  res.json({ ok: true, message: 'If the account exists, the administrator has been notified.' });
});

// ---- Admin: reset any user's password (temp password + forced change) ----
router.post('/members/:id/reset-password', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  const temp = crypto.randomBytes(5).toString('hex').replace(/[^a-zA-Z0-9]/g, 'x') + 'A1';
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime(\'now\') WHERE id = ?')
    .run(bcrypt.hashSync(temp, 10), target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id); // revoke all sessions
  db.prepare('INSERT INTO notifications(user_id,type,title,body) VALUES(?,?,?,?)')
    .run(target.id, 'account', 'Password reset by administrator', 'Your password was reset. Use the temporary password provided by the administrator, then change it on first login.');
  audit(req, 'member.reset_password', 'user', target.id, { username: target.username });
  res.json({ ok: true, temporary_password: temp });
});

// ---- Admin: list pending password reset requests (from forgot flow) ----
router.get('/password-resets', requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT n.id, n.user_id, u.username, u.first_name, u.last_name, n.created_at
     FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.type = 'account' AND n.title LIKE 'Password reset requested%' AND n.is_read = 0
     ORDER BY n.created_at DESC`
  ).all();
  res.json({ resets: rows });
});

module.exports = router;
