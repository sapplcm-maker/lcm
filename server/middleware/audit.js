/* Append-only audit logger. */
'use strict';
const { db } = require('../db');

function audit(req, action, entityType = null, entityId = null, details = {}) {
  try {
    db.prepare(
      `INSERT INTO audit_logs(user_id, username, action, entity_type, entity_id, details, ip_address)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      req.user ? req.user.id : null,
      req.user ? req.user.username : null,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      req.ip || null
    );
  } catch (e) {
    console.error('audit insert failed:', e.message);
  }
}

module.exports = { audit };
