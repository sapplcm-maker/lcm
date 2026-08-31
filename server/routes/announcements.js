/* Announcements — CRUD, publish/archive, attachments, notifications. */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, UPLOAD_DIR } = require('../db');
const { requireAuth, requirePermission, hasPerm } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { required, isDate, esc } = require('../middleware/validate');
const { uploader } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

const canManage = (user) => hasPerm(user, 'announcements.manage');
const canPublish = (user) => hasPerm(user, 'announcements.publish');

function attachMeta(a) {
  a.attachments = db.prepare('SELECT id, original_name, stored_name, mime_type, size, created_at FROM announcement_attachments WHERE announcement_id = ?').all(a.id);
  return a;
}

function notifyAll(title, body, link, authorId) {
  const users = db.prepare('SELECT id FROM users WHERE status = ? AND id != ?').all('active', authorId);
  const ins = db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const u of users) ins.run(u.id, 'announcement', title, body, link);
  });
  tx();
  return users.length;
}

// ---- List ----
router.get('/', (req, res) => {
  const { status = '', mine = '0' } = req.query;
  const isManager = canManage(req.user);
  const where = [];
  const params = [];
  if (isManager && status) { where.push('a.status = ?'); params.push(status); }
  else if (!isManager) {
    where.push("a.status = 'published'");
    where.push('(a.publish_at IS NULL OR a.publish_at <= datetime(\'now\'))');
    where.push('(a.expires_at IS NULL OR a.expires_at >= datetime(\'now\'))');
  }
  if (mine === '1') { where.push('a.author_id = ?'); params.push(req.user.id); }
  const rows = db.prepare(
    `SELECT a.*, u.first_name, u.last_name, u.profile_picture,
            (SELECT COUNT(*) FROM announcement_attachments WHERE announcement_id = a.id) AS attachment_count
     FROM announcements a JOIN users u ON u.id = a.author_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.published_at IS NULL, a.published_at DESC, a.created_at DESC`
  ).all(...params);
  res.json({ announcements: rows.map(attachMeta) });
});

