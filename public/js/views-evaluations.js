/* Evaluations module — member results, committee evaluation, approval center, terms. */
'use strict';

const RATING_LABELS = { 5: 'Highest', 4: 'Very Good', 3: 'Satisfactory', 2: 'Needs Improvement', 1: 'Lowest' };

Router.register('evaluations', {
  title: 'Evaluations',
  render: async (el) => {
    const tabs = [];
    tabs.push(['results', 'My Results']);
    if (App.can('evaluations.evaluate')) tabs.push(['committee', 'Committee Dashboard']);
    if (App.can('evaluations.view')) tabs.push(['mine', 'My Submissions']);
    if (App.can('evaluations.approve')) tabs.push(['approvals', 'Approval Center']);
    if (App.can('evaluations.manage')) tabs.push(['terms', 'Evaluation Terms']);

    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    let tab = params.get('tab') || tabs[0][0];
    if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];

    el.innerHTML = `
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="eval-content">${loadingHtml()}</div>`;
    el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      location.hash = '#/evaluations?tab=' + b.dataset.tab;
    }));

    const views = {
      results: renderResults,
      committee: renderCommittee,
      mine: renderMine,
      approvals: renderApprovals,
      terms: renderTerms,
    };
    await views[tab](document.getElementById('eval-content'));
  },
});

