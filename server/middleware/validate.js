/* Input validation helpers. */
'use strict';

const esc = (v) => String(v ?? '').trim();

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const isInt = (v, min, max) => Number.isInteger(v) && (min === undefined || v >= min) && (max === undefined || v <= max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
const isUsername = (s) => /^[a-zA-Z0-9._-]{3,30}$/.test(s || '');

/** Returns missing required field names. */
function required(body, fields) {
  return fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
}

/** Password policy: min length + at least one letter and one digit. */
function passwordPolicy(pw, minLen) {
  if (!pw || pw.length < minLen) return `Password must be at least ${minLen} characters.`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}

module.exports = { esc, isDate, isTime, isInt, isEmail, isUsername, required, passwordPolicy };
