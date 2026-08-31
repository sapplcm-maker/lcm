/* Admin routes — roles/permissions, classifications, committees, settings, audit, stats. */
'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, requireAdmin } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { required, esc } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

/* ---------------- Roles & permissions ---------------- */
router.get('/roles', (req, res) => {
  const roles = db.prepare('SELECT id, code, name, description FROM roles ORDER BY id').all();
  res.json({ roles });
});

router.get('/roles/:id/permissions', requirePermission('roles.manage'), (req, res) => {
  const perms = db.prepare('SELECT code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?').all(req.params.id).map((r) => r.code);
  res.json({ permissions: perms });
});

router.put('/roles/:id/permissions', requirePermission('roles.manage'), (req, res) => {
  const roleId = +req.params.id;
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.code === 'admin') return res.status(400).json({ error: 'Administrator permissions are fixed and cannot be edited.' });
  const codes = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const ins = db.prepare('INSERT INTO role_permissions(role_id, permission_id) VALUES(?, (SELECT id FROM permissions WHERE code = ?))');
    for (const c of codes) ins.run(roleId, c);
  });
  tx();
  audit(req, 'roles.update_permissions', 'role', roleId, { role: role.code, permissions: codes });
  res.json({ ok: true });
});

router.get('/permissions', requirePermission('roles.manage'), (req, res) => {
  res.json({ permissions: db.prepare('SELECT code, description FROM permissions ORDER BY id').all() });
});

/* ---------------- Classifications ---------------- */
router.get('/classifications', (req, res) => {
  res.json({ classifications: db.prepare('SELECT * FROM member_classifications ORDER BY name').all() });
});

router.post('/classifications', requirePermission('classifications.manage'), (req, res) => {
  const miss = required(req.body, ['name']);
  if (miss.length) return res.status(400).json({ error: 'Name is required.' });
  const name = esc(req.body.name);
  if (db.prepare('SELECT 1 FROM member_classifications WHERE name = ?').get(name)) return res.status(409).json({ error: 'Classification already exists.' });
  const r = db.prepare('INSERT INTO member_classifications(name, description) VALUES(?,?)').run(name, esc(req.body.description || ''));
  audit(req, 'classification.create', 'classification', r.lastInsertRowid, { name });
  res.status(201).json({ ok: true });
});

router.put('/classifications/:id', requirePermission('classifications.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM member_classifications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE member_classifications SET name = ?, description = ? WHERE id = ?')
    .run(esc(req.body.name || row.name), esc(req.body.description ?? row.description ?? ''), row.id);
  audit(req, 'classification.update', 'classification', row.id, { name: req.body.name });
  res.json({ ok: true });
});

router.delete('/classifications/:id', requirePermission('classifications.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM member_classifications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const used = db.prepare('SELECT COUNT(*) c FROM users WHERE classification_id = ?').get(row.id).c;
  if (used) return res.status(400).json({ error: `Classification is assigned to ${used} member(s) and cannot be deleted.` });
  db.prepare('DELETE FROM member_classifications WHERE id = ?').run(row.id);
  audit(req, 'classification.delete', 'classification', row.id, { name: row.name });
  res.json({ ok: true });
});

/* ---------------- Committees ---------------- */
router.get('/committees', (req, res) => {
  const isAdmin = req.user.role_code === 'admin';
  const canEval = (req.user.perms || []).includes('evaluations.view');
  let rows;
  if (isAdmin || canEval) {
    rows = db.prepare('SELECT * FROM committees ORDER BY id').all();
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }
  for (const c of rows) {
    c.member_count = db.prepare('SELECT COUNT(*) c FROM committee_members WHERE committee_id = ? AND is_active = 1').get(c.id).c;
    c.categories = db.prepare('SELECT id, name, sort_order FROM committee_categories WHERE committee_id = ? ORDER BY sort_order').all(c.id);
  }
  res.json({ committees: rows });
});

