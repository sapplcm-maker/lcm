/* Schedule view — monthly calendar + management (admin/officer). */
'use strict';

Router.register('schedule', {
  title: 'Schedule',
  render: async (el) => {
    const canManage = App.can('schedule.manage');
    const today = new Date();
    let month = new Date().toISOString().slice(0, 7);
    const state = { month, canManage };

    const load = async () => {
      el.innerHTML = `
        <div class="card"><div class="card-head">
          <div class="cal-toolbar" style="margin:0">
            <h3 id="cal-title"></h3>
            <button class="btn btn-sm btn-ghost" id="cal-prev">‹</button>
            <button class="btn btn-sm btn-ghost" id="cal-today">Today</button>
            <button class="btn btn-sm btn-ghost" id="cal-next">›</button>
            <input type="month" id="cal-month" value="${month}" style="padding:6px 8px;border:1.5px solid var(--border);border-radius:7px" />
          </div>
          ${canManage ? `<button class="btn btn-sm btn-gold" id="sched-new">＋ New schedule</button>` : ''}
        </div>
        <div class="card-body" id="cal-body">${loadingHtml('Loading schedule…')}</div></div>`;
      const data = await API.get('/api/schedules' + qs({ month: state.month }));
      renderCalendar(data);
      document.getElementById('cal-title').textContent = new Date(state.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      bindCalControls();
    };

    const renderCalendar = (data) => {
      const [y, m] = state.month.split('-').map(Number);
      const firstDow = new Date(y, m - 1, 1).getDay();
      const daysInMonth = new Date(y, m, 0).getDate();
      const prevDays = new Date(y, m - 1, 0).getDate();
      const cells = [];
      for (let i = firstDow - 1; i >= 0; i--) cells.push({ day: prevDays - i, other: true });
      for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, other: false });
      while (cells.length % 7) cells.push({ day: cells.length % 7 === 0 ? 7 : (cells.length % 7) - 1 + 1, other: true, pad: true });

      const byDate = {};
      for (const s of data.schedules) {
        (byDate[s.schedule_date] = byDate[s.schedule_date] || []).push(s);
      }
      const todayStr = new Date().toISOString().slice(0, 10);
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let html = `<div class="cal-grid">${dow.map((d) => `<div class="cal-dow">${d}</div>`).join('')}`;
      for (const c of cells) {
        const dateStr = `${state.month}-${String(c.day).padStart(2, '0')}`;
        const dayScheds = c.other ? [] : (byDate[dateStr] || []);
        const chips = dayScheds.slice(0, 3).map((s) => {
          const mine = s.assignments.filter((a) => a.self);
          const label = state.canManage ? `${s.start_time} ${esc(s.title)}` : `${s.start_time} ${mine.map((a) => esc(a.role)).join(', ')}`;
          const cls = s.status === 'cancelled' ? 'gold' : (s.status === 'draft' && state.canManage ? 'navy' : '');
          return `<button class="cal-chip ${cls}" data-date="${dateStr}">${label}</button>`;
        }).join('');
        const extra = dayScheds.length > 3 ? `<button class="cal-chip more" data-date="${dateStr}">+${dayScheds.length - 3} more</button>` : '';
        html += `<div class="cal-cell ${c.other ? 'other' : ''} ${dateStr === todayStr ? 'today' : ''}">
          <span class="cal-num">${c.day}</span>${chips}${extra}</div>`;
      }
      html += '</div>';
      document.getElementById('cal-body').innerHTML = html;
      // day click → detail
      document.getElementById('cal-body').querySelectorAll('[data-date]').forEach((chip) => {
        chip.addEventListener('click', () => showDayDetail(byDate[chip.dataset.date] || [], chip.dataset.date));
      });
    };

    const showDayDetail = (schedules, dateStr) => {
      const modal = openModal({
        title: fmtDate(dateStr),
        wide: true,
        body: schedules.length ? schedules.map((s) => `
          <div class="card" style="margin-bottom:12px">
            <div class="card-head"><h3>${esc(s.title)}</h3>${badge(s.status)}</div>
            <div class="card-body">
              <p style="margin:0 0 8px">${esc(s.start_time)}${s.end_time ? ' – ' + esc(s.end_time) : ''} · ${esc(s.venue || 'Venue TBD')}</p>
              ${s.notes ? `<p style="margin:0 0 8px;font-size:13px;color:var(--muted)">${esc(s.notes)}</p>` : ''}
              <table class="data"><thead><tr><th>Member</th><th>Role</th><th>Status</th></tr></thead><tbody>
                ${s.assignments.map((a) => `<tr><td><span style="display:inline-flex;align-items:center;gap:8px">${avatarHtml(a, 'avatar avatar-sm')} ${esc(a.member)}</span></td><td>${esc(a.role)}</td><td>${badge(a.status)}</td></tr>`).join('')}
                ${!s.assignments.length ? '<tr><td colspan="3" style="color:var(--muted)">No assignments yet.</td></tr>' : ''}
              </tbody></table>
              ${state.canManage ? `<div class="row-actions" style="margin-top:10px">
                <button class="btn btn-sm btn-ghost" data-edit="${s.id}">Edit</button>
                ${s.status === 'draft' ? `<button class="btn btn-sm btn-teal" data-pub="${s.id}">Publish</button>` : ''}
                ${s.status !== 'cancelled' ? `<button class="btn btn-sm btn-ghost" data-cancel="${s.id}">Cancel</button>` : ''}
                <button class="btn btn-sm btn-ghost" data-assign="${s.id}">＋ Assign member</button>
              </div>` : ''}
            </div></div>`).join('')
        : emptyHtml('🗓️', 'No ministry schedule on this day.'),
      });
      if (state.canManage) {
        modal.el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { modal.close(); editSchedule(+b.dataset.edit); }));
        modal.el.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => { modal.close(); assignMember(+b.dataset.assign); }));
        modal.el.querySelectorAll('[data-pub]').forEach((b) => b.addEventListener('click', async () => {
          try { const r = await API.post(`/api/schedules/${b.dataset.pub}/publish`); toast(`Published — ${r.notified} member(s) notified.`, 'success'); modal.close(); load(); } catch (e) { toast(e.message, 'error'); }
        }));
        modal.el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
          confirmDlg('Cancel this schedule and notify assigned members?', { okLabel: 'Cancel schedule', danger: true, onOk: async () => {
            try { await API.post(`/api/schedules/${b.dataset.cancel}/cancel`); toast('Schedule cancelled.', 'success'); modal.close(); load(); } catch (e) { toast(e.message, 'error'); }
          } });
        }));
      }
    };

    const bindCalControls = () => {
      const [y, m] = state.month.split('-').map(Number);
      document.getElementById('cal-prev').addEventListener('click', () => { state.month = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`; load(); });
      document.getElementById('cal-next').addEventListener('click', () => { state.month = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`; load(); });
      document.getElementById('cal-today').addEventListener('click', () => { state.month = new Date().toISOString().slice(0, 7); load(); });
      document.getElementById('cal-month').addEventListener('change', (e) => { state.month = e.target.value; load(); });
      if (state.canManage) {
        document.getElementById('sched-new').addEventListener('click', () => editSchedule(null));
      }
    };

    // ---- Management ----
    const editSchedule = async (id) => {
      let s = null;
      if (id) {
        const r = await API.get('/api/schedules/' + id);
        s = r.schedule;
      }
      openModal({
        title: id ? 'Edit Schedule' : 'New Schedule',
        body: `
          <div class="form-grid">
            <div class="field full"><label>Title</label><input id="sch-title" value="${esc(s?.title || '')}" placeholder="e.g. Sunday Mass 8:00 AM" /></div>
            <div class="field"><label>Date</label><input id="sch-date" type="date" value="${esc(s?.schedule_date || '')}" /></div>
            <div class="field"><label>Start time</label><input id="sch-start" type="time" value="${esc(s?.start_time || '')}" /></div>
            <div class="field"><label>End time</label><input id="sch-end" type="time" value="${esc(s?.end_time || '')}" /></div>
            <div class="field"><label>Venue / location</label><input id="sch-venue" value="${esc(s?.venue || '')}" placeholder="e.g. Main Church" /></div>
            <div class="field full"><label>Notes</label><textarea id="sch-notes">${esc(s?.notes || '')}</textarea></div>
          </div>`,
        actions: [
          { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
          { key: 'save', label: 'Save', cls: 'btn-primary', onClick: async (close) => {
            const body = {
              title: document.getElementById('sch-title').value,
              schedule_date: document.getElementById('sch-date').value,
              start_time: document.getElementById('sch-start').value,
              end_time: document.getElementById('sch-end').value || null,
              venue: document.getElementById('sch-venue').value,
              notes: document.getElementById('sch-notes').value,
            };
            try {
              if (id) await API.put('/api/schedules/' + id, body); else await API.post('/api/schedules', body);
              toast('Schedule saved.', 'success'); close(); load();
            } catch (e) { toast(e.message, 'error'); }
          } },
        ],
      });
    };

    const assignMember = async (sid) => {
      const dir = await API.get('/api/members/directory');
      const active = dir.members;
      openModal({
        title: 'Assign Member',
        body: `
          <div class="form-grid">
            <div class="field full"><label>Member</label><select id="as-member">${active.map((m) => `<option value="${m.id}">${esc(m.last_name)}, ${esc(m.first_name)} (${esc(m.classification || '')})</option>`).join('')}</select></div>
            <div class="field"><label>Role / Ministry service</label>
              <select id="as-role">
                <option value="Lector (1st Reader)">Lector (1st Reader)</option>
                <option value="Lector (Psalm)">Lector (Psalm)</option>
                <option value="Lector (2nd Reader)">Lector (2nd Reader)</option>
                <option value="Lector (PNB)">Lector (PNB)</option>
                <option value="Commentator">Commentator</option>
                <option value="Server">Server</option>
                <option value="Usher / Greeter">Usher / Greeter</option>
                <option value="__other__">Other… (type below)</option>
              </select>
              <input id="as-role-other" class="hidden" placeholder="Type the role" style="margin-top:6px" />
            </div>
            <div class="field"><label>Status</label><select id="as-status"><option value="confirmed">Confirmed</option><option value="pending">Pending</option></select></div>
            <div class="field full"><label>Notes (reading, etc.)</label><input id="as-notes" /></div>
            <div class="field full"><label class="hint"><input type="checkbox" id="as-override" /> Allow despite conflict (overlap warning)</label></div>
          </div>`,
        actions: [
          { key: 'cancel', label: 'Cancel', cls: 'btn-ghost' },
          { key: 'save', label: 'Assign', cls: 'btn-primary', onClick: async (close) => {
            const roleSel = document.getElementById('as-role');
            const otherBox = document.getElementById('as-role-other');
            let role = roleSel.value;
            if (role === '__other__') role = (otherBox.value || '').trim();
            const body = {
              user_id: +document.getElementById('as-member').value,
              role,
              status: document.getElementById('as-status').value,
              notes: document.getElementById('as-notes').value,
              allow_conflict: document.getElementById('as-override').checked,
            };
            if (!body.role) return toast('Please enter a role.', 'error');
            try {
              const r = await API.post(`/api/schedules/${sid}/assignments`, body);
              toast(r.warning || 'Member assigned.', 'success'); close(); load();
            } catch (e) {
              if (e.data && e.data.conflicts && e.data.conflicts.length) {
                toast(e.message + ' Tick “Allow despite conflict” to override.', 'error');
              } else toast(e.message, 'error');
            }
          } },
        ],
      });
      // show the free-text box when "Other…" is chosen
      const roleSel = document.getElementById('as-role');
      const otherBox = document.getElementById('as-role-other');
      roleSel.addEventListener('change', () => {
        otherBox.classList.toggle('hidden', roleSel.value !== '__other__');
        if (roleSel.value === '__other__') otherBox.focus();
      });
    };

    // event delegation on the schedule container for manage actions
    el.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      const pub = e.target.closest('[data-pub]');
      const cancel = e.target.closest('[data-cancel]');
      const assign = e.target.closest('[data-assign]');
      if (edit) return editSchedule(+edit.dataset.edit);
      if (assign) return assignMember(+assign.dataset.assign);
      if (pub) {
        try { const r = await API.post(`/api/schedules/${pub.dataset.pub}/publish`); toast(`Published — ${r.notified} member(s) notified.`, 'success'); load(); } catch (err) { toast(err.message, 'error'); }
      }
      if (cancel) {
        confirmDlg('Cancel this schedule and notify assigned members?', { okLabel: 'Cancel schedule', danger: true, onOk: async () => {
          try { await API.post(`/api/schedules/${cancel.dataset.cancel}/cancel`); toast('Schedule cancelled.', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
        } });
      }
    });

    await load();
  },
});
