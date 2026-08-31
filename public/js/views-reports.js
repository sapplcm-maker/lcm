/* Reports — overview, member, committee, term; charts + exports. */
'use strict';

Router.register('reports', {
  title: 'Evaluation Reports',
  render: async (el) => {
    const isAdmin = App.user.role_code === 'admin';
    const data = await API.get('/api/reports/overview');
    const { terms } = data;

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body">
        <div class="filters" style="margin:0">
          <select id="rp-term"><option value="">All terms</option>${terms.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
          ${isAdmin ? `<select id="rp-scope"><option value="overview">Overview</option><option value="member">Individual member</option><option value="committee">Committee</option><option value="term">Term</option></select>` : ''}
          <span id="rp-target"></span>
          <button class="btn btn-sm btn-primary" id="rp-run">Generate report</button>
        </div>
      </div></div>
      <div id="rp-output">${loadingHtml('Building overview…')}</div>`;

    const renderOverview = async () => {
      const termId = document.getElementById('rp-term').value;
      const d = await API.get('/api/reports/overview' + qs({ term_id: termId }));
      document.getElementById('rp-output').innerHTML = `
        <div class="grid grid-3">
          ${d.committees.map((c) => `<div class="card card-pad">
            <h3 style="margin:0 0 4px">${esc(c.name)}</h3>
            <div style="font-size:13px;color:var(--muted)">${c.evaluated} member(s) evaluated · average <b>${c.average !== null ? c.average.toFixed(2) : '—'}</b></div>
            <div style="margin-top:10px">${barChart(c.distribution.counts, { label: 'Rating distribution — ' + c.name })}</div>
            <div class="row-actions" style="margin-top:8px">
              <a class="btn btn-sm btn-ghost" href="/api/reports/export/committee/${c.id}?format=csv${termId ? '&term_id=' + termId : ''}">CSV</a>
              <a class="btn btn-sm btn-ghost" href="/api/reports/export/committee/${c.id}?format=xlsx${termId ? '&term_id=' + termId : ''}">XLSX</a>
              <a class="btn btn-sm btn-ghost" href="/api/reports/export/committee/${c.id}?format=pdf${termId ? '&term_id=' + termId : ''}">PDF</a>
            </div>
          </div>`).join('')}
        </div>`;
    };

    const renderMember = async () => {
      const termId = document.getElementById('rp-term').value;
      const dir = await API.get('/api/members/directory');
      const mid = document.getElementById('rp-target').querySelector('select').value;
      if (!mid) return toast('Select a member.', 'warn');
      const d = await API.get(`/api/reports/member/${mid}` + qs({ term_id: termId }));
      document.getElementById('rp-output').innerHTML = `
        <div class="card" style="margin-bottom:14px"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <h2 style="margin:0;font-size:18px">${esc(d.member.first_name)} ${esc(d.member.last_name)}</h2>
            <div><strong style="font-size:22px;color:var(--navy)">${d.overall_average !== null ? d.overall_average.toFixed(2) : '—'}</strong> ${d.overall_average !== null ? stars(d.overall_average) : ''}</div>
          </div>
          <div style="font-size:13px;color:var(--muted)">${d.evaluations.length} official evaluation(s)</div>
          <div class="row-actions" style="margin-top:8px">
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/member/${mid}?format=csv${termId ? '&term_id=' + termId : ''}">CSV</a>
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/member/${mid}?format=xlsx${termId ? '&term_id=' + termId : ''}">XLSX</a>
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/member/${mid}?format=pdf${termId ? '&term_id=' + termId : ''}">PDF</a>
          </div>
        </div></div>
        ${d.evaluations.map((e) => `<div class="card" style="margin-bottom:12px"><div class="card-head">
          <h3>${esc(e.committee_name)} — ${esc(e.term_name)}</h3>${badge(e.status)}</div>
          <div class="card-body">
            <table class="data"><thead><tr><th>Category</th><th>Rating</th></tr></thead><tbody>
              ${e.ratings.map((r) => `<tr><td>${esc(r.category)}</td><td>${r.rating} — ${RATING_LABELS[r.rating]} ${stars(r.rating)}</td></tr>`).join('')}
            </tbody></table>
            ${e.comments.length ? `<div style="margin-top:10px;font-size:13px"><strong>Feedback</strong>${e.comments.map((c) => `<p style="margin:3px 0"><b>${esc(c.comment_type)}:</b> ${esc(c.body)}</p>`).join('')}</div>` : ''}
          </div></div>`).join('') || emptyHtml('📊', 'No official results for this member yet.')}`;
    };

    const renderCommittee = async () => {
      const termId = document.getElementById('rp-term').value;
      const cid = document.getElementById('rp-target').querySelector('select').value;
      if (!cid) return toast('Select a committee.', 'warn');
      const d = await API.get(`/api/reports/committee/${cid}` + qs({ term_id: termId }));
      document.getElementById('rp-output').innerHTML = `
        <div class="card" style="margin-bottom:14px"><div class="card-body">
          <h2 style="margin:0 0 4px;font-size:18px">${esc(d.committee.name)}</h2>
          <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">
            <div><span style="color:var(--muted);font-size:12px">Members evaluated</span><div style="font-size:22px;font-weight:700;color:var(--navy)">${d.members.length}</div></div>
            <div><span style="color:var(--muted);font-size:12px">Rating mean</span><div style="font-size:22px;font-weight:700;color:var(--navy)">${d.distribution.mean !== null ? d.distribution.mean.toFixed(2) : '—'}</div></div>
            ${donutChart(d.distribution.counts, {})}
          </div>
          <div class="row-actions" style="margin-top:8px">
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/committee/${cid}?format=csv${termId ? '&term_id=' + termId : ''}">CSV</a>
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/committee/${cid}?format=xlsx${termId ? '&term_id=' + termId : ''}">XLSX</a>
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/committee/${cid}?format=pdf${termId ? '&term_id=' + termId : ''}">PDF</a>
          </div>
        </div></div>
        <div class="card"><div class="card-body" style="padding:0"><table class="data"><thead><tr><th>Member</th><th>Average</th><th>Evaluations</th><th>Status</th></tr></thead><tbody>
        ${d.members.map((m) => `<tr>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${avatarHtml(m, 'avatar avatar-sm')} ${esc(m.last_name)}, ${esc(m.first_name)}</span></td>
          <td><b>${m.average !== null ? m.average.toFixed(2) : '—'}</b></td>
          <td>${m.evaluations.length}</td>
          <td>${m.evaluations.map((e) => badge(e.status)).join(' ')}</td>
        </tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted)">No official results.</td></tr>'}
        </tbody></table></div></div>`;
    };

    const renderTerm = async () => {
      const termId = document.getElementById('rp-term').value;
      if (!termId) return toast('Select a term.', 'warn');
      const d = await API.get('/api/reports/term/' + termId);
      document.getElementById('rp-output').innerHTML = `
        <div class="card" style="margin-bottom:14px"><div class="card-body">
          <h2 style="margin:0 0 4px;font-size:18px">${esc(d.term.name)}</h2>
          <div style="font-size:13px;color:var(--muted)">${fmtDate(d.term.start_date)} — ${fmtDate(d.term.end_date)}</div>
          <div style="margin-top:10px">${donutChart(d.distribution.counts, {})}</div>
          <div class="row-actions" style="margin-top:8px">
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/term/${termId}?format=csv">CSV</a>
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/term/${termId}?format=xlsx">XLSX</a>
            <a class="btn btn-sm btn-ghost" href="/api/reports/export/term/${termId}?format=pdf">PDF</a>
          </div>
        </div></div>
        ${d.committees.map((c) => `<div class="card" style="margin-bottom:12px"><div class="card-head"><h3>${esc(c.committee_name)}</h3><b>avg ${c.average !== null ? c.average.toFixed(2) : '—'}</b></div>
          <div class="card-body" style="padding:0"><table class="data"><thead><tr><th>Member</th><th>Average</th><th>Status</th></tr></thead><tbody>
          ${c.entries.map((e) => `<tr><td>${esc(e.member_name)}</td><td>${e.average !== null ? e.average.toFixed(2) : '—'}</td><td>${badge(e.status)}</td></tr>`).join('')}
          </tbody></table></div></div>`).join('')}`;
    };

    const setupTarget = async () => {
      const scope = document.getElementById('rp-scope').value;
      const target = document.getElementById('rp-target');
      if (scope === 'overview') { target.innerHTML = ''; return; }
      if (scope === 'member') {
        const dir = await API.get('/api/members/directory');
        target.innerHTML = `<select style="padding:8px;border:1.5px solid var(--border);border-radius:7px;min-width:220px"><option value="">Select member…</option>${dir.members.map((m) => `<option value="${m.id}">${esc(m.last_name)}, ${esc(m.first_name)}</option>`).join('')}</select>`;
      } else if (scope === 'committee') {
        const c = await API.get('/api/admin/committees');
        target.innerHTML = `<select style="padding:8px;border:1.5px solid var(--border);border-radius:7px;min-width:220px"><option value="">Select committee…</option>${c.committees.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>`;
      }
    };

    document.getElementById('rp-run').addEventListener('click', async () => {
      const scope = isAdmin ? document.getElementById('rp-scope').value : 'overview';
      if (scope === 'overview') await renderOverview();
      else if (scope === 'member') await renderMember();
      else if (scope === 'committee') await renderCommittee();
      else if (scope === 'term') await renderTerm();
    });
    const scopeSel = document.getElementById('rp-scope');
    if (scopeSel) scopeSel.addEventListener('change', setupTarget);
    await setupTarget();
    await renderOverview();
  },
});
