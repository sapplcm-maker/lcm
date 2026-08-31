-- =====================================================================
-- LCM Ministry Online Management and Evaluation System — Schema
-- SQLite (better-sqlite3), WAL, FK enforced, prepared statements only.
-- =====================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS member_classifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id               INTEGER NOT NULL REFERENCES roles(id),
  classification_id     INTEGER REFERENCES member_classifications(id),
  username              TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash         TEXT NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','suspended','pending')),
  profile_picture       TEXT,
  last_login_at         TEXT,
  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status   ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role_id);

CREATE TABLE IF NOT EXISTS member_profiles (
  user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birthday                 TEXT,
  address                  TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  joined_date              TEXT,
  bio                      TEXT,
  notes                    TEXT,
  updated_at               TEXT
);

CREATE TABLE IF NOT EXISTS committees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS committee_categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cc_committee ON committee_categories(committee_id);

CREATE TABLE IF NOT EXISTS committee_members (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id       INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_committee  TEXT NOT NULL DEFAULT 'member' CHECK(role_in_committee IN ('chair','secretary','member')),
  is_active          INTEGER NOT NULL DEFAULT 1,
  joined_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (committee_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON committee_members(user_id);

CREATE TABLE IF NOT EXISTS schedules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT,
  venue         TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sched_date ON schedules(schedule_date);

CREATE TABLE IF NOT EXISTS schedule_assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','pending','declined','replaced')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_sa_user     ON schedule_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_sa_schedule ON schedule_assignments(schedule_id);

CREATE TABLE IF NOT EXISTS announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  author_id    INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  publish_at   TEXT,
  expires_at   TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ann_status_publish ON announcements(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_ann_author ON announcements(author_id);

CREATE TABLE IF NOT EXISTS announcement_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL,
  mime_type       TEXT,
  size            INTEGER NOT NULL,
  uploaded_by     INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aa_ann ON announcement_attachments(announcement_id);

CREATE TABLE IF NOT EXISTS message_threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_thread_participants (
  thread_id    INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mtp_user ON message_thread_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','edited','deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS message_attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ma_message ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS evaluation_terms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_terms_active ON evaluation_terms(is_active);

CREATE TABLE IF NOT EXISTS evaluations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id   INTEGER NOT NULL REFERENCES committees(id),
  evaluator_id   INTEGER NOT NULL REFERENCES users(id),
  member_id      INTEGER NOT NULL REFERENCES users(id),
  term_id        INTEGER NOT NULL REFERENCES evaluation_terms(id),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','pending_review','returned','resubmitted','approved','released')),
  overall_average REAL,
  admin_notes    TEXT,
  submitted_at   TEXT,
  approved_at    TEXT,
  released_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (committee_id, evaluator_id, member_id, term_id)
);
CREATE INDEX IF NOT EXISTS idx_ev_status   ON evaluations(status);
CREATE INDEX IF NOT EXISTS idx_ev_member   ON evaluations(member_id, term_id);
CREATE INDEX IF NOT EXISTS idx_ev_committee ON evaluations(committee_id, term_id);
CREATE INDEX IF NOT EXISTS idx_ev_evaluator ON evaluations(evaluator_id);

CREATE TABLE IF NOT EXISTS evaluation_ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES committee_categories(id),
  rating        INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  UNIQUE (evaluation_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_er_eval ON evaluation_ratings(evaluation_id);

CREATE TABLE IF NOT EXISTS evaluation_comments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id        INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  comment_type         TEXT NOT NULL CHECK(comment_type IN ('comment','observation','recommendation','improvement')),
  body                 TEXT NOT NULL,
  is_visible_to_member INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ec_eval ON evaluation_comments(evaluation_id);

CREATE TABLE IF NOT EXISTS evaluation_approvals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id   INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  admin_id        INTEGER NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status      TEXT NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ea_eval ON evaluation_approvals(evaluation_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  username    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  details     TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