router.post('/committees', requirePermission('committees.manage'), (req, res) => {
  const miss = required(req.body, ['name', 'code']);
  if (miss.length) return res.status(400).json({ error: 'Name and code are required.' });
  if (db.prepare('SELECT 1 FROM committees WHERE code = ?').get(req.body.code)) return res.status(409).json({ error: 'Committee code already exists.' });
  const r = db.prepare('INSERT INTO committees(name, code, description) VALUES(?,?,?)')
    .run(esc(req.body.name), esc(req.body.code).toLowerCase().replace(/\s+/g, '-'), esc(req.body.description || ''));
  audit(req, 'committee.create', 'committee', r.lastInsertRowid, { name: req.body.name });
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});

router.put('/committees/:id', requirePermission('committees.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM committees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE committees SET name = ?, description = ?, is_active = ? WHERE id = ?')
    .run(esc(req.body.name || row.name), esc(req.body.description ?? row.description ?? ''), req.body.is_active === undefined ? row.is_active : (req.body.is_active ? 1 : 0), row.id);
  audit(req, 'committee.update', 'committee', row.id, { name: req.body.name });
  res.json({ ok: true });
});

// Committee membership
router.get('/committees/:id/members', requirePermission('committees.manage'), (req, res) => {
  const rows = db.prepare(
    `SELECT cm.id, cm.user_id, u.first_name, u.last_name, u.username, u.status, cm.role_in_committee, cm.is_active, cm.joined_at
     FROM committee_members cm JOIN users u ON u.id = cm.user_id WHERE cm.committee_id = ? ORDER BY cm.is_active DESC, u.last_name`
  ).all(req.params.id);
  res.json({ members: rows });
});

router.post('/committees/:id/members', requirePermission('committees.manage'), (req, res) => {
  const cid = +req.params.id;
  const { user_id, role_in_committee = 'member' } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required.' });
  if (!['chair', 'secretary', 'member'].includes(role_in_committee)) return res.status(400).json({ error: 'Invalid committee role.' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(user_id)) return res.status(404).json({ error: 'User not found' });
  if (db.prepare('SELECT 1 FROM committee_members WHERE committee_id = ? AND user_id = ?').get(cid, user_id)) return res.status(409).json({ error: 'Member is already on this committee.' });
  db.prepare('INSERT INTO committee_members(committee_id, user_id, role_in_committee) VALUES(?,?,?)').run(cid, user_id, role_in_committee);
  audit(req, 'committee.add_member', 'committee', cid, { user_id, role_in_committee });
  res.status(201).json({ ok: true });
});

router.put('/committees/members/:cmId', requirePermission('committees.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM committee_members WHERE id = ?').get(req.params.cmId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { role_in_committee, is_active } = req.body;
  if (role_in_committee && !['chair', 'secretary', 'member'].includes(role_in_committee)) return res.status(400).json({ error: 'Invalid committee role.' });
  db.prepare('UPDATE committee_members SET role_in_committee = COALESCE(?, role_in_committee), is_active = COALESCE(?, is_active) WHERE id = ?')
    .run(role_in_committee || null, is_active === undefined ? null : (is_active ? 1 : 0), row.id);
  audit(req, 'committee.update_member', 'committee', row.committee_id, { cmId: row.id, role_in_committee, is_active });
  res.json({ ok: true });
});

router.delete('/committees/members/:cmId', requirePermission('committees.manage'), (req, res) => {
  const row = db.prepare('SELECT * FROM committee_members WHERE id = ?').get(req.params.cmId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM committee_members WHERE id = ?').run(row.id);
  audit(req, 'committee.remove_member', 'committee', row.committee_id, { cmId: row.id });
  res.json({ ok: true });
});

// Rating categories
router.put('/committees/:id/categories', requirePermission('committees.manage'), (req, res) => {
  const cid = +req.params.id;
  if (!db.prepare('SELECT 1 FROM committees WHERE id = ?').get(cid)) return res.status(404).json({ error: 'Committee not found' });
  const names = Array.isArray(req.body.categories) ? req.body.categories.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 80)) : [];
  if (!names.length) return res.status(400).json({ error: 'At least one category is required.' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM committee_categories WHERE committee_id = ?').run(cid);
    const ins = db.prepare('INSERT INTO committee_categories(committee_id, name, sort_order) VALUES(?,?,?)');
    names.forEach((n, i) => ins.run(cid, n, i + 1));
  });
  tx();
  audit(req, 'committee.update_categories', 'committee', cid, { categories: names });
  res.json({ ok: true });
});

