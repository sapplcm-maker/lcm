/* =====================================================================
 * LCM-OMES — Seed script
 * Idempotent: skips if admin user already exists. Use `--fresh` to wipe.
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'lcm.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

if (process.argv.includes('--fresh')) {
  for (const f of ['lcm.db', 'lcm.db-wal', 'lcm.db-shm']) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (_) {}
  }
  console.log('[*] Fresh start: removed existing database.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const seeded = db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
if (seeded) {
  console.log('[=] Database already seeded — skipping (use --fresh to reset).');
  process.exit(0);
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const hash = (p) => bcrypt.hashSync(p, 10);

const run = db.transaction(() => {
  const ins = (sql, ...args) => db.prepare(sql).run(...args);

  // ---------- Roles ----------
  const roles = {
    admin: ins('INSERT INTO roles(code,name,description) VALUES(?,?,?)', 'admin', 'Administrator', 'Full system access, evaluation approval and release'),
    officer: ins('INSERT INTO roles(code,name,description) VALUES(?,?,?)', 'officer', 'Officer', 'Schedule & announcement management, limited directory'),
    committee: ins('INSERT INTO roles(code,name,description) VALUES(?,?,?)', 'committee', 'Committee Member', 'Member plus committee evaluation duties'),
    member: ins('INSERT INTO roles(code,name,description) VALUES(?,?,?)', 'member', 'Regular Member', 'Personal portal access'),
  };

  // ---------- Permissions ----------
  const PERMS = [
    ['members.view', 'View member directory'],
    ['members.manage', 'Full member management (CRUD, status, classification, role)'],
    ['members.reset_password', 'Reset member passwords'],
    ['roles.manage', 'Manage roles and permission matrix'],
    ['classifications.manage', 'Manage member classifications'],
    ['committees.manage', 'Manage committees, membership and categories'],
    ['schedule.view', 'View ministry schedules'],
    ['schedule.manage', 'Create/edit/assign/publish schedules'],
    ['announcements.view', 'View published announcements'],
    ['announcements.manage', 'Create/edit/archive announcements'],
    ['announcements.publish', 'Publish announcements'],
    ['messages.use', 'Use internal messaging'],
    ['profile.manage', 'Manage own profile and photo'],
    ['evaluations.view', 'Access evaluation module and committee dashboards'],
    ['evaluations.evaluate', 'Create and submit evaluations'],
    ['evaluations.approve', 'Review, approve or return evaluations (admin)'],
    ['evaluations.release', 'Release approved results to members (admin)'],
    ['evaluations.manage', 'Manage evaluation terms'],
    ['reports.view', 'View evaluation reports'],
    ['reports.export', 'Export reports (CSV/XLSX/PDF)'],
    ['audit.view', 'View audit log'],
    ['settings.manage', 'Manage system settings'],
    ['notifications.broadcast', 'Send ministry-wide notifications'],
    ['own.results', 'View own released evaluation results'],
  ];
  const permIds = {};
  for (const [code, desc] of PERMS) {
    permIds[code] = ins('INSERT INTO permissions(code,description) VALUES(?,?)', code, desc).lastInsertRowid;
  }

  const grant = (roleKey, codes) => {
    for (const c of codes) {
      ins('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)', roles[roleKey].lastInsertRowid, permIds[c]);
    }
  };

  // Base set for every authenticated member
  const base = ['schedule.view', 'announcements.view', 'messages.use', 'profile.manage', 'own.results'];
  grant('member', base);
  // Officers view schedules but do NOT manage them — only the Administrator edits schedules.
  grant('officer', [...base, 'announcements.manage', 'announcements.publish', 'members.view']);
  grant('committee', [...base, 'evaluations.view', 'evaluations.evaluate', 'reports.view']);
  grant('admin', Object.keys(permIds));

  // ---------- Classifications ----------
  const CLASS = [
    ['Lector', 'Proclaims the Word of God'],
    ['Commentator', 'Guides the assembly'],
    ['Server', 'Altar service'],
    ['Usher / Greeter', 'Hospitality and ushering'],
  ];
  const classIds = {};
  for (const [n, d] of CLASS) {
    classIds[n] = ins('INSERT INTO member_classifications(name,description) VALUES(?,?)', n, d).lastInsertRowid;
  }

  // ---------- Committees & categories ----------
  const COMMITTEES = [
    { code: 'screening', name: 'Screening and Evaluation Committee',
      cats: ['Doctrine & Faith', 'Knowledge of Scripture', 'Commitment & Availability', 'Conduct & Reverence', 'Communication'] },
    { code: 'discipline', name: 'Discipline Committee',
      cats: ['Conduct & Behavior', 'Punctuality & Attendance', 'Obedience & Cooperation', 'Respect & Relationships', 'Confidentiality'] },
    { code: 'readers', name: "Reader's Evaluation Committee",
      cats: ['Delivery & Projection', 'Preparation & Accuracy', 'Reverence & Decorum', 'Pace & Pause', 'Pronunciation & Clarity'] },
  ];
  const commIds = {};
  const catIds = {};
  for (const c of COMMITTEES) {
    const r = ins('INSERT INTO committees(name,code,description) VALUES(?,?,?)', c.name, c.code, '');
    commIds[c.code] = r.lastInsertRowid;
    c.cats.forEach((n, i) => {
      catIds[c.code + ':' + n] = ins('INSERT INTO committee_categories(committee_id,name,sort_order) VALUES(?,?,?)', r.lastInsertRowid, n, i + 1).lastInsertRowid;
    });
  }

  // ---------- Users ----------
  const mkUser = (u) => {
    const r = ins(
      `INSERT INTO users(role_id,classification_id,username,password_hash,must_change_password,first_name,last_name,email,phone,status,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      roles[u.role].lastInsertRowid,
      classIds[u.classification] || classIds['Lector'],
      u.username, hash(u.password), u.must_change || 0,
      u.first, u.last, u.email || null, u.phone || null,
      u.status || 'active', adminId || null
    );
    return r.lastInsertRowid;
  };
  let adminId = ins(
    `INSERT INTO users(role_id,classification_id,username,password_hash,first_name,last_name,email,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    roles.admin.lastInsertRowid, classIds['Lector'], 'admin', hash('Admin@123'), 'Maria Clara', 'Santos', 'admin@lcm-ministry.org', 'active', null
  ).lastInsertRowid;

  const u = (first, last, username, role, classification, password = 'Member@123', extra = {}) =>
    mkUser({ first, last, username, role, classification, password, ...extra });

  const idOfficer = u('Juan Miguel', 'Reyes', 'officer.reyes', 'officer', 'Lector');
  const idCarmen  = u('Carmen', 'Villanueva', 'carmen.villanueva', 'committee', 'Commentator');
  const idRicardo = u('Ricardo', 'Bautista', 'ricardo.bautista', 'committee', 'Lector');
  const idTeresa  = u('Teresa', 'Domingo', 'teresa.domingo', 'committee', 'Lector');
  const idPaolo   = u('Paolo', 'Mendoza', 'paolo.mendoza', 'committee', 'Commentator');
  const idAndrea  = u('Andrea', 'Lopez', 'andrea.lopez', 'member', 'Lector');
  const idMiguel  = u('Miguel', 'Torres', 'miguel.torres', 'member', 'Lector');
  const idSophia  = u('Sophia', 'Ramirez', 'sophia.ramirez', 'member', 'Commentator');
  const idGabriel = u('Gabriel', 'Flores', 'gabriel.flores', 'member', 'Commentator');
  const idElena   = u('Elena', 'Cruz', 'elena.cruz', 'member', 'Server');
  const idDavid   = u('David', 'Garcia', 'david.garcia', 'member', 'Lector', 'Member@123', { status: 'inactive' });
  const idIsabel  = u('Isabel', 'Ramos', 'isabel.ramos', 'member', 'Lector');

  // ---------- Committee membership ----------
  const cm = (code, userId, roleInCommittee = 'member') =>
    ins('INSERT INTO committee_members(committee_id,user_id,role_in_committee) VALUES(?,?,?)', commIds[code], userId, roleInCommittee);
  cm('screening', idCarmen, 'chair');
  cm('discipline', idRicardo, 'chair');
  cm('readers', idTeresa, 'chair');
  cm('screening', idPaolo);            // multiple committees — edge case
  cm('readers', idPaolo);
  cm('screening', adminId, 'chair');   // admin is also chair of screening (admin sees all anyway)

  // ---------- Profiles ----------
  ins('INSERT INTO member_profiles(user_id,birthday,address,emergency_contact_name,emergency_contact_phone,joined_date,bio) VALUES(?,?,?,?,?,?,?)',
    idAndrea, '1998-03-14', '18 Mabini St., Inarawan, Antipolo City', 'Rosa Lopez', '+63 917 555 0142', '2022-01-09', 'Lector since 2022. Serving at the 8:00 AM Sunday Mass.');
  ins('INSERT INTO member_profiles(user_id,birthday,address,bio) VALUES(?,?,?,?)',
    idSophia, '2000-07-02', '5 Rizal Ave., Inarawan, Antipolo City', 'Commentator; leads the Youth Lectors group.');
  ins('INSERT INTO member_profiles(user_id,birthday,address,joined_date) VALUES(?,?,?,?)',
    idMiguel, '1995-11-21', '12 Kiling St., Inarawan, Antipolo City', '2019-06-02');

  // ---------- Schedules (Aug–Sep 2026) ----------
  const mkSched = (title, date, start, end, venue, status, notes = '') => {
    const r = ins('INSERT INTO schedules(title,schedule_date,start_time,end_time,venue,status,created_by,notes) VALUES(?,?,?,?,?,?,?,?)',
      title, date, start, end, venue, status, adminId, notes);
    return r.lastInsertRowid;
  };
  const assign = (sid, uid, role, notes = '') =>
    ins('INSERT INTO schedule_assignments(schedule_id,user_id,role,notes) VALUES(?,?,?,?)', sid, uid, role, notes);

  const s1 = mkSched('Sunday Mass 8:00 AM', '2026-08-30', '08:00', '09:30', 'Main Church', 'published', 'Regular Sunday liturgy.');
  assign(s1, idAndrea, 'Lector', 'First reading');
  assign(s1, idSophia, 'Commentator');
  assign(s1, idMiguel, 'Lector', 'Second reading');
  const s2 = mkSched('Sunday Mass 8:00 AM', '2026-09-06', '08:00', '09:30', 'Main Church', 'published');
  assign(s2, idGabriel, 'Commentator');
  assign(s2, idElena, 'Server');
  assign(s2, idAndrea, 'Lector', 'Gospel reading');
  const s3 = mkSched('Family Mass', '2026-09-13', '10:30', '12:00', 'Parish Hall', 'published', 'Families day — children participation.');
  assign(s3, idSophia, 'Commentator');
  assign(s3, idMiguel, 'Lector');
  const s4 = mkSched('Sunday Mass 8:00 AM', '2026-09-20', '08:00', '09:30', 'Main Church', 'draft', 'Draft — assignments pending.');
  assign(s4, idAndrea, 'Lector');
  const s5 = mkSched('Vigil Mass', '2026-09-27', '17:00', '18:30', 'Main Church', 'published');
  assign(s5, idGabriel, 'Commentator');
  assign(s5, idElena, 'Lector');

  // ---------- Announcements ----------
  const ann1 = ins('INSERT INTO announcements(title,body,author_id,status,publish_at,published_at) VALUES(?,?,?,?,?,?)',
    'Evaluation Term 3 (Aug–Nov) is now open', 'Dear members,\n\nThe evaluation period for Term 3, 2026 has begun. Committee evaluations will be conducted in the coming weeks. Approved results will appear in your My Evaluations dashboard once released.\n\nGod bless.',
    adminId, 'published', now(), now()).lastInsertRowid;
  const ann2 = ins('INSERT INTO announcements(title,body,author_id,status,publish_at,published_at) VALUES(?,?,?,?,?,?)',
    'September Mass Schedule Published', 'The September schedule is now available on your dashboard. Please review your assignments and coordinate swaps through the office if needed.\n\nSchedule: https://lcm.example.org/schedule',
    idOfficer, 'published', now(), now()).lastInsertRowid;
  const ann3 = ins('INSERT INTO announcements(title,body,author_id,status) VALUES(?,?,?,?)',
    'Fellowship Night — Draft Plan', 'Planning for the October fellowship night. Venue ideas welcome. (Draft)',
    idOfficer, 'draft').lastInsertRowid;

  // Sample attachment for the schedule announcement
  const attContent = 'September 2026 Lectors & Commentators Schedule (Summary)\n\nAug 30 (Sun) 08:00  Main Church\nSep 06 (Sun) 08:00  Main Church\nSep 13 (Sun) 10:30  Parish Hall — Family Mass\nSep 20 (Sun) 08:00  Main Church\nSep 27 (Sun) 17:00  Main Church — Vigil Mass\n';
  const attName = 'sept-schedule-' + crypto.randomBytes(6).toString('hex') + '.txt';
  fs.writeFileSync(path.join(UPLOAD_DIR, attName), attContent);
  ins('INSERT INTO announcement_attachments(announcement_id,original_name,stored_name,mime_type,size,uploaded_by) VALUES(?,?,?,?,?,?)',
    ann2, 'september-schedule.txt', attName, 'text/plain', Buffer.byteLength(attContent), idOfficer);

  // ---------- Evaluation terms (2026 defaults) ----------
  const terms = {};
  const mkTerm = (name, s, e) => {
    const r = ins('INSERT INTO evaluation_terms(name,start_date,end_date,is_active,created_by) VALUES(?,?,?,1,?)', name, s, e, adminId);
    terms[name] = r.lastInsertRowid;
  };
  mkTerm('Term 1 — 2026', '2026-01-01', '2026-04-30');
  mkTerm('Term 2 — 2026', '2026-05-01', '2026-07-31');
  mkTerm('Term 3 — 2026', '2026-08-01', '2026-11-30');

  // ---------- Evaluations (Term 3) ----------
  const cat = (code, name) => catIds[code + ':' + name];
  const mkEval = (committeeCode, evaluatorId, memberId, termName, status, ratings, comments = [], opts = {}) => {
    const r = ins(
      `INSERT INTO evaluations(committee_id,evaluator_id,member_id,term_id,status,overall_average,admin_notes,submitted_at,approved_at,released_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      commIds[committeeCode], evaluatorId, memberId, terms[termName], status,
      ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null,
      opts.adminNotes || null,
      opts.submittedAt || (status === 'draft' ? null : now()),
      opts.approvedAt || null,
      opts.releasedAt || null
    );
    const evId = r.lastInsertRowid;
    const names = COMMITTEES.find(c => c.code === committeeCode).cats;
    ratings.forEach((val, i) => {
      ins('INSERT INTO evaluation_ratings(evaluation_id,category_id,rating) VALUES(?,?,?)', evId, cat(committeeCode, names[i]), val);
    });
    comments.forEach(([type, body, vis]) => {
      ins('INSERT INTO evaluation_comments(evaluation_id,comment_type,body,is_visible_to_member) VALUES(?,?,?,?)', evId, type, body, vis ? 1 : 0);
    });
    if (opts.approvals) {
      for (const a of opts.approvals) {
        ins('INSERT INTO evaluation_approvals(evaluation_id,admin_id,action,previous_status,new_status,notes) VALUES(?,?,?,?,?,?)',
          evId, a.admin || adminId, a.action, a.prev, a.next, a.notes || null);
      }
    }
    return evId;
  };

  // Released for Andrea (readers) — visible on her dashboard
  mkEval('readers', idTeresa, idAndrea, 'Term 3 — 2026', 'released', [5, 4, 5, 4, 5],
    [['comment', 'Andrea delivers with clarity and reverence. Excellent preparation each Sunday.', 1],
     ['recommendation', 'Continue to refine pace during longer passages.', 1],
     ['improvement', 'Pause slightly longer at paragraph breaks.', 1]],
    { approvedAt: '2026-08-10 10:00:00', releasedAt: '2026-08-11 09:00:00',
      approvals: [{ action: 'approve', prev: 'pending_review', next: 'approved' }, { action: 'release', prev: 'approved', next: 'released' }] });

  // Approved but NOT released for Miguel (readers)
  mkEval('readers', idTeresa, idMiguel, 'Term 3 — 2026', 'approved', [4, 4, 3, 4, 4],
    [['comment', 'Solid and consistent. Watch projection in the back of the church.', 0]],
    { approvedAt: '2026-08-15 14:30:00',
      approvals: [{ action: 'approve', prev: 'pending_review', next: 'approved', notes: 'Approved — awaiting package release.' }] });

  // Pending admin review — Paolo (readers) on Gabriel
  mkEval('readers', idPaolo, idGabriel, 'Term 3 — 2026', 'pending_review', [3, 4, 4, 3, 3],
    [['comment', 'Shows promise; needs practice with longer readings.', 0]]);

  // Returned for revision — Carmen (screening) on Sophia
  mkEval('screening', idCarmen, idSophia, 'Term 3 — 2026', 'returned', [4, 3, 4, 4, 3],
    [['observation', 'Attendance at formation sessions has been inconsistent.', 0]],
    { submittedAt: '2026-08-05 09:00:00',
      approvals: [{ action: 'return', prev: 'pending_review', next: 'returned', notes: 'Please clarify attendance details and add a recommendation.' }] });

  // Submitted → pending_review for Elena (discipline)
  mkEval('discipline', idRicardo, idElena, 'Term 3 — 2026', 'pending_review', [4, 5, 4, 4, 5],
    [['comment', 'Exemplary conduct and reliability.', 0]]);

  // Draft — Carmen on Andrea (only 2 categories rated so far)
  mkEval('screening', idCarmen, idAndrea, 'Term 3 — 2026', 'draft', [4, 4]);

  // Draft — Ricardo on Miguel
  mkEval('discipline', idRicardo, idMiguel, 'Term 3 — 2026', 'draft', [5, 5, 4, 4]);

  // Self-evaluation — Paolo evaluates himself (screening)
  mkEval('screening', idPaolo, idPaolo, 'Term 3 — 2026', 'pending_review', [4, 4, 4, 5, 4],
    [['comment', 'Self-assessment: consistent attendance and ministry commitment.', 0]]);

  // ---------- Message thread ----------
  const th = ins('INSERT INTO message_threads(title,created_by) VALUES(?,?)', 'Welcome to the Ministry', adminId).lastInsertRowid;
  ins('INSERT INTO message_thread_participants(thread_id,user_id,last_read_at) VALUES(?,?,?)', th, adminId, now());
  ins('INSERT INTO message_thread_participants(thread_id,user_id,last_read_at) VALUES(?,?,?)', th, idAndrea, now());
  ins('INSERT INTO messages(thread_id,sender_id,body) VALUES(?,?,?)', th, adminId, 'Welcome to the Lectors and Commentators Ministry, Andrea! Kindly complete your profile and review the September schedule.');
  ins('INSERT INTO messages(thread_id,sender_id,body) VALUES(?,?,?)', th, idAndrea, 'Thank you, Ma\'am! Profile updated and schedule reviewed. See you Sunday.');

  // ---------- Notifications ----------
  const notif = (uid, type, title, body, link) =>
    ins('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)', uid, type, title, body, link);
  notif(idAndrea, 'announcement', 'Evaluation Term 3 (Aug–Nov) is now open', 'The evaluation period for Term 3, 2026 has begun.', '#/announcements');
  notif(idAndrea, 'schedule', 'New assignment — Aug 30, 8:00 AM', 'You are assigned as Lector (First reading) at Main Church.', '#/schedule');
  notif(idAndrea, 'evaluation', 'Your evaluation results are available', 'Your Reader\'s Committee evaluation for Term 3 has been released.', '#/evaluations');
  notif(idOfficer, 'announcement', 'September Mass Schedule Published', 'Members have been notified.', '#/announcements');
  notif(idPaolo, 'evaluation', 'Self-evaluation submitted', 'Your screening self-evaluation is pending admin review.', '#/committee');
  notif(idSophia, 'evaluation', 'Evaluation returned for revision', 'The Screening Committee evaluation of you was returned for clarification.', '#/committee');

  // ---------- Settings ----------
  const settings = {
    site_name: 'LCM Ministry Portal',
    release_mode: 'individual',           // or 'package'
    password_min_length: '8',
    allow_self_evaluation: '1',
    evaluation_grace_days: '0',
    session_inactivity_minutes: '1440',   // 24h
    session_absolute_days: '7',
    edit_window_minutes: '15',
    org_name: 'Lectors and Commentators Ministry',
    org_location: 'Inarawan, Antipolo City',
  };
  for (const [k, v] of Object.entries(settings)) {
    ins('INSERT INTO system_settings(key,value,updated_by) VALUES(?,?,?)', k, v, adminId);
  }

  // ---------- Audit trail seeds ----------
  const audit = (uid, uname, action, entity, details) =>
    ins('INSERT INTO audit_logs(user_id,username,action,entity_type,entity_id,details,ip_address) VALUES(?,?,?,?,?,?,?)',
      uid, uname, action, entity.type, entity.id, JSON.stringify(details || {}), '127.0.0.1');
  audit(adminId, 'admin', 'system.seeded', { type: 'system', id: null }, { note: 'Initial database seed' });
  audit(adminId, 'admin', 'member.create', { type: 'user', id: idOfficer }, { username: 'officer.reyes' });
  audit(adminId, 'admin', 'announcement.publish', { type: 'announcement', id: ann1 }, { title: 'Evaluation Term 3 (Aug–Nov) is now open' });
  audit(adminId, 'admin', 'schedule.create', { type: 'schedule', id: s1 }, { date: '2026-08-30' });

  console.log(`[✓] Seeded: ${Object.keys(roles).length} roles, ${PERMS.length} permissions, ${Object.keys(CLASS).length} classifications, ${COMMITTEES.length} committees, 13 users, 5 schedules, 3 announcements, 8 evaluations, ${terms ? 3 : 0} terms.`);
  console.log('[✓] Admin login:  admin / Admin@123');
  console.log('[✓] Demo members: e.g. andrea.lopez / Member@123  (officer.reyes, carmen.villanueva, ricardo.bautista, teresa.domingo, paolo.mendoza)');
});

run();
db.close();
