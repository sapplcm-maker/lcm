/* Internal messaging — participant-privacy threads, reply, edit/delete own, read state, search. */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, UPLOAD_DIR } = require('../db');
const { requireAuth } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { esc } = require('../middleware/validate');
const { uploader } = require('../middleware/upload');
const { getSettings } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// millisecond-precision UTC timestamp so unread comparisons are exact
const nowMs = () => new Date().toISOString().slice(0, 23).replace('T', ' ');

function isParticipant(threadId, userId) {
  return !!db.prepare('SELECT 1 FROM message_thread_participants WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
}

function notifyParticipants(threadId, exceptUserId, title, body, link) {
  const parts = db.prepare('SELECT user_id FROM message_thread_participants WHERE thread_id = ? AND user_id != ?').all(threadId, exceptUserId);
  const ins = db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const p of parts) ins.run(p.user_id, 'message', title, body, link);
  });
  tx();
}

// ---- Thread list (own) ----
router.get('/threads', (req, res) => {
  const { q = '' } = req.query;
  const rows = db.prepare(
    `SELECT t.id, t.title, t.created_at, p.last_read_at,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_id != ? AND m.created_at > COALESCE(p.last_read_at, '1970-01-01')) AS unread,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count,
            (SELECT m2.body FROM messages m2 WHERE m2.thread_id = t.id AND m2.status != 'deleted' ORDER BY m2.id DESC LIMIT 1) AS last_body,
            (SELECT m2.created_at FROM messages m2 WHERE m2.thread_id = t.id ORDER BY m2.id DESC LIMIT 1) AS last_at
     FROM message_thread_participants p
     JOIN message_threads t ON t.id = p.thread_id
     WHERE p.user_id = ?
     ORDER BY last_at DESC`
  ).all(req.user.id, req.user.id);
  const list = [];
  for (const r of rows) {
    if (q) {
      const names = db.prepare(
        `SELECT u.first_name, u.last_name FROM message_thread_participants pp JOIN users u ON u.id = pp.user_id WHERE pp.thread_id = ? AND pp.user_id != ?`
      ).all(r.id, req.user.id).map((n) => `${n.first_name} ${n.last_name}`).join(' ');
      if (!(r.title || '').toLowerCase().includes(q.toLowerCase()) && !(r.last_body || '').toLowerCase().includes(q.toLowerCase()) && !names.toLowerCase().includes(q.toLowerCase())) continue;
    }
    const others = db.prepare(
      `SELECT u.id, u.first_name, u.last_name, u.profile_picture, u.username, u.status
       FROM message_thread_participants pp JOIN users u ON u.id = pp.user_id WHERE pp.thread_id = ? AND pp.user_id != ? ORDER BY u.last_name`
    ).all(r.id, req.user.id);
    list.push({ ...r, others, unread: +r.unread });
  }
  res.json({ threads: list });
});

// ---- Unread count ----
router.get('/unread-count', (req, res) => {
  const c = db.prepare(
    `SELECT COUNT(*) c FROM message_thread_participants p
     WHERE p.user_id = ? AND (p.last_read_at IS NULL OR EXISTS (
        SELECT 1 FROM messages m WHERE m.thread_id = p.thread_id AND m.sender_id != ? AND m.created_at > p.last_read_at))`
  ).get(req.user.id, req.user.id).c;
  res.json({ count: c });
});

