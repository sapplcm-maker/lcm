/* Reports — member/committee/term/overview summaries, distributions, exports (CSV/XLSX/PDF). */
'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePermission, hasPerm } = require('../middleware/rbac');
const { audit } = require('../middleware/audit');
const { getSettings } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* Official results = approved + released (never drafts/pending/returned). */
const OFFICIAL = "e.status IN ('approved','released')";

function memberSummary(memberId, termId) {
  const where = ['e.member_id = ?'];
  const params = [memberId];
  if (termId) { where.push('e.term_id = ?'); params.push(termId); }
  const rows = db.prepare(
    `SELECT e.id, e.status, e.overall_average, e.released_at, e.approved_at,
            c.id AS committee_id, c.name AS committee_name, c.code AS committee_code,
            t.id AS term_id, t.name AS term_name, t.start_date, t.end_date
     FROM evaluations e JOIN committees c ON c.id = e.committee_id JOIN evaluation_terms t ON t.id = e.term_id
     WHERE ${where.join(' AND ')} AND ${OFFICIAL} ORDER BY t.start_date DESC, c.name`
  ).all(...params);
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
  const avgs = out.map((r) => r.overall_average).filter((a) => a !== null);
  return {
    member_id: memberId,
    evaluations: out,
    overall_average: avgs.length ? +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null,
    count: out.length,
  };
}

function committeeSummary(committeeId, termId) {
  const where = ['e.committee_id = ?'];
  const params = [committeeId];
  if (termId) { where.push('e.term_id = ?'); params.push(termId); }
  const rows = db.prepare(
    `SELECT e.member_id, m.first_name, m.last_name, m.profile_picture, c.name AS classification,
            e.id, e.overall_average, e.status, e.released_at
     FROM evaluations e
     JOIN users m ON m.id = e.member_id
     LEFT JOIN member_classifications c ON c.id = m.classification_id
     WHERE ${where.join(' AND ')} AND ${OFFICIAL}
     ORDER BY m.last_name, m.first_name`
  ).all(...params);
  const byMember = new Map();
  for (const r of rows) {
    if (!byMember.has(r.member_id)) {
      byMember.set(r.member_id, { member_id: r.member_id, first_name: r.first_name, last_name: r.last_name, avatar: r.profile_picture, classification: r.classification, evaluations: [] });
    }
    byMember.get(r.member_id).evaluations.push({ id: r.id, average: r.overall_average, status: r.status, released_at: r.released_at });
  }
  const members = [...byMember.values()].map((m) => {
    const avgs = m.evaluations.map((e) => e.average).filter((a) => a !== null);
    m.average = avgs.length ? +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null;
    return m;
  });
  return { committee_id: committeeId, members };
}

function termSummary(termId) {
  const rows = db.prepare(
    `SELECT c.id AS committee_id, c.name AS committee_name, e.member_id, m.first_name, m.last_name, e.overall_average, e.status
     FROM evaluations e JOIN committees c ON c.id = e.committee_id JOIN users m ON m.id = e.member_id
     WHERE e.term_id = ? AND ${OFFICIAL} ORDER BY c.id, m.last_name`
  ).all(termId);
  const committees = new Map();
  for (const r of rows) {
    if (!committees.has(r.committee_id)) {
      committees.set(r.committee_id, { committee_id: r.committee_id, committee_name: r.committee_name, entries: [], average: null });
    }
    committees.get(r.committee_id).entries.push({ member_id: r.member_id, member_name: `${r.first_name} ${r.last_name}`, average: r.overall_average, status: r.status });
  }
  const list = [...committees.values()].map((c) => {
    const avgs = c.entries.map((e) => e.average).filter((a) => a !== null);
    c.average = avgs.length ? +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null;
    return c;
  });
  return { term_id: termId, committees: list };
}

function distribution(committeeId, termId) {
  const where = [OFFICIAL];
  const params = [];
  if (committeeId) { where.push('e.committee_id = ?'); params.push(committeeId); }
  if (termId) { where.push('e.term_id = ?'); params.push(termId); }
  const rows = db.prepare(
    `SELECT r.rating, COUNT(*) AS n FROM evaluation_ratings r JOIN evaluations e ON e.id = r.evaluation_id
     WHERE ${where.join(' AND ')} GROUP BY r.rating`
  ).all(...params);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rows) counts[r.rating] = r.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const mean = total ? +Object.entries(counts).reduce((a, [k, v]) => a + (+k) * v, 0) / total : null;
  return { counts, total, mean: mean === null ? null : +mean.toFixed(2) };
}

function canViewReports(user) {
  return hasPerm(user, 'reports.view') || hasPerm(user, 'reports.export') || user.role_code === 'admin';
}

/* ---------- Endpoints ---------- */

function myCommitteeIds(userId) {
  if (userId === undefined) return [];
  return db.prepare('SELECT c.id FROM committee_members cm JOIN committees c ON c.id = cm.committee_id WHERE cm.user_id = ? AND cm.is_active = 1').all(userId).map((r) => r.id);
}

