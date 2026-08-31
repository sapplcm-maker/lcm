/* Member management — admin CRUD, status, classification, role, directory. */
'use strict';
const bcrypt = require('bcryptjs');
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, requireAdmin } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { required, isUsername, isEmail, passwordPolicy } = require('../middleware/validate');
const { getSettings } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const BASIC_FIELDS = `u.id, u.first_name, u.last_name, u.username, u.email, u.phone, u.status, u.profile_picture,
  u.classification_id, c.name AS classification, r.code AS role_code, r.name AS role_name, u.created_at, u.last_login_at`;

function memberRow(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

// ---- Directory (officer+ and admins; used for messaging recipients & committee lists) ----
router.get('/directory', (req, res) => {
  const canView = req.user.role_code === 'admin' || (req.user.perms || []).includes('members.view') || (req.user.perms || []).includes('evaluations.view');
  if (!canView) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.status, u.profile_picture, u.classification_id, c.name AS classification, r.code AS role_code
     FROM users u LEFT JOIN member_classifications c ON c.id = u.classification_id JOIN roles r ON r.id = u.role_id
     WHERE u.status = 'active' ORDER BY u.last_name, u.first_name`
  ).all();
  res.json({ members: rows });
});

// ---- List (admin: full; officer: limited) ----
router.get('/', (req, res) => {
  const isAdmin = req.user.role_code === 'admin';
  const canManage = req.user.role_code === 'admin' || (req.user.perms || []).includes('members.manage');
  if (!isAdmin && !(req.user.perms || []).includes('members.view')) return res.status(403).json({ error: 'Forbidden' });

  const { search = '', status = '', classification_id = '', role_id = '', page = 1, limit = 50 } = req.query;
  const where = [];
  const params = [];
  if (search) {
    where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where.push('u.status = ?'); params.push(status); }
  if (classification_id) { where.push('u.classification_id = ?'); params.push(classification_id); }
  if (role_id) { where.push('u.role_id = ?'); params.push(role_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const offset = Math.max(0, (+page - 1) * +limit);
  const rows = db.prepare(
    `SELECT ${BASIC_FIELDS} FROM users u
     LEFT JOIN member_classifications c ON c.id = u.classification_id
     JOIN roles r ON r.id = u.role_id ${whereSql}
     ORDER BY u.last_name, u.first_name LIMIT ? OFFSET ?`
  ).all(...params, +limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${whereSql}`).get(...params).c;
  const list = rows.map((r) => (isAdmin || canManage ? r : { id: r.id, first_name: r.first_name, last_name: r.last_name, username: r.username, status: r.status, profile_picture: r.profile_picture, classification: r.classification, role_name: r.role_name }));
  res.json({ members: list, total, page: +page, limit: +limit });
});

