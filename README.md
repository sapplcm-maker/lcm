# LCM Ministry Portal

**Lectors and Commentators Ministry — Online Management and Evaluation System**

A complete system for managing ministry members, schedules, announcements, internal messages, and committee evaluations — built for the Lectors and Commentators Ministry.

---

## Part 1 — For everyone (plain language)

### What this system does

| Module | What it lets you do |
|---|---|
| **Dashboard** | Your personal home page: upcoming assignments, announcements, messages, results |
| **Schedule** | Monthly calendar of ministry services with your role, time and venue |
| **Announcements** | Ministry news with attachments and links |
| **Messages** | Private conversations between members |
| **Profile** | Your photo, personal information and account settings |
| **Evaluations** | Committee members rate members (1–5); members see **approved, official results only** |
| **Notifications** | Bell alerts for new announcements, messages, assignments and results |
| **Admin tools** | Member accounts, schedules, announcements, evaluation approval, reports, audit log |

### How to start the system (one-time setup)

1. Install **Node.js** from <https://nodejs.org> — choose the **LTS** version and accept the defaults.
2. Put this folder on the computer that will run the portal (e.g., the parish office PC).
3. Double-click:
   - **Windows** → `START-WINDOWS.bat`
   - **Mac or Linux** → `START-MAC-LINUX.sh`
4. Your browser opens at **http://localhost:3000** — that's the portal. **Keep that window open** while people use it; closing it stops the portal.

### Signing in

Everyone opens their browser and goes to `http://localhost:3000`, then signs in with the username and password given by the administrator.

**First-time accounts (built into the system):**

| Who | Username | Password |
|---|---|---|
| Administrator | `admin` | `Admin@123` |
| Sample officer | `officer.reyes` | `Member@123` |
| Sample committee chair (Screening) | `carmen.villanueva` | `Member@123` |
| Sample committee chair (Discipline) | `ricardo.bautista` | `Member@123` |
| Sample committee chair (Readers) | `teresa.domingo` | `Member@123` |
| Sample committee member | `paolo.mendoza` | `Member@123` |
| Sample members | `andrea.lopez`, `miguel.torres`, `sophia.ramirez`, … | `Member@123` |

> ⚠️ **Before real use**: sign in as `admin` and change the administrator password (Profile → or Settings → Security). The admin creates real member accounts under **Members**. Sample data (schedules, evaluations, messages) shows how everything works — you can delete or replace it as you go.

### Daily backup (protects your data)

With the portal **stopped**, run `npm run backup` (or ask your administrator). It copies the database and files into the `backups/` folder. Keep a copy somewhere safe (USB stick / cloud). Restore = copy the backup files back.

---

## Part 2 — Publishing so everyone can use it

The portal runs **on your own computer** first — perfect for the parish office. To let members sign in **from home**, you need one of:

1. **Office computer on the parish network** — members on the same Wi-Fi can use `http://<office-computer-IP>:3000`. Simple, free, works today.
2. **A small hosting service** — rent a cheap virtual server (e.g., a $5–10/month VPS from providers like DigitalOcean, Vultr, or a local provider), copy this folder, and run the same start steps. Members then use a web address like `https://yourministry.example.com`.
3. **A domain name + HTTPS** — recommended once you have a server: put the portal behind a reverse proxy (nginx/Caddy) with a free HTTPS certificate so logins are encrypted.

The system is **HTTPS-ready** (secure cookies, security headers, HSTS-ready) — the technical appendix below covers deployment.

> Honest note: publishing to the public internet requires a hosting account and (ideally) a domain — I can't create those from here, but the software is ready; a local tech-savvy parishioner can have it online in an afternoon with the appendix.

---

## Part 3 — Technical appendix (for your administrator / tech volunteer)

### Requirements
- Node.js **20 or newer** (LTS recommended)
- No database server needed — SQLite file at `server/data/lcm.db` (backups = copy it)

### Commands
```bash
npm install          # install dependencies
node server/seed.js  # create demo database (--fresh wipes and recreates)
npm start            # start on http://localhost:3000  (PORT=8080 npm start to change)
npm run backup       # snapshot DB + uploads into backups/
```

### Architecture
- **Frontend** (`public/`): responsive vanilla-JS SPA, ministry visual identity (navy/gold/teal from the LCM logo), hash router, SVG charts, no external CDNs
- **Backend** (`server/`): Express + better-sqlite3; layered middleware (session → CSRF → RBAC → validation); route modules per domain
- **Docs** (`docs/`): 10 design documents — architecture, permission matrix, ERD, screens, flows, workflows, security plan, UX plan

### Roles & permissions
Administrator (full), Officer (schedule + announcements + directory), Committee Member (evaluation dashboards for their committees), Regular Member (personal portal). Permission matrix editable in **Roles & Permissions**; enforcement is server-side.

### Evaluation workflow (confidentiality is enforced at the data layer)
```
Draft → Submitted → Pending Admin Review → Approved → Released to Member
                 ↘ Returned for Revision → Resubmitted ↗
```
- Members only ever receive **released** results (SQL-filtered — no UI can bypass it)
- Release mode: **individual** or **package** (all committee results for a member + term must be approved first) — configurable in System Settings
- Every approval/return/release is recorded in the audit log and approval history

### Security highlights
bcrypt password hashing (never plaintext) · DB-backed sessions with sliding/absolute expiry · CSRF double-submit tokens · login rate limiting (5 fails/15 min per username) · input validation + prepared statements (SQLi-safe) · XSS escaping + CSP headers · upload allowlists + image re-encoding · audit trail for administrative/evaluation actions · backup & recovery procedure

### HTTPS deployment sketch
```
nginx:
  server_name ministry.example.com;
  location / { proxy_pass http://127.0.0.1:3000;
               proxy_set_header X-Forwarded-Proto $scheme; ... }
  # certbot / Let's Encrypt for the certificate
```
Cookies automatically become `Secure` when the app sees HTTPS behind the proxy.

### Tests
```bash
node scripts/smoke-test.mjs     # backend: 70 checks (auth, RBAC, workflow, exports)
node scripts/test-frontend.mjs  # frontend: 49 checks (renders every portal via jsdom)
```
