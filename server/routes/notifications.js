/* Notifications — own list, read state, admin broadcast. */
'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { required, esc } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { unread = '0', limit = 50 } = req.query;
  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (unread === '1') { where.push('is_read = 0'); }
  const rows = db.prepare(
    `SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(...params, +limit);
  res.json({ notifications: rows });
});

router.get('/unread-count', (req, res) => {
  const c = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;
  res.json({ count: c });
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---- Admin-defined ministry broadcast ----
router.post('/broadcast', requirePermission('notifications.broadcast'), (req, res) => {
  const miss = required(req.body, ['title']);
  if (miss.length) return res.status(400).json({ error: 'Title is required.' });
  const { title, body = '', link = null, audience = 'all', user_ids = [] } = req.body;
  const ins = db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)');
  const tx = db.transaction(() => {
    if (audience === 'all') {
      const users = db.prepare('SELECT id FROM users WHERE status = ?').all('active');
      for (const u of users) ins.run(u.id, 'admin', esc(title).slice(0, 150), esc(body).slice(0, 500), link || null);
    } else if (audience === 'role') {
      const roleId = db.prepare('SELECT id FROM roles WHERE code = ?').get(req.body.role_code || 'member');
      if (!roleId) throw new Error('Invalid role');
      const users = db.prepare('SELECT id FROM users WHERE role_id = ? AND status = ?').all(roleId.id, 'active');
      for (const u of users) ins.run(u.id, 'admin', esc(title).slice(0, 150), esc(body).slice(0, 500), link || null);
    } else {
      for (const id of user_ids) ins.run(id, 'admin', esc(title).slice(0, 150), esc(body).slice(0, 500), link || null);
    }
  });
  try {
    tx();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  audit(req, 'notification.broadcast', 'notification', null, { title, audience });
  res.json({ ok: true });
});

module.exports = router;
