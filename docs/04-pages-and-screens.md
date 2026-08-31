# 4. Complete Page / Screen List

All screens are served by the SPA shell (`public/index.html`) and gated by role. Route format: `#/view?params`.

## 4.1 Shared

| Screen | Route | Access |
|---|---|---|
| Login | `#/login` | Public |
| Change password (forced) | `#/change-password` | Any authenticated user with `must_change_password` |
| App shell (sidebar + topbar + notifications bell) | — | All authenticated |

## 4.2 Regular Member Portal

| Screen | Route | Notes |
|---|---|---|
| Dashboard | `#/dashboard` | Welcome, upcoming assignments, latest announcements, unread messages, notifications, released results summary |
| My Schedule (monthly calendar) | `#/schedule` | Month selector; date, time, role, venue, notes, status per assignment |
| Announcements | `#/announcements` | Published list w/ expiry badges; detail with attachments (download) |
| Messages | `#/messages` | Thread list w/ unread badges + search |
| Conversation | `#/messages/:threadId` | Threaded view, reply, edit/delete own messages, mark read |
| New message | modal | Compose to authorized members |
| My Profile | `#/profile` | Photo upload/preview/remove, personal info |
| My Evaluations | `#/evaluations` | **Released results only** — Official/Approved badge, scores by committee, categories, summary, admin feedback |
| Notifications | `#/notifications` | List, mark read/all |
| Settings | `#/settings` | Username/account settings, password change, session management (list/revoke own sessions) |

## 4.3 Officer Portal (adds to member portal)

| Screen | Route | Notes |
|---|---|---|
| Schedule Management | `#/schedule` (manage mode) | Create/edit schedules, assignments, conflict warnings, publish |
| Announcement Management | `#/announcements/manage` | Create/edit/publish own announcements, attachments |
| Member Directory | `#/directory` | Basic member info (name, classification, photo, status) — read-only |
| Dashboard | `#/dashboard` | Officer summary cards |

## 4.4 Committee Member Portal (adds to member portal)

| Screen | Route | Notes |
|---|---|---|
| Committee Dashboard | `#/committee` | Their committee(s), term selector, members to evaluate (incl. self), not-yet-evaluated list, my drafts/submissions status |
| Evaluation Form | `#/committee/evaluate/:memberId` | Per-category 1–5 rating scale (with labels), comments/observations/recommendations/improvements, save draft / submit → Pending Admin Review; reopened view for returned items |
| Evaluation History | `#/committee/history` | My evaluations per term, status badges |
| Committee Reports | `#/committee/reports` | Own-committee aggregates (subject to permissions) |

## 4.5 Administrator Portal (adds everything)

| Screen | Route | Notes |
|---|---|---|
| Dashboard | `#/dashboard` | Admin KPIs incl. evaluation approval queue |
| Member Management | `#/members` | Search/filter; add/edit; status actions; classification & role change; password reset; deactivate |
| Roles & Permissions | `#/roles` | Edit role→permission matrix |
| Classifications | `#/classifications` | CRUD member classifications |
| Committees | `#/committees` | CRUD committees, membership, rating categories |
| Schedule Management | `#/schedule/manage` | Full schedule CRUD + assignments + publish |
| Announcement Management | `#/announcements/manage` | All announcements, any status; publish/archive; attachments |
| Evaluation Terms | `#/terms` | Configure names/dates/active |
| **Evaluation Approval Center** | `#/approvals` | Status cards (Pending/Returned/Approved/Released/Incomplete), filters (committee/term/member/status/date/evaluator), review drawer, approve/return w/ notes, release individual or package |
| Reports | `#/reports` | Member/committee/term/overview summaries, charts, exports CSV/XLSX/PDF |
| Notifications | `#/notifications` | Own notifications + broadcast composer |
| Audit Logs | `#/audit` | Filterable audit trail |
| System Settings | `#/settings/admin` | Release mode, site name, password policy, grace period |
