/* Shared UI components: escaping, toasts, modals, avatars, badges, SVG charts. */
'use strict';

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(first, last) {
  return esc(((first || '?').charAt(0) + (last || '?').charAt(0)).toUpperCase());
}

function avatarHtml(u, cls = 'avatar') {
  if (!u) return `<span class="${cls}">?</span>`;
  if (u.profile_picture) return `<img class="${cls}" src="/api/files/${esc(u.profile_picture)}" alt="${esc(u.first_name || '')} ${esc(u.last_name || '')}" loading="lazy" />`;
  return `<span class="${cls}" aria-hidden="true">${initials(u.first_name, u.last_name)}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(String(d).replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) return esc(d);
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(String(d).replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) return esc(d);
  return dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(d) {
  if (!d) return '';
  const t = new Date(String(d).replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return fmtDate(d);
}

/* Status → badge */
const STATUS_BADGE = {
  active: ['badge-green', 'Active'], inactive: ['badge-grey', 'Inactive'], suspended: ['badge-red', 'Suspended'], pending: ['badge-orange', 'Pending'],
  published: ['badge-green', 'Published'], draft: ['badge-grey', 'Draft'], archived: ['badge-navy', 'Archived'], cancelled: ['badge-red', 'Cancelled'],
  confirmed: ['badge-green', 'Confirmed'], declined: ['badge-red', 'Declined'], replaced: ['badge-grey', 'Replaced'],
  pending_review: ['badge-orange', 'Pending Admin Review'], submitted: ['badge-orange', 'Submitted'], resubmitted: ['badge-orange', 'Resubmitted'],
  returned: ['badge-red', 'Returned for Revision'], approved: ['badge-navy', 'Approved'], released: ['badge-official', 'Official · Released'],
  sent: ['badge-grey', 'Sent'], edited: ['badge-navy', 'Edited'], deleted: ['badge-grey', 'Deleted'], none: ['badge-grey', 'Not started'],
};
function badge(status) {
  const [cls, label] = STATUS_BADGE[status] || ['badge-grey', esc(status)];
  return `<span class="badge ${cls}">${label}</span>`;
}

function stars(rating) {
  const r = Math.round(rating || 0);
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="${i <= r ? '' : 'dim'}">★</span>`;
  return `<span class="stars" role="img" aria-label="${r} out of 5">${s}</span>`;
}

/* ---------- Toasts ---------- */
function toast(msg, type = 'info', ms = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warn' ? 'warn' : '');
  el.textContent = msg;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 400);
  setTimeout(() => el.remove(), ms);
}

/* ---------- Modal ---------- */
function openModal({ title, body, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', title);
  const foot = actions.length
    ? `<div class="modal-foot">${actions.map((a) => `<button class="btn ${a.cls || 'btn-ghost'}" data-mact="${esc(a.key)}">${esc(a.label)}</button>`).join('')}</div>`
    : '';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" data-mact="close" aria-label="Close">&times;</button></div>
      <div class="modal-body">${body}</div>${foot}
    </div>`;
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
    const act = e.target.closest('[data-mact]');
    if (!act) return;
    if (act.dataset.mact === 'close') return close();
    const action = actions.find((a) => a.key === act.dataset.mact);
    if (action && action.onClick) action.onClick(close);
  });
  document.addEventListener('keydown', onKey);
  root.appendChild(backdrop);
  // focus first input
  const first = backdrop.querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, el: backdrop };
}

function confirmDlg(message, { title = 'Please confirm', okLabel = 'Confirm', danger = false, onOk } = {}) {
  openModal({
    title,
    body: `<p style="margin:0">${esc(message)}</p>`,
    actions: [
      { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
      { key: 'ok', label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { close(); onOk(); } },
    ],
  });
}

function formDataToObject(fd) {
  const o = {};
  for (const [k, v] of fd.entries()) o[k] = v;
  return o;
}

/* ---------- SVG Charts (dependency-free) ---------- */
function barChart(data, { color = '#1d3a6e', height = 180, label = '' } = {}) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const bw = Math.min(64, 520 / Math.max(entries.length, 1));
  const pad = 22;
  const w = Math.max(260, entries.length * (bw + 14) + pad);
  let bars = '';
  entries.forEach(([k, v], i) => {
    const h = Math.max(3, (v / max) * (height - 34));
    const x = pad + i * (bw + 14);
    const y = height - h - 20;
    bars += `
      <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" fill="${color}" opacity="0.9">
        <title>${esc(k)}: ${v}</title>
      </rect>
      <text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle" font-size="11" fill="#5a6472">${esc(k)}</text>
      <text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="#1c2430">${v}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${height}" width="100%" role="img" aria-label="${esc(label)}" style="max-width:${w}px">
    ${bars}</svg>`;
}

function donutChart(counts, { size = 150, colors = ['#d9a441', '#1f9d8a', '#1d3a6e', '#e8661f', '#c0392b'] } = {}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return `<div class="empty-state" style="padding:30px"><div class="e-ico">📊</div>No data yet</div>`;
  const cx = size / 2, cy = size / 2, r = size / 2 - 8, stroke = 20;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  let segs = '';
  let i = 0;
  for (const [k, v] of Object.entries(counts)) {
    const frac = v / total;
    if (!v) { i++; continue; }
    const dash = frac * circ;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}"
      stroke-width="${stroke}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})"><title>${esc(k)}: ${v}</title></circle>`;
    offset += dash;
    i++;
  }
  return `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Rating distribution">
      ${segs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#14294d">${total}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10" fill="#5a6472">ratings</text>
    </svg>
    <div class="legend">${Object.entries(counts).map(([k, v], idx) => `<span class="lg"><span class="sw" style="background:${colors[idx % colors.length]}"></span>${esc(k)}: ${v}</span>`).join('')}</div>
  </div>`;
}

/* ---------- Event binding helper ---------- */
function bindEvents(root, map) {
  for (const [key, fn] of Object.entries(map)) {
    const sp = key.indexOf(' ');
    if (sp === -1) continue;
    const evt = key.slice(0, sp);
    const selector = key.slice(sp + 1);
    root.addEventListener(evt, (e) => {
      const t = e.target.closest(selector);
      if (t && (t === root || root.contains(t))) fn(e, t);
    });
  }
}

function loadingHtml(text = 'Loading…') {
  return `<div class="empty-state"><div class="e-ico">⏳</div>${esc(text)}</div>`;
}

function emptyHtml(icon, text, sub = '') {
  return `<div class="empty-state"><div class="e-ico">${icon}</div><p style="margin:4px 0">${esc(text)}</p>${sub ? `<p style="margin:0;font-size:13px">${esc(sub)}</p>` : ''}</div>`;
}