// ---- Thread detail ----
router.get('/threads/:id', (req, res) => {
  const id = +req.params.id;
  if (!isParticipant(id, req.user.id)) return res.status(403).json({ error: 'You do not have access to this conversation.' });
  const t = db.prepare('SELECT * FROM message_threads WHERE id = ?').get(id);
  const participants = db.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.profile_picture, u.status
     FROM message_thread_participants pp JOIN users u ON u.id = pp.user_id WHERE pp.thread_id = ?`
  ).all(id);
  const messages = db.prepare(
    `SELECT m.id, m.thread_id, m.sender_id, m.body, m.status, m.created_at, m.edited_at,
            u.first_name, u.last_name, u.profile_picture, u.username
     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.thread_id = ? ORDER BY m.id`
  ).all(id);
  for (const m of messages) {
    m.attachments = db.prepare('SELECT id, original_name, stored_name, mime_type, size FROM message_attachments WHERE message_id = ?').all(m.id);
    m.own = m.sender_id === req.user.id;
  }
  // mark thread read
  db.prepare('UPDATE message_thread_participants SET last_read_at = ? WHERE thread_id = ? AND user_id = ?').run(nowMs(), id, req.user.id);
  res.json({ thread: t, participants, messages });
});

// ---- Create thread ----
router.post('/threads', (req, res) => {
  const { participantIds = [], title = null, body } = req.body;
  if (!Array.isArray(participantIds) || !participantIds.length) return res.status(400).json({ error: 'Select at least one recipient.' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Message body is required.' });
  const ids = [...new Set([req.user.id, ...participantIds.map(Number)])];
  if (ids.length < 2) return res.status(400).json({ error: 'Select at least one other recipient.' });
  const valid = db.prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (valid.length !== ids.length) return res.status(400).json({ error: 'One or more recipients are invalid.' });

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO message_threads(title, created_by) VALUES(?,?)').run(title ? esc(title).slice(0, 120) : null, req.user.id);
    const insP = db.prepare('INSERT INTO message_thread_participants(thread_id, user_id, last_read_at) VALUES(?,?,?)');
    for (const id of ids) insP.run(r.lastInsertRowid, id, nowMs());
    const insM = db.prepare('INSERT INTO messages(thread_id, sender_id, body, created_at) VALUES(?,?,?,?)');
    insM.run(r.lastInsertRowid, req.user.id, esc(body).slice(0, 10000), nowMs());
    return r.lastInsertRowid;
  });
  const threadId = tx();
  notifyParticipants(threadId, req.user.id, 'New message', `${req.user.first_name} ${req.user.last_name} sent you a message.`, `#/messages/${threadId}`);
  audit(req, 'message.thread_create', 'thread', threadId, { participants: ids.length });
  res.status(201).json({ ok: true, thread_id: threadId });
});

// ---- Reply (optionally with attachment) ----
router.post('/threads/:id/messages', (req, res) => {
  const id = +req.params.id;
  if (!isParticipant(id, req.user.id)) return res.status(403).json({ error: 'You do not have access to this conversation.' });
  const up = uploader({ field: 'file', maxSize: 2 * 1024 * 1024 });
  up(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    const body = esc(req.body.body || '').slice(0, 10000);
    if (!body && !req.file) return res.status(400).json({ error: 'Message body is required.' });
    const r = db.prepare('INSERT INTO messages(thread_id, sender_id, body, created_at) VALUES(?,?,?,?)').run(id, req.user.id, body, nowMs());
    if (req.file) {
      db.prepare('INSERT INTO message_attachments(message_id, original_name, stored_name, mime_type, size) VALUES(?,?,?,?,?)')
        .run(r.lastInsertRowid, req.file.originalname.slice(0, 200), req.file.filename, req.file.mimetype, req.file.size);
    }
    notifyParticipants(id, req.user.id, 'New message', `${req.user.first_name} ${req.user.last_name} replied.`, `#/messages/${id}`);
    audit(req, 'message.send', 'thread', id, {});
    res.status(201).json({ ok: true, message_id: r.lastInsertRowid });
  });
});

// ---- Edit own message ----
router.put('/messages/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages.' });
  if (m.status === 'deleted') return res.status(400).json({ error: 'Deleted messages cannot be edited.' });
  const settings = getSettings();
  const windowMin = +settings.edit_window_minutes || 15;
  const ageMin = (Date.now() - Date.parse(m.created_at.replace(' ', 'T') + 'Z')) / 60000;
  if (ageMin > windowMin) return res.status(400).json({ error: `Messages can only be edited within ${windowMin} minutes of sending.` });
  const body = esc(req.body.body || '').slice(0, 10000);
  if (!body) return res.status(400).json({ error: 'Message body is required.' });
  db.prepare("UPDATE messages SET body = ?, status = 'edited', edited_at = datetime('now') WHERE id = ?").run(body, m.id);
  audit(req, 'message.edit', 'message', m.id, {});
  res.json({ ok: true });
});

// ---- Delete own message (soft) ----
router.delete('/messages/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own messages.' });
  db.prepare("UPDATE messages SET body = '', status = 'deleted' WHERE id = ?").run(m.id);
  audit(req, 'message.delete', 'message', m.id, {});
  res.json({ ok: true });
});

module.exports = router;