/* ---------------- System settings ---------------- */
const EDITABLE_SETTINGS = ['site_name', 'org_name', 'org_location', 'release_mode', 'allow_self_evaluation', 'evaluation_grace_days', 'session_inactivity_minutes', 'session_absolute_days', 'edit_window_minutes'];

router.get('/settings', (req, res) => {
  const isAdmin = req.user.role_code === 'admin';
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  if (!isAdmin) {
    const allowed = ['site_name', 'org_name', 'org_location', 'release_mode', 'allow_self_evaluation', 'password_min_length', 'edit_window_minutes'];
    for (const k of Object.keys(s)) if (!allowed.includes(k)) delete s[k];
  }
  res.json({ settings: s });
});

router.put('/settings', requirePermission('settings.manage'), (req, res) => {
  const patch = req.body.settings || {};
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!EDITABLE_SETTINGS.includes(k)) continue;
      if (k === 'release_mode' && !['individual', 'package'].includes(v)) continue;
      if (['allow_self_evaluation'].includes(k)) { db.prepare('INSERT INTO system_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at').run(k, v ? '1' : '0', req.user.id); continue; }
      db.prepare('INSERT INTO system_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at').run(k, String(v), req.user.id);
    }
  });
  tx();
  audit(req, 'settings.update', 'settings', null, { keys: Object.keys(patch) });
  res.json({ ok: true });
});

/* ---------------- Audit log ---------------- */
router.get('/audit', requirePermission('audit.view'), (req, res) => {
  const { action = '', user_id = '', from = '', to = '', page = 1, limit = 100 } = req.query;
  const where = [];
  const params = [];
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  if (user_id) { where.push('user_id = ?'); params.push(user_id); }
  if (from) { where.push('created_at >= ?'); params.push(from); }
  if (to) { where.push('created_at <= ?'); params.push(to + ' 23:59:59'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const offset = Math.max(0, (+page - 1) * +limit);
  const rows = db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, +limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${whereSql}`).get(...params).c;
  res.json({ entries: rows, total, page: +page });
});

/* ---------------- Admin dashboard stats ---------------- */
router.get('/stats', requireAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    members: db.prepare('SELECT COUNT(*) c FROM users WHERE role_id != (SELECT id FROM roles WHERE code = ?)').get('admin').c,
    active_members: db.prepare('SELECT COUNT(*) c FROM users WHERE status = ?').get('active').c,
    pending_members: db.prepare('SELECT COUNT(*) c FROM users WHERE status = ?').get('pending').c,
    suspended_members: db.prepare('SELECT COUNT(*) c FROM users WHERE status = ?').get('suspended').c,
    upcoming_schedules: db.prepare('SELECT COUNT(*) c FROM schedules WHERE schedule_date >= ? AND status != ?').get(today, 'cancelled').c,
    published_announcements: db.prepare('SELECT COUNT(*) c FROM announcements WHERE status = ?').get('published').c,
    pending_review: db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status IN ('pending_review','submitted','resubmitted')").get().c,
    returned: db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'returned'").get().c,
    approved: db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'approved'").get().c,
    released: db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'released'").get().c,
    drafts: db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'draft'").get().c,
  };
  res.json({ stats });
});

module.exports = router;