router.get('/overview', (req, res) => {
  if (!canViewReports(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { term_id = '' } = req.query;
  let committees = db.prepare('SELECT id, name, code FROM committees ORDER BY id').all();
  if (req.user.role_code !== 'admin') {
    const mine = myCommitteeIds(req.user.id);
    committees = committees.filter((c) => mine.includes(c.id));
    if (!committees.length) return res.status(403).json({ error: 'Forbidden: you are not on any evaluation committee.' });
  }
  const terms = db.prepare('SELECT id, name, start_date, end_date FROM evaluation_terms ORDER BY start_date DESC').all();
  const perCommittee = committees.map((c) => {
    const s = committeeSummary(c.id, term_id || null);
    const d = distribution(c.id, term_id || null);
    const avgs = s.members.map((m) => m.average).filter((a) => a !== null);
    return { ...c, evaluated: s.members.length, average: avgs.length ? +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null, distribution: d };
  });
  res.json({ committees: perCommittee, terms });
});

router.get('/member/:id', (req, res) => {
  const memberId = +req.params.id;
  if (!canViewReports(req.user) && memberId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!canViewReports(req.user) && req.user.role_code !== 'admin') {
    // a regular member may only see their own *released* results via /my-results; keep this admin/officer+ path strict
    return res.status(403).json({ error: 'Forbidden' });
  }
  const member = db.prepare('SELECT id, first_name, last_name, username, profile_picture FROM users WHERE id = ?').get(memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const summary = memberSummary(memberId, req.query.term_id || null);
  res.json({ member, ...summary });
});

router.get('/committee/:id', (req, res) => {
  if (!canViewReports(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const committee = db.prepare('SELECT id, name, code FROM committees WHERE id = ?').get(req.params.id);
  if (!committee) return res.status(404).json({ error: 'Committee not found' });
  if (req.user.role_code !== 'admin' && !myCommitteeIds(req.user.id).includes(committee.id)) {
    return res.status(403).json({ error: 'Forbidden: you may only view reports for your own committee.' });
  }
  const s = committeeSummary(committee.id, req.query.term_id || null);
  const d = distribution(committee.id, req.query.term_id || null);
  res.json({ committee, ...s, distribution: d });
});

router.get('/term/:id', (req, res) => {
  if (!canViewReports(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const term = db.prepare('SELECT id, name, start_date, end_date FROM evaluation_terms WHERE id = ?').get(req.params.id);
  if (!term) return res.status(404).json({ error: 'Term not found' });
  const s = termSummary(term.id);
  const d = distribution(null, term.id);
  res.json({ term, ...s, distribution: d });
});

router.get('/incomplete', requirePermission('reports.view'), (req, res) => {
  const term = req.query.term_id ? db.prepare('SELECT id, name FROM evaluation_terms WHERE id = ?').get(req.query.term_id) : null;
  const termId = term ? term.id : db.prepare('SELECT id FROM evaluation_terms ORDER BY start_date DESC LIMIT 1').get().id;
  const rows = db.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.username, u.profile_picture, c.name AS classification,
            (SELECT COUNT(*) FROM evaluations e WHERE e.member_id = u.id AND e.term_id = ? AND e.status = 'released') AS released_count
     FROM users u LEFT JOIN member_classifications c ON c.id = u.classification_id
     WHERE u.status = 'active' AND u.role_id != (SELECT id FROM roles WHERE code = 'admin')
       AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.member_id = u.id AND e.term_id = ? AND e.status = 'released')
     ORDER BY u.last_name`
  ).all(termId, termId);
  res.json({ term_id: termId, members: rows });
});

/* ---------- Exports ---------- */

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}

async function sendXlsx(res, filename, sheets) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.headers);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r);
    ws.columns.forEach((c) => { c.width = 22; });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

function makePdf(title, subtitle, tableHeaders, rows, footer) {
  const PDFDocument = require('pdfkit');
  const settings = getSettings();
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  doc.fontSize(18).fillColor('#14294d').text(settings.org_name || 'LCM Ministry', { align: 'center' });
  doc.fontSize(12).fillColor('#1c2430').text(title, { align: 'center' });
  if (subtitle) doc.fontSize(9).fillColor('#5a6472').text(subtitle, { align: 'center' });
  doc.moveDown(1.2);
  const colW = (doc.page.width - 96) / tableHeaders.length;
  const drawHeader = () => {
    doc.fontSize(9).fillColor('#ffffff');
    tableHeaders.forEach((h, i) => doc.rect(48 + i * colW, doc.y, colW, 18).fill('#14294d'));
    doc.fillColor('#ffffff');
    tableHeaders.forEach((h, i) => doc.text(h, 48 + i * colW + 3, doc.y - 18 + 5, { width: colW - 6 }));
    doc.moveDown(0.4);
  };
  drawHeader();
  let rowIndex = 0;
  for (const r of rows) {
    if (doc.y > doc.page.height - 80) { doc.addPage(); drawHeader(); }
    const h = 14;
    doc.fontSize(8.5).fillColor(rowIndex % 2 ? '#f0f2f5' : '#ffffff');
    tableHeaders.forEach((_, i) => doc.rect(48 + i * colW, doc.y, colW, h).fill(rowIndex % 2 ? '#f0f2f5' : '#ffffff'));
    doc.fillColor('#1c2430');
    tableHeaders.forEach((_, i) => doc.text(String(r[i] ?? ''), 48 + i * colW + 3, doc.y + 2, { width: colW - 6 }));
    doc.moveDown(0.36);
    rowIndex++;
  }
  if (footer) { doc.moveDown(); doc.fontSize(8).fillColor('#5a6472').text(footer, { align: 'center' }); }
  return doc;
}

async function exportXlsxOrPdf(req, res, format, filenameBase, sheets, pdfTitle, pdfSubtitle, pdfRows, pdfFooter) {
  audit(req, 'report.export', 'report', null, { filename: filenameBase, format });
  if (format === 'xlsx') return sendXlsx(res, filenameBase + '.xlsx', sheets);
  if (format === 'pdf') {
    const doc = makePdf(pdfTitle, pdfSubtitle, sheets[0].headers, pdfRows || sheets[0].rows, pdfFooter);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
    doc.pipe(res);
    doc.end();
    return;
  }
  sendCsv(res, filenameBase + '.csv', sheets[0].headers, sheets[0].rows);
}

router.get('/export/member/:id', requirePermission('reports.export'), async (req, res) => {
  try {
    const memberId = +req.params.id;
    const member = db.prepare('SELECT id, first_name, last_name, username FROM users WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const s = memberSummary(memberId, req.query.term_id || null);
    const headers = ['Term', 'Committee', 'Status', 'Average', 'Released'];
    const rows = s.evaluations.map((e) => [e.term_name, e.committee_name, e.status, e.overall_average ?? '', e.released_at || '']);
    const sheets = [
      { name: 'Summary', headers, rows },
      { name: 'Ratings', headers: ['Term', 'Committee', 'Category', 'Rating'], rows: s.evaluations.flatMap((e) => e.ratings.map((r) => [e.term_name, e.committee_name, r.category, r.rating])) },
    ];
    const format = req.query.format || 'csv';
    await exportXlsxOrPdf(req, res, format, `member-report-${member.username}`, sheets, `Individual Evaluation Report — ${member.first_name} ${member.last_name}`, `Overall average: ${s.overall_average ?? '—'}`, rows, 'LCM Ministry — Official evaluation report');
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export failed' }); }
});

router.get('/export/committee/:id', requirePermission('reports.export'), async (req, res) => {
  try {
    const committee = db.prepare('SELECT id, name, code FROM committees WHERE id = ?').get(req.params.id);
    if (!committee) return res.status(404).json({ error: 'Committee not found' });
    const s = committeeSummary(committee.id, req.query.term_id || null);
    const d = distribution(committee.id, req.query.term_id || null);
    const headers = ['Member', 'Classification', 'Average', 'Evaluations', 'Status'];
    const rows = s.members.map((m) => [m.last_name + ', ' + m.first_name, m.classification || '', m.average ?? '', m.evaluations.length, m.evaluations.map((e) => e.status).join('; ')]);
    const distHeaders = ['1', '2', '3', '4', '5', 'Total', 'Mean'];
    const distRows = [Object.values(d.counts), d.total, d.mean ?? ''];
    const sheets = [
      { name: 'Committee Summary', headers, rows },
      { name: 'Rating Distribution', headers: distHeaders, rows: [distRows] },
    ];
    const format = req.query.format || 'csv';
    await exportXlsxOrPdf(req, res, format, `committee-report-${committee.code}`, sheets, `Committee Evaluation Report — ${committee.name}`, `Rating mean: ${d.mean ?? '—'}`, rows, 'LCM Ministry — Official evaluation report');
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export failed' }); }
});

router.get('/export/term/:id', requirePermission('reports.export'), async (req, res) => {
  try {
    const term = db.prepare('SELECT id, name, start_date, end_date FROM evaluation_terms WHERE id = ?').get(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found' });
    const s = termSummary(term.id);
    const headers = ['Committee', 'Member', 'Average', 'Status'];
    const rows = s.committees.flatMap((c) => c.entries.map((e) => [c.committee_name, e.member_name, e.average ?? '', e.status]));
    const sheets = [{ name: 'Term Summary', headers, rows }];
    const format = req.query.format || 'csv';
    await exportXlsxOrPdf(req, res, format, `term-report-${term.id}`, sheets, `Term Evaluation Report — ${term.name}`, `${term.start_date} — ${term.end_date}`, rows, 'LCM Ministry — Official evaluation report');
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export failed' }); }
});

module.exports = router;
