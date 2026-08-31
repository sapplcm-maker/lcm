# 1. System Architecture

## 1.1 Overview

The **Lectors and Commentators Ministry Online Management and Evaluation System (LCM-OMES)** is a secure, multi-role web application that centralizes ministry membership, scheduling, announcements, internal messaging, and committee evaluation workflows.

The application follows a **clean three-tier architecture** with a clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT TIER  (public/)                                          │
│  Responsive SPA — Vanilla JS + HTML5 + CSS3 (design system)      │
│  Hash router · API client w/ CSRF · SVG charts · Accessible UI   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS / JSON + multipart
┌──────────────────────────────▼──────────────────────────────────┐
│  APPLICATION TIER  (server/)                                     │
│  Node.js + Express 20                                           │
│  ├─ Middleware chain: helmet-ish headers → session → CSRF →      │
│  │   RBAC (role + permission) → validation → route handlers      │
│  ├─ Route modules: auth, members, admin, schedule,               │
│  │   announcements, messages, notifications, profile,            │
│  │   evaluations, reports                                        │
│  ├─ Services: password policy, audit logger, notification        │
│  │   dispatcher, conflict detector, evaluation state machine,    │
│  │   report/export generators (CSV · XLSX · PDF)                 │
│  └─ File storage: /data/uploads (profile photos, attachments)    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ better-sqlite3 (WAL mode)
┌──────────────────────────────▼──────────────────────────────────┐
│  DATA TIER  (server/data/lcm.db)                                 │
│  SQLite (normalized, FK-enforced, 20+ tables)                    │
│  schema.sql · seed.js · backup script (sqlite3 .backup / copy)   │
└─────────────────────────────────────────────────────────────────┘
```

## 1.2 Technology Choices

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS | Stable, ubiquitous, single-language stack |
| Web framework | Express 4 | Minimal, mature middleware ecosystem |
| Database | SQLite via better-sqlite3 (WAL) | Zero-ops, transactional, full SQL; file-based backup; ideal for a parish-scale ministry (hundreds of members) |
| Auth | express-session + DB-backed sessions | Server-side sessions, revocable, expiration-enforced |
| Password hashing | bcrypt (bcryptjs) | Industry-standard adaptive hash; **never plaintext** |
| File uploads | multer + validation layer + sharp (image resize) | Allowlisted types, size caps, randomized storage names |
| Exports | pdfkit (PDF) · exceljs (XLSX) · CSV | Dependency-light, accurate office-compatible output |
| Frontend | Vanilla JS SPA (no build step) | No framework churn, easy to audit, small attack surface, fast load |
| Charts | Hand-rolled SVG | No external CDN dependency; crisp, themeable |

> **Deployment**: the app is HTTPS-ready — behind a reverse proxy (nginx/Caddy) it trusts `X-Forwarded-Proto` and sets `Secure` cookies automatically. SQLite file lives outside the web root.

## 1.3 Module Map

| Module | Files | Functions |
|---|---|---|
| Auth & sessions | `routes/auth.js`, `middleware/auth.js` | Login/logout, session CRUD, password change, reset, session revocation |
| RBAC | `middleware/rbac.js`, `routes/admin.js` | Role/permission matrix, committee membership, guards |
| Members | `routes/members.js` | Member lifecycle, classification, status, reset |
| Schedule | `routes/schedule.js` | Monthly calendar data, CRUD, assignments, conflict detection, publish |
| Announcements | `routes/announcements.js` | CRUD, publish/expire, attachments, notifications |
| Messaging | `routes/messages.js` | Threads, replies, edit/delete, read state, search |
| Notifications | `routes/notifications.js` | In-app notification center, admin broadcast |
| Profile | `routes/profile.js` | Personal info, photo upload/resize/remove |
| Evaluations | `routes/evaluations.js` | Terms, committee dashboards, ratings/comments, approval workflow |
| Reports | `routes/reports.js` | Summaries, distributions, CSV/XLSX/PDF export |
| Audit | `middleware/audit.js`, `routes/admin.js` | Immutable audit trail |
| Settings | `routes/admin.js` | System settings (release mode, site name, password policy) |

## 1.4 Security Architecture Highlights

- **Defense in depth**: every API route enforces session → CSRF → RBAC → input validation before touching the DB.
- **Confidentiality rule is enforced at the data layer**: the evaluations module only ever returns *released* results to the evaluated member; committee view and admin view have separate query paths. No frontend switch can expose unreleased data.
- All DB access uses **prepared statements** (better-sqlite3) → SQL-injection safe by construction.
- All rendered text is HTML-escaped on the client; all stored text is validated server-side → XSS mitigated.
- CSRF via **double-submit token** bound to the session.
- **Rate limiting** on login (per IP + per username) and on sensitive submissions.
- **Audit trail**: every administrative and evaluation action records actor, action, entity, IP, timestamp.

## 1.5 Configuration

| Setting (env / system_settings) | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `SESSION_SECRET` | generated at first boot (stored in `data/.secret`) | Session signing |
| `site_name` | `LCM Ministry Portal` | UI branding |
| `release_mode` | `individual` | `individual` or `package` evaluation release |
| `password_min_length` | `8` | Password policy |
| `allow_self_evaluation` | `true` | Committee members may rate themselves |
| `evaluation_grace_days` | `0` | Days after term end still accepting submissions |