/* ================= Member: released results ================= */
async function renderResults(box) {
  const { results } = await API.get('/api/evaluations/my-results');
  if (!results.length) {
    box.innerHTML = `<div class="card"><div class="card-body">${emptyHtml('⭐', 'No evaluation results available yet.', 'Approved results are released to your dashboard by the administrator. Unreleased results remain confidential.')}</div></div>`;
    return;
  }
  box.innerHTML = results.map((t) => `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <h3>${esc(t.term_name)} <span class="badge badge-official">OFFICIAL · APPROVED</span></h3>
        <strong style="font-size:18px;color:var(--navy)">${t.overall_average !== null ? t.overall_average.toFixed(2) : '—'} ${t.overall_average !== null ? stars(t.overall_average) : ''}</strong>
      </div>
      <div class="card-body">
        ${t.committees.map((c) => `
          <div style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <strong>${esc(c.committee_name)}</strong>
              <span>Average: <b>${c.overall_average !== null ? c.overall_average.toFixed(2) : '—'}</b> ${c.overall_average !== null ? stars(c.overall_average) : ''}</span>
            </div>
            <table class="data" style="margin-top:8px"><thead><tr><th>Category</th><th>Rating</th></tr></thead><tbody>
              ${c.ratings.map((r) => `<tr><td>${esc(r.category)}</td><td>${r.rating} — ${RATING_LABELS[r.rating]} ${stars(r.rating)}</td></tr>`).join('')}
            </tbody></table>
            ${c.comments.length ? `<div style="margin-top:10px;font-size:13px"><strong>Feedback</strong>
              ${c.comments.map((cm) => `<p style="margin:4px 0 0"><b>${esc(cm.comment_type)}:</b> ${esc(cm.body)}</p>`).join('')}
            </div>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('');
}

/* ================= Committee dashboard ================= */
async function renderCommittee(box) {
  const data = await API.get('/api/evaluations/committee-dashboard');
  const state = { termId: data.default_term_id, data };
  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>Committee Evaluation — ${data.committees.map((c) => esc(c.name)).join(' · ')}</h3>
        <select id="cd-term" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px">
          ${data.terms.map((t) => `<option value="${t.id}" ${t.id === state.termId ? 'selected' : ''}>${esc(t.name)} (${t.state === 'open' ? 'open' : t.state})</option>`).join('')}
        </select>
      </div>
      <div class="card-body" style="padding:0" id="cd-list">${loadingHtml()}</div>
    </div>`;

  const loadList = async () => {
    const d = await API.get('/api/evaluations/committee-dashboard');
    state.data = d;
    const { members, committees } = d;
    const boxList = document.getElementById('cd-list');
    const notStarted = members.filter((m) => committees.every((c) => (m.committees[c.id] || {}).status === 'none'));
    boxList.innerHTML = `
      <div style="padding:12px 20px;border-bottom:1px solid var(--border);font-size:13px;color:var(--muted)">
        ${members.length} member(s) to evaluate · <b>${notStarted.length}</b> not yet evaluated
      </div>
      <table class="data"><thead><tr><th>Member</th><th>Classification</th>${committees.map((c) => `<th>${esc(c.name.split(' ')[0])}</th>`).join('')}<th></th></tr></thead><tbody>
        ${members.map((m) => `<tr>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${avatarHtml(m, 'avatar avatar-sm')} ${esc(m.first_name)} ${esc(m.last_name)}</span></td>
          <td>${esc(m.classification || '—')}</td>
          ${committees.map((c) => `<td>${badge((m.committees[c.id] || {}).status || 'none')}</td>`).join('')}
          <td class="actions"><a class="btn btn-sm ${committees.every((c) => (m.committees[c.id] || {}).status === 'none') ? 'btn-primary' : 'btn-ghost'}" href="#/committee-eval/${m.id}?termId=${state.termId}">${committees.every((c) => (m.committees[c.id] || {}).status === 'none') ? 'Evaluate' : 'View / Edit'}</a></td>
        </tr>`).join('')}
      </tbody></table>`;
  };

  document.getElementById('cd-term').addEventListener('change', async (e) => {
    state.termId = +e.target.value;
    await loadList();
  });
  await loadList();
}

/* ================= Evaluation form (committee member) ================= */
Router.register('committee-eval', {
  title: 'Member Evaluation',
  perm: 'evaluations.evaluate',
  render: async (el, segs) => {
    const memberId = +segs[1];
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const termId = params.get('termId');
    const data = await API.get(`/api/evaluations/committee-dashboard/${memberId}` + qs({ termId }));
    const { member, term, committees } = data;
    const state = {};
    for (const c of committees) {
      state[c.committee.id] = {
        ratings: Object.fromEntries((c.evaluation?.ratings || []).map((r) => [r.category_id, r.rating])),
        comments: (c.evaluation?.comments || []).map((x) => ({ ...x })),
      };
    }

    el.innerHTML = `
      <a href="#/evaluations?tab=committee" class="btn btn-sm btn-ghost" style="margin-bottom:12px">← Committee Dashboard</a>
      <div class="card"><div class="card-body">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          ${avatarHtml(member, 'avatar avatar-lg')}
          <div>
            <h2 style="margin:0;font-size:20px">${esc(member.first_name)} ${esc(member.last_name)}</h2>
            <span style="color:var(--muted)">${esc(member.classification || '')} · evaluating for <b>${esc(term.name)}</b> ${term.state === 'open' ? '' : `<span class="badge badge-red">${term.state}</span>`}</span>
          </div>
        </div>
      </div></div>
      <div id="eval-forms" style="margin-top:16px"></div>`;

    const formsBox = document.getElementById('eval-forms');
    formsBox.innerHTML = committees.map((c, ci) => formForCommittee(c, ci)).join('');
    bindForms();

    function formForCommittee(c, ci) {
      const ev = c.evaluation;
      const locked = ev && ['pending_review', 'approved', 'released', 'submitted', 'resubmitted'].includes(ev.status);
      const status = ev ? ev.status : 'none';
      return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h3>${esc(c.committee.name)}</h3>
            <div style="display:flex;gap:8px;align-items:center">${badge(status)} ${locked ? `<span class="badge badge-navy">Under review</span>` : ''}</div>
          </div>
          <div class="card-body">
            ${ev && ev.return_notes ? `<div class="badge badge-red" style="margin-bottom:10px;white-space:normal">Returned for revision — administrator note: ${esc(ev.return_notes)}</div>` : ''}
            ${locked ? readOnlyView(c, ev) : `
              <div class="form-grid">
                ${c.committee.categories.map((cat) => `
                  <div class="field">
                    <label>${esc(cat.name)}</label>
                    <div class="rating-input" data-cat="${cat.id}">
                      ${[5, 4, 3, 2, 1].map((v) => `<button type="button" class="rating-opt" data-val="${v}" aria-label="${v} — ${RATING_LABELS[v]}">
                        <span class="r-num">${v}</span><span class="r-label">${RATING_LABELS[v]}</span>
                      </button>`).join('')}
                    </div>
                  </div>`).join('')}
              </div>
              <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
                <strong style="font-size:14px">Comments &amp; Observations</strong>
                <p class="hint" style="font-size:12px;color:var(--muted);margin:2px 0 10px">Tick “visible to member” only for feedback the administrator may release to the member after approval.</p>
                <div class="form-grid">
                  ${['comment', 'observation', 'recommendation', 'improvement'].map((t) => `
                    <div class="field">
                      <label>${esc(t[0].toUpperCase() + t.slice(1))}</label>
                      <textarea data-comment="${t}" placeholder="${esc(t)}…">${esc((state[c.committee.id].comments.find((x) => x.comment_type === t) || {}).body || '')}</textarea>
                      <label class="hint" style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" data-vis="${t}" ${((state[c.committee.id].comments.find((x) => x.comment_type === t) || {}).visible) ? 'checked' : ''} /> Visible to member after approval</label>
                    </div>`).join('')}
                </div>
              </div>
              <div class="row-actions" style="margin-top:16px">
                <button class="btn btn-ghost" data-act="draft" data-ci="${ci}">Save draft</button>
                <button class="btn btn-primary" data-act="submit" data-ci="${ci}">Submit for admin review</button>
              </div>
              <p class="hint" style="font-size:12px;color:var(--muted);margin-top:8px">Submitted evaluations go to <b>Pending Admin Review</b> and remain confidential until the administrator approves and releases them.</p>
            `}
          </div>
        </div>`;
    }

    function readOnlyView(c, ev) {
      return `<div class="detail-list">
        <dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:4px 20px">
          ${ev.ratings.map((r) => `<div><dt>${esc(c.committee.categories.find((x) => x.id === r.category_id)?.name || r.category_id)}</dt><dd>${r.rating} — ${RATING_LABELS[r.rating]} ${stars(r.rating)}</dd></div>`).join('')}
        </dl>
        ${ev.overall_average !== null ? `<p style="margin-top:10px"><strong>Average: ${ev.overall_average.toFixed(2)}</strong> ${stars(ev.overall_average)}</p>` : ''}
        ${ev.comments.length ? `<div style="margin-top:8px">${ev.comments.map((x) => `<p style="margin:3px 0;font-size:13px"><b>${esc(x.comment_type)}:</b> ${esc(x.body)}</p>`).join('')}</div>` : ''}
      </div>`;
    }

    function ciOf(node) {
      const card = node.closest('.card');
      const name = card.querySelector('h3').textContent.trim();
      return committees.findIndex((c) => c.committee.name === name);
    }

    function bindForms() {
      // rating buttons
      formsBox.querySelectorAll('.rating-input').forEach((box) => {
        const catId = +box.dataset.cat;
        const ci = ciOf(box);
        box.querySelectorAll('.rating-opt').forEach((btn) => {
          const v = +btn.dataset.val;
          if (ci > -1 && state[committees[ci].committee.id].ratings[catId] === v) btn.classList.add('selected');
          btn.addEventListener('click', () => {
            const c2 = ciOf(btn);
            state[committees[c2].committee.id].ratings[catId] = v;
            box.querySelectorAll('.rating-opt').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
          });
        });
      });
      // comment textareas + visibility
      formsBox.querySelectorAll('[data-comment]').forEach((ta) => ta.addEventListener('input', () => {
        const card = ta.closest('.card');
        const name = card.querySelector('h3').textContent.trim();
        const ci = committees.findIndex((c) => c.committee.name === name);
        const list = state[committees[ci].committee.id].comments;
        const type = ta.dataset.comment;
        let entry = list.find((x) => x.comment_type === type);
        if (!entry) { entry = { comment_type: type, body: '', visible: false }; list.push(entry); }
        entry.body = ta.value;
      }));
      formsBox.querySelectorAll('[data-vis]').forEach((chk) => chk.addEventListener('change', () => {
        const card = chk.closest('.card');
        const name = card.querySelector('h3').textContent.trim();
        const ci = committees.findIndex((c) => c.committee.name === name);
        const list = state[committees[ci].committee.id].comments;
        const type = chk.dataset.vis;
        let entry = list.find((x) => x.comment_type === type);
        if (!entry) { entry = { comment_type: type, body: '', visible: false }; list.push(entry); }
        entry.visible = chk.checked;
      }));
      // submit / draft buttons
      formsBox.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
        const ci = +btn.dataset.ci;
        const c = committees[ci];
        const s = state[c.committee.id];
        const payload = {
          committee_id: c.committee.id,
          member_id,
          term_id: term.id,
          ratings: Object.entries(s.ratings).map(([catId, rating]) => ({ category_id: +catId, rating })),
          comments: s.comments.map((x) => ({ comment_type: x.comment_type, body: x.body, visible: !!x.visible })),
        };
        const isSubmit = btn.dataset.act === 'submit';
        if (isSubmit) {
          const missing = c.committee.categories.filter((cat) => !s.ratings[cat.id]);
          if (missing.length) return toast('Please rate all categories: ' + missing.map((m) => m.name).join(', '), 'error');
        }
        if (term.state !== 'open' && term.state !== 'upcoming' && isSubmit) return toast('This evaluation term is closed.', 'error');
        try {
          if (isSubmit) {
            const r = await API.post('/api/evaluations/submit', payload);
            toast('Evaluation submitted — pending admin review.', 'success');
            if (r.status === 'pending_review') location.hash = '#/evaluations?tab=mine';
          } else {
            await API.post('/api/evaluations/save-draft', payload);
            toast('Draft saved.', 'success');
            Router.go();
          }
        } catch (e) { toast(e.message, 'error'); }
      }));
    }
  },
});

/* ================= My submissions (committee member) ================= */
async function renderMine(box) {
  const { evaluations } = await API.get('/api/evaluations/my-evaluations');
  box.innerHTML = `<div class="card"><div class="card-body" style="padding:0">
    <table class="data"><thead><tr><th>Member</th><th>Committee</th><th>Term</th><th>Status</th><th>Average</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${evaluations.map((e) => `<tr>
        <td><span style="display:inline-flex;align-items:center;gap:8px">${avatarHtml(e, 'avatar avatar-sm')} ${esc(e.first_name)} ${esc(e.last_name)}</span></td>
        <td>${esc(e.committee_name)}</td><td>${esc(e.term_name)}</td>
        <td>${badge(e.status)}${e.return_notes ? `<div style="font-size:12px;color:var(--red);margin-top:2px">${esc(e.return_notes.slice(0, 80))}</div>` : ''}</td>
        <td>${e.overall_average !== null ? e.overall_average.toFixed(2) : '—'}</td>
        <td>${fmtDateTime(e.submitted_at || e.updated_at)}</td>
        <td class="actions">${['draft', 'returned'].includes(e.status) ? `<a class="btn btn-sm btn-primary" href="#/committee-eval/${e.member_id}?termId=${e.term_id}">${e.status === 'returned' ? 'Revise &amp; resubmit' : 'Continue'}</a>` : ''}</td>
      </tr>`).join('') || `<tr><td colspan="7">${emptyHtml('📋', 'You have not created any evaluations yet.')}</td></tr>`}
    </tbody></table>
  </div></div>`;
}

/* ================= Admin: approval center ================= */
async function renderApprovals(box) {
  const [summaryData, committees, terms] = await Promise.all([
    API.get('/api/evaluations/admin-summary'),
    API.get('/api/admin/committees'),
    API.get('/api/evaluations/terms/all'),
  ]);
  const s = summaryData.summary;
  const state = { filters: {} };

  box.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px">
      ${[
        ['Pending Review', s.pending, 'evaluations awaiting action', '🕒', 'navy'],
        ['Returned for Revision', s.returned, 'need committee action', '↩️', 'orange'],
        ['Approved', s.approved, 'ready to release', '📋', 'navy'],
        ['Released to Members', s.released, 'visible on dashboards', '✅', 'green'],
      ].map(([l, v, sub, ico, c]) => `<div class="card stat-card" style="border-left:4px solid ${c === 'navy' ? 'var(--navy)' : c === 'orange' ? 'var(--orange)' : 'var(--teal)'}">
        <div class="stat-ico">${ico}</div><span class="stat-label">${l}</span><span class="stat-value">${v}</span><span class="stat-sub">${sub}</span></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Evaluation Queue</h3>
        <span class="badge badge-orange">${s.incomplete_count} member(s) with incomplete evaluations</span>
      </div>
      <div class="card-body">
        <div class="filters">
          <select id="aq-committee" style="min-width:190px"><option value="">All committees</option>${committees.committees.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          <select id="aq-term"><option value="">All terms</option>${terms.terms.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
          <select id="aq-status">
            <option value="pending">Needs action (pending)</option>
            <option value="returned">Returned for revision</option>
            <option value="approved">Approved</option>
            <option value="released">Released</option>
            <option value="draft">Drafts</option>
            <option value="">All statuses</option>
          </select>
          <input id="aq-member" placeholder="Member username…" style="min-width:170px" />
          <input id="aq-evaluator" placeholder="Evaluator username…" style="min-width:170px" />
          <button class="btn btn-sm btn-primary" id="aq-apply">Apply</button>
        </div>
        <div id="aq-list">${loadingHtml()}</div>
      </div></div>`;

  const loadQueue = async () => {
    const f = state.filters;
    const { evaluations } = await API.get('/api/evaluations/admin-queue' + qs({
      committee_id: f.committee_id, term_id: f.term_id, status: f.status, member_id: f.member_id, evaluator_id: f.evaluator_id,
    }));
    const list = document.getElementById('aq-list');
    if (!evaluations.length) { list.innerHTML = emptyHtml('🔍', 'No evaluations match these filters.'); return; }
    list.innerHTML = `<table class="data"><thead><tr><th>Member</th><th>Committee</th><th>Term</th><th>Evaluator</th><th>Status</th><th>Avg</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${evaluations.map((e) => `<tr>
        <td>${esc(e.member_name)}${e.member_username ? `<div style="font-size:11px;color:var(--muted)">${esc(e.member_username)}</div>` : ''}</td>
        <td>${esc(e.committee_name)}</td><td>${esc(e.term_name)}</td><td>${esc(e.evaluator_name)}</td>
        <td>${badge(e.status)}</td>
        <td>${e.overall_average !== null ? e.overall_average.toFixed(2) : '—'}</td>
        <td style="font-size:12px">${fmtDateTime(e.submitted_at || e.updated_at)}</td>
        <td class="actions"><button class="btn btn-sm btn-outline" data-review="${e.id}">Review</button></td>
      </tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => reviewEval(+b.dataset.review)));
  };

  document.getElementById('aq-apply').addEventListener('click', () => {
    state.filters = {
      committee_id: document.getElementById('aq-committee').value,
      term_id: document.getElementById('aq-term').value,
      status: document.getElementById('aq-status').value,
      member_id: document.getElementById('aq-member').value,
      evaluator_id: document.getElementById('aq-evaluator').value,
    };
    loadQueue();
  });
  await loadQueue();
  const incomplete = summaryData.summary.incomplete || [];
  if (incomplete.length) {
    const box2 = box.querySelector('.card');
    // append incomplete section
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.style.marginTop = '16px';
    wrap.innerHTML = `<div class="card-head"><h3>Members With Incomplete Evaluations (${esc(summaryData.open_term ? summaryData.open_term.name : 'latest term')})</h3></div>
      <div class="card-body" style="padding:0"><table class="data"><thead><tr><th>Member</th><th>Classification</th><th></th></tr></thead><tbody>
      ${incomplete.map((m) => `<tr><td><span style="display:inline-flex;align-items:center;gap:8px">${avatarHtml(m, 'avatar avatar-sm')} ${esc(m.first_name)} ${esc(m.last_name)}</span></td><td>${esc(m.classification || '—')}</td><td><span class="badge badge-red">No released result</span></td></tr>`).join('')}
      </tbody></table></div>`;
    box2.after(wrap);
  }
}

async function reviewEval(id) {
  const { evaluation } = await API.get('/api/evaluations/admin-queue/' + id);
  const canRelease = App.can('evaluations.release');
  const actions = [
    { key: 'close', label: 'Close', cls: 'btn-ghost' },
  ];
  if (['pending_review', 'submitted', 'resubmitted'].includes(evaluation.status)) {
    actions.push({ key: 'return', label: 'Return for revision', cls: 'btn-danger' });
    actions.push({ key: 'approve', label: 'Approve', cls: 'btn-primary' });
  }
  if (evaluation.status === 'approved' && canRelease) {
    actions.push({ key: 'release', label: 'Release to member', cls: 'btn-gold' });
  }
  const modal = openModal({
    title: `Review Evaluation — ${evaluation.member.first_name} ${evaluation.member.last_name}`,
    wide: true,
    body: `
      <div class="detail-list">
        <dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:2px 18px">
          <div><dt>Committee</dt><dd>${esc(evaluation.committee.name)}</dd></div>
          <div><dt>Term</dt><dd>${esc(evaluation.term.name)}</dd></div>
          <div><dt>Evaluator</dt><dd>${esc(evaluation.evaluator.first_name)} ${esc(evaluation.evaluator.last_name)}</dd></div>
          <div><dt>Status</dt><dd>${badge(evaluation.status)}</dd></div>
          <div><dt>Average</dt><dd>${evaluation.overall_average !== null ? evaluation.overall_average.toFixed(2) : '—'}</dd></div>
          <div><dt>Submitted</dt><dd>${fmtDateTime(evaluation.submitted_at)}</dd></div>
          ${evaluation.approved_at ? `<div><dt>Approved</dt><dd>${fmtDateTime(evaluation.approved_at)}</dd></div>` : ''}
        </dl>
      </div>
      <table class="data" style="margin-top:14px"><thead><tr><th>Category</th><th>Rating</th></tr></thead><tbody>
        ${evaluation.ratings.map((r) => `<tr><td>${esc(r.category)}</td><td>${r.rating} — ${RATING_LABELS[r.rating]} ${stars(r.rating)}</td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:12px">
        <strong>Comments</strong>
        ${evaluation.comments.length ? evaluation.comments.map((c) => `<p style="margin:5px 0;font-size:13px"><b>${esc(c.comment_type)}</b>${c.visible ? ' <span class="badge badge-green">visible to member</span>' : ' <span class="badge badge-grey">confidential</span>'}: ${esc(c.body)}</p>`).join('') : '<p style="color:var(--muted)">No comments.</p>'}
      </div>
      ${evaluation.admin_notes ? `<div style="margin-top:10px"><strong>Admin notes</strong><p style="margin:4px 0;font-size:13px">${esc(evaluation.admin_notes)}</p></div>` : ''}
      <div style="margin-top:14px"><strong>Approval / revision history</strong>
        ${evaluation.approvals.length ? evaluation.approvals.map((a) => `<p style="margin:4px 0;font-size:12px;color:var(--muted)">${fmtDateTime(a.created_at)} · ${esc(a.action)} by ${esc(a.admin_name)} · ${esc(a.previous_status)} → ${esc(a.new_status)}${a.notes ? ` · “${esc(a.notes)}”` : ''}</p>`).join('') : '<p style="color:var(--muted)">No history yet.</p>'}
      </div>
      <div class="field" style="margin-top:14px"><label>Administrative note (for approval or revision)</label><textarea id="rv-note" style="min-height:70px"></textarea></div>`,
    actions,
  });

  const note = () => document.getElementById('rv-note').value.trim();
  modal.el.querySelector('[data-mact="approve"]')?.addEventListener('click', async () => {
    try { await API.post(`/api/evaluations/${id}/approve`, { notes: note() || undefined }); toast('Evaluation approved.', 'success'); modal.close(); Router.go(); }
    catch (e) { toast(e.message, 'error'); }
  });
  modal.el.querySelector('[data-mact="return"]')?.addEventListener('click', async () => {
    if (!note()) return toast('Please provide revision notes for the committee member.', 'error');
    try { await API.post(`/api/evaluations/${id}/return`, { notes: note() }); toast('Returned for revision.', 'success'); modal.close(); Router.go(); }
    catch (e) { toast(e.message, 'error'); }
  });
  modal.el.querySelector('[data-mact="release"]')?.addEventListener('click', async () => {
    try {
      const r = await API.post(`/api/evaluations/${id}/release`, {});
      toast('Released to member.', 'success'); modal.close(); Router.go();
    } catch (e) {
      if (e.data && e.data.code === 'PACKAGE_MODE') {
        confirmDlg(e.message + '\n\nRelease the complete package for this member and term instead?', { okLabel: 'Release package', onOk: async () => {
          try { await API.post('/api/evaluations/release-package', { member_id: evaluation.member.id, term_id: evaluation.term.id }); toast('Package released to member.', 'success'); modal.close(); Router.go(); }
          catch (err) { toast(err.message, 'error'); }
        } });
      } else toast(e.message, 'error');
    }
  });
}

/* ================= Admin: evaluation terms ================= */
async function renderTerms(box) {
  const { terms } = await API.get('/api/evaluations/terms/all');
  box.innerHTML = `<div class="card"><div class="card-head">
      <h3>Evaluation Terms</h3>
      <button class="btn btn-sm btn-gold" id="term-new">＋ New term</button>
    </div>
    <div class="card-body" style="padding:0">
      <table class="data"><thead><tr><th>Name</th><th>Period</th><th>Status</th><th>Active</th><th></th></tr></thead><tbody>
        ${terms.map((t) => `<tr>
          <td><strong>${esc(t.name)}</strong></td>
          <td>${fmtDate(t.start_date)} — ${fmtDate(t.end_date)}</td>
          <td>${t.state === 'open' ? '<span class="badge badge-green">Open</span>' : t.state === 'upcoming' ? '<span class="badge badge-navy">Upcoming</span>' : '<span class="badge badge-grey">Closed</span>'}</td>
          <td>${t.is_active ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-grey">No</span>'}</td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-edit="${t.id}">Edit</button></td>
        </tr>`).join('')}
      </tbody></table>
      <div style="padding:14px 20px;font-size:12px;color:var(--muted)">Default structure: Term 1 January–April · Term 2 May–July · Term 3 August–November. Dates and names are fully configurable for future years.</div>
    </div></div>`;

  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const t = terms.find((x) => x.id === +b.dataset.edit);
    editTerm(t);
  }));
  document.getElementById('term-new').addEventListener('click', () => editTerm(null));

  function editTerm(t) {
    openModal({
      title: t ? 'Edit Evaluation Term' : 'New Evaluation Term',
      body: `<div class="form-grid">
        <div class="field full"><label>Name</label><input id="tm-name" value="${esc(t?.name || '')}" placeholder="e.g. Term 1 — 2027" /></div>
        <div class="field"><label>Start date</label><input id="tm-start" type="date" value="${esc(t?.start_date || '')}" /></div>
        <div class="field"><label>End date</label><input id="tm-end" type="date" value="${esc(t?.end_date || '')}" /></div>
        <div class="field full"><label class="hint"><input type="checkbox" id="tm-active" ${t?.is_active ? 'checked' : ''} /> Active term (shown in committee dashboards)</label></div>
      </div>`,
      actions: [
        { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
        { key: 'save', label: 'Save', cls: 'btn-primary', onClick: async (close) => {
          const body = {
            name: document.getElementById('tm-name').value,
            start_date: document.getElementById('tm-start').value,
            end_date: document.getElementById('tm-end').value,
            is_active: document.getElementById('tm-active').checked ? 1 : 0,
          };
          if (!body.name || !body.start_date || !body.end_date) return toast('All fields are required.', 'error');
          try {
            if (t) await API.put('/api/evaluations/terms/' + t.id, body);
            else await API.post('/api/evaluations/terms', body);
            toast('Term saved.', 'success'); close(); Router.go();
          } catch (e) { toast(e.message, 'error'); }
        } },
      ],
    });
  }
}
