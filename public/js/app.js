/* Application bootstrap — session, navigation, shell. */
'use strict';

window.APP_VERSION = 'v8';;;;;;

const App = {
  user: null,
  committees: [],
  settings: {},
  profile: {},

  can(perm) {
    if (!this.user) return false;
    if (this.user.role_code === 'admin') return true;
    return (this.user.perms || []).includes(perm);
  },

  async boot() {
    // CSRF bootstrap
    try {
      const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const d = await r.json();
      API.csrf = d.token;
    } catch (_) { /* server down — login will show error */ }

    const me = await API.get('/api/auth/me').catch(() => null);
    if (me && me.user) {
      this.user = me.user;
      this.committees = me.committees || [];
      this.settings = me.settings || {};
      this.profile = me.profile || {};
      this.showApp();
      this.refreshBadges();
      window.addEventListener('hashchange', () => Router.go());
      Router.go();
      // periodic badge refresh
      setInterval(() => this.refreshBadges(), 60000);
    } else {
      this.showLogin();
    }
  },

  showLogin() {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    const title = document.getElementById('login-title');
    const sub = document.getElementById('login-sub');
    if (this.settings && this.settings.site_name) title.textContent = this.settings.site_name;
    if (this.settings && this.settings.org_name) sub.textContent = this.settings.org_name + (this.settings.org_location ? ' · ' + this.settings.org_location : '');
    this.bindLogin();
  },

  bindLogin() {
    if (this._loginBound) return; // idempotent — the login view is never re-created
    this._loginBound = true;
    const form = document.getElementById('login-form');
    const errBox = document.getElementById('login-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const r = await API.post('/api/auth/login', {
          username: document.getElementById('login-username').value,
          password: document.getElementById('login-password').value,
        });
        API.csrf = r.token;
        this.settings = r.settings || {};
        if (r.must_change_password) {
          const me = await API.get('/api/auth/me');
          this.user = me.user;
          this.showApp();
          this.refreshBadges();
          location.hash = '#/change-password';
        } else {
          location.reload();
        }
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
    document.getElementById('forgot-btn').addEventListener('click', async () => {
      const username = prompt('Enter your username to request a password reset:');
      if (!username) return;
      try {
        const r = await API.post('/api/auth/forgot-password', { username });
        toast(r.message || 'Request sent.', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  },

  showApp() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    this.renderShell();
    this.bindShell();
  },

  renderShell() {
    const u = this.user;
    const ver = document.getElementById('app-version');
    if (ver) ver.textContent = 'Portal ' + (window.APP_VERSION || '');
    document.getElementById('side-avatar').innerHTML = avatarHtml(u);
    document.getElementById('side-name').textContent = `${u.first_name} ${u.last_name}`;
    document.getElementById('side-role').textContent = u.role_name;
    document.getElementById('top-avatar').innerHTML = avatarHtml(u);
    document.getElementById('top-name').textContent = `${u.first_name} ${u.last_name}`;
    document.getElementById('top-role').textContent = u.role_name;

    const mainNav = [
      { key: 'dashboard', label: 'Dashboard', ico: '🏠', perm: null },
      { key: 'schedule', label: 'Schedule', ico: '🗓️', perm: null },
      { key: 'announcements', label: 'Announcements', ico: '📣', perm: null },
      { key: 'messages', label: 'Messages', ico: '💬', perm: 'messages.use' },
      { key: 'directory', label: 'Member Directory', ico: '👥', perm: 'members.view' },
      { key: 'profile', label: 'Profile', ico: '👤', perm: null },
      { key: 'evaluations', label: 'Evaluations', ico: '⭐', perm: 'own.results' },
      { key: 'notifications', label: 'Notifications', ico: '🔔', perm: null },
      { key: 'settings', label: 'Settings', ico: '⚙️', perm: null },
    ];
    const manageNav = [
      { key: 'members', label: 'Members', ico: '👥', perm: 'members.view' },
      { key: 'roles', label: 'Roles & Permissions', ico: '🛡️', perm: 'roles.manage' },
      { key: 'classifications', label: 'Classifications', ico: '🏷️', perm: 'classifications.manage' },
      { key: 'committees', label: 'Committees', ico: '📋', perm: 'committees.manage' },
      { key: 'broadcast', label: 'Send Notification', ico: '📢', perm: 'notifications.broadcast' },
      { key: 'approvals', label: 'Approval Center', ico: '✅', perm: 'evaluations.approve' },
      { key: 'reports', label: 'Reports', ico: '📊', perm: 'reports.view' },
      { key: 'audit', label: 'Audit Logs', ico: '🧾', perm: 'audit.view' },
      { key: 'syssettings', label: 'System Settings', ico: '🔧', perm: 'settings.manage' },
    ];
    const mk = (items) => items.filter((i) => !i.perm || this.can(i.perm)).map((i) => `<a href="#/${i.key}"><span class="nav-ico">${i.ico}</span>${i.label}</a>`).join('');
    document.getElementById('nav-main').innerHTML = mk(mainNav);
    const manage = mk(manageNav);
    document.getElementById('nav-manage').innerHTML = manage ? `<div class="nav-title">Management</div>${manage}` : '';
  },

  bindShell() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try { await API.post('/api/auth/logout'); } catch (_) {}
      location.hash = '';
      location.reload();
    });
    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-backdrop').classList.add('show');
    });
    const closeSidebar = () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('show');
    };
    document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
    document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
  },

  setTitle(t) {
    document.getElementById('page-title').textContent = t;
    document.title = t + ' · ' + (this.settings.site_name || 'LCM Ministry Portal');
  },

  markNav(key) {
    document.querySelectorAll('.nav a').forEach((a) => {
      const active = a.getAttribute('href') === '#/' + key;
      a.classList.toggle('active', active);
    });
  },

  async refreshBadges() {
    if (!this.user) return;
    try {
      const [n, m] = await Promise.all([
        API.get('/api/notifications/unread-count'),
        API.get('/api/messages/unread-count'),
      ]);
      const nb = document.getElementById('notif-badge');
      const mb = document.getElementById('msg-badge');
      if (nb) { nb.classList.toggle('hidden', !n.count); nb.textContent = n.count > 9 ? '9+' : n.count; }
      if (mb) { mb.classList.toggle('hidden', !m.count); mb.textContent = m.count > 9 ? '9+' : m.count; }
    } catch (_) {}
  },

  async refreshMe() {
    try {
      const me = await API.get('/api/auth/me');
      this.user = me.user;
      this.committees = me.committees || [];
      this.settings = me.settings || {};
      this.profile = me.profile || {};
      this.renderShell();
    } catch (_) {}
  },

  sessionExpired() {
    this.user = null;
    location.hash = '';
    if (!document.getElementById('login-view').classList.contains('hidden')) return;
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  },
};

// Surface unexpected errors as visible toasts (helps non-technical users report issues)
let lastErrToast = 0;
window.addEventListener('error', (e) => {
  const now = Date.now();
  if (now - lastErrToast > 8000) {
    lastErrToast = now;
    toast('Something went wrong: ' + (e.message || 'unknown error'), 'error', 9000);
  }
  console.error(e.error || e.message);
});

document.addEventListener('DOMContentLoaded', () => App.boot());
