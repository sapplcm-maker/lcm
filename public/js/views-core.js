/* Core views — dashboard, change password, profile, settings, notifications. */
'use strict';

/* ---------------- Dashboard ---------------- */
Router.register('dashboard', {
  title: 'Dashboard',
  render: async (el) => {
    const me = await API.get('/api/auth/me');
    const isAdmin = me.user.role_code === 'admin';
    const isOfficer = me.user.role_code === 'officer';
    const isCommittee = me.committees.length > 0;

    let html = `<div class="grid grid-4" style="margin-bottom:18px">
      <div class="card stat-card"><div class="stat-ico">🗓️</div><span class="stat-label">Upcoming Assignments</span><span class="stat-value" id="dash-upcoming">…</span></div>
      <div class="card stat-card"><div class="stat-ico">📣</div><span class="stat-label">Announcements</span><span class="stat-value" id="dash-ann">…</span></div>
      <div class="card stat-card"><div class="stat-ico">✉️</div><span class="stat-label">Unread Messages</span><span class="stat-value" id="dash-msg">…</span></div>
      <div class="card stat-card"><div class="stat-ico">⭐</div><span class="stat-label">Released Results</span><span class="stat-value" id="dash-eval">…</span></div>
    </div>`;

    if (isAdmin) {
      html += `<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>Administration Overview</h3><a class="btn btn-sm btn-ghost" href="#/approvals">Open Approval Center</a></div>
      <div class="card-body"><div class="grid grid-4" id="admin-stats"></div></div></div>`;
    }

    html += `<div class="two-col">
      <div class="card"><div class="card-head"><h3>My Upcoming Assignments</h3><a class="btn btn-sm btn-ghost" href="#/schedule">Full schedule</a></div>
        <div class="card-body" id="dash-assignments">${loadingHtml()}</div></div>
      <div class="side-stack">
        <div class="card"><div class="card-head"><h3>Latest Announcements</h3><a class="btn btn-sm btn-ghost" href="#/announcements">View all</a></div>
          <div class="card-body" id="dash-announcements">${loadingHtml()}</div></div>
        <div class="card"><div class="card-head"><h3>My Evaluation Results</h3><a class="btn btn-sm btn-ghost" href="#/evaluations">Details</a></div>
          <div class="card-body" id="dash-results">${loadingHtml()}</div></div>
      </div>
    </div>`;

    el.innerHTML = html;

    // parallel data loads
    const month = new Date().toISOString().slice(0, 7);
    const [schedule, announcements, unread, results] = await Promise.all([
      API.get('/api/schedules' + qs({ month })).catch(() => null),
      API.get('/api/announcements').catch(() => null),
      API.get('/api/messages/unread-count').catch(() => null),
      API.get('/api/evaluations/my-results').catch(() => null),
    ]);

    // upcoming assignments (next 3)
    const upcoming = (schedule?.schedules || []).filter((s) => s.schedule_date >= new Date().toISOString().slice(0, 10)).slice(0, 3);
    const assignHtml = upcoming.length
      ? upcoming.map((s) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #eef0f4">
          <div><strong>${esc(s.title)}</strong><br><span style="font-size:13px;color:var(--muted)">${fmtDate(s.schedule_date)} · ${esc(s.start_time)}${s.end_time ? '–' + esc(s.end_time) : ''} · ${esc(s.venue || 'venue TBD')}</span></div>
          <div style="text-align:right">${s.assignments.filter((a) => a.self).map((a) => `<span class="badge badge-navy">${esc(a.role)}</span>`).join(' ')}</div>
        </div>`).join('')
      : emptyHtml('🗓️', 'No upcoming assignments.', 'Your next ministry service will appear here.');

    const annHtml = (announcements?.announcements || []).slice(0, 4).map((a) => `<div style="padding:9px 0;border-bottom:1px solid #eef0f4">
        <a href="#/announcements/${a.id}" style="font-weight:600;font-size:14px">${esc(a.title)}</a>
        <div style="font-size:12px;color:var(--muted)">${fmtDateTime(a.published_at || a.created_at)} · by ${esc(a.first_name)} ${esc(a.last_name)}</div>
      </div>`).join('') || emptyHtml('📣', 'No announcements yet.');

    const released = results?.results || [];
    const resultsHtml = released.length
      ? released.map((t) => `<div style="padding:9px 0;border-bottom:1px solid #eef0f4">
          <div style="display:flex;justify-content:space-between"><strong>${esc(t.term_name)}</strong>${t.overall_average !== null ? stars(t.overall_average) + ` <b>${t.overall_average.toFixed(1)}</b>` : ''}</div>
          <div style="font-size:12px;color:var(--muted)">${t.committees.length} committee result(s) · Official</div>
        </div>`).join('')
      : emptyHtml('⭐', 'No released results yet.', 'Approved evaluation results will appear here.');

    document.getElementById('dash-upcoming').textContent = upcoming.length;
    document.getElementById('dash-ann').textContent = (announcements?.announcements || []).length;
    document.getElementById('dash-msg').textContent = unread?.count || 0;
    document.getElementById('dash-eval').textContent = released.length;
    document.getElementById('dash-assignments').innerHTML = assignHtml;
    document.getElementById('dash-announcements').innerHTML = annHtml;
    document.getElementById('dash-results').innerHTML = resultsHtml;

    if (isAdmin) {
      const [stats, summary] = await Promise.all([
        API.get('/api/admin/stats').catch(() => null),
        API.get('/api/evaluations/admin-summary').catch(() => null),
      ]);
      const s = stats?.stats || {};
      const cards = [
        ['Members', s.active_members || 0, 'active accounts', '👥'],
        ['Pending Review', summary?.summary?.pending || 0, 'evaluations awaiting action', '🕒'],
        ['Returned', summary?.summary?.returned || 0, 'need revision', '↩️'],
        ['Released', summary?.summary?.released || 0, 'visible to members', '✅'],
      ];
      document.getElementById('admin-stats').innerHTML = cards.map(([l, v, sub, ico]) =>
        `<div class="stat-card card" style="padding:14px"><div class="stat-ico">${ico}</div><span class="stat-label">${l}</span><span class="stat-value" style="font-size:24px">${v}</span><span class="stat-sub">${sub}</span></div>`).join('');
    }
  },
});

/* ---------------- Change password (forced) ---------------- */
Router.register('change-password', {
  title: 'Change Password',
  render: async (el) => {
    el.innerHTML = `<div class="card" style="max-width:520px;margin:30px auto">
      <div class="card-head"><h3>Set a new password</h3></div>
      <div class="card-body">
        <p style="margin-top:0">For your security, please choose a new password before continuing. It must contain at least ${App.settings?.password_min_length || 8} characters, with at least one letter and one number.</p>
        <div class="form-grid">
          <div class="field full"><label for="cp-current">Current password</label><input type="password" id="cp-current" autocomplete="current-password" /></div>
          <div class="field"><label for="cp-new">New password</label><input type="password" id="cp-new" autocomplete="new-password" /></div>
          <div class="field"><label for="cp-confirm">Confirm new password</label><input type="password" id="cp-confirm" autocomplete="new-password" /></div>
        </div>
        <button class="btn btn-primary" id="cp-save" style="margin-top:14px">Update password</button>
      </div></div>`;
    const save = async () => {
      const cur = document.getElementById('cp-current').value;
      const nw = document.getElementById('cp-new').value;
      const cf = document.getElementById('cp-confirm').value;
      if (!cur || !nw) return toast('Please fill in all fields.', 'error');
      if (nw !== cf) return toast('New passwords do not match.', 'error');
      try {
        await API.post('/api/auth/change-password', { current_password: cur, new_password: nw });
        toast('Password updated successfully.', 'success');
        App.user.must_change_password = 0;
        location.hash = '#/dashboard';
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('cp-save').addEventListener('click', save);
    el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));
  },
});

/* ---------------- Profile ---------------- */
Router.register('profile', {
  title: 'My Profile',
  render: async (el) => {
    const { profile, details } = await API.get('/api/profile');
    el.innerHTML = `
      <div class="two-col">
        <div class="card"><div class="card-head"><h3>Profile Photo</h3></div>
          <div class="card-body profile-photo-box">
            <div id="pf-avatar">${avatarHtml(profile, 'avatar avatar-lg')}</div>
            <div class="row-actions">
              <label class="btn btn-outline btn-sm" for="pf-file">Upload photo</label>
              <input type="file" id="pf-file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" />
              <button class="btn btn-ghost btn-sm" id="pf-remove">Remove</button>
            </div>
            <p style="font-size:12px;color:var(--muted);margin:0">JPG, PNG, WebP or GIF up to 2 MB. Photos are resized and compressed automatically.</p>
          </div></div>
        <div class="card"><div class="card-head"><h3>Personal Information</h3></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="field"><label>First name</label><input id="pf-first" value="${esc(profile.first_name)}" /></div>
              <div class="field"><label>Last name</label><input id="pf-last" value="${esc(profile.last_name)}" /></div>
              <div class="field"><label>Username</label><input id="pf-username" value="${esc(profile.username)}" /></div>
              <div class="field"><label>Email</label><input id="pf-email" type="email" value="${esc(profile.email || '')}" /></div>
              <div class="field"><label>Phone</label><input id="pf-phone" value="${esc(profile.phone || '')}" /></div>
              <div class="field"><label>Classification</label><input value="${esc(profile.classification || '—')}" disabled /></div>
              <div class="field"><label>Birthday</label><input id="pf-birthday" type="date" value="${esc(details.birthday || '')}" /></div>
              <div class="field"><label>Joined the ministry</label><input id="pf-joined" type="date" value="${esc(details.joined_date || '')}" /></div>
              <div class="field"><label>Address</label><input id="pf-address" value="${esc(details.address || '')}" /></div>
              <div class="field"><label>Emergency contact</label><input id="pf-ec-name" value="${esc(details.emergency_contact_name || '')}" /></div>
              <div class="field"><label>Emergency contact phone</label><input id="pf-ec-phone" value="${esc(details.emergency_contact_phone || '')}" /></div>
              <div class="field full"><label>Short bio</label><textarea id="pf-bio">${esc(details.bio || '')}</textarea></div>
            </div>
            <button class="btn btn-primary" id="pf-save" style="margin-top:16px">Save changes</button>
          </div></div>
      </div>`;
    const pfFile = document.getElementById('pf-file');
    pfFile.addEventListener('change', async () => {
      const f = pfFile.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) return toast('Image must be 2 MB or smaller.', 'error');
      const fd = new FormData();
      fd.append('photo', f);
      try {
        const r = await API.upload('/api/profile/photo', fd);
        toast('Photo updated.', 'success');
        document.getElementById('pf-avatar').innerHTML = `<img class="avatar avatar-lg" src="/api/files/${esc(r.profile_picture)}?t=${Date.now()}" alt="Profile photo" />`;
        App.refreshMe();
      } catch (e) { toast(e.message, 'error'); }
    });
    document.getElementById('pf-remove').addEventListener('click', async () => {
      confirmDlg('Remove your profile photo?', { okLabel: 'Remove', danger: true, onOk: async () => {
        try { await API.del('/api/profile/photo'); document.getElementById('pf-avatar').innerHTML = avatarHtml({ first_name: profile.first_name, last_name: profile.last_name }, 'avatar avatar-lg'); App.refreshMe(); toast('Photo removed.', 'success'); }
        catch (e) { toast(e.message, 'error'); }
      } });
    });
    document.getElementById('pf-save').addEventListener('click', async () => {
      const body = {
        first_name: document.getElementById('pf-first').value,
        last_name: document.getElementById('pf-last').value,
        username: document.getElementById('pf-username').value,
        email: document.getElementById('pf-email').value,
        phone: document.getElementById('pf-phone').value,
        details: {
          birthday: document.getElementById('pf-birthday').value || null,
          joined_date: document.getElementById('pf-joined').value || null,
          address: document.getElementById('pf-address').value || null,
          emergency_contact_name: document.getElementById('pf-ec-name').value || null,
          emergency_contact_phone: document.getElementById('pf-ec-phone').value || null,
          bio: document.getElementById('pf-bio').value || null,
        },
      };
      try { await API.put('/api/profile', body); toast('Profile saved.', 'success'); App.refreshMe(); }
      catch (e) { toast(e.message, 'error'); }
    });
  },
});

/* ---------------- Settings (account & security) ---------------- */
Router.register('settings', {
  title: 'Account Settings',
  render: async (el) => {
    const { sessions } = await API.get('/api/auth/sessions');
    el.innerHTML = `
      <div class="two-col">
        <div class="card"><div class="card-head"><h3>Security &amp; Password</h3></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="field full"><label>Current password</label><input type="password" id="st-cur" autocomplete="current-password" /></div>
              <div class="field"><label>New password</label><input type="password" id="st-new" autocomplete="new-password" /></div>
              <div class="field"><label>Confirm new password</label><input type="password" id="st-confirm" autocomplete="new-password" /></div>
            </div>
            <button class="btn btn-primary" id="st-change" style="margin-top:14px">Change password</button>
            <p class="hint" style="font-size:12px;color:var(--muted)">Password policy: at least ${App.settings?.password_min_length || 8} characters with letters and numbers. All other sessions are signed out after a password change.</p>
          </div></div>
        <div class="card"><div class="card-head"><h3>Active Sessions</h3></div>
          <div class="card-body" style="padding:8px 20px">
            ${sessions.length ? sessions.map((s) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #eef0f4">
              <div><strong>${esc(s.user_agent || 'Unknown device')}</strong><br><span style="font-size:12px;color:var(--muted)">${esc(s.ip || '')} · started ${fmtDateTime(s.created_at)}</span></div>
              <div>${s.current ? '<span class="badge badge-green">This session</span>' : `<button class="btn btn-ghost btn-sm" data-revoke="${esc(s.sid)}">Sign out</button>`}</div>
            </div>`).join('') : emptyHtml('🔐', 'No active sessions.')}
          </div></div>
      </div>`;
    document.getElementById('st-change').addEventListener('click', async () => {
      const cur = document.getElementById('st-cur').value;
      const nw = document.getElementById('st-new').value;
      const cf = document.getElementById('st-confirm').value;
      if (!cur || !nw) return toast('Please fill in all fields.', 'error');
      if (nw !== cf) return toast('New passwords do not match.', 'error');
      try { await API.post('/api/auth/change-password', { current_password: cur, new_password: nw }); toast('Password changed.', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
    el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.del('/api/auth/sessions/' + b.dataset.revoke); toast('Session revoked.', 'success'); Router.go(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  },
});

/* ---------------- Notifications ---------------- */
Router.register('notifications', {
  title: 'Notifications',
  render: async (el) => {
    el.innerHTML = `<div class="card"><div class="card-head">
        <h3>Notifications</h3>
        <button class="btn btn-sm btn-ghost" id="notif-readall">Mark all as read</button>
      </div>
      <div class="card-body" style="padding:0" id="notif-list">${loadingHtml()}</div></div>`;
    const { notifications } = await API.get('/api/notifications' + qs({ limit: 100 }));
    const list = document.getElementById('notif-list');
    document.getElementById('notif-readall').addEventListener('click', async () => {
      await API.post('/api/notifications/read-all');
      list.querySelectorAll('.notif-item').forEach((i) => i.classList.remove('unread'));
      list.querySelectorAll('[data-mark]').forEach((b) => b.remove());
      App.refreshBadges();
      toast('All notifications marked as read.', 'success');
    });
    if (!notifications.length) { list.innerHTML = emptyHtml('🔔', 'No notifications yet.'); return; }
    const ICONS = { announcement: '📣', message: '✉️', schedule: '🗓️', evaluation: '⭐', account: '🔐', admin: '📢', deadline: '⏰' };
    list.innerHTML = notifications.map((n) => `<div class="notif-item ${n.is_read ? '' : 'unread'}" data-nid="${n.id}">
      <span class="n-ico">${ICONS[n.type] || '🔔'}</span>
      <div style="flex:1">
        <div class="n-title">${esc(n.title)}</div>
        ${n.body ? `<div class="n-body">${esc(n.body)}</div>` : ''}
        <div class="n-time">${timeAgo(n.created_at)}</div>
      </div>
      ${n.is_read ? '' : '<button class="btn btn-sm btn-ghost" data-mark="1">Mark read</button>'}
      ${n.link ? `<a class="btn btn-sm btn-outline" href="${esc(n.link)}">View</a>` : ''}
    </div>`).join('');
    bindEvents(list, {
      'click [data-mark]': async (e, b) => {
        const item = b.closest('.notif-item');
        await API.post(`/api/notifications/${item.dataset.nid}/read`);
        item.classList.remove('unread');
        b.remove();
        App.refreshBadges();
      },
    });
  },
});
