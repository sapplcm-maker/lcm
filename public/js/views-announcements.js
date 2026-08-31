/* Announcements view — list, detail, management (admin/officer). */
'use strict';

Router.register('announcements', {
  title: 'Announcements',
  render: async (el, segs) => {
    const canManage = App.can('announcements.manage');
    if (segs[1]) return showDetail(el, +segs[1]);

    el.innerHTML = `<div class="card"><div class="card-head">
        <h3>${canManage ? 'Announcement Management' : 'Announcements'}</h3>
        <div>
          ${canManage ? `<button class="btn btn-sm btn-gold" id="ann-new">＋ New announcement</button>` : ''}
        </div>
      </div>
      <div class="card-body" style="padding:0" id="ann-list">${loadingHtml()}</div></div>`;

    // Connect the button FIRST — it must work even when the list is empty.
    const newBtn = document.getElementById('ann-new');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        try {
          openAnnouncementEditor(null);
        } catch (e) {
          console.error(e);
          toast('Error opening the announcement window: ' + e.message, 'error', 10000);
        }
      });
    }

    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const status = canManage ? (params.get('status') || '') : '';
    const { announcements } = await API.get('/api/announcements' + qs({ status, mine: params.get('mine') || '' }));

    const list = document.getElementById('ann-list');
    if (!announcements.length) {
      list.innerHTML = emptyHtml('📣', 'No announcements yet.', canManage ? 'Click "＋ New announcement" to create the first one.' : '');
      return;
    }

    list.innerHTML = announcements.map((a) => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid #eef0f4">
        <div style="flex:1;min-width:0">
          <a href="#/announcements/${a.id}" style="font-weight:600;font-size:15px">${esc(a.title)}</a>
          ${a.status === 'published' && a.expires_at && a.expires_at < new Date().toISOString().slice(0,10) ? ' <span class="badge badge-grey">Expired</span>' : badge(a.status)}
          <div style="font-size:12px;color:var(--muted);margin-top:3px">
            ${fmtDateTime(a.published_at || a.created_at)} · by ${esc(a.first_name)} ${esc(a.last_name)}
            ${a.publish_at && a.status === 'draft' ? ` · publishes ${fmtDate(a.publish_at)}` : ''}
            ${a.status === 'draft' ? ' <span class="badge badge-orange">Members can’t see this yet</span>' : ''}
            ${a.attachment_count ? ` · ${a.attachment_count} attachment(s)` : ''}
          </div>
        </div>
        <div class="row-actions">
          <a class="btn btn-sm btn-ghost" href="#/announcements/${a.id}">View</a>
          ${canManage && (a.status === 'draft' || a.status === 'published') ? `<button class="btn btn-sm btn-outline" data-edit="${a.id}">Edit</button>` : ''}
          ${canManage && a.status === 'draft' ? `<button class="btn btn-sm btn-teal" data-pub="${a.id}">Publish</button>` : ''}
          ${canManage && a.status === 'published' ? `<button class="btn btn-sm btn-ghost" data-archive="${a.id}">Archive</button>` : ''}
          ${canManage && (a.status === 'draft' || a.status === 'archived') ? `<button class="btn btn-sm btn-danger" data-delann="${a.id}">Delete</button>` : ''}
        </div>
      </div>`).join('');

    bindEvents(list, {
      'click [data-edit]': (e, b) => { const a = announcements.find((x) => x.id === +b.dataset.edit); openAnnouncementEditor(a); },
      'click [data-pub]': async (e, b) => {
        try { const r = await API.post(`/api/announcements/${b.dataset.pub}/publish`); toast(`Published — ${r.notified} member(s) notified.`, 'success'); Router.go(); }
        catch (err) { toast(err.message, 'error'); }
      },
      'click [data-archive]': (e, b) => {
        confirmDlg('Archive this announcement? Members will no longer see it in their lists.', { okLabel: 'Archive', onOk: async () => {
          try { await API.post(`/api/announcements/${b.dataset.archive}/archive`); toast('Announcement archived.', 'success'); Router.go(); }
          catch (err) { toast(err.message, 'error'); }
        } });
      },
      'click [data-delann]': (e, b) => {
        confirmDlg('Delete this announcement permanently? This cannot be undone.', { okLabel: 'Delete', danger: true, onOk: async () => {
          try { await API.del('/api/announcements/' + b.dataset.delann); toast('Announcement deleted.', 'success'); Router.go(); }
          catch (err) { toast(err.message, 'error'); }
        } });
      },
    });

  },
});

/* ---------------- Create / edit modal (module scope — used by list & detail) ---------------- */
async function openAnnouncementEditor(a, onDone) {
  const canPublish = App.can('announcements.publish');
  let current = a;

  const showErr = (msg) => {
    const box = document.getElementById('an-error');
    box.textContent = msg;
    box.classList.remove('hidden');
  };

  const renderAttachments = () => {
    const box = document.getElementById('an-attach');
    const atts = current ? (current.attachments || []) : [];
    box.innerHTML = (atts.length ? atts.map((at) => {
      const isImg = (at.mime_type || '').startsWith('image/');
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;flex-wrap:wrap">
        ${isImg ? `<img src="/api/files/${esc(at.stored_name)}" alt="" style="height:42px;width:42px;object-fit:cover;border-radius:6px" />` : '📎'}
        <span style="font-size:13px">${esc(at.original_name)} (${(at.size / 1024).toFixed(0)} KB)</span>
        <button class="btn btn-sm btn-ghost" data-delatt="${at.id}">Remove</button>
      </div>`;
    }).join('') : '') + `
      <div style="margin-top:6px">
        <label class="btn btn-sm btn-outline" for="an-file">📷 ＋ Add photo / file</label>
        <input type="file" id="an-file" class="hidden" accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.txt,.doc,.docx,.xls,.xlsx" />
        <span class="hint" style="margin-left:8px">Photos appear inside the announcement; other files become downloads. You can add them before or after publishing.</span>
      </div>`;
    const fileInput = document.getElementById('an-file');
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { showErr('The file must be 10 MB or smaller.'); fileInput.value = ''; return; }
      try {
        // If the announcement doesn't exist yet, auto-save it as a draft first
        // so the photo has a place to live — no "save first" trap.
        if (!current) {
          const title = (document.getElementById('an-title').value || '').trim() || 'Announcement';
          const body = (document.getElementById('an-body').value || '').trim() || '';
          const r = await API.post('/api/announcements', { title, body, publish: false });
          current = { id: r.id, status: 'draft', attachments: [] };
          toast('Saved as draft — adding your photo…', 'info');
        }
        const fd = new FormData();
        fd.append('file', f);
        await API.upload(`/api/announcements/${current.id}/attachments`, fd);
        const r = await API.get('/api/announcements/' + current.id);
        current.attachments = r.announcement.attachments;
        renderAttachments();
        toast('Photo/file added. It will appear with the announcement.', 'success');
      } catch (e) { showErr(e.message); }
    });
    box.querySelectorAll('[data-delatt]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await API.del('/api/announcements/attachments/' + b.dataset.delatt);
        const r = await API.get('/api/announcements/' + current.id);
        current.attachments = r.announcement.attachments;
        renderAttachments();
        toast('Attachment removed.', 'success');
      } catch (e) { showErr(e.message); }
    }));
  };

  async function onSave(close, publishNow) {
    const errBox = document.getElementById('an-error');
    errBox.classList.add('hidden');
    const body = {
      title: document.getElementById('an-title').value,
      body: document.getElementById('an-body').value,
      publish_at: document.getElementById('an-pub').value || null,
      expires_at: document.getElementById('an-exp').value || null,
    };
    if (!body.title || !body.body) { errBox.textContent = 'Please enter both a title and the announcement text.'; errBox.classList.remove('hidden'); return; }
    if (publishNow && !canPublish) { errBox.textContent = 'You do not have permission to publish announcements.'; errBox.classList.remove('hidden'); return; }
    try {
      if (current) {
        await API.put(`/api/announcements/${current.id}`, body);
        if (publishNow && current.status === 'draft') await API.post(`/api/announcements/${current.id}/publish`);
      } else {
        const r = await API.post('/api/announcements', { ...body, publish: publishNow });
        if (r.notified) toast(`Published — ${r.notified} member(s) notified.`, 'success');
      }
      toast(publishNow ? 'Announcement published — members can now see it.' : 'Saved as DRAFT — members can’t see it yet. Click “Publish now” when ready.', publishNow ? 'success' : 'warn');
      close();
      if (onDone) onDone();
      else Router.go();
    } catch (e) { errBox.textContent = e.message; errBox.classList.remove('hidden'); }
  }

  const modal = openModal({
    title: current ? 'Edit Announcement' : 'New Announcement',
    wide: true,
    body: `
      <div id="an-error" class="form-error hidden" role="alert"></div>
      <div class="form-grid" style="margin-top:12px">
        <div class="field full"><label>Title</label><input id="an-title" value="${esc(current?.title || '')}" /></div>
        <div class="field full"><label>Announcement text</label><textarea id="an-body" style="min-height:140px">${esc(current?.body || '')}</textarea>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-outline" id="an-addlink">🔗 Add link</button>
            <span class="hint">Links like https://example.org become clickable automatically.</span>
          </div></div>
        <div class="field"><label>Publish date</label><input id="an-pub" type="date" value="${esc(current?.publish_at || '')}" /></div>
        <div class="field"><label>Expiration date (optional)</label><input id="an-exp" type="date" value="${esc(current?.expires_at || '')}" /></div>
        <div class="field full"><label>Photos &amp; files</label><div id="an-attach"></div></div>
      </div>`,
    actions: [
      { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
      ...(canPublish && (!current || current.status === 'draft') ? [{ key: 'pub', label: 'Publish now', cls: 'btn-teal' }] : []),
      { key: 'save', label: current ? 'Save changes' : 'Save draft', cls: 'btn-primary' },
    ],
  });

  modal.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mact]');
    if (!b) return;
    if (b.dataset.mact === 'save') onSave(modal.close, false);
    if (b.dataset.mact === 'pub') onSave(modal.close, true);
  });

  document.getElementById('an-addlink').addEventListener('click', () => {
    const url = prompt('Paste the web link (https://…):');
    if (!url) return;
    const ta = document.getElementById('an-body');
    ta.value = (ta.value ? ta.value + '\n' : '') + '🔗 ' + url;
    ta.focus();
  });

  renderAttachments();
}

