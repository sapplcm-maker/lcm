/* API client — CSRF header, JSON handling, auth-error routing. */
'use strict';

const API = {
  csrf: null,

  async request(method, path, body, opts = {}) {
    const headers = {};
    if (API.csrf) headers['x-csrf-token'] = API.csrf;
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    if (opts.headers) Object.assign(headers, opts.headers);

    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined),
        credentials: 'same-origin',
      });
    } catch (e) {
      throw { status: 0, error: 'Network error — please check your connection.' };
    }

    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();

    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      App.sessionExpired();
      throw { status: 401, error: 'Session expired. Please sign in again.' };
    }
    if (res.status === 403 && data && data.error === 'PASSWORD_CHANGE_REQUIRED') {
      location.hash = '#/change-password';
      throw { status: 403, error: 'Please change your password to continue.' };
    }
    if (!res.ok) {
      const err = (data && data.error) || 'Request failed (' + res.status + ')';
      const ex = new Error(err);
      ex.status = res.status;
      ex.data = data;
      throw ex;
    }
    return data;
  },

  get: (p) => API.request('GET', p),
  post: (p, b) => API.request('POST', p, b || {}),
  put: (p, b) => API.request('PUT', p, b || {}),
  del: (p) => API.request('DELETE', p),
  upload: (p, formData) => API.request('POST', p, formData),
};

/* Helpers to build query strings */
function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
}
