/* Schedule management — monthly views, CRUD, assignments, conflict detection, publish. */
'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, hasPerm } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { required, isDate, isTime, esc } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const canManage = (user) => hasPerm(user, 'schedule.manage');
const isAdmin = (user) => user.role_code === 'admin';
// Officers and admins see the full calendar; regular members see only their own assignments.
const seesAllAssignments = (user) => isAdmin(user) || user.role_code === 'officer' || canManage(user);

/** Find overlapping confirmed/pending assignments for a member on a date. */
function findConflicts(memberId, date, start, end, excludeScheduleId = null, excludeAssignmentId = null) {
  if (!end || end <= start) return []; // open-ended or invalid → no overlap check
  const rows = db.prepare(`
    SELECT sa.id, sa.schedule_id, s.title, s.schedule_date, s.start_time, s.end_time, s.venue, sa.role,
           sa.status AS assignment_status, s.status AS schedule_status
    FROM schedule_assignments sa JOIN schedules s ON s.id = sa.schedule_id
    WHERE sa.user_id = ? AND s.schedule_date = ? AND s.status != 'cancelled'
      AND sa.status IN ('confirmed','pending')
      AND s.start_time < ? AND (s.end_time IS NULL OR s.end_time > ?)
  `).all(memberId, date, end, start);
  return rows.filter((r) =>
    (!excludeScheduleId || r.schedule_id !== excludeScheduleId) &&
    (!excludeAssignmentId || r.id !== excludeAssignmentId)
  );
}

// ---- Month view ----
router.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const start = month + '-01';
  const end = month + '-31';
  const params = [start, end];
  let where = 's.schedule_date BETWEEN ? AND ?';
  if (!seesAllAssignments(req.user)) { // regular members see only their own assignments
    where += ' AND (sa.user_id = ? OR sa.user_id IS NULL)';
    params.push(req.user.id);
  }
  const rows = db.prepare(
    `SELECT s.id, s.title, s.schedule_date, s.start_time, s.end_time, s.venue, s.notes, s.status AS schedule_status,
            sa.id AS assignment_id, sa.user_id, sa.role, sa.notes AS assignment_notes, sa.status AS assignment_status,
            u.first_name, u.last_name, u.username, u.profile_picture, u.status AS member_status
     FROM schedules s
     LEFT JOIN schedule_assignments sa ON sa.schedule_id = s.id
     LEFT JOIN users u ON u.id = sa.user_id
     WHERE ${where} ORDER BY s.schedule_date, s.start_time`
  ).all(...params);
  // Group by schedule
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.id)) {
      map.set(r.id, {
        id: r.id, title: r.title, schedule_date: r.schedule_date, start_time: r.start_time, end_time: r.end_time,
        venue: r.venue, notes: r.notes, status: r.schedule_status, assignments: [],
      });
    }
    const s = map.get(r.id);
    if (r.user_id) s.assignments.push({
      id: r.assignment_id, user_id: r.user_id, role: r.role, notes: r.assignment_notes,
      status: r.assignment_status, member: `${r.first_name} ${r.last_name}`, username: r.username,
      avatar: r.profile_picture, member_status: r.member_status,
      self: r.user_id === req.user.id,
    });
  }
  const schedules = [...map.values()];
  res.json({ month, schedules });
});

// ---- Detail ----
router.get('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  let assignments = db.prepare(
    `SELECT sa.id, sa.user_id, sa.role, sa.notes, sa.status, u.first_name, u.last_name, u.username, u.profile_picture, u.status AS member_status
     FROM schedule_assignments sa JOIN users u ON u.id = sa.user_id WHERE sa.schedule_id = ? ORDER BY sa.role`
  ).all(s.id);
  if (!seesAllAssignments(req.user)) {
    assignments = assignments.filter((a) => a.user_id === req.user.id).map((a) => ({ ...a, self: true }));
  } else {
    assignments = assignments.map((a) => ({ ...a, self: a.user_id === req.user.id }));
  }
  res.json({ schedule: s, assignments });
});

