/* Backup: WAL checkpoint then copy DB + uploads into backups/<timestamp>/ */
'use strict';
const fs = require('fs');
const path = require('path');
const { db, DB_PATH, UPLOAD_DIR, DATA_DIR } = require('./db');

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const dest = path.join(__dirname, '..', 'backups', stamp);
fs.mkdirSync(dest, { recursive: true });

db.pragma('wal_checkpoint(TRUNCATE)');
fs.copyFileSync(DB_PATH, path.join(dest, 'lcm.db'));
if (fs.existsSync(UPLOAD_DIR)) {
  fs.cpSync(UPLOAD_DIR, path.join(dest, 'uploads'), { recursive: true });
}
db.close();
console.log(`[✓] Backup written to backups/${stamp}/ (database + uploads).`);
console.log('    Restore: stop server, replace data/lcm.db and data/uploads/, start server.');
