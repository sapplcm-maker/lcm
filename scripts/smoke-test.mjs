/* Backend smoke test — exercises every core flow against a running server. */
'use strict';
const BASE = 'http://localhost:3000';
let failures = 0;
let passed = 0;

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

class Client {
  constructor() { this.cookies = {}; this.csrf = null; }
  setCookies(res) {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > -1) this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookieHeader()) headers.cookie = this.cookieHeader();
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    this.setCookies(res);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else data = await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  async login(username, password) {
    const csrfRes = await this.req('GET', '/api/auth/csrf');
    this.csrf = csrfRes.data.token;
    const r = await this.req('POST', '/api/auth/login', { username, password });
    if (r.status === 200 && r.data.token) this.csrf = r.data.token;
    return r;
  }
}

const run = async () => {
  console.log('— Auth & RBAC —');
  const admin = new Client();
  let r = await admin.login('admin', 'Admin@123');
  check('admin login', r.status === 200 && r.data.user.username === 'admin', JSON.stringify(r.data).slice(0, 100));
  r = await admin.req('GET', '/api/auth/me');
  check('me returns permissions', r.status === 200 && Array.isArray(r.data.user.perms) && r.data.user.perms.length > 20);
  check('me returns committees', Array.isArray(r.data.committees));

  const andrea = new Client();
  r = await andrea.login('andrea.lopez', 'Member@123');
  check('member login', r.status === 200);

  const bad = new Client();
  r = await bad.login('admin', 'wrongpass');
  check('wrong password rejected', r.status === 401);
  for (let i = 0; i < 4; i++) await bad.login('admin', 'wrongpass');
  r = await bad.login('admin', 'Admin@123');
  check('rate limit after 5 fails', r.status === 429, `got ${r.status}`);

  r = await andrea.req('GET', '/api/members');
  check('member blocked from member list', r.status === 403);
  r = await andrea.req('GET', '/api/admin/audit');
  check('member blocked from audit', r.status === 403);
  r = await andrea.req('GET', '/api/evaluations/admin-queue');
  check('member blocked from admin queue', r.status === 403);

  console.log('— Members —');
  r = await admin.req('POST', '/api/members', {
    username: 'new.member', first_name: 'Test', last_name: 'Member', password: 'TestPass1',
    role_id: 4, classification_id: 1, status: 'active',
  });
  check('create member', r.status === 201, JSON.stringify(r.data));
  const newId = r.data.member?.id;
  r = await admin.req('POST', '/api/members', {
    username: 'new.member', first_name: 'Dup', last_name: 'X', password: 'TestPass1', role_id: 4,
  });
  check('duplicate username rejected', r.status === 409);
  r = await admin.req('PUT', `/api/members/${newId}`, { classification_id: 2 });
  check('change classification', r.status === 200);
  r = await admin.req('POST', `/api/members/${newId}/status`, { status: 'suspended' });
  check('suspend member', r.status === 200);
  const suspended = new Client();
  r = await suspended.login('new.member', 'TestPass1');
  check('suspended member cannot login', r.status === 403);
  r = await admin.req('POST', `/api/members/${newId}/status`, { status: 'active' });
  r = await admin.req('POST', `/api/auth/members/${newId}/reset-password`);
  check('admin reset password returns temp', r.status === 200 && r.data.temporary_password);

  console.log('— Schedule —');
  r = await admin.req('GET', '/api/schedules?month=2026-09');
  check('admin month view', r.status === 200 && r.data.schedules.length >= 4);
  r = await andrea.req('GET', '/api/schedules?month=2026-09');
  const andreaSchedules = r.data.schedules;
  check('member sees own assignments only', r.status === 200 && andreaSchedules.every((s) => s.assignments.every((a) => a.self)));
  const sId = andreaSchedules[0].id;
  r = await admin.req('POST', '/api/schedules', { title: 'Test Mass', schedule_date: '2026-10-04', start_time: '08:00', end_time: '09:30', venue: 'Main Church' });
  const newSched = r.data.id;
  const miguelId = 8; // miguel.torres
  r = await admin.req('POST', `/api/schedules/${newSched}/assignments`, { user_id: miguelId, role: 'Lector' });
  check('assign member', r.status === 201);
  // conflict: assign same member to overlapping slot on same date
  r = await admin.req('POST', '/api/schedules', { title: 'Overlap Mass', schedule_date: '2026-10-04', start_time: '09:00', end_time: '10:30' });
  const overlapSched = r.data.id;
  r = await admin.req('POST', `/api/schedules/${overlapSched}/assignments`, { user_id: miguelId, role: 'Commentator' });
  check('overlapping assignment blocked (409)', r.status === 409, `got ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
  r = await admin.req('POST', `/api/schedules/${overlapSched}/assignments`, { user_id: miguelId, role: 'Commentator', allow_conflict: true });
  check('override allows conflict', r.status === 201 && !!r.data.warning);
  r = await admin.req('POST', `/api/schedules/${newSched}/publish`);
  check('publish schedule', r.status === 200 && r.data.notified >= 1);
  r = await admin.req('POST', '/api/schedules/999999/publish');
  check('missing schedule 404', r.status === 404);
  r = await andrea.req('POST', '/api/schedules', { title: 'x', schedule_date: '2026-10-04', start_time: '08:00' });
  check('member cannot create schedule', r.status === 403);

  console.log('— Announcements —');
  r = await admin.req('POST', '/api/announcements', { title: 'Smoke Test Announcement', body: 'Body text', publish: true });
  check('admin create+publish announcement', r.status === 201 && r.data.notified > 0);
  r = await andrea.req('GET', '/api/announcements');
  check('member sees published announcements', r.status === 200 && r.data.announcements.some((a) => a.title === 'Smoke Test Announcement'));
  r = await admin.req('POST', '/api/announcements', { title: 'Draft Only', body: 'x' });
  const draftAnn = r.data.id;
  r = await andrea.req('GET', '/api/announcements');
  check('member does not see drafts', !r.data.announcements.some((a) => a.id === draftAnn));
  r = await admin.req('POST', `/api/announcements/${draftAnn}/publish`);
  check('publish draft announcement', r.status === 200);

  console.log('— Messaging —');
  const paolo = new Client();
  const paoloLogin = await paolo.login('paolo.mendoza', 'Member@123');
  paolo.id = paoloLogin.data.user.id;
  const sophiaId = 9; // sophia.ramirez
  r = await paolo.req('POST', '/api/messages/threads', { participantIds: [sophiaId], body: 'Hello Sophia — schedule check' });
  check('create thread', r.status === 201, JSON.stringify(r.data));
  const threadId = r.data.thread_id;
  const sophia = new Client();
  await sophia.login('sophia.ramirez', 'Member@123');
  r = await sophia.req('GET', `/api/messages/threads/${threadId}`);
  check('participant reads thread', r.status === 200 && r.data.messages.length === 1);
  const gabriel = new Client();
  await gabriel.login('gabriel.flores', 'Member@123');
  r = await gabriel.req('GET', `/api/messages/threads/${threadId}`);
  check('non-participant blocked (403)', r.status === 403);
  r = await paolo.req('POST', `/api/messages/threads/${threadId}/messages`, { body: 'Reply from Paolo' });
  check('reply in thread', r.status === 201);
  r = await sophia.req('GET', '/api/messages/unread-count');
  check('unread count for sophia', r.status === 200 && r.data.count >= 1);

  console.log('— Profile & photo —');
  r = await andrea.req('PUT', '/api/profile', { first_name: 'Andrea', phone: '+63 900 111 2222', details: { bio: 'Updated bio' } });
  check('update profile', r.status === 200);
  // photo upload with a real PNG
  const fs = await import('node:fs');
  const path = await import('node:path');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync('/tmp/test-avatar.png', png);
  const fd = new FormData();
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'avatar.png');
  const headers = { ...(andrea.csrf ? { 'x-csrf-token': andrea.csrf } : {}), cookie: andrea.cookieHeader() };
  const upRes = await fetch(BASE + '/api/profile/photo', { method: 'POST', headers, body: fd });
  const upText = await upRes.text();
  check('profile photo upload', upRes.status === 200, `got ${upRes.status} ${upText}`);
  const upData = JSON.parse(upText || '{}');
  const avatarName = upData.profile_picture;
  const fileRes = await fetch(BASE + '/api/files/' + avatarName, { headers: { cookie: andrea.cookieHeader() } });
  check('avatar served to member', fileRes.status === 200);
  r = await andrea.req('DELETE', '/api/profile/photo');
  check('remove photo', r.status === 200);

  console.log('— Evaluations —');
  r = await andrea.req('GET', '/api/evaluations/my-results');
  check('member sees ONLY released results', r.status === 200 && r.data.results.length === 1 && r.data.results[0].committees[0].committee_name.includes('Reader'));
  const readersId = 3, screeningId = 1, term3Id = 3;
  // paolo (readers + screening) evaluates a member
  r = await paolo.req('GET', `/api/evaluations/committee-dashboard/7?termId=3`);
  check('committee form loads', r.status === 200 && r.data.committees.length === 2 && r.data.committees[0].committee.categories.length === 5);
  const cats = r.data.committees.find((c) => c.committee.id === readersId).committee.categories;
  const ratings = cats.map((c, i) => ({ category_id: c.id, rating: (i % 5) + 1 }));
  r = await paolo.req('POST', '/api/evaluations/save-draft', { committee_id: readersId, member_id: 7, term_id: term3Id, ratings, comments: [{ comment_type: 'comment', body: 'Smoke draft comment', visible: false }] });
  check('save draft', r.status === 200, JSON.stringify(r.data));
  r = await paolo.req('POST', '/api/evaluations/submit', { committee_id: readersId, member_id: 7, term_id: term3Id, ratings, comments: [{ comment_type: 'comment', body: 'Smoke submitted comment', visible: true }] });
  check('submit evaluation → pending_review', r.status === 200 && r.data.status === 'pending_review');
  r = await paolo.req('POST', '/api/evaluations/submit', { committee_id: readersId, member_id: 7, term_id: term3Id, ratings, comments: [] });
  check('duplicate submit rejected', r.status === 409);
  // incomplete ratings blocked
  r = await paolo.req('POST', '/api/evaluations/submit', { committee_id: screeningId, member_id: 7, term_id: term3Id, ratings: [{ category_id: 1, rating: 4 }], comments: [] });
  check('submit missing categories blocked', r.status === 400, JSON.stringify(r.data).slice(0, 120));
  // self-evaluation (carmen evaluates herself — no seeded self-eval exists for her)
  const carmen = new Client();
  const carmenLogin = await carmen.login('carmen.villanueva', 'Member@123');
  carmen.id = carmenLogin.data.user.id;
  const screeningCats = [1, 2, 3, 4, 5];
  r = await carmen.req('POST', '/api/evaluations/submit', { committee_id: screeningId, member_id: carmen.id, term_id: term3Id, ratings: screeningCats.map((cid) => ({ category_id: cid, rating: 4 })), comments: [{ comment_type: 'comment', body: 'Self-assessment', visible: false }] });
  check('self-evaluation submit', r.status === 200, JSON.stringify(r.data).slice(0, 120));
  // admin queue
  r = await admin.req('GET', '/api/evaluations/admin-queue?status=pending');
  check('admin pending queue', r.status === 200 && r.data.evaluations.length >= 2);
  const pendEval = r.data.evaluations.find((e) => e.member_username === 'andrea.lopez' && e.committee_name.includes('Reader'));
  check('found paolo evaluation of andrea', !!pendEval);
  r = await admin.req('GET', `/api/evaluations/admin-queue/${pendEval.id}`);
  check('admin queue detail w/ ratings+approvals', r.status === 200 && r.data.evaluation.ratings.length === 5);
  // member confidentiality: elena has no released results yet
  const elena = new Client();
  await elena.login('elena.cruz', 'Member@123');
  r = await elena.req('GET', '/api/evaluations/my-results');
  check('member sees no unreleased results', r.status === 200 && r.data.results.length === 0);
  // approve → still not visible; release → visible (test chain on paolo's eval of elena)
  // (paolo evaluates elena on readers — create + submit now)
  r = await paolo.req('GET', '/api/evaluations/committee-dashboard/11?termId=3');
  const elenaCats = r.data.committees.find((c) => c.committee.id === readersId).committee.categories;
  const elenaRatings = elenaCats.map((c, i) => ({ category_id: c.id, rating: (i % 5) + 1 }));
  r = await paolo.req('POST', '/api/evaluations/submit', { committee_id: readersId, member_id: 11, term_id: term3Id, ratings: elenaRatings, comments: [{ comment_type: 'comment', body: 'Elena chain test', visible: true }] });
  check('paolo submits elena eval', r.status === 200);
  r = await admin.req('GET', `/api/evaluations/admin-queue?member_id=11&status=pending`);
  const elenaEval = r.data.evaluations.find((e) => e.member_id === 11 && e.committee_name.includes('Reader'));
  r = await admin.req('POST', `/api/evaluations/${elenaEval.id}/approve`, { notes: 'Approved in smoke test' });
  check('admin approve', r.status === 200);
  r = await elena.req('GET', '/api/evaluations/my-results');
  check('approved but NOT released stays hidden', r.status === 200 && r.data.results.length === 0);
  r = await admin.req('POST', `/api/evaluations/${elenaEval.id}/release`);
  check('admin release individual', r.status === 200, JSON.stringify(r.data).slice(0, 150));
  r = await elena.req('GET', '/api/evaluations/my-results');
  check('released result visible to member', r.status === 200 && r.data.results.length === 1 && r.data.results[0].overall_average !== null);
  // miguel: teresa's readers eval is APPROVED (seed) — confidential until released
  const miguel = new Client();
  await miguel.login('miguel.torres', 'Member@123');
  r = await miguel.req('GET', '/api/evaluations/my-results');
  check('approved eval of miguel stays hidden', r.status === 200 && r.data.results.length === 0);
  // return flow: carmen's returned eval on sophia (seed) → resubmit
  r = await admin.req('GET', '/api/evaluations/admin-queue?status=returned');
  const retEval = r.data.evaluations[0];
  check('returned evals in queue', r.status === 200 && retEval && retEval.status === 'returned');
  r = await carmen.req('GET', `/api/evaluations/committee-dashboard/${retEval.member_id}?termId=${retEval.term_id}`);
  const carmenForm = r.data.committees.find((c) => c.committee.id === retEval.committee_id);
  check('returned eval shows admin notes', carmenForm.evaluation && carmenForm.evaluation.return_notes !== null);
  const rCat = r.data.committees.find((c) => c.committee.id === retEval.committee_id).committee.categories;
  const rRatings = rCat.map((c, i) => ({ category_id: c.id, rating: ((i * 2) % 5) + 1 }));
  r = await carmen.req('POST', '/api/evaluations/submit', { committee_id: retEval.committee_id, member_id: retEval.member_id, term_id: retEval.term_id, ratings: rRatings, comments: [{ comment_type: 'recommendation', body: 'Revised after admin note', visible: false }] });
  check('resubmit returned evaluation', r.status === 200 && r.data.status === 'pending_review');
  // package mode test: with package mode, individual release of miguel's approved eval is blocked
  const setRes = await admin.req('PUT', '/api/admin/settings', { settings: { release_mode: 'package' } });
  check('set package release mode', setRes.status === 200);
  r = await admin.req('GET', '/api/evaluations/admin-queue?member_id=8&status=approved');
  const approvedMiguel = r.data.evaluations.find((e) => e.member_id === 8);
  check('miguel has approved (unreleased) eval', !!approvedMiguel);
  r = await admin.req('POST', `/api/evaluations/${approvedMiguel.id}/release`);
  check('package mode blocks individual release', r.status === 409 && r.data.code === 'PACKAGE_MODE', JSON.stringify(r.data).slice(0, 120));
  // package release: all non-draft evaluations for miguel+term3 must be approved (teresa's is; ricardo's is a draft — excluded)
  r = await admin.req('POST', '/api/evaluations/release-package', { member_id: 8, term_id: 3 });
  check('package release succeeds', r.status === 200 && r.data.count === 1, JSON.stringify(r.data).slice(0, 150));
  r = await miguel.req('GET', '/api/evaluations/my-results');
  check('miguel sees released package result', r.status === 200 && r.data.results.length === 1);
  const setRes2 = await admin.req('PUT', '/api/admin/settings', { settings: { release_mode: 'individual' } });
  check('restore individual mode', setRes2.status === 200);

  console.log('— Reports & exports —');
  r = await admin.req('GET', '/api/reports/overview');
  check('overview report', r.status === 200 && r.data.committees.length === 3);
  r = await admin.req('GET', '/api/reports/member/7');
  check('member report', r.status === 200 && r.data.overall_average !== null);
  r = await admin.req('GET', '/api/reports/committee/3');
  check('committee report', r.status === 200);
  const csv = await admin.req('GET', '/api/reports/export/member/7?format=csv');
  check('CSV export', csv.status === 200 && csv.data.includes('Term'));
  const xlsx = await admin.req('GET', '/api/reports/export/member/7?format=xlsx');
  check('XLSX export', xlsx.status === 200 && xlsx.headers.get('content-type').includes('spreadsheetml'));
  const pdf = await admin.req('GET', '/api/reports/export/committee/3?format=pdf');
  check('PDF export', pdf.status === 200 && pdf.headers.get('content-type').includes('pdf'));
  const dist = await admin.req('GET', '/api/evaluations/admin-summary');
  check('admin summary cards', dist.status === 200 && dist.data.summary.released >= 1);

  console.log('— Audit —');
  r = await admin.req('GET', '/api/admin/audit?action=evaluation');
  check('audit log has evaluation actions', r.status === 200 && r.data.total >= 1);

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
};

run().catch((e) => { console.error('SMOKE TEST CRASHED:', e); process.exit(1); });