// ---- Create ----
router.post('/', requirePermission('schedule.manage'), (req, res) => {
  const miss = required(req.body, ['title', 'schedule_date', 'start_time']);
  if (miss.length) return res.status(400).json({ error: 'Title, date and start time are required.' });
  if (!isDate(req.body.schedule_date)) return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD).' });
  if (!isTime(req.body.start_time)) return res.status(400).json({ error: 'Invalid start time (expected HH:MM).' });
  if (req.body.end_time && !isTime(req.body.end_time)) return res.status(400).json({ error: 'Invalid end time.' });
  if (req.body.end_time && req.body.end_time <= req.body.start_time) return res.status(400).json({ error: 'End time must be after start time.' });
  const r = db.prepare(
    'INSERT INTO schedules(title, schedule_date, start_time, end_time, venue, notes, status, created_by) VALUES(?,?,?,?,?,?,?,?)'
  ).run(esc(req.body.title), req.body.schedule_date, req.body.start_time, req.body.end_time || null,
    esc(req.body.venue || ''), esc(req.body.notes || ''), req.body.status === 'published' ? 'published' : 'draft', req.user.id);
  audit(req, 'schedule.create', 'schedule', r.lastInsertRowid, { date: req.body.schedule_date, title: req.body.title });
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});

// ---- Update ----
router.put('/:id', requirePermission('schedule.manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  const { title, schedule_date, start_time, end_time, venue, notes, status } = req.body;
  if (schedule_date && !isDate(schedule_date)) return res.status(400).json({ error: 'Invalid date.' });
  if (start_time && !isTime(start_time)) return res.status(400).json({ error: 'Invalid start time.' });
  if (end_time && !isTime(end_time)) return res.status(400).json({ error: 'Invalid end time.' });
  const newStart = start_time || s.start_time;
  const newEnd = end_time === null || end_time === '' ? null : (end_time || s.end_time);
  if (newEnd && newEnd <= newStart) return res.status(400).json({ error: 'End time must be after start time.' });
  if (status && !['draft', 'published', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const timeChanged = (start_time && start_time !== s.start_time) || (end_time !== undefined && (end_time || null) !== s.end_time);
  if (timeChanged) {
    // re-check conflicts for all assignments
    const assigns = db.prepare('SELECT * FROM schedule_assignments WHERE schedule_id = ?').all(s.id);
    const conflicts = [];
    for (const a of assigns) {
      const c = findConflicts(a.user_id, schedule_date || s.schedule_date, newStart, newEnd, s.id);
      if (c.length) conflicts.push({ member_id: a.user_id, assignment_id: a.id, conflicts: c });
    }
    if (conflicts.length && req.body.allow_conflict !== true) {
      return res.status(409).json({ error: 'This change creates assignment conflicts.', conflicts });
    }
  }

  db.prepare(
    `UPDATE schedules SET title = COALESCE(?, title), schedule_date = COALESCE(?, schedule_date), start_time = COALESCE(?, start_time),
     end_time = ?, venue = COALESCE(?, venue), notes = COALESCE(?, notes), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?`
  ).run(title ?? null, schedule_date ?? null, start_time ?? null, newEnd, venue ?? null, notes ?? null, status ?? null, s.id);
  audit(req, 'schedule.update', 'schedule', s.id, { changed: Object.keys(req.body) });

  // Notify affected members if schedule was published
  if (s.status === 'published' && (title !== undefined || schedule_date !== undefined || start_time !== undefined || end_time !== undefined)) {
    const members = db.prepare('SELECT user_id FROM schedule_assignments WHERE schedule_id = ?').all(s.id);
    for (const m of members) {
      db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)')
        .run(m.user_id, 'schedule', 'Schedule updated', `Your assignment on ${schedule_date || s.schedule_date} has changed. Please check your schedule.`, '#/schedule');
    }
  }
  res.json({ ok: true });
});

// ---- Publish ----
router.post('/:id/publish', requirePermission('schedule.manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (s.status === 'cancelled') return res.status(400).json({ error: 'A cancelled schedule cannot be published.' });
  db.prepare("UPDATE schedules SET status = 'published', updated_at = datetime('now') WHERE id = ?").run(s.id);
  const members = db.prepare('SELECT user_id FROM schedule_assignments WHERE schedule_id = ?').all(s.id);
  for (const m of members) {
    db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)')
      .run(m.user_id, 'schedule', 'New schedule assignment', `${s.title} on ${s.schedule_date} at ${s.start_time} — ${s.venue || 'venue TBD'}.`, '#/schedule');
  }
  audit(req, 'schedule.publish', 'schedule', s.id, { date: s.schedule_date, notified: members.length });
  res.json({ ok: true, notified: members.length });
});

