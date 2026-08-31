/* RBAC middleware — role and permission guards. */
'use strict';

const ALLOWED_WHEN_PASSWORD_CHANGE_REQUIRED = ['/me', '/change-password', '/logout', '/csrf', '/sessions', '/settings-preview'];

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required. Please log in.' });
  if (req.user.must_change_password) {
    const ok = ALLOWED_WHEN_PASSWORD_CHANGE_REQUIRED.some((p) => req.path === p || req.path.startsWith(p));
    if (!ok) return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your password before continuing.' });
  }
  next();
}

function hasPerm(user, code) {
  return user.role_code === 'admin' || (user.perms || []).includes(code);
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!hasPerm(req.user, code)) return res.status(403).json({ error: 'Forbidden: you do not have permission for this action.' });
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role_code)) return res.status(403).json({ error: 'Forbidden: insufficient role.' });
    next();
  };
}

function requireAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

module.exports = { requireAuth, requirePermission, requireRole, requireAdmin, hasPerm };
