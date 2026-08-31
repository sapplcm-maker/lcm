/* Evaluations — terms, committee dashboards, ratings/comments, admin approval workflow.
 *
 * Confidentiality: results are only ever returned to the evaluated member when
 * status = 'released' (enforced in SQL here — no UI can bypass it).
 */
'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, hasPerm } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { required, isInt, esc } = require('../middleware/validate');
const { getSettings } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const COMMENT_TYPES = ['comment', 'observation', 'recommendation', 'improvement'];
const WORKFLOW_STATUSES = ['draft', 'submitted', 'pending_review', 'returned', 'resubmitted', 'approved', 'released'];
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- helpers ---------- */

function myCommitteeIds(userId) {
  return db.prepare(
    `SELECT c.id, c.name, c.code FROM committee_members cm JOIN committees c ON c.id = cm.committee_id
     WHERE cm.user_id = ? AND cm.is_active = 1 AND c.is_active = 1 ORDER BY c.id`
  ).all(userId);
}

function evaluateePool() {
  return db.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.profile_picture, u.status, u.classification_id,
            c.name AS classification
     FROM users u LEFT JOIN member_classifications c ON c.id = u.classification_id
     WHERE u.status = 'active' AND u.role_id != (SELECT id FROM roles WHERE code = 'admin')
     ORDER BY u.last_name, u.first_name`
  ).all();
}

function termInfo(t) {
  const settings = getSettings();
  const grace = +settings.evaluation_grace_days || 0;
  const end = new Date(t.end_date + 'T23:59:59');
  end.setDate(end.getDate() + grace);
  const state = today() < t.start_date ? 'upcoming' : (today() <= t.end_date || Date.now() <= end.getTime() ? 'open' : 'closed');
  return { ...t, state };
}

function termById(id) {
  const t = db.prepare('SELECT * FROM evaluation_terms WHERE id = ?').get(id);
  return t ? termInfo(t) : null;
}

function activeTerms() {
  return db.prepare('SELECT * FROM evaluation_terms WHERE is_active = 1 ORDER BY start_date DESC').all().map(termInfo);
}

function categoriesFor(committeeId) {
  return db.prepare('SELECT id, name, sort_order FROM committee_categories WHERE committee_id = ? ORDER BY sort_order').all(committeeId);
}

function evalState(committeeId, evaluatorId, memberId, termId) {
  return db.prepare(
    `SELECT * FROM evaluations WHERE committee_id = ? AND evaluator_id = ? AND member_id = ? AND term_id = ?`
  ).get(committeeId, evaluatorId, memberId, termId) || null;
}

function evalPayload(ev) {
  if (!ev) return null;
  const ratings = db.prepare('SELECT category_id, rating FROM evaluation_ratings WHERE evaluation_id = ?').all(ev.id);
  const comments = db.prepare('SELECT comment_type, body, is_visible_to_member AS visible FROM evaluation_comments WHERE evaluation_id = ? ORDER BY id').all(ev.id);
  const returnNote = db.prepare(`SELECT notes, created_at FROM evaluation_approvals WHERE evaluation_id = ? AND action = 'return' ORDER BY id DESC LIMIT 1`).get(ev.id);
  return { ...ev, ratings, comments, return_notes: returnNote ? returnNote.notes : null };
}

function assertCanEvaluate(user, committeeId, memberId) {
  const settings = getSettings();
  const isAdmin = user.role_code === 'admin';
  const isMemberOf = db.prepare('SELECT 1 FROM committee_members WHERE user_id = ? AND committee_id = ? AND is_active = 1').get(user.id, committeeId);
  if (!isAdmin && !isMemberOf) throw Object.assign(new Error('You are not a member of this committee.'), { status: 403 });
  if (memberId !== user.id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND status = ?').get(memberId, 'active')) {
    throw Object.assign(new Error('The member to be evaluated is not active.'), { status: 400 });
  }
  if (memberId === user.id && settings.allow_self_evaluation !== '1') {
    throw Object.assign(new Error('Self-evaluation is disabled by the administrator.'), { status: 403 });
  }
  const pool = evaluateePool().some((m) => m.id === memberId);
  if (!pool && memberId !== user.id) throw Object.assign(new Error('This member is not in the evaluation pool.'), { status: 400 });
}

function validateTermOpen(t) {
  if (t.state === 'closed') throw Object.assign(new Error(`The evaluation term "${t.name}" has closed. Submissions are no longer accepted.`), { status: 400 });
}

function saveRatings(evalId, ratings) {
  db.prepare('DELETE FROM evaluation_ratings WHERE evaluation_id = ?').run(evalId);
  const ins = db.prepare('INSERT INTO evaluation_ratings(evaluation_id, category_id, rating) VALUES(?,?,?)');
  for (const r of ratings) ins.run(evalId, r.category_id, r.rating);
}

function saveComments(evalId, comments) {
  db.prepare('DELETE FROM evaluation_comments WHERE evaluation_id = ?').run(evalId);
  const ins = db.prepare('INSERT INTO evaluation_comments(evaluation_id, comment_type, body, is_visible_to_member) VALUES(?,?,?,?)');
  for (const c of comments) ins.run(evalId, c.comment_type, c.body.slice(0, 2000), c.visible ? 1 : 0);
}

function recordApproval(evalId, adminId, action, prev, next, notes = null) {
  db.prepare('INSERT INTO evaluation_approvals(evaluation_id, admin_id, action, previous_status, new_status, notes) VALUES(?,?,?,?,?,?)')
    .run(evalId, adminId, action, prev, next, notes);
}

function notifyMember(evalId) {
  const ev = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(evalId);
  const committee = db.prepare('SELECT name FROM committees WHERE id = ?').get(ev.committee_id);
  const term = db.prepare('SELECT name FROM evaluation_terms WHERE id = ?').get(ev.term_id);
  db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)')
    .run(ev.member_id, 'evaluation', 'Your evaluation results are available', `Your ${committee.name} result for ${term.name} has been released.`, '#/evaluations');
}

/* ---------- Terms ---------- */

router.get('/terms', (req, res) => {
  const terms = activeTerms();
  res.json({ terms });
});

router.get('/terms/all', requirePermission('evaluations.manage'), (req, res) => {
  res.json({ terms: db.prepare('SELECT * FROM evaluation_terms ORDER BY start_date DESC').all().map(termInfo) });
});

router.post('/terms', requirePermission('evaluations.manage'), (req, res) => {
  const miss = required(req.body, ['name', 'start_date', 'end_date']);
  if (miss.length) return res.status(400).json({ error: 'Name, start date and end date are required.' });
  const { name, start_date, end_date, is_active = 1 } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return res.status(400).json({ error: 'Invalid date format.' });
  if (end_date < start_date) return res.status(400).json({ error: 'End date must be after start date.' });
  const r = db.prepare('INSERT INTO evaluation_terms(name, start_date, end_date, is_active, created_by) VALUES(?,?,?,?,?)')
    .run(esc(name).slice(0, 100), start_date, end_date, is_active ? 1 : 0, req.user.id);
  audit(req, 'evaluation.term_create', 'term', r.lastInsertRowid, { name });
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});

router.put('/terms/:id', requirePermission('evaluations.manage'), (req, res) => {
  const t = db.prepare('SELECT * FROM evaluation_terms WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Term not found' });
  const { name, start_date, end_date, is_active } = req.body;
  if (start_date && end_date && end_date < start_date) return res.status(400).json({ error: 'End date must be after start date.' });
  db.prepare('UPDATE evaluation_terms SET name = COALESCE(?, name), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), is_active = COALESCE(?, is_active) WHERE id = ?')
    .run(name ?? null, start_date ?? null, end_date ?? null, is_active === undefined ? null : (is_active ? 1 : 0), t.id);
  audit(req, 'evaluation.term_update', 'term', t.id, { name });
  res.json({ ok: true });
});

/* ---------- Member: my released results ---------- */

router.get('/my-results', (req, res) => {
  const rows = db.prepare(
    `SELECT e.id, e.overall_average, e.released_at, e.status,
            c.id AS committee_id, c.name AS committee_name,
            t.id AS term_id, t.name AS term_name, t.start_date, t.end_date
     FROM evaluations e
     JOIN committees c ON c.id = e.committee_id
     JOIN evaluation_terms t ON t.id = e.term_id
     WHERE e.member_id = ? AND e.status = 'released'
     ORDER BY t.start_date DESC, c.name`
  ).all(req.user.id);

  const out = [];
  for (const r of rows) {
    const ratings = db.prepare(
      `SELECT r.rating, cc.name AS category FROM evaluation_ratings r JOIN committee_categories cc ON cc.id = r.category_id
       WHERE r.evaluation_id = ? ORDER BY cc.sort_order`
    ).all(r.id);
    const comments = db.prepare(
      `SELECT comment_type, body FROM evaluation_comments WHERE evaluation_id = ? AND is_visible_to_member = 1 ORDER BY id`
    ).all(r.id);
    out.push({ ...r, ratings, comments });
  }
  // group by term with consolidated average
  const byTerm = [];
  const map = new Map();
  for (const r of out) {
    if (!map.has(r.term_id)) {
      const entry = { term_id: r.term_id, term_name: r.term_name, start_date: r.start_date, end_date: r.end_date, committees: [], overall_average: null, released_at: r.released_at };
      map.set(r.term_id, entry);
      byTerm.push(entry);
    }
    map.get(r.term_id).committees.push(r);
  }
  for (const t of byTerm) {
    const avgs = t.committees.map((c) => c.overall_average).filter((a) => a !== null);
    t.overall_average = avgs.length ? +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null;
  }
  res.json({ results: byTerm });
});

/* ---------- Committee dashboard ---------- */

router.get('/committee-dashboard', requirePermission('evaluations.view'), (req, res) => {
  const committees = myCommitteeIds(req.user.id);
  if (!committees.length && req.user.role_code !== 'admin') return res.status(403).json({ error: 'You are not assigned to any committee.' });
  const terms = activeTerms();
  const pool = evaluateePool();
  const defaultTerm = terms.find((t) => t.state === 'open') || terms[0] || null;
  const members = pool.map((m) => {
    const perCommittee = {};
    for (const c of committees) {
      const ev = evalState(c.id, req.user.id, m.id, defaultTerm ? defaultTerm.id : null);
      perCommittee[c.id] = ev ? { status: ev.status, evaluation_id: ev.id, average: ev.overall_average } : { status: 'none', evaluation_id: null, average: null };
    }
    return { ...m, committees: perCommittee };
  });
  res.json({ committees, terms, members, default_term_id: defaultTerm ? defaultTerm.id : null });
});

router.get('/committee-dashboard/:memberId', requirePermission('evaluations.view'), (req, res) => {
  const memberId = +req.params.memberId;
  const termId = +req.query.termId || null;
  const member = db.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.profile_picture, u.status, u.classification_id, c.name AS classification
     FROM users u LEFT JOIN member_classifications c ON c.id = u.classification_id WHERE u.id = ?`
  ).get(memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  let committees = myCommitteeIds(req.user.id);
  if (req.user.role_code === 'admin' && req.query.committee_id) {
    const c = db.prepare('SELECT id, name, code FROM committees WHERE id = ?').get(req.query.committee_id);
    if (c) committees = [c];
  }
  if (!committees.length) return res.status(403).json({ error: 'You are not assigned to any committee.' });

  const term = termId ? termById(termId) : activeTerms().find((t) => t.state === 'open') || activeTerms()[0];
  if (!term) return res.status(400).json({ error: 'No evaluation term configured.' });

  const out = [];
  for (const c of committees) {
    const ev = evalState(c.id, req.user.id, memberId, term.id);
    out.push({
      committee: { id: c.id, name: c.name, code: c.code, categories: categoriesFor(c.id) },
      evaluation: evalPayload(ev),
    });
  }
  res.json({ member, term, committees: out });
});

