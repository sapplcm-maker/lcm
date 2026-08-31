/* Headless DOM integration test — runs the real SPA against the real API via jsdom. */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = 'http://localhost:3000';
const ROOT = path.join(import.meta.dirname, '..');
let failures = 0, passed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')
  .replace(/<script src="[^"]+"><\/script>/g, ''); // we inject scripts manually

const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
const { window } = dom;

// cookie jar for the SPA's fetch
let cookies = {};
const jarHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

function parseSetCookie(header) {
  // node's undici merges multiple Set-Cookie with ", " — split on pairs
  const parts = header.split(', ');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i === -1) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).split(';')[0].trim();
    cookies[k] = v;
  }
}

const trace = (msg) => { if (process.env.TRACE) console.log('  [trace]', msg); };
window.fetch = (url, opts = {}) => {
  const abs = new URL(String(url), BASE).href;
  const headers = { ...(opts.headers || {}) };
  const ck = jarHeader();
  if (ck && !headers.cookie) headers.cookie = ck;
  trace(`${opts.method || 'GET'} ${abs.replace(BASE, '')} | csrf-hdr=${(headers['x-csrf-token'] || '').slice(0, 8)} | cookie=${(headers.cookie || '').slice(0, 60)}`);
  return fetch(abs, { ...opts, headers, redirect: 'manual' }).then(async (res) => {
    const sc = res.headers.get('set-cookie');
    if (sc) { parseSetCookie(sc); trace(`  → ${res.status} ${abs.replace(BASE, '')} | SET-COOKIE: ${sc.slice(0, 80)}`); } else { trace(`  → ${res.status} ${abs.replace(BASE, '')}`); }
    return res;
  });
};
window.scrollTo = () => {};
window.alert = (m) => { errors.push('alert: ' + m); };
window.prompt = () => null;

