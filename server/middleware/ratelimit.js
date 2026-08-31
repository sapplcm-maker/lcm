/* In-memory sliding-window rate limiter (per process). */
'use strict';

const buckets = new Map();

function limiter(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { ok: b.count <= max, remaining: Math.max(0, max - b.count), resetAt: b.resetAt };
}

function clearKey(key) {
  buckets.delete(key);
}

module.exports = { limiter, clearKey };