// ---- Create ----
router.post('/', requirePermission('members.manage'), (req, res) => {
  const miss = required(req.body, ['username', 'first_name', 'last_name', 'password', 'role_id']);
  if (miss.length) return res.status(400).json({ error: 'Missing required fields: ' + miss.join(', ') });
  const { username, first_name, last_name, email = null, phone = null, role_id, classification_id = null, status = 'active', password } = req.body;
  if (!isUsername(username)) return res.status(400).json({ error: 'Username must be 3–30 characters (letters, numbers, . _ -).' });
  if (email && !isEmail(email)) return res.status(400).json({ error: 'Invalid email address.' });
  const settings = getSettings();
  const policyErr = passwordPolicy(password, +settings.password_min_length || 8);
  if (policyErr) return res.status(400).json({ error: policyErr });
  if (!db.prepare('SELECT 1 FROM roles WHERE id = ?').get(role_id)) return res.status(400).json({ error: 'Invalid role.' });
  if (classification_id && !db.prepare('SELECT 1 FROM member_classifications WHERE id = ?').get(classification_id)) return res.status(400).json({ error: 'Invalid classification.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) return res.status(409).json({ error: 'That username is already taken.' });

  const r = db.prepare(
    `INSERT INTO users(role_id, classification_id, username, password_hash, first_name, last_name, email, phone, status, created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(role_id, classification_id, username, bcrypt.hashSync(password, 10), first_name.trim(), last_name.trim(), email, phone, status, req.user.id);
  audit(req, 'member.create', 'user', r.lastInsertRowid, { username });
  const user = db.prepare(`SELECT ${BASIC_FIELDS} FROM users u LEFT JOIN member_classifications c ON c.id=u.classification_id JOIN roles r ON r.id=u.role_id WHERE u.id=?`).get(r.lastInsertRowid);
  res.status(201).json({ member: memberRow(user) });
});

// ---- View one ----
router.get('/:id', (req, res) => {
  const id = +req.params.id;
  const isAdmin = req.user.role_code === 'admin';
  const canView = isAdmin || (req.user.perms || []).includes('members.view');
  if (!canView && id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const u = db.prepare(
    `SELECT ${BASIC_FIELDS}, u.email FROM users u LEFT JOIN member_classifications c ON c.id=u.classification_id JOIN roles r ON r.id=u.role_id WHERE u.id=?`
  ).get(id);
  if (!u) return res.status(404).json({ error: 'Member not found' });
  const profile = db.prepare('SELECT * FROM member_profiles WHERE user_id = ?').get(id) || null;
  const committees = db.prepare(
    `SELECT c.id, c.name, c.code, cm.role_in_committee FROM committee_members cm JOIN committees c ON c.id = cm.committee_id WHERE cm.user_id = ?`
  ).all(id);
  const output = { member: memberRow(u), profile, committees };
  if (!isAdmin) { // officers/members get a sanitized view
    delete output.member.email;
    delete output.member.phone;
  }
  res.json(output);
});

// ---- Update ----
router.put('/:id', requirePermission('members.manage'), (req, res) => {
  const id = +req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Member not found' });
  const { first_name, last_name, email = null, phone = null, role_id, classification_id, status } = req.body;
  const updates = [];
  const params = [];
  if (first_name !== undefined) { updates.push('first_name = ?'); params.push(String(first_name).trim()); }
  if (last_name !== undefined) { updates.push('last_name = ?'); params.push(String(last_name).trim()); }
  if (email !== undefined) {
    if (email && !isEmail(email)) return res.status(400).json({ error: 'Invalid email address.' });
    updates.push('email = ?'); params.push(email || null);
  }
  if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
  if (role_id !== undefined) {
    if (!db.prepare('SELECT 1 FROM roles WHERE id = ?').get(role_id)) return res.status(400).json({ error: 'Invalid role.' });
    updates.push('role_id = ?'); params.push(role_id);
  }
  if (classification_id !== undefined) {
    if (classification_id && !db.prepare('SELECT 1 FROM member_classifications WHERE id = ?').get(classification_id)) return res.status(400).json({ error: 'Invalid classification.' });
    updates.push('classification_id = ?'); params.push(classification_id || null);
  }
  if (status !== undefined) {
    if (!['active', 'inactive', 'suspended', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    updates.push('status = ?'); params.push(status);
    if (status !== 'active') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (!updates.length && !req.body.profile) return res.status(400).json({ error: 'Nothing to update.' });
  if (updates.length) {
    updates.push('updated_at = datetime(\'now\')');
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
  }
  // Profile details (birthday, address, emergency contact, bio, joined date)
  if (req.body.profile && typeof req.body.profile === 'object') {
    const p = req.body.profile;
    const keys = ['birthday', 'address', 'emergency_contact_name', 'emergency_contact_phone', 'joined_date', 'bio', 'notes'];
    const sets = [];
    const vals = [];
    for (const k of keys) {
      if (p[k] !== undefined) { sets.push(`${k} = ?`); vals.push(p[k] === '' ? null : p[k]); }
    }
    if (sets.length) {
      const hasRow = db.prepare('SELECT 1 FROM member_profiles WHERE user_id = ?').get(id);
      if (hasRow) {
        db.prepare(`UPDATE member_profiles SET ${sets.join(', ')}, updated_at = datetime('now') WHERE user_id = ?`).run(...vals, id);
      } else {
        db.prepare(`INSERT INTO member_profiles(user_id, ${sets.join(', ')}, updated_at) VALUES(${['?', ...sets.map(() => '?')].join(', ')}, datetime('now'))`).run(id, ...vals);
      }
    }
  }
  audit(req, 'member.update', 'user', id, { username: u.username, fields: Object.keys(req.body) });
  res.json({ ok: true });
});

// ---- Status transition (activate/deactivate/suspend) ----
router.post('/:id/status', requirePermission('members.manage'), (req, res) => {
  const id = +req.params.id;
  const { status } = req.body;
  if (!['active', 'inactive', 'suspended', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Member not found' });
  if (status !== 'active') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  audit(req, 'member.status', 'user', id, { username: u.username, from: u.status, to: status });
  res.json({ ok: true });
});

// ---- Delete ----
// ?permanent=1 → hard delete (only allowed when the member has NO historical records)
// default → soft delete (deactivate), history preserved
router.delete('/:id', requirePermission('members.manage'), (req, res) => {
  const id = +req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Member not found' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });

  if (req.query.permanent === '1') {
    // A member may only be permanently removed if they have no historical records.
    const history = {
      evaluations_as_member: db.prepare('SELECT COUNT(*) c FROM evaluations WHERE member_id = ?').get(id).c,
      evaluations_as_evaluator: db.prepare('SELECT COUNT(*) c FROM evaluations WHERE evaluator_id = ?').get(id).c,
      schedule_assignments: db.prepare('SELECT COUNT(*) c FROM schedule_assignments WHERE user_id = ?').get(id).c,
      created_schedules: db.prepare('SELECT COUNT(*) c FROM schedules WHERE created_by = ?').get(id).c,
      messages_sent: db.prepare('SELECT COUNT(*) c FROM messages WHERE sender_id = ?').get(id).c,
      announcements_authored: db.prepare('SELECT COUNT(*) c FROM announcements WHERE author_id = ?').get(id).c,
    };
    const hasHistory = Object.values(history).some((c) => c > 0);
    if (hasHistory) {
      return res.status(409).json({
        error: 'This member has records (schedules, evaluations, messages or announcements) that must be preserved, so they cannot be permanently erased. Remove them from active use instead to keep their history.',
        history,
      });
    }
    const tx = db.transaction(() => {
      // keep the audit trail but detach the user reference
      db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    tx();
    audit(req, 'member.delete_permanent', 'user', id, { username: u.username });
    return res.json({ ok: true, permanent: true, message: 'Member permanently deleted.' });
  }

  // soft delete (deactivate)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('inactive', id);
  audit(req, 'member.deactivate', 'user', id, { username: u.username });
  res.json({ ok: true, message: 'Member deleted. Their records are kept safely; use Restore to bring them back.' });
});

module.exports = router;
