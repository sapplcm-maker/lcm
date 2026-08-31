/* Admin portal views — members, directory, roles, classifications, committees, audit, settings. */
'use strict';

/* ================= Member management ================= */
Router.register('members', {
  title: 'Member Management',
  render: async (el) => {
    const [roles, classifications] = await Promise.all([
      API.get('/api/admin/roles'),
      API.get('/api/admin/classifications'),
    ]);
    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Members</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-gold" id="mb-new">＋ Add member</button>
          </div>
        </div>
        <div class="card-body">
          <div class="filters">
            <input id="mb-search" class="search-input" placeholder="Search name or username…" />
            <select id="mb-status"><option value="">All statuses</option><option>active</option><option>inactive</option><option>suspended</option><option>pending</option></select>
            <select id="mb-class"><option value="">All classifications</option>${classifications.classifications.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
            <select id="mb-role"><option value="">All roles</option>${roles.roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
          </div>
          <div id="mb-list">${loadingHtml()}</div>
        </div>
      </div>`;

    const loadList = async () => {
      const { members, total } = await API.get('/api/members' + qs({
        search: document.getElementById('mb-search').value,
        status: document.getElementById('mb-status').value,
        classification_id: document.getElementById('mb-class').value,
        role_id: document.getElementById('mb-role').value,
        limit: 200,
      }));
      const box = document.getElementById('mb-list');
      box.innerHTML = `<div style="font-size:13px;color:var(--muted);padding:4px 2px 10px">${total} member(s)</div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Member</th><th>Classification</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>
        ${members.map((m) => `<tr>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${avatarHtml(m, 'avatar avatar-sm')} <div><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><div style="font-size:12px;color:var(--muted)">@${esc(m.username)}</div></div></span></td>
          <td>${esc(m.classification || '—')}</td>
          <td>${esc(m.role_name)}</td>
          <td>${badge(m.status)}</td>
          <td style="font-size:12px">${m.last_login_at ? timeAgo(m.last_login_at) : 'Never'}</td>
          <td class="actions"><div class="row-actions">
            <button class="btn btn-sm btn-ghost" data-view="${m.id}">View</button>
            <button class="btn btn-sm btn-ghost" data-edit="${m.id}">Edit</button>
            <button class="btn btn-sm btn-ghost" data-reset="${m.id}">Reset PW</button>
            ${m.status === 'active' ? `<button class="btn btn-sm btn-danger" data-del="${m.id}" data-name="${esc(m.first_name)} ${esc(m.last_name)}">Delete</button>` : `<button class="btn btn-sm btn-teal" data-restore="${m.id}">Restore</button>`}
          </div></td>
        </tr>`).join('') || `<tr><td colspan="6">${emptyHtml('👥', 'No members found.')}</td></tr>`}
        </tbody></table></div>`;
      box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewMember(+b.dataset.view)));
      box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editMember(+b.dataset.edit, roles, classifications)));
      box.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => resetPassword(+b.dataset.reset)));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        confirmDlg(`Delete ${b.dataset.name}? Members with no records are removed permanently. If they have records (schedules, evaluations, messages), those are protected, so the member is removed from active use instead — and can be brought back with Restore anytime.`, { okLabel: 'Delete', danger: true, onOk: async () => {
          try {
            const r = await API.del('/api/members/' + b.dataset.del + '?permanent=1');
            toast(r.message || 'Member deleted.', 'success');
          } catch (e) {
            if (e.status === 409) {
              // Has records → remove from active use so Delete always visibly works
              await API.post(`/api/members/${b.dataset.del}/status`, { status: 'inactive' });
              toast('This member has records that must be kept, so they were removed from active use. Use Restore to bring them back.', 'warn', 9000);
            } else toast(e.message, 'error');
          }
          loadList();
        } });
      }));
      box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
        confirmDlg('Restore this member so they can sign in again?', { okLabel: 'Restore', onOk: async () => {
          try { await API.post(`/api/members/${b.dataset.restore}/status`, { status: 'active' }); toast('Member restored.', 'success'); loadList(); } catch (e) { toast(e.message, 'error'); }
        } });
      }));
    };

    document.getElementById('mb-search').addEventListener('input', debounce(loadList, 300));
    ['mb-status', 'mb-class', 'mb-role'].forEach((id) => document.getElementById(id).addEventListener('change', loadList));
    document.getElementById('mb-new').addEventListener('click', () => editMember(null, roles, classifications));
    await loadList();
  },
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function viewMember(id) {
  const { member, profile, committees } = await API.get('/api/members/' + id);
  openModal({
    title: `${member.first_name} ${member.last_name}`,
    body: `<div style="display:flex;gap:16px;align-items:center">
      ${avatarHtml(member, 'avatar avatar-lg')}
      <div><h3 style="margin:0">@${esc(member.username)}</h3>
        <span style="color:var(--muted)">${esc(member.role_name)} · ${esc(member.classification || 'No classification')}</span>
        <div style="margin-top:4px">${badge(member.status)}</div>
      </div></div>
      <div class="detail-list"><dl>
        <div><dt>Email</dt><dd>${esc(member.email || '—')}</dd></div>
        <div><dt>Phone</dt><dd>${esc(member.phone || '—')}</dd></div>
        <div><dt>Joined</dt><dd>${fmtDate(member.created_at)}</dd></div>
        ${profile ? `<div><dt>Birthday</dt><dd>${esc(profile.birthday || '—')}</dd></div>
        <div><dt>Address</dt><dd>${esc(profile.address || '—')}</dd></div>
        <div><dt>Emergency contact</dt><dd>${esc(profile.emergency_contact_name || '—')} ${esc(profile.emergency_contact_phone || '')}</dd></div>
        <div><dt>Bio</dt><dd>${esc(profile.bio || '—')}</dd></div>` : ''}
        <div><dt>Committees</dt><dd>${committees.length ? committees.map((c) => esc(c.name)).join(', ') : '—'}</dd></div>
      </dl></div>`,
    actions: [{ key: 'close', label: 'Close', cls: 'btn-ghost' }],
  });
}

async function editMember(id, roles, classifications) {
  let m = null;
  let prof = {};
  if (id) {
    const r = await API.get('/api/members/' + id);
    m = r.member;
    prof = r.profile || {};
  }
  const minLen = App.settings?.password_min_length || 8;
  openModal({
    title: id ? 'Edit Member' : 'Add Member',
    wide: true,
    body: `
      <div id="em-error" class="form-error hidden" role="alert"></div>
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label>First name</label><input id="em-first" value="${esc(m?.first_name || '')}" /></div>
        <div class="field"><label>Last name</label><input id="em-last" value="${esc(m?.last_name || '')}" /></div>
        <div class="field"><label>Username</label><input id="em-username" value="${esc(m?.username || '')}" ${id ? 'disabled' : ''} /><div class="hint">${id ? 'Usernames cannot be changed after creation.' : '3–30 characters: letters, numbers, . _ -'}</div></div>
        ${id ? '' : `
        <div class="field">
          <label>Initial password</label>
          <input id="em-pass" type="text" value="" placeholder="at least ${minLen} characters" autocomplete="new-password" />
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-outline" id="em-gen">🎲 Generate password</button>
            <span class="hint">Password needs at least ${minLen} characters with letters AND numbers.</span>
          </div>
        </div>`}
        <div class="field"><label>Role</label><select id="em-role">${roles.roles.map((r) => `<option value="${r.id}" ${m?.role_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Classification</label><select id="em-class">${classifications.classifications.map((c) => `<option value="${c.id}" ${m?.classification_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Email</label><input id="em-email" type="email" value="${esc(m?.email || '')}" /></div>
        <div class="field"><label>Phone</label><input id="em-phone" value="${esc(m?.phone || '')}" /></div>
        <div class="field"><label>Status</label><select id="em-status">${['active', 'inactive', 'suspended', 'pending'].map((s) => `<option ${m?.status === s || (!m && s === 'active') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        ${id ? `
        <div class="field"><label>Birthday</label><input id="em-birthday" type="date" value="${esc(prof.birthday || '')}" /></div>
        <div class="field"><label>Joined the ministry</label><input id="em-joined" type="date" value="${esc(prof.joined_date || '')}" /></div>
        <div class="field full"><label>Address</label><input id="em-address" value="${esc(prof.address || '')}" /></div>
        <div class="field"><label>Emergency contact name</label><input id="em-ecname" value="${esc(prof.emergency_contact_name || '')}" /></div>
        <div class="field"><label>Emergency contact phone</label><input id="em-ecphone" value="${esc(prof.emergency_contact_phone || '')}" /></div>
        <div class="field full"><label>Short bio</label><textarea id="em-bio">${esc(prof.bio || '')}</textarea></div>` : ''}
      </div>`,
    actions: [
      { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
      { key: 'save', label: 'Save', cls: 'btn-primary', onClick: async (close) => {
        const errBox = document.getElementById('em-error');
        errBox.classList.add('hidden');
        const showErr = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };
        const body = {
          first_name: document.getElementById('em-first').value,
          last_name: document.getElementById('em-last').value,
          role_id: +document.getElementById('em-role').value,
          classification_id: +document.getElementById('em-class').value || null,
          email: document.getElementById('em-email').value,
          phone: document.getElementById('em-phone').value,
          status: document.getElementById('em-status').value,
        };
        if (!body.first_name || !body.last_name) return showErr('Please enter the member\'s first and last name.');
        try {
          if (id) {
            body.profile = {
              birthday: document.getElementById('em-birthday').value || null,
              joined_date: document.getElementById('em-joined').value || null,
              address: document.getElementById('em-address').value,
              emergency_contact_name: document.getElementById('em-ecname').value,
              emergency_contact_phone: document.getElementById('em-ecphone').value,
              bio: document.getElementById('em-bio').value,
            };
            await API.put('/api/members/' + id, body);
          } else {
            body.username = document.getElementById('em-username').value;
            body.password = document.getElementById('em-pass').value;
            if (!body.username) return showErr('Please enter a username (3–30 characters: letters, numbers, . _ -).');
            if (!body.password) return showErr('Please enter a password (or click "Generate password").');
            await API.post('/api/members', body);
          }
          toast('Member saved successfully.', 'success');
          close();
          Router.go();
        } catch (e) { showErr(e.message); }
      } },
    ],
  });
  const genBtn = document.getElementById('em-gen');
  if (genBtn) {
    genBtn.addEventListener('click', () => {
      const pw = 'Lcm' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10);
      document.getElementById('em-pass').value = pw;
      toast('Password generated: ' + pw, 'info', 9000);
    });
  }
}

async function resetPassword(id) {
  openModal({
    title: 'Reset Password',
    body: `<p style="margin-top:0">This generates a temporary password and signs the member out of all devices. They will be required to change it on next login.</p>`,
    actions: [
      { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
      { key: 'reset', label: 'Generate temporary password', cls: 'btn-danger', onClick: async (close) => {
        try {
          const r = await API.post('/api/auth/members/' + id + '/reset-password');
          close();
          openModal({
            title: 'Temporary Password',
            body: `<p>Share this temporary password securely with the member:</p>
              <p style="font-size:22px;font-weight:800;color:var(--navy);text-align:center;letter-spacing:1px">${esc(r.temporary_password)}</p>
              <p class="hint" style="font-size:12px;color:var(--muted)">The member must change it after their next sign-in.</p>`,
            actions: [{ key: 'close', label: 'Done', cls: 'btn-primary' }],
          });
          Router.go();
        } catch (e) { toast(e.message, 'error'); }
      } },
    ],
  });
}

/* ================= Member directory (officer) ================= */
Router.register('directory', {
  title: 'Member Directory',
  render: async (el) => {
    const { members } = await API.get('/api/members/directory');
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Member Directory</h3><span style="font-size:13px;color:var(--muted)">${members.length} active members</span></div>
      <div class="card-body"><div class="grid grid-3">
        ${members.map((m) => `<div class="card card-pad" style="display:flex;gap:12px;align-items:center">
          ${avatarHtml(m)}
          <div><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><div style="font-size:13px;color:var(--muted)">${esc(m.classification || '—')} · ${esc(m.role_name)}</div></div>
        </div>`).join('')}
      </div></div></div>`;
  },
});

/* ================= Roles & permissions ================= */
Router.register('roles', {
  title: 'Roles & Permissions',
  render: async (el) => {
    const { roles } = await API.get('/api/admin/roles');
    const { permissions } = await API.get('/api/admin/permissions');
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Roles &amp; Permission Matrix</h3></div>
      <div class="card-body"><p style="margin-top:0;font-size:13px;color:var(--muted)">Select a role to edit its permissions. Administrator permissions are fixed.</p>
        <div class="grid grid-2">
        ${roles.map((r) => `<div class="card card-pad" data-role="${r.code}">
          <div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(r.name)}</strong>${r.code === 'admin' ? '<span class="badge badge-gold">All permissions</span>' : ''}</div>
          <p style="font-size:12px;color:var(--muted);margin:4px 0 10px">${esc(r.description || '')}</p>
          ${r.code === 'admin' ? '' : `<div id="perms-${r.id}" class="pill-row">${loadingHtml('Loading…')}</div>`}
        </div>`).join('')}
        </div></div></div>`;
    for (const r of roles) {
      if (r.code === 'admin') continue;
      const box = document.getElementById('perms-' + r.id);
      const { permissions: granted } = await API.get(`/api/admin/roles/${r.id}/permissions`);
      box.innerHTML = permissions.map((p) => `<label style="display:inline-flex;gap:5px;align-items:center;font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:999px;cursor:pointer;background:${granted.includes(p.code) ? 'var(--teal-soft)' : '#fff'}">
        <input type="checkbox" value="${esc(p.code)}" ${granted.includes(p.code) ? 'checked' : ''} data-perm="${esc(p.code)}" /> ${esc(p.code)}
      </label>`).join('');
      box.querySelectorAll('input[data-perm]').forEach((chk) => chk.addEventListener('change', debounce(async () => {
        const codes = [...box.querySelectorAll('input[data-perm]:checked')].map((c) => c.value);
        try { await API.put(`/api/admin/roles/${r.id}/permissions`, { permissions: codes }); toast('Permissions updated.', 'success'); }
        catch (e) { toast(e.message, 'error'); }
      }, 500)));
    }
  },
});

/* ================= Classifications ================= */
Router.register('classifications', {
  title: 'Classifications',
  render: async (el) => {
    const { classifications } = await API.get('/api/admin/classifications');
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Member Classifications</h3><button class="btn btn-sm btn-gold" id="cl-new">＋ New classification</button></div>
      <div class="card-body" style="padding:0"><table class="data"><thead><tr><th>Name</th><th>Description</th><th></th></tr></thead><tbody>
        ${classifications.map((c) => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.description || '')}</td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-del="${c.id}" data-name="${esc(c.name)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    document.getElementById('cl-new').addEventListener('click', () => {
      openModal({
        title: 'New Classification',
        body: `<div class="form-grid"><div class="field"><label>Name</label><input id="cl-name" /></div><div class="field"><label>Description</label><input id="cl-desc" /></div></div>`,
        actions: [
          { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
          { key: 'save', label: 'Save', cls: 'btn-primary', onClick: async (close) => {
            try { await API.post('/api/admin/classifications', { name: document.getElementById('cl-name').value, description: document.getElementById('cl-desc').value }); toast('Classification added.', 'success'); close(); Router.go(); }
            catch (e) { toast(e.message, 'error'); }
          } },
        ],
      });
    });
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      confirmDlg(`Delete classification “${b.dataset.name}”?`, { okLabel: 'Delete', danger: true, onOk: async () => {
        try { await API.del('/api/admin/classifications/' + b.dataset.del); toast('Deleted.', 'success'); Router.go(); } catch (e) { toast(e.message, 'error'); }
      } });
    }));
  },
});

/* ================= Committees ================= */
Router.register('committees', {
  title: 'Committees',
  render: async (el) => {
    const { committees } = await API.get('/api/admin/committees');
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Evaluation Committees</h3><button class="btn btn-sm btn-gold" id="cm-new">＋ New committee</button></div>
      <div class="card-body" style="padding:0">
        <table class="data"><thead><tr><th>Committee</th><th>Members</th><th>Rating categories</th><th></th></tr></thead><tbody>
        ${committees.map((c) => `<tr>
          <td><strong>${esc(c.name)}</strong> ${c.is_active ? '' : '<span class="badge badge-grey">inactive</span>'}</td>
          <td>${c.member_count}</td>
          <td>${c.categories.map((x) => `<span class="badge badge-navy" style="margin:1px">${esc(x.name)}</span>`).join('') || '—'}</td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-manage="${c.id}">Manage</button></td>
        </tr>`).join('')}
        </tbody></table>
      </div></div>`;

    el.querySelectorAll('[data-manage]').forEach((b) => b.addEventListener('click', () => manageCommittee(+b.dataset.manage)));
    document.getElementById('cm-new').addEventListener('click', () => {
      openModal({
        title: 'New Committee',
        body: `<div class="form-grid">
          <div class="field"><label>Name</label><input id="cm-name" placeholder="e.g. Music Evaluation Committee" /></div>
          <div class="field"><label>Code</label><input id="cm-code" placeholder="e.g. music" /></div>
          <div class="field full"><label>Description</label><input id="cm-desc" /></div>
        </div>`,
        actions: [
          { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
          { key: 'save', label: 'Save', cls: 'btn-primary', onClick: async (close) => {
            try { await API.post('/api/admin/committees', { name: document.getElementById('cm-name').value, code: document.getElementById('cm-code').value, description: document.getElementById('cm-desc').value }); toast('Committee created.', 'success'); close(); Router.go(); }
            catch (e) { toast(e.message, 'error'); }
          } },
        ],
      });
    });
  },
});

async function manageCommittee(id) {
  const { committees } = await API.get('/api/admin/committees');
  const c = committees.find((x) => x.id === id);
  const { members } = await API.get(`/api/admin/committees/${id}/members`);
  const dir = await API.get('/api/members/directory');
  const available = dir.members.filter((m) => !members.some((mm) => mm.user_id === m.id));
  const modal = openModal({
    title: `Manage — ${c.name}`,
    wide: true,
    body: `
      <h4 style="margin:0 0 8px">Members</h4>
      <table class="data"><thead><tr><th>Member</th><th>Committee role</th><th>Active</th><th></th></tr></thead><tbody>
        ${members.map((m) => `<tr>
          <td>${esc(m.first_name)} ${esc(m.last_name)} <span style="color:var(--muted);font-size:12px">@${esc(m.username)}</span></td>
          <td><select data-cmrole="${m.id}"><option ${m.role_in_committee === 'chair' ? 'selected' : ''}>chair</option><option ${m.role_in_committee === 'secretary' ? 'selected' : ''}>secretary</option><option ${m.role_in_committee === 'member' ? 'selected' : ''}>member</option></select></td>
          <td><input type="checkbox" data-cmact="${m.id}" ${m.is_active ? 'checked' : ''} /></td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-cmrem="${m.id}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted)">No members yet.</td></tr>'}
      </tbody></table>
      <div style="margin-top:10px;display:flex;gap:8px">
        <select id="cm-addsel" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px">${available.map((m) => `<option value="${m.id}">${esc(m.last_name)}, ${esc(m.first_name)}</option>`).join('')}</select>
        <button class="btn btn-sm btn-teal" id="cm-addbtn">＋ Add member</button>
      </div>
      <h4 style="margin:20px 0 8px">Rating Categories</h4>
      <div id="cm-cats">${c.categories.map((x, i) => `<div style="display:flex;gap:8px;margin-bottom:6px"><input value="${esc(x.name)}" data-catname="${i}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px" /></div>`).join('')}</div>
      <button class="btn btn-sm btn-ghost" id="cm-addcat">＋ Add category</button>`,
    actions: [
      { key: 'cancel', label: 'Close', cls: 'btn-ghost' },
      { key: 'save', label: 'Save all', cls: 'btn-primary' },
    ],
  });
  modal.el.querySelectorAll('[data-cmrole]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await API.put(`/api/admin/committees/members/${sel.dataset.cmrole}`, { role_in_committee: sel.value }); } catch (e) { toast(e.message, 'error'); }
  }));
  modal.el.querySelectorAll('[data-cmact]').forEach((chk) => chk.addEventListener('change', async () => {
    try { await API.put(`/api/admin/committees/members/${chk.dataset.cmact}`, { is_active: chk.checked }); toast('Membership updated.', 'success'); } catch (e) { toast(e.message, 'error'); }
  }));
  modal.el.querySelectorAll('[data-cmrem]').forEach((b) => b.addEventListener('click', async () => {
    try { await API.del('/api/admin/committees/members/' + b.dataset.cmrem); b.closest('tr').remove(); toast('Member removed.', 'success'); } catch (e) { toast(e.message, 'error'); }
  }));
  const addMember = async (userId) => {
    try {
      await API.post(`/api/admin/committees/${id}/members`, { user_id: +userId, role_in_committee: 'member' });
      toast('Member added.', 'success'); modal.close(); manageCommittee(id);
    } catch (e) { toast(e.message, 'error'); }
  };
  modal.el.querySelector('#cm-addbtn').addEventListener('click', () => {
    const sel = modal.el.querySelector('#cm-addsel');
    if (sel.value) addMember(sel.value);
  });
  modal.el.querySelector('#cm-addcat').addEventListener('click', () => {
    const box = modal.el.querySelector('#cm-cats');
    const i = box.children.length;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;margin-bottom:6px';
    div.innerHTML = `<input placeholder="Category name" data-catname="${i}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px" />`;
    box.appendChild(div);
  });
  modal.el.querySelector('[data-mact="save"]').addEventListener('click', async () => {
    const names = [...modal.el.querySelectorAll('[data-catname]')].map((i) => i.value.trim()).filter(Boolean);
    if (!names.length) return toast('At least one category is required.', 'error');
    try {
      await API.put(`/api/admin/committees/${id}/categories`, { categories: names });
      toast('Committee saved.', 'success'); modal.close(); Router.go();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ================= Audit log ================= */
Router.register('audit', {
  title: 'Audit Logs',
  render: async (el) => {
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Audit Trail</h3></div>
      <div class="card-body">
        <div class="filters">
          <input id="au-action" placeholder="Action (e.g. member, evaluation, schedule)…" class="search-input" />
          <input id="au-user" placeholder="Username…" />
          <input id="au-from" type="date" />
          <input id="au-to" type="date" />
          <button class="btn btn-sm btn-primary" id="au-apply">Filter</button>
        </div>
        <div id="au-list">${loadingHtml()}</div>
      </div></div>`;
    const load = async () => {
      const { entries, total } = await API.get('/api/admin/audit' + qs({
        action: document.getElementById('au-action').value,
        user_id: document.getElementById('au-user').value,
        from: document.getElementById('au-from').value,
        to: document.getElementById('au-to').value,
        limit: 150,
      }));
      const box = document.getElementById('au-list');
      box.innerHTML = `<div style="font-size:13px;color:var(--muted);padding-bottom:8px">${total} entries</div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
        ${entries.map((e) => `<tr>
          <td style="white-space:nowrap;font-size:12px">${fmtDateTime(e.created_at)}</td>
          <td>${esc(e.username || '—')}</td>
          <td><code>${esc(e.action)}</code></td>
          <td style="font-size:12px">${esc(e.entity_type || '')}${e.entity_id ? ' #' + e.entity_id : ''}</td>
          <td style="font-size:12px;color:var(--muted)">${esc(e.details || '')}</td>
        </tr>`).join('') || `<tr><td colspan="5">${emptyHtml('🔍', 'No audit entries match.')}</td></tr>`}
        </tbody></table></div>`;
    };
    document.getElementById('au-apply').addEventListener('click', load);
    await load();
  },
});

/* ================= System settings ================= */
Router.register('syssettings', {
  title: 'System Settings',
  render: async (el) => {
    const { settings } = await API.get('/api/admin/settings');
    el.innerHTML = `<div class="card" style="max-width:720px"><div class="card-head"><h3>System Settings</h3></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Site name</label><input id="ss-site" value="${esc(settings.site_name || '')}" /></div>
          <div class="field"><label>Organization name</label><input id="ss-org" value="${esc(settings.org_name || '')}" /></div>
          <div class="field"><label>Organization location</label><input id="ss-loc" value="${esc(settings.org_location || '')}" /></div>
          <div class="field"><label>Password minimum length</label><input id="ss-plen" type="number" min="8" max="32" value="${esc(settings.password_min_length || '8')}" /></div>
          <div class="field"><label>Evaluation release mode</label>
            <select id="ss-rel">
              <option value="individual" ${settings.release_mode === 'individual' ? 'selected' : ''}>Individual — release each approved evaluation separately</option>
              <option value="package" ${settings.release_mode === 'package' ? 'selected' : ''}>Package — release only after ALL committee evaluations for a member &amp; term are approved</option>
            </select>
            <div class="hint">Package mode enforces the strictest confidentiality: no member sees any result until the complete set is approved.</div></div>
          <div class="field"><label>Allow committee self-evaluation</label>
            <select id="ss-self"><option value="1" ${settings.allow_self_evaluation === '1' ? 'selected' : ''}>Yes</option><option value="0" ${settings.allow_self_evaluation === '0' ? 'selected' : ''}>No</option></select></div>
          <div class="field"><label>Submission grace days after term end</label><input id="ss-grace" type="number" min="0" max="30" value="${esc(settings.evaluation_grace_days || '0')}" /></div>
        </div>
        <button class="btn btn-primary" id="ss-save" style="margin-top:16px">Save settings</button>
      </div></div>`;
    document.getElementById('ss-save').addEventListener('click', async () => {
      const body = {
        site_name: document.getElementById('ss-site').value,
        org_name: document.getElementById('ss-org').value,
        org_location: document.getElementById('ss-loc').value,
        password_min_length: document.getElementById('ss-plen').value,
        release_mode: document.getElementById('ss-rel').value,
        allow_self_evaluation: document.getElementById('ss-self').value,
        evaluation_grace_days: document.getElementById('ss-grace').value,
      };
      try { await API.put('/api/admin/settings', { settings: body }); toast('Settings saved.', 'success'); App.refreshMe(); }
      catch (e) { toast(e.message, 'error'); }
    });
  },
});

/* ================= Notification broadcast ================= */
Router.register('broadcast', {
  title: 'Send Notification',
  render: async (el) => {
    const { roles } = await API.get('/api/admin/roles');
    el.innerHTML = `<div class="card" style="max-width:640px"><div class="card-head"><h3>Send Ministry Notification</h3></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field full"><label>Title</label><input id="bc-title" /></div>
          <div class="field full"><label>Message</label><textarea id="bc-body" style="min-height:90px"></textarea></div>
          <div class="field"><label>Audience</label><select id="bc-aud"><option value="all">All active members</option><option value="role">By role</option></select></div>
          <div class="field"><label>Role</label><select id="bc-role">${roles.roles.filter((r) => r.code !== 'admin').map((r) => `<option value="${esc(r.code)}">${esc(r.name)}</option>`).join('')}</select></div>
          <div class="field full"><label>Link (optional)</label><input id="bc-link" placeholder="e.g. #/schedule" /></div>
        </div>
        <button class="btn btn-primary" id="bc-send" style="margin-top:14px">Send notification</button>
      </div></div>`;
    document.getElementById('bc-send').addEventListener('click', async () => {
      try {
        await API.post('/api/notifications/broadcast', {
          title: document.getElementById('bc-title').value,
          body: document.getElementById('bc-body').value,
          link: document.getElementById('bc-link').value || null,
          audience: document.getElementById('bc-aud').value,
          role_code: document.getElementById('bc-role').value,
        });
        toast('Notification sent.', 'success');
        document.getElementById('bc-title').value = '';
        document.getElementById('bc-body').value = '';
      } catch (e) { toast(e.message, 'error'); }
    });
  },
});