/* ---------- Save draft / submit ---------- */

function parseEvalBody(body) {
  const committee_id = +body.committee_id;
  const member_id = +body.member_id;
  const term_id = +body.term_id;
  const ratings = Array.isArray(body.ratings) ? body.ratings : [];
  const comments = Array.isArray(body.comments) ? body.comments : [];
  for (const r of ratings) {
    if (!isInt(r.rating, 1, 5)) throw Object.assign(new Error('Ratings must be whole numbers between 1 and 5.'), { status: 400 });
    if (!isInt(r.category_id, 1)) throw Object.assign(new Error('Invalid category.'), { status: 400 });
  }
  for (const c of comments) {
    if (!COMMENT_TYPES.includes(c.comment_type)) throw Object.assign(new Error('Invalid comment type.'), { status: 400 });
    if (!String(c.body || '').trim()) throw Object.assign(new Error('Comment body cannot be empty.'), { status: 400 });
  }
  return { committee_id, member_id, term_id, ratings, comments };
}

router.post('/save-draft', requirePermission('evaluations.evaluate'), (req, res) => {
  try {
    const { committee_id, member_id, term_id, ratings, comments } = parseEvalBody(req.body);
    assertCanEvaluate(req.user, committee_id, member_id);
    const term = termById(term_id);
    if (!term) return res.status(400).json({ error: 'Invalid evaluation term.' });
    if (!categoriesFor(committee_id).length) return res.status(400).json({ error: 'This committee has no rating categories configured.' });

    let ev = evalState(committee_id, req.user.id, member_id, term_id);
    if (ev && ['pending_review', 'approved', 'released'].includes(ev.status)) {
      return res.status(409).json({ error: `This evaluation is ${ev.status.replace('_', ' ')} and can no longer be edited.` });
    }
    if (!ev) {
      const r = db.prepare('INSERT INTO evaluations(committee_id, evaluator_id, member_id, term_id, status) VALUES(?,?,?,?,?)')
        .run(committee_id, req.user.id, member_id, term_id, 'draft');
      ev = { id: r.lastInsertRowid };
    }
    saveRatings(ev.id, ratings);
    saveComments(ev.id, comments);
    const avg = ratings.length ? +(ratings.reduce((a, r) => a + r.rating, 0) / ratings.length).toFixed(2) : null;
    db.prepare("UPDATE evaluations SET overall_average = ?, status = CASE WHEN status = 'returned' THEN 'returned' ELSE 'draft' END, updated_at = datetime('now') WHERE id = ?")
      .run(avg, ev.id);
    audit(req, 'evaluation.save_draft', 'evaluation', ev.id, { member_id, committee_id, term_id });
    res.json({ ok: true, evaluation_id: ev.id });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/submit', requirePermission('evaluations.evaluate'), (req, res) => {
  try {
    const { committee_id, member_id, term_id, ratings, comments } = parseEvalBody(req.body);
    assertCanEvaluate(req.user, committee_id, member_id);
    const term = termById(term_id);
    if (!term) return res.status(400).json({ error: 'Invalid evaluation term.' });
    validateTermOpen(term);

    const cats = categoriesFor(committee_id);
    const rated = new Set(ratings.map((r) => r.category_id));
    const missing = cats.filter((c) => !rated.has(c.id));
    if (missing.length) {
      return res.status(400).json({ error: `Please rate all categories before submitting. Missing: ${missing.map((m) => m.name).join(', ')}` });
    }
    for (const c of cats) {
      const r = ratings.find((x) => x.category_id === c.id);
      if (!isInt(r.rating, 1, 5)) return res.status(400).json({ error: 'All ratings must be between 1 and 5.' });
    }

    let ev = evalState(committee_id, req.user.id, member_id, term_id);
    if (ev && ['pending_review', 'approved', 'released', 'submitted', 'resubmitted'].includes(ev.status)) {
      return res.status(409).json({ error: `This evaluation has already been submitted and is ${ev.status.replace('_', ' ')}.` });
    }
    const prevStatus = ev ? ev.status : null;
    if (!ev) {
      const r = db.prepare('INSERT INTO evaluations(committee_id, evaluator_id, member_id, term_id, status) VALUES(?,?,?,?,?)')
        .run(committee_id, req.user.id, member_id, term_id, 'pending_review');
      ev = { id: r.lastInsertRowid };
    }
    saveRatings(ev.id, ratings);
    saveComments(ev.id, comments);
    const avg = ratings.length ? +(ratings.reduce((a, r) => a + r.rating, 0) / ratings.length).toFixed(2) : null;
    db.prepare("UPDATE evaluations SET overall_average = ?, status = 'pending_review', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(avg, ev.id);
    if (prevStatus === 'returned') {
      recordApproval(ev.id, req.user.id, 'resubmit', 'returned', 'pending_review', null);
    }
    audit(req, 'evaluation.submit', 'evaluation', ev.id, { member_id, committee_id, term_id, prev_status: prevStatus });
    res.json({ ok: true, evaluation_id: ev.id, status: 'pending_review' });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/* ---------- Committee member: my authored evaluations ---------- */

router.get('/my-evaluations', requirePermission('evaluations.view'), (req, res) => {
  const rows = db.prepare(
    `SELECT e.id, e.status, e.overall_average, e.submitted_at, e.updated_at,
            c.name AS committee_name, t.name AS term_name, t.id AS term_id,
            u.first_name, u.last_name, u.username, u.profile_picture
     FROM evaluations e
     JOIN committees c ON c.id = e.committee_id
     JOIN evaluation_terms t ON t.id = e.term_id
     JOIN users u ON u.id = e.member_id
     WHERE e.evaluator_id = ? ORDER BY e.updated_at DESC`
  ).all(req.user.id);
  for (const r of rows) {
    if (r.status === 'returned') {
      r.return_notes = db.prepare(`SELECT notes FROM evaluation_approvals WHERE evaluation_id = ? AND action = 'return' ORDER BY id DESC LIMIT 1`).get(r.id)?.notes || null;
    }
  }
  res.json({ evaluations: rows });
});

/* ---------- Admin approval center ---------- */

router.get('/admin-queue', requirePermission('evaluations.approve'), (req, res) => {
  const { committee_id = '', term_id = '', member_id = '', status = '', evaluator_id = '', from = '', to = '' } = req.query;
  const where = [];
  const params = [];
  if (committee_id) { where.push('e.committee_id = ?'); params.push(committee_id); }
  if (term_id) { where.push('e.term_id = ?'); params.push(term_id); }
  if (member_id) { where.push('e.member_id = ?'); params.push(member_id); }
  if (status) {
    if (status === 'pending') where.push("e.status IN ('pending_review','submitted','resubmitted')");
    else where.push('e.status = ?'), params.push(status);
  }
  if (evaluator_id) { where.push('e.evaluator_id = ?'); params.push(evaluator_id); }
  if (from) { where.push('e.submitted_at >= ?'); params.push(from); }
  if (to) { where.push('e.submitted_at <= ?'); params.push(to + ' 23:59:59'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT e.id, e.status, e.overall_average, e.submitted_at, e.approved_at, e.released_at, e.updated_at,
            c.name AS committee_name, c.id AS committee_id,
            t.name AS term_name, t.id AS term_id,
            m.first_name || ' ' || m.last_name AS member_name, m.id AS member_id, m.username AS member_username, m.profile_picture AS member_avatar,
            ev.first_name || ' ' || ev.last_name AS evaluator_name, ev.id AS evaluator_id, ev.username AS evaluator_username,
            (SELECT COUNT(*) FROM evaluation_ratings r WHERE r.evaluation_id = e.id) AS ratings_count,
            (SELECT COUNT(*) FROM committee_categories cc WHERE cc.committee_id = e.committee_id) AS categories_count
     FROM evaluations e
     JOIN committees c ON c.id = e.committee_id
     JOIN evaluation_terms t ON t.id = e.term_id
     JOIN users m ON m.id = e.member_id
     JOIN users ev ON ev.id = e.evaluator_id
     ${whereSql}
     ORDER BY CASE e.status WHEN 'pending_review' THEN 0 WHEN 'submitted' THEN 1 WHEN 'resubmitted' THEN 1 WHEN 'returned' THEN 2 ELSE 3 END, e.submitted_at DESC`
  ).all(...params);
  res.json({ evaluations: rows });
});

router.get('/admin-queue/:id', requirePermission('evaluations.approve'), (req, res) => {
  const ev = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evaluation not found' });
  const member = db.prepare('SELECT id, first_name, last_name, username, profile_picture FROM users WHERE id = ?').get(ev.member_id);
  const evaluator = db.prepare('SELECT id, first_name, last_name, username FROM users WHERE id = ?').get(ev.evaluator_id);
  const committee = db.prepare('SELECT id, name, code FROM committees WHERE id = ?').get(ev.committee_id);
  const term = db.prepare('SELECT id, name, start_date, end_date FROM evaluation_terms WHERE id = ?').get(ev.term_id);
  const ratings = db.prepare(
    `SELECT r.rating, cc.name AS category FROM evaluation_ratings r JOIN committee_categories cc ON cc.id = r.category_id WHERE r.evaluation_id = ? ORDER BY cc.sort_order`
  ).all(ev.id);
  const comments = db.prepare('SELECT comment_type, body, is_visible_to_member AS visible FROM evaluation_comments WHERE evaluation_id = ? ORDER BY id').all(ev.id);
  const approvals = db.prepare(
    `SELECT a.*, u.first_name || ' ' || u.last_name AS admin_name FROM evaluation_approvals a JOIN users u ON u.id = a.admin_id WHERE a.evaluation_id = ? ORDER BY a.id`
  ).all(ev.id);
  const { password_hash, ...memberSafe } = member;
  res.json({ evaluation: { ...ev, committee, term, member: memberSafe, evaluator, ratings, comments, approvals } });
});

/* ---------- Approve / return / release ---------- */

router.post('/:id/approve', requirePermission('evaluations.approve'), (req, res) => {
  const ev = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evaluation not found' });
  if (!['pending_review', 'submitted', 'resubmitted', 'returned'].includes(ev.status)) {
    return res.status(400).json({ error: `Cannot approve an evaluation in status "${ev.status}".` });
  }
  const notes = req.body.notes ? esc(req.body.notes).slice(0, 2000) : ev.admin_notes;
  db.prepare("UPDATE evaluations SET status = 'approved', approved_at = datetime('now'), admin_notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(notes, ev.id);
  recordApproval(ev.id, req.user.id, 'approve', ev.status, 'approved', req.body.notes ? notes : null);
  audit(req, 'evaluation.approve', 'evaluation', ev.id, { member_id: ev.member_id, committee_id: ev.committee_id, term_id: ev.term_id, prev: ev.status });
  res.json({ ok: true });
});

router.post('/:id/return', requirePermission('evaluations.approve'), (req, res) => {
  const ev = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evaluation not found' });
  if (!['pending_review', 'submitted', 'resubmitted', 'approved'].includes(ev.status)) {
    return res.status(400).json({ error: `Cannot return an evaluation in status "${ev.status}".` });
  }
  const notes = esc(req.body.notes || '');
  if (!notes) return res.status(400).json({ error: 'Please provide revision notes for the committee member.' });
  db.prepare("UPDATE evaluations SET status = 'returned', admin_notes = ?, updated_at = datetime('now') WHERE id = ?").run(notes, ev.id);
  recordApproval(ev.id, req.user.id, 'return', ev.status, 'returned', notes);
  // notify evaluator
  db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)')
    .run(ev.evaluator_id, 'evaluation', 'Evaluation returned for revision', `Your evaluation was returned by the administrator. Please review the notes and resubmit.`, '#/committee/history');
  audit(req, 'evaluation.return', 'evaluation', ev.id, { member_id: ev.member_id, prev: ev.status });
  res.json({ ok: true });
});

function releaseEval(req, res, ev, force) {
  const settings = getSettings();
  if (ev.status !== 'approved') {
    return res.status(400).json({ error: `Only approved evaluations can be released (current: ${ev.status}).` });
  }
  if (settings.release_mode === 'package' && force !== true) {
    return res.status(409).json({
      error: 'Release mode is set to "package". Use package release (all committee results for this member and term must be approved).',
      code: 'PACKAGE_MODE',
    });
  }
  db.prepare("UPDATE evaluations SET status = 'released', released_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(ev.id);
  recordApproval(ev.id, req.user.id, 'release', 'approved', 'released', null);
  notifyMember(ev.id);
  audit(req, 'evaluation.release', 'evaluation', ev.id, { member_id: ev.member_id, committee_id: ev.committee_id, term_id: ev.term_id, mode: 'individual' });
  res.json({ ok: true, released: [ev.id] });
}

router.post('/:id/release', requirePermission('evaluations.release'), (req, res) => {
  const ev = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evaluation not found' });
  releaseEval(req, res, ev, req.body.force === true);
});

router.post('/release-package', requirePermission('evaluations.release'), (req, res) => {
  const member_id = +req.body.member_id;
  const term_id = +req.body.term_id;
  if (!member_id || !term_id) return res.status(400).json({ error: 'member_id and term_id are required.' });
  const all = db.prepare(
    `SELECT e.*, c.name AS committee_name FROM evaluations e JOIN committees c ON c.id = e.committee_id
     WHERE e.member_id = ? AND e.term_id = ? AND e.status != 'draft' ORDER BY e.id`
  ).all(member_id, term_id);
  if (!all.length) return res.status(400).json({ error: 'No evaluations found for this member and term.' });
  const blocking = all.filter((e) => !['approved', 'released'].includes(e.status));
  if (blocking.length) {
    return res.status(409).json({
      error: `Cannot release the package: ${blocking.length} evaluation(s) not yet approved (${blocking.map((b) => b.committee_name + ' [' + b.status + ']').join(', ')}).`,
      blocking,
    });
  }
  const toRelease = all.filter((e) => e.status === 'approved');
  if (!toRelease.length) return res.status(400).json({ error: 'Everything for this member and term is already released.' });
  const tx = db.transaction(() => {
    for (const ev of toRelease) {
      db.prepare("UPDATE evaluations SET status = 'released', released_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(ev.id);
      recordApproval(ev.id, req.user.id, 'release', 'approved', 'released', 'Package release');
      notifyMember(ev.id);
      audit(req, 'evaluation.release', 'evaluation', ev.id, { member_id, term_id, mode: 'package' });
    }
  });
  tx();
  res.json({ ok: true, released: toRelease.map((e) => e.id), count: toRelease.length });
});

/* ---------- Admin summary ---------- */

router.get('/admin-summary', requirePermission('evaluations.approve'), (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status IN ('pending_review','submitted','resubmitted')").get().c;
  const returned = db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'returned'").get().c;
  const approved = db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'approved'").get().c;
  const released = db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'released'").get().c;
  const drafts = db.prepare("SELECT COUNT(*) c FROM evaluations WHERE status = 'draft'").get().c;
  const byCommittee = db.prepare(
    `SELECT c.id, c.name, COUNT(e.id) AS total,
            SUM(CASE WHEN e.status IN ('pending_review','submitted','resubmitted') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN e.status = 'released' THEN 1 ELSE 0 END) AS released,
            SUM(CASE WHEN e.status = 'returned' THEN 1 ELSE 0 END) AS returned
     FROM committees c LEFT JOIN evaluations e ON e.committee_id = c.id GROUP BY c.id ORDER BY c.id`
  ).all();
  const byTerm = db.prepare(
    `SELECT t.id, t.name, t.start_date, t.end_date, COUNT(e.id) AS total,
            SUM(CASE WHEN e.status IN ('pending_review','submitted','resubmitted') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN e.status = 'released' THEN 1 ELSE 0 END) AS released
     FROM evaluation_terms t LEFT JOIN evaluations e ON e.term_id = t.id GROUP BY t.id ORDER BY t.start_date DESC`
  ).all();
  // incomplete: active evaluatees with no released evaluation in the latest open term
  const openTerm = activeTerms().find((t) => t.state === 'open') || null;
  let incomplete = [];
  if (openTerm) {
    incomplete = db.prepare(
      `SELECT u.id, u.first_name, u.last_name, u.profile_picture, c.name AS classification
       FROM users u LEFT JOIN member_classifications c ON c.id = u.classification_id
       WHERE u.status = 'active' AND u.role_id != (SELECT id FROM roles WHERE code = 'admin')
         AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.member_id = u.id AND e.term_id = ? AND e.status = 'released')`
    ).all(openTerm.id);
  }
  res.json({ summary: { pending, returned, approved, released, drafts, incomplete_count: incomplete.length, incomplete }, byCommittee, byTerm, open_term: openTerm });
});

module.exports = router;
