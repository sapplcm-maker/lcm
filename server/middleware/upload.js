/* File upload middleware — allowlist, size caps, randomized storage names. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('../db');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const DOC_EXTS = ['.pdf', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.md'];
const ALLOWED_EXTS = [...IMAGE_EXTS, ...DOC_EXTS];

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomBytes(12).toString('hex') + (ALLOWED_EXTS.includes(ext) ? ext : ''));
  },
});

function uploader({ field = 'file', maxSize = 10 * 1024 * 1024 } = {}) {
  return multer({
    storage,
    limits: { fileSize: maxSize, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) return cb(new UploadError('File type not allowed: ' + (ext || '(no extension)')));
      cb(null, true);
    },
  }).single(field);
}

class UploadError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Magic-byte sniffing: confirm a file is what its extension claims (basic validation). */
function sniffValid(filePath, mimeType) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (mimeType === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
    if (mimeType === 'image/png') return buf.readUInt32BE(0) === 0x89504e47;
    if (mimeType === 'image/gif') return buf.toString('ascii', 0, 4) === 'GIF8';
    if (mimeType === 'image/webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    if (mimeType === 'application/pdf') return buf.toString('ascii', 0, 4) === '%PDF';
    return true; // text/office files: checked by extension + size caps
  } catch (_) {
    return false;
  }
}

module.exports = { uploader, UploadError, sniffValid, IMAGE_EXTS, IMAGE_MIMES, ALLOWED_EXTS, UPLOAD_DIR };
