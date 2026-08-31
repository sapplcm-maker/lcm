/* CSRF protection — double-submit cookie bound to the server-side session. */
'use strict';
const crypto = require('crypto');

const CSRF_COOKIE = 'lcm.csrf';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** Sets the CSRF cookie if absent. Exposed so the login page can bootstrap a token. */
function ensureCsrfCookie(req, res, next) {
  if (!req.cookies || !req.cookies[CSRF_COOKIE]) {
    const t = newToken();
    req.csrfCookieToken = t;
    res.cookie(CSRF_COOKIE, t, { httpOnly: false, sameSite: 'lax', secure: req.secure, path: '/' });
  }
  if (next) next();
}

/** For unsafe methods: header token must equal cookie token and (if logged in) session token. */
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) return next();
  const cookieTok = req.cookies ? req.cookies[CSRF_COOKIE] : undefined;
  const headerTok = req.headers['x-csrf-token'];
  if (!cookieTok || !headerTok || cookieTok !== headerTok) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Refresh the page and try again.' });
  }
  if (req.session && req.session.csrf_token && req.session.csrf_token !== headerTok) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  next();
}

/** Rotate the CSRF token after login and persist it to the session row. */
function rotateCsrf(res, sid) {
  const { db } = require('../db');
  const t = newToken();
  if (sid) db.prepare('UPDATE sessions SET csrf_token = ? WHERE sid = ?').run(t, sid);
  res.cookie(CSRF_COOKIE, t, { httpOnly: false, sameSite: 'lax', secure: res.req.secure, path: '/' });
  return t;
}

module.exports = { CSRF_COOKIE, ensureCsrfCookie, csrfProtect, rotateCsrf, newToken };