// ---- Detail ----
router.get('/:id', (req, res) => {
  const a = db.prepare('SELECT a.*, u.first_name, u.last_name FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  const isManager = canManage(req.user);
  const isAuthor = a.author_id === req.user.id;
  if (!isManager && !isAuthor) {
    if (a.status !== 'published') return res.status(404).json({ error: 'Announcement not found' });
    if (a.publish_at && a.publish_at > new Date().toISOString().slice(0, 19).replace('T', ' ')) return res.status(404).json({ error: 'Announcement not found' });
    if (a.expires_at && a.expires_at < new Date().toISOString().slice(0, 19).replace('T', ' ')) return res.status(404).json({ error: 'Announcement not found' });
  }
  res.json({ announcement: attachMeta(a) });
});

// ---- Create ----
router.post('/', requirePermission('announcements.manage'), (req, res) => {
  const miss = required(req.body, ['title', 'body']);
  if (miss.length) return res.status(400).json({ error: 'Title and body are required.' });
  const { title, body, publish_at = null, expires_at = null, publish = false } = req.body;
  if (publish_at && !isDate(publish_at)) return res.status(400).json({ error: 'Invalid publish date.' });
  if (expires_at && !isDate(expires_at)) return res.status(400).json({ error: 'Invalid expiration date.' });
  if (publish_at && expires_at && expires_at < publish_at) return res.status(400).json({ error: 'Expiration date must be after publish date.' });
  const willPublish = publish === true && canPublish(req.user);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const r = db.prepare(
    'INSERT INTO announcements(title, body, author_id, status, publish_at, expires_at, published_at) VALUES(?,?,?,?,?,?,?)'
  ).run(esc(title), esc(body), req.user.id, willPublish ? 'published' : 'draft', publish_at || null, expires_at || null, willPublish ? now : null);
  audit(req, 'announcement.create', 'announcement', r.lastInsertRowid, { title, status: willPublish ? 'published' : 'draft' });
  const notified = willPublish ? notifyAll(title.slice(0, 100), body.slice(0, 200), '#/announcements', req.user.id) : 0;
  if (willPublish) audit(req, 'announcement.publish', 'announcement', r.lastInsertRowid, { notified });
  res.status(201).json({ ok: true, id: r.lastInsertRowid, notified });
});

// ---- Update ----
router.put('/:id', requirePermission('announcements.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (a.author_id !== req.user.id && req.user.role_code !== 'admin') return res.status(403).json({ error: 'Only the author or an administrator may edit this announcement.' });
  const { title, body, publish_at, expires_at } = req.body;
  db.prepare(
    `UPDATE announcements SET title = COALESCE(?, title), body = COALESCE(?, body),
     publish_at = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(title ?? null, body ?? null,
    publish_at === undefined ? a.publish_at : (publish_at || null),
    expires_at === undefined ? a.expires_at : (expires_at || null), a.id);
  audit(req, 'announcement.update', 'announcement', a.id, { fields: Object.keys(req.body) });
  res.json({ ok: true });
});

// ---- Publish ----
router.post('/:id/publish', requirePermission('announcements.publish'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (a.author_id !== req.user.id && req.user.role_code !== 'admin') return res.status(403).json({ error: 'Only the author or an administrator may publish this announcement.' });
  if (a.status === 'archived') return res.status(400).json({ error: 'Archived announcements cannot be published.' });
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare("UPDATE announcements SET status = 'published', published_at = COALESCE(published_at, ?), publish_at = COALESCE(publish_at, ?), updated_at = datetime('now') WHERE id = ?")
    .run(now, now, a.id);
  const notified = notifyAll(a.title.slice(0, 100), a.body.slice(0, 200), '#/announcements', req.user.id);
  audit(req, 'announcement.publish', 'announcement', a.id, { notified });
  res.json({ ok: true, notified });
});

// ---- Archive ----
router.post('/:id/archive', requirePermission('announcements.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (a.author_id !== req.user.id && req.user.role_code !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE announcements SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(a.id);
  audit(req, 'announcement.archive', 'announcement', a.id, {});
  res.json({ ok: true });
});

// ---- Delete (drafts only; published → archive) ----
router.delete('/:id', requirePermission('announcements.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (a.author_id !== req.user.id && req.user.role_code !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (a.status === 'published') return res.status(400).json({ error: 'Published announcements cannot be deleted. Archive them instead.' });
  db.prepare('DELETE FROM announcements WHERE id = ?').run(a.id);
  audit(req, 'announcement.delete', 'announcement', a.id, {});
  res.json({ ok: true });
});

// ---- Attachments ----
router.post('/:id/attachments', requirePermission('announcements.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (a.author_id !== req.user.id && req.user.role_code !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const up = uploader({ field: 'file', maxSize: 10 * 1024 * 1024 });
  up(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const r = db.prepare('INSERT INTO announcement_attachments(announcement_id, original_name, stored_name, mime_type, size, uploaded_by) VALUES(?,?,?,?,?,?)')
      .run(a.id, req.file.originalname.slice(0, 200), req.file.filename, req.file.mimetype, req.file.size, req.user.id);
    audit(req, 'announcement.attachment', 'announcement', a.id, { file: req.file.originalname });
    res.status(201).json({ ok: true, id: r.lastInsertRowid, original_name: req.file.originalname, size: req.file.size });
  });
});

router.delete('/attachments/:attId', requirePermission('announcements.manage'), (req, res) => {
  const att = db.prepare('SELECT * FROM announcement_attachments WHERE id = ?').get(req.params.attId);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(att.announcement_id);
  if (a && a.author_id !== req.user.id && req.user.role_code !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM announcement_attachments WHERE id = ?').run(att.id);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, att.stored_name)); } catch (_) {}
  audit(req, 'announcement.attachment_delete', 'announcement', att.announcement_id, { file: att.original_name });
  res.json({ ok: true });
});

module.exports = router;
