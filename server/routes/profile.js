/* Member profile — personal info + photo upload (validated & resized). */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const { db, UPLOAD_DIR } = require('../db');
const { requireAuth } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { uploader, sniffValid, IMAGE_MIMES } = require('../middleware/upload');
const { isEmail, isDate, esc } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// ---- Get own profile ----
router.get('/', (req, res) => {
  const u = db.prepare('SELECT id, first_name, last_name, username, email, phone, status, profile_picture, classification_id, created_at FROM users WHERE id = ?').get(req.user.id);
  const profile = db.prepare('SELECT * FROM member_profiles WHERE user_id = ?').get(req.user.id) || {};
  const classification = db.prepare('SELECT name FROM member_classifications WHERE id = ?').get(u.classification_id);
  res.json({ profile: { ...u, classification: classification ? classification.name : null }, details: profile });
});

// ---- Update personal info ----
router.put('/', (req, res) => {
  const { first_name, last_name, email, phone, username } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const upd = [];
  const params = [];
  if (first_name !== undefined) { upd.push('first_name = ?'); params.push(esc(first_name)); }
  if (last_name !== undefined) { upd.push('last_name = ?'); params.push(esc(last_name)); }
  if (email !== undefined) {
    if (email && !isEmail(email)) return res.status(400).json({ error: 'Invalid email address.' });
    upd.push('email = ?'); params.push(email || null);
  }
  if (phone !== undefined) { upd.push('phone = ?'); params.push(esc(phone) || null); }
  if (username !== undefined) {
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–30 characters (letters, numbers, . _ -).' });
    const taken = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, u.id);
    if (taken) return res.status(409).json({ error: 'That username is already taken.' });
    upd.push('username = ?'); params.push(username);
  }
  if (upd.length) {
    upd.push('updated_at = datetime(\'now\')');
    db.prepare(`UPDATE users SET ${upd.join(', ')} WHERE id = ?`).run(...params, u.id);
    audit(req, 'profile.update', 'user', u.id, { fields: Object.keys(req.body) });
  }

  const details = req.body.details || {};
  const p = db.prepare('SELECT 1 FROM member_profiles WHERE user_id = ?').get(u.id);
  if (p) {
    db.prepare(
      `UPDATE member_profiles SET birthday = COALESCE(?, birthday), address = COALESCE(?, address),
       emergency_contact_name = COALESCE(?, emergency_contact_name), emergency_contact_phone = COALESCE(?, emergency_contact_phone),
       joined_date = COALESCE(?, joined_date), bio = COALESCE(?, bio), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE user_id = ?`
    ).run(details.birthday ?? null, details.address ?? null, details.emergency_contact_name ?? null,
      details.emergency_contact_phone ?? null, details.joined_date ?? null, details.bio ?? null, details.notes ?? null, u.id);
  } else if (Object.keys(details).length) {
    db.prepare(
      'INSERT INTO member_profiles(user_id, birthday, address, emergency_contact_name, emergency_contact_phone, joined_date, bio, notes, updated_at) VALUES(?,?,?,?,?,?,?,?,datetime(\'now\'))'
    ).run(u.id, details.birthday ?? null, details.address ?? null, details.emergency_contact_name ?? null,
      details.emergency_contact_phone ?? null, details.joined_date ?? null, details.bio ?? null, details.notes ?? null);
  }
  res.json({ ok: true });
});

// ---- Upload photo ----
router.post('/photo', (req, res) => {
  const up = uploader({ field: 'photo', maxSize: 2 * 1024 * 1024 });
  up(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded.' });
    const mime = req.file.mimetype;
    if (!IMAGE_MIMES.includes(mime) || !sniffValid(req.file.path, mime)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid image file.' });
    }
    try {
      const outName = `avatar-${req.user.id}-${Date.now()}.jpg`;
      await sharp(req.file.path, { failOn: 'error' })
        .resize(512, 512, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toFile(path.join(UPLOAD_DIR, outName));
      fs.unlinkSync(req.file.path); // remove original upload
      // delete previous photo file if any
      const u = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.user.id);
      if (u.profile_picture && u.profile_picture !== outName) {
        const old = path.join(UPLOAD_DIR, u.profile_picture);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }
      db.prepare('UPDATE users SET profile_picture = ?, updated_at = datetime(\'now\') WHERE id = ?').run(outName, req.user.id);
      audit(req, 'profile.photo_upload', 'user', req.user.id, { file: outName });
      res.json({ ok: true, profile_picture: outName });
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      console.error(e);
      res.status(400).json({ error: 'Image could not be processed. Please upload a valid JPG, PNG, WebP or GIF.' });
    }
  });
});

// ---- Remove photo ----
router.delete('/photo', (req, res) => {
  const u = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.user.id);
  if (u.profile_picture) {
    const p = path.join(UPLOAD_DIR, u.profile_picture);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('UPDATE users SET profile_picture = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(req.user.id);
  audit(req, 'profile.photo_remove', 'user', req.user.id, {});
  res.json({ ok: true });
});

module.exports = router;