// ---- Cancel ----
router.post('/:id/cancel', requirePermission('schedule.manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  db.prepare("UPDATE schedules SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(s.id);
  const members = db.prepare('SELECT user_id FROM schedule_assignments WHERE schedule_id = ?').all(s.id);
  for (const m of members) {
    db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)')
      .run(m.user_id, 'schedule', 'Schedule cancelled', `${s.title} on ${s.schedule_date} has been cancelled.`, '#/schedule');
  }
  audit(req, 'schedule.cancel', 'schedule', s.id, { date: s.schedule_date });
  res.json({ ok: true });
});

// ---- Delete (drafts only) ----
router.delete('/:id', requirePermission('schedule.manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (s.status === 'published') return res.status(400).json({ error: 'Published schedules cannot be deleted. Cancel them instead.' });
  db.prepare('DELETE FROM schedules WHERE id = ?').run(s.id);
  audit(req, 'schedule.delete', 'schedule', s.id, { date: s.schedule_date });
  res.json({ ok: true });
});

// ---- Add assignment ----
router.post('/:id/assignments', requirePermission('schedule.manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (s.status === 'cancelled') return res.status(400).json({ error: 'Cannot assign to a cancelled schedule.' });
  const miss = required(req.body, ['user_id', 'role']);
  if (miss.length) return res.status(400).json({ error: 'Member and role are required.' });
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.user_id);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const dup = db.prepare('SELECT 1 FROM schedule_assignments WHERE schedule_id = ? AND user_id = ?').get(s.id, member.id);
  if (dup) return res.status(409).json({ error: `${member.first_name} ${member.last_name} is already assigned to this schedule.` });
  if (member.status !== 'active' && req.body.allow_inactive !== true) {
    return res.status(400).json({ error: `${member.first_name} ${member.last_name} is not an active member. Use "allow inactive" to override.` });
  }

  const conflicts = findConflicts(member.id, s.schedule_date, s.start_time, s.end_time, s.id);
  if (conflicts.length && req.body.allow_conflict !== true) {
    const detail = conflicts.map((c) => `${c.title} (${c.schedule_date} ${c.start_time}–${c.end_time || '?'})`).join('; ');
    return res.status(409).json({ error: `Conflicting assignment: ${member.first_name} ${member.last_name} is already scheduled for ${detail}.`, conflicts });
  }

  const r = db.prepare('INSERT INTO schedule_assignments(schedule_id, user_id, role, notes, status) VALUES(?,?,?,?,?)')
    .run(s.id, member.id, esc(req.body.role), esc(req.body.notes || ''), ['pending', 'confirmed', 'declined', 'replaced'].includes(req.body.status) ? req.body.status : 'confirmed');
  audit(req, 'schedule.assign', 'schedule', s.id, { user_id: member.id, role: req.body.role, conflicts: conflicts.length });

  if (s.status === 'published') {
    db.prepare('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)')
      .run(member.id, 'schedule', 'New schedule assignment', `${s.title} on ${s.schedule_date} at ${s.start_time} as ${req.body.role}.`, '#/schedule');
  }
  res.status(201).json({ ok: true, id: r.lastInsertRowid, warning: conflicts.length ? `Assigned with ${conflicts.length} overlapping assignment(s).` : null });
});

// ---- Update assignment ----
router.put('/assignments/:id', requirePermission('schedule.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM schedule_assignments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(a.schedule_id);
  const { role, notes, status, user_id } = req.body;
  if (status && !['confirmed', 'pending', 'declined', 'replaced'].includes(status)) return res.status(400).json({ error: 'Invalid assignment status.' });
  db.prepare('UPDATE schedule_assignments SET role = COALESCE(?, role), notes = COALESCE(?, notes), status = COALESCE(?, status), user_id = COALESCE(?, user_id) WHERE id = ?')
    .run(role ?? null, notes ?? null, status ?? null, user_id ?? null, a.id);
  audit(req, 'schedule.assignment_update', 'schedule', s.id, { assignment_id: a.id, fields: Object.keys(req.body) });
  res.json({ ok: true });
});

// ---- Remove assignment ----
router.delete('/assignments/:id', requirePermission('schedule.manage'), (req, res) => {
  const a = db.prepare('SELECT * FROM schedule_assignments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  db.prepare('DELETE FROM schedule_assignments WHERE id = ?').run(a.id);
  audit(req, 'schedule.unassign', 'schedule', a.schedule_id, { assignment_id: a.id });
  res.json({ ok: true });
});

module.exports = router;
