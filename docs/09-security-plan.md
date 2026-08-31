# 9. Security Plan

Security and privacy are core requirements. Controls are applied at **every layer** — network, application, data — with the evaluation confidentiality rule enforced at the data layer.

## 9.1 Authentication & Sessions

| Control | Implementation |
|---|---|
| Password hashing | bcrypt (cost 10); **no plaintext ever stored or logged** |
| Password policy | Min 8 chars, must contain letter + number; enforced on create/change/reset |
| First-login enforcement | Admin-created/reset accounts get `must_change_password`; forced change screen |
| Session storage | Server-side SQLite `sessions`; httpOnly, `SameSite=Lax`, `Secure` when HTTPS; sliding expiry (24 h inactivity, 7 d absolute) |
| Session revocation | User can list & revoke own sessions; admin can revoke any user's sessions |
| Login rate limiting | 5 failed attempts / 15 min per IP and per username; audit logged |
| Forgot password | Admin-initiated reset → temp password + forced change; hashed reset tokens with expiry |

## 9.2 Authorization (RBAC)

- Roles + permission codes stored in DB; `requirePermission(code)` middleware on every protected route.
- Admin role bypasses by design; committee evaluation access additionally scoped by `committee_members` membership.
- Every endpoint re-checks the *resource owner* (e.g., a member may only read their own profile/results; thread access requires participation).

## 9.3 Web Attack Mitigations

| Threat | Mitigation |
|---|---|
| SQL injection | Prepared statements only (better-sqlite3); no string-concatenated SQL |
| XSS | HTML-escape all user content on render; Content-Security-Policy header; no `innerHTML` with unescaped data |
| CSRF | Double-submit token bound to session; required on all mutating requests |
| Session fixation/hijack | New session id on login; httpOnly cookies; IP/UA recorded; revocation |
| Upload attacks | MIME + extension allowlist (jpg/png/webp/gif; docs for attachments), magic-byte sniffing, size caps (2 MB photos, 10 MB attachments), randomized stored filenames, files served from a dedicated non-executable `/uploads` path with `Content-Disposition` on download |
| Rate abuse | Login limiter + submission throttling on evaluation/message endpoints |
| Broken access control | Central RBAC + ownership checks; tested negative cases (403) |
| Open redirect | Login/redirect endpoints only accept relative/internal targets |
| Header hardening | `helmet` (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS when HTTPS) |

## 9.4 Evaluation Confidentiality (Data-Layer Enforcement)

- Member results endpoint filters `status='released'` **in SQL**.
- Unreleased data is never serialized to the member's session, regardless of UI state.
- Evaluation comments expose only rows with `is_visible_to_member = 1`; evaluator identities are never included in member-facing payloads.
- Admin notes are separate from member-visible feedback.

## 9.5 Audit Trail

`audit_logs` records: actor (user id + username), action, entity type/id, details (JSON), IP, UTC timestamp — for logins, member CRUD, classification/role changes, password resets, schedule create/edit/publish/cancel, announcement publish, message deletes, evaluation draft/submit/approve/return/release, settings changes, and export actions. `evaluation_approvals` records the full approval/revision history. Logs are append-only (no update/delete endpoints).

## 9.6 Database Access Controls & Backup

- SQLite file (`data/lcm.db`) outside the web root; WAL mode; `PRAGMA foreign_keys = ON` on every connection.
- Application connects as the OS user only; no network exposure.
- **Backup**: `npm run backup` snapshots the DB + uploads dir to `backups/` (WAL checkpoint first). Restore = stop server, replace files, start. Documented in README.
- Nightly backup recommended via cron in production.

## 9.7 HTTPS-Ready Architecture

- Trusts `X-Forwarded-Proto` behind nginx/Caddy; cookies become `Secure` automatically when HTTPS is detected.
- HSTS header enabled when served over HTTPS.
- Sample nginx reverse-proxy config provided in README.

## 9.8 OWASP Mapping

Authentication → 9.1 · Access control → 9.2 · Injection → 9.3 · XSS → 9.3 · CSRF → 9.3 · File upload → 9.3 · Sensitive data exposure → 9.4 + crypto (bcrypt) · Logging & monitoring → 9.5 · Rate limiting → 9.3 · Configuration → HTTPS-ready + helmet.
