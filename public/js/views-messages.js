/* Internal messaging — thread list, conversation, compose, edit/delete own. */
'use strict';

Router.register('messages', {
  title: 'Messages',
  render: async (el, segs) => {
    const threadId = segs[1] ? +segs[1] : null;
    let html = `
      <div class="card"><div class="card-head">
        <h3>Messages</h3>
        <button class="btn btn-sm btn-gold" id="msg-new">＋ New message</button>
      </div></div>
      <div class="msg-layout" style="margin-top:16px">
        <div class="card" style="align-self:start">
          <div style="padding:12px"><input id="msg-search" class="search-input" style="width:100%" placeholder="Search conversations…" /></div>
          <div id="msg-threads" style="max-height:62vh;overflow-y:auto">${loadingHtml()}</div>
        </div>
        <div class="card" id="msg-conv">${threadId ? loadingHtml('Loading conversation…') : emptyHtml('💬', 'Select a conversation', 'or start a new message.')}</div>
      </div>`;
    el.innerHTML = html;

    const loadThreads = async () => {
      const { threads } = await API.get('/api/messages/threads');
      const box = document.getElementById('msg-threads');
      if (!threads.length) { box.innerHTML = emptyHtml('💬', 'No conversations yet.'); return; }
      box.innerHTML = threads.map((t) => {
        const otherNames = t.others.map((o) => `${o.first_name} ${o.last_name}`).join(', ');
        const selfOnly = t.others.length === 0;
        return `<div class="thread-item ${t.unread ? 'unread' : ''} ${threadId === t.id ? 'active' : ''}" data-thread="${t.id}">
          ${t.others.length ? avatarHtml(t.others[0], 'avatar') : `<span class="avatar">${initials(App.user.first_name, App.user.last_name)}</span>`}
          <div class="t-meta">
            <div class="t-name"><span>${esc(selfOnly ? 'Note to self' : otherNames)}</span><span style="font-size:11px;color:var(--muted)">${timeAgo(t.last_at)}</span></div>
            <div class="t-preview">${t.last_body ? esc(t.last_body) : ''}</div>
          </div>
          ${t.unread ? `<span class="badge badge-red">${t.unread}</span>` : ''}
        </div>`;
      }).join('');
      box.querySelectorAll('.thread-item').forEach((item) => item.addEventListener('click', () => {
        location.hash = `#/messages/${item.dataset.thread}`;
      }));
    };

    const loadConversation = async (id) => {
      const conv = document.getElementById('msg-conv');
      try {
        const { thread, participants, messages } = await API.get('/api/messages/threads/' + id);
        const others = participants.filter((p) => p.id !== App.user.id);
        const title = thread.title || others.map((o) => `${o.first_name} ${o.last_name}`).join(', ');
        const isMyThread = thread.created_by === App.user.id;
        conv.innerHTML = `
          <div class="card-head"><h3>${esc(title)}</h3>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-sm btn-ghost" id="conv-reload">↻</button>
            </div></div>
          <div class="msg-bubbles" id="msg-bubbles">
            ${messages.map((m) => {
              if (m.status === 'deleted') return `<div class="bubble ${m.own ? 'mine' : 'theirs'} deleted">This message was deleted.</div>`;
              return `<div class="bubble ${m.own ? 'mine' : 'theirs'}">
                ${m.own ? '' : `<div style="font-size:11px;font-weight:700;margin-bottom:2px">${esc(m.first_name)} ${esc(m.last_name)}</div>`}
                <div style="white-space:pre-wrap">${esc(m.body)}</div>
                ${m.attachments.length ? m.attachments.map((at) => `<div style="margin-top:5px"><a class="btn btn-xs btn-ghost" href="/api/files/${esc(at.stored_name)}" style="font-size:12px;padding:3px 8px">📎 ${esc(at.original_name)}</a></div>`).join('') : ''}
                <div class="b-meta">
                  <span>${fmtDateTime(m.created_at)}</span>
                  ${m.status === 'edited' ? '<span>(edited)</span>' : ''}
                  ${m.own ? `<button class="link-btn" data-medit="${m.id}" style="font-size:11px">Edit</button>
                    <button class="link-btn" data-mdel="${m.id}" style="font-size:11px;color:var(--red)">Delete</button>` : ''}
                </div>
              </div>`;
            }).join('') || emptyHtml('💬', 'No messages yet.')}
          </div>
          <div class="compose-bar">
            <textarea id="msg-body" placeholder="Type a message…" aria-label="Message body"></textarea>
            <div style="display:flex;flex-direction:column;gap:6px">
              <label class="btn btn-sm btn-ghost" for="msg-file" title="Attach a file">📎</label>
              <input type="file" id="msg-file" class="hidden" accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx" />
              <button class="btn btn-sm btn-primary" id="msg-send">Send</button>
            </div>
          </div>`;
        const bubbles = document.getElementById('msg-bubbles');
        bubbles.scrollTop = bubbles.scrollHeight;

        const send = async () => {
          const body = document.getElementById('msg-body').value;
          const file = document.getElementById('msg-file').files[0];
          if (!body.trim() && !file) return toast('Type a message first.', 'warn');
          const fd = new FormData();
          fd.append('body', body);
          if (file) fd.append('file', file);
          try {
            await API.upload(`/api/messages/threads/${id}/messages`, fd);
            document.getElementById('msg-body').value = '';
            document.getElementById('msg-file').value = '';
            await loadConversation(id);
            await loadThreads();
            App.refreshBadges();
          } catch (e) { toast(e.message, 'error'); }
        };
        document.getElementById('msg-send').addEventListener('click', send);
        document.getElementById('msg-body').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        document.getElementById('conv-reload').addEventListener('click', () => loadConversation(id));
        bubbles.querySelectorAll('[data-medit]').forEach((b) => b.addEventListener('click', () => editMessage(id, +b.dataset.medit)));
        bubbles.querySelectorAll('[data-mdel]').forEach((b) => b.addEventListener('click', () => {
          confirmDlg('Delete this message? Others will see “message deleted”.', { okLabel: 'Delete', danger: true, onOk: async () => {
            try { await API.del('/api/messages/' + b.dataset.mdel); await loadConversation(id); } catch (e) { toast(e.message, 'error'); }
          } });
        }));
      } catch (e) {
        conv.innerHTML = emptyHtml('🚫', e.message);
      }
    };

    const editMessage = (threadId, msgId) => {
      const bubble = document.querySelector(`[data-medit="${msgId}"]`)?.closest('.bubble');
      if (!bubble) return;
      const bodyDiv = bubble.querySelector('div[style*="white-space"]') || bubble.firstElementChild.nextElementSibling;
      const oldText = bubble.textContent.match(/Edit|Delete/) ? '' : '';
      const text = bodyDiv ? bodyDiv.textContent : '';
      const ta = document.createElement('textarea');
      ta.value = text.trim();
      ta.className = 'field';
      ta.style.cssText = 'width:100%;min-height:70px;padding:8px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit';
      bodyDiv.replaceWith(ta);
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-sm btn-primary';
      saveBtn.textContent = 'Save edit';
      saveBtn.style.marginTop = '6px';
      ta.after(saveBtn);
      saveBtn.addEventListener('click', async () => {
        try { await API.put('/api/messages/' + msgId, { body: ta.value }); await loadConversation(threadId); }
        catch (e) { toast(e.message, 'error'); }
      });
    };

    const compose = async () => {
      const dir = await API.get('/api/members/directory');
      const members = dir.members.filter((m) => m.id !== App.user.id);
      openModal({
        title: 'New Message',
        body: `
          <div class="form-grid">
            <div class="field full"><label>Recipients</label>
              <div id="comp-recipients" style="max-height:200px;overflow-y:auto;border:1.5px solid var(--border);border-radius:7px;padding:8px">
                ${members.map((m) => `<label style="display:flex;gap:8px;padding:4px 6px;align-items:center;font-size:14px;cursor:pointer">
                  <input type="checkbox" value="${m.id}" class="comp-recip" /> ${esc(m.first_name)} ${esc(m.last_name)} <span style="color:var(--muted);font-size:12px">(${esc(m.classification || '')})</span>
                </label>`).join('')}
              </div></div>
            <div class="field full"><label>Message</label><textarea id="comp-body" style="min-height:110px"></textarea></div>
          </div>`,
        actions: [
          { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
          { key: 'send', label: 'Send', cls: 'btn-primary', onClick: async (close) => {
            const ids = [...document.querySelectorAll('.comp-recip:checked')].map((c) => +c.value);
            const body = document.getElementById('comp-body').value;
            if (!ids.length) return toast('Select at least one recipient.', 'error');
            if (!body.trim()) return toast('Message body is required.', 'error');
            try {
              const r = await API.post('/api/messages/threads', { participantIds: ids, body });
              toast('Message sent.', 'success');
              close();
              location.hash = '#/messages/' + r.thread_id;
            } catch (e) { toast(e.message, 'error'); }
          } },
        ],
      });
    };

    document.getElementById('msg-new').addEventListener('click', compose);
    document.getElementById('msg-search').addEventListener('input', async (e) => {
      const { threads } = await API.get('/api/messages/threads' + qs({ q: e.target.value }));
      const box = document.getElementById('msg-threads');
      box.innerHTML = threads.length ? threads.map((t) => `<div class="thread-item" data-thread="${t.id}">
        ${avatarHtml(t.others[0], 'avatar')}<div class="t-meta"><div class="t-name">${esc(t.others.map((o) => o.first_name + ' ' + o.last_name).join(', ') || 'Note to self')}</div><div class="t-preview">${esc(t.last_body || '')}</div></div></div>`).join('')
        : emptyHtml('🔍', 'No conversations match.');
      box.querySelectorAll('.thread-item').forEach((i) => i.addEventListener('click', () => location.hash = '#/messages/' + i.dataset.thread));
    });

    await loadThreads();
    if (threadId) await loadConversation(threadId);
  },
});
