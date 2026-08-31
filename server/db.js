/* DB singleton — WAL mode, FK enforced, idempotent schema migration. */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'lcm.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Idempotent migration (all statements use IF NOT EXISTS)
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Lightweight column migrations for pre-existing databases
const sessionCols = db.prepare('PRAGMA table_info(sessions)').all();
if (!sessionCols.find((c) => c.name === 'csrf_token')) {
  db.exec('ALTER TABLE sessions ADD COLUMN csrf_token TEXT');
}

module.exports = { db, DB_PATH, UPLOAD_DIR, DATA_DIR };