// inject scripts in load order (single eval so top-level const/let share one lexical scope,
// mirroring how classic <script> tags share the global lexical environment)
const scriptFiles = ['api.js', 'components.js', 'router.js', 'views-core.js', 'views-schedule.js', 'views-announcements.js', 'views-messages.js', 'views-evaluations.js', 'views-admin.js', 'views-reports.js', 'app.js'];
let bundle = '';
for (const f of scriptFiles) {
  bundle += `\n;/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
}
bundle += '\n;window.__APP = App; window.__API = API; window.__ROUTER = Router;';
try { window.eval(bundle); } catch (e) { errors.push('EVAL FAIL: ' + e.message); console.error('EVAL FAIL', e); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(60);
  }
  return null;
};
const setHash = (h) => { window.location.hash = h; };

let reloaded = false;
try { Object.defineProperty(window.location, 'reload', { value: () => { reloaded = true; }, writable: true, configurable: true }); } catch (_) {}
const afterLogin = async () => {
  await waitFor(() => cookies['lcm.sid']);
  await sleep(250);
  await window.__APP.boot();
  await sleep(300);
};

const logoutAll = async () => {
  await window.__API.post('/api/auth/logout').catch(() => {});
  cookies = {};
  window.__API.csrf = null;
  window.__APP.user = null;
  window.__APP.sessionExpired();
  await window.__APP.boot();
  await sleep(150);
};

const run = async () => {
  console.log('— Boot —');
  await window.__APP.boot();
  await sleep(300);
  check('login screen shown when unauthenticated', !$('#login-view').classList.contains('hidden'));
  check('login shows logo', !!$('.login-logo'));
  check('login shows brand title', ($('#login-title').textContent || '').includes('LCM'));

  console.log('— Admin login + shell —');
  $('#login-username').value = 'admin';
  $('#login-password').value = 'Admin@123';
  $('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await afterLogin();
  check('app shell visible after login', !$('#app-shell').classList.contains('hidden'));
  check('topbar shows admin name', ($('#top-name').textContent || '').includes('Maria'));
  const navLabels = $$('.nav a').map((a) => a.textContent.trim());
  for (const label of ['Dashboard', 'Schedule', 'Announcements', 'Messages', 'Profile', 'Evaluations', 'Notifications', 'Settings']) {
    check(`nav has ${label}`, navLabels.some((l) => l.includes(label)));
  }
  for (const label of ['Members', 'Approval Center', 'Reports', 'Audit Logs', 'System Settings', 'Roles & Permissions', 'Committees']) {
    check(`management nav has ${label}`, navLabels.some((l) => l.includes(label)));
  }
  await waitFor(() => $('#dash-assignments') && !$('#dash-assignments').textContent.includes('Loading'));
  check('dashboard assignments rendered', ($('#dash-assignments').textContent || '').includes('2026'));
  check('dashboard stat cards', !!$('#admin-stats') && $$('#admin-stats .stat-value').length === 4);

  console.log('— Admin screens —');
  setHash('#/members');
  await waitFor(() => $$('#mb-list tr').length > 5);
  check('members table renders rows', $$('#mb-list tr').length > 5, `got ${$$('#mb-list tr').length}`);
  check('member search input', !!$('#mb-search'));

  setHash('#/schedule');
  await waitFor(() => $$('.cal-cell').length > 28);
  check('calendar renders ~35 cells', $$('.cal-cell').length >= 28, `got ${$$('.cal-cell').length}`);
  check('calendar has chips', $$('.cal-chip').length > 0, `got ${$$('.cal-chip').length}`);

  setHash('#/evaluations?tab=approvals');
  await waitFor(() => $$('#eval-content .stat-value').length >= 4);
  check('approval center stat cards', $$('#eval-content .stat-value').length >= 4);
  await waitFor(() => $$('#aq-list [data-review]').length > 0);
  check('approval queue has review buttons', $$('#aq-list [data-review]').length > 0, `got ${$$('#aq-list [data-review]').length}`);
  check('approval filters present', !!$('#aq-committee') && !!$('#aq-status'));

  setHash('#/reports');
  await waitFor(() => $$('#rp-output svg').length >= 3);
  check('reports render svg charts', $$('#rp-output svg').length >= 3, `got ${$$('#rp-output svg').length}`);
  check('report export links', $$('#rp-output a[href*="export"]').length > 0);

  setHash('#/audit');
  await waitFor(() => $$('#au-list tr').length > 3);
  check('audit table renders', $$('#au-list tr').length > 3, `got ${$$('#au-list tr').length}`);

  console.log('— Member (andrea) —');
  await logoutAll();
  $('#login-username').value = 'andrea.lopez';
  $('#login-password').value = 'Member@123';
  $('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await afterLogin();
  console.log('  [debug] app-shell hidden:', $('#app-shell').classList.contains('hidden'), '| user:', window.__APP.user ? window.__APP.user.username : 'null', '| jar:', JSON.stringify(cookies));
  console.log('  [debug] csrf:', window.__API.csrf, '| err box:', $('#login-error').textContent, '| errors so far:', errors.filter((e) => !e.includes('Not implemented')).slice(-4).join(' || '));
  const memberNav = $$('.nav a').map((a) => a.textContent.trim());
  check('member has no management nav', !memberNav.some((l) => l.includes('Members') || l.includes('Approval')));

  setHash('#/evaluations');
  await waitFor(() => $('#eval-content') && $('#eval-content').textContent.includes('Term 3'));
  const evalText = $('#eval-content').textContent;
  check('member sees released result', evalText.includes('Term 3') && evalText.includes('Reader'), evalText.slice(0, 120));
  check('member result marked official', evalText.includes('OFFICIAL'));
  check('member sees rating categories', evalText.includes('Delivery') || evalText.includes('Pronunciation'));

  setHash('#/schedule');
  await waitFor(() => $$('.cal-chip').length > 0);
  const chipText = $$('.cal-chip').map((c) => c.textContent).join(' ');
  check('member calendar shows role chips', /Lector|Commentator|Server/.test(chipText), chipText.slice(0, 100));

  console.log('— Committee member (paolo) —');
  await logoutAll();
  $('#login-username').value = 'paolo.mendoza';
  $('#login-password').value = 'Member@123';
  $('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await afterLogin();
  console.log('  [debug] paolo user:', window.__APP.user ? window.__APP.user.username : 'null', '| shell hidden:', $('#app-shell').classList.contains('hidden'), '| jar:', JSON.stringify(cookies));
  setHash('#/evaluations?tab=committee');
  await waitFor(() => $$('#cd-list tr').length > 5);
  check('committee dashboard lists members', $$('#cd-list tr').length > 5, `got ${$$('#cd-list tr').length} | main: ${$('#main').innerHTML.slice(0, 200)}`);
  check('committee dashboard shows not-started badge', !!$('#cd-list') && $('#cd-list').textContent.includes('Not started'));
  // open the first member evaluation form (draft status member)
  const evalLink = $('#cd-list a[href*="committee-eval"]');
  check('evaluate link present', !!evalLink);
  if (evalLink) {
    const target = evalLink.getAttribute('href');
    setHash(target);
    await waitFor(() => $$('.rating-opt').length >= 5);
    check('evaluation form rating buttons', $$('.rating-opt').length >= 5, `got ${$$('.rating-opt').length}`);
    const labels = $$('.rating-opt .r-label').map((l) => l.textContent);
    for (const l of ['Highest', 'Very Good', 'Satisfactory', 'Needs Improvement', 'Lowest']) {
      check(`rating label "${l}"`, labels.includes(l));
    }
    check('comment boxes present', $$('[data-comment]').length >= 4, `got ${$$('[data-comment]').length}`);
    check('submit button present', $$('[data-act="submit"]').length > 0);
  }

  console.log('— JS errors —');
  const pageErrors = errors.filter((e) => !e.includes('Could not parse CSS') && !e.includes('Not implemented') && !e.includes('HTMLCanvasElement'));
  check('no unexpected JS errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));

  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
};

run().catch((e) => { console.error('FRONTEND TEST CRASHED:', e); process.exit(1); });