/* ---------------- Detail view ---------------- */
async function showDetail(el, id) {
  const { announcement: a } = await API.get('/api/announcements/' + id);
  const canManage = App.can('announcements.manage');
  const isAuthor = App.user && a.author_id === App.user.id;
  const canAct = canManage && (isAuthor || App.user.role_code === 'admin');
  el.innerHTML = `
    <div class="card" style="max-width:820px;margin:0 auto">
      <div class="card-head"><h3>${esc(a.title)}</h3>${badge(a.status)}</div>
      <div class="card-body">
        <p style="font-size:13px;color:var(--muted);margin:0 0 14px">
          Published ${fmtDateTime(a.published_at || a.created_at)} · by ${esc(a.first_name)} ${esc(a.last_name)}
          ${a.expires_at ? ` · expires ${fmtDate(a.expires_at)}` : ''}
          ${a.updated_at !== a.created_at ? ` · edited ${fmtDateTime(a.updated_at)}` : ''}
        </p>
        <div style="white-space:pre-wrap;line-height:1.65" id="ann-body">${esc(a.body)}</div>
        ${a.attachments.length ? `<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:12px">
          <strong style="font-size:13px">Photos &amp; files</strong>
          ${a.attachments.map((at) => {
            const isImg = (at.mime_type || '').startsWith('image/');
            return `<div style="margin-top:8px">
              ${isImg ? `<img src="/api/files/${esc(at.stored_name)}" alt="${esc(at.original_name)}" style="max-height:220px;border-radius:8px;display:block;margin-bottom:6px;max-width:100%" />` : ''}
              <a class="btn btn-sm btn-ghost" href="/api/files/${esc(at.stored_name)}">📎 Download ${esc(at.original_name)} (${(at.size / 1024).toFixed(0)} KB)</a>
            </div>`;
          }).join('')}
        </div>` : ''}
        <div class="row-actions" style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px">
          <a class="btn btn-sm btn-ghost" href="#/announcements">← Back</a>
          ${canAct ? `
            ${a.status === 'draft' || a.status === 'published' ? `<button class="btn btn-sm btn-outline" id="ad-edit">Edit</button>` : ''}
            ${a.status === 'draft' ? `<button class="btn btn-sm btn-teal" id="ad-publish">Publish</button>` : ''}
            ${a.status === 'published' ? `<button class="btn btn-sm btn-ghost" id="ad-archive">Archive</button>` : ''}
            ${a.status === 'draft' || a.status === 'archived' ? `<button class="btn btn-sm btn-danger" id="ad-delete">Delete</button>` : ''}
          ` : ''}
        </div>
      </div></div>`;

  // render links in body
  const bodyEl = document.getElementById('ann-body');
  if (bodyEl) {
    bodyEl.innerHTML = esc(a.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  const edit = document.getElementById('ad-edit');
  if (edit) edit.addEventListener('click', () => openAnnouncementEditor(a, () => showDetail(el, a.id)));
  const pub = document.getElementById('ad-publish');
  if (pub) pub.addEventListener('click', async () => {
    try { const r = await API.post(`/api/announcements/${a.id}/publish`); toast(`Published — ${r.notified} member(s) notified.`, 'success'); showDetail(el, a.id); } catch (e) { toast(e.message, 'error'); }
  });
  const arc = document.getElementById('ad-archive');
  if (arc) arc.addEventListener('click', async () => {
    confirmDlg('Archive this announcement? Members will no longer see it.', { okLabel: 'Archive', onOk: async () => {
      try { await API.post(`/api/announcements/${a.id}/archive`); toast('Archived.', 'success'); showDetail(el, a.id); } catch (e) { toast(e.message, 'error'); }
    } });
  });
  const del = document.getElementById('ad-delete');
  if (del) del.addEventListener('click', () => {
    confirmDlg('Delete this announcement permanently? This cannot be undone.', { okLabel: 'Delete', danger: true, onOk: async () => {
      try { await API.del('/api/announcements/' + a.id); toast('Announcement deleted.', 'success'); location.hash = '#/announcements'; } catch (e) { toast(e.message, 'error'); }
    } });
  });
}
