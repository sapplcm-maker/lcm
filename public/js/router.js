/* Hash router with permission guards and serialized rendering (no concurrent renders). */
'use strict';

const Router = {
  routes: {},
  _busy: false,
  _queued: false,

  register(name, def) {
    this.routes[name] = def;
  },

  parse() {
    let h = location.hash.replace(/^#\/?/, '');
    if (!h) h = 'dashboard';
    const [pathPart, queryPart] = h.split('?');
    const segs = pathPart.split('/').filter(Boolean);
    const params = {};
    for (const [k, v] of new URLSearchParams(queryPart || '').entries()) params[k] = v;
    return { segs, params };
  },

  async go() {
    // Serialize: only one render at a time; re-run after the current one finishes.
    if (this._busy) {
      this._queued = true;
      return;
    }
    this._busy = true;
    try {
      await this._render();
    } finally {
      this._busy = false;
      if (this._queued) {
        this._queued = false;
        this.go();
      }
    }
  },

  async _render() {
    const { segs, params } = this.parse();
    const key = segs[0] || 'dashboard';
    // If unauthenticated, never render views (the login screen is shown instead).
    if (!App.user && key !== 'login') {
      document.getElementById('main').innerHTML = '';
      return;
    }
    const def = this.routes[key];
    if (!def) {
      location.hash = '#/dashboard';
      return;
    }
    if (def.perm && !App.can(def.perm)) {
      toast('You do not have access to that section.', 'error');
      location.hash = '#/dashboard';
      return;
    }
    if (App.user && App.user.must_change_password && key !== 'change-password' && key !== 'settings' && key !== 'profile' && key !== 'logout') {
      location.hash = '#/change-password';
      return;
    }
    App.setTitle(def.title);
    App.markNav(key);
    const el = document.getElementById('main');
    el.innerHTML = loadingHtml();
    try {
      await def.render(el, segs, params);
    } catch (e) {
      console.error(e);
      el.innerHTML = emptyHtml('⚠️', e.message || 'Something went wrong while loading this page.');
    }
    el.scrollTop = 0;
    window.scrollTo(0, 0);
  },
};
