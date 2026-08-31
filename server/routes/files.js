/* Protected file serving — resolves stored files to their owning entity
 * and authorizes the request before streaming. */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, UPLOAD_DIR } = require('../db');
const { requireAuth } = require('../middleware/rbac');

const router = express.Router();
router.use(requireAuth);

router.get('/:name', (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..')) return res.status(400).json({ error: 'Invalid file name.' });
  const filePath = path.join(UPLOAD_DIR, name);

  // 1) profile pictures — visible to any authenticated member
  const avatarOwner = db.prepare('SELECT id FROM users WHERE profile_picture = ?').get(name);
  // 2) announcement attachments — visible to any authenticated member
  const annAtt = db.prepare('SELECT id, original_name, mime_type, announcement_id FROM announcement_attachments WHERE stored_name = ?').get(name);
  // 3) message attachments — participants only
  const msgAtt = db.prepare('SELECT id, original_name, mime_type, message_id FROM message_attachments WHERE stored_name = ?').get(name);

  let filename = name;
  let disposition = 'inline';
  if (avatarOwner) {
    disposition = 'inline';
  } else if (annAtt) {
    filename = annAtt.original_name;
    disposition = 'attachment';
  } else if (msgAtt) {
    const m = db.prepare('SELECT thread_id FROM messages WHERE id = ?').get(msgAtt.message_id);
    if (!m) return res.status(404).json({ error: 'File not found' });
    const part = db.prepare('SELECT 1 FROM message_thread_participants WHERE thread_id = ? AND user_id = ?').get(m.thread_id, req.user.id);
    if (!part) return res.status(403).json({ error: 'You do not have access to this file.' });
    filename = msgAtt.original_name;
    disposition = 'attachment';
  } else {
    return res.status(404).json({ error: 'File not found' });
  }

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
  res.sendFile(filePath);
});

module.exports = router;
