# 5. User Flows

## 5.1 Account Lifecycle (Administrator)

```
Add member ──▶ set classification + role ──▶ set username + initial password
   └─▶ member logs in ──▶ forced password change (must_change_password)
        └─▶ member completes profile + uploads photo
Change classification/role ──▶ audit logged; history unaffected (keyed by user id)
Deactivate/suspend ──▶ account cannot log in; historical records remain
Reactivate ──▶ restores access
Lost password ──▶ admin reset → temp password → member forced to change
```

## 5.2 Login & Session Flow

```
Login page ──▶ POST /api/auth/login
   ├─ fail ×5/15min (IP or username) ──▶ rate-limit message + audit log
   └─ success ──▶ DB session row + httpOnly cookie + CSRF token
        └─▶ must_change_password? ──▶ force change screen
        └─▶ else ──▶ dashboard (role-aware)
Logout / expiry / revoked session ──▶ redirect to login
```

## 5.3 Schedule Workflow (Admin / Officer)

```
Create schedule (date, time, venue, notes) ──▶ draft
Add assignments (member + role + notes)
   └─▶ conflict detection: same member, overlapping time
        ├─ exact conflict ──▶ blocked (unless admin override)
        └─ partial overlap ──▶ warning shown, admin decides
Publish ──▶ members notified; visible on their calendar
Post-publication change ──▶ re-notify affected members; audit logged
Cancel ──▶ assignments marked, members notified
```

## 5.4 Announcement Workflow

```
Create (title, body, publish_at, expires_at, attachments, links) ──▶ draft
Publish ──▶ visible to members (if within publish window) + notifications
Edit published ──▶ members see updated version (edited_at shown)
Archive/expire ──▶ removed from member lists, kept in admin archive
```

## 5.5 Messaging Flow

```
Compose ──▶ pick recipients (authorized directory) ──▶ thread created
Reply ──▶ thread continues; participants notified; unread counts
Read ──▶ participant marks thread read (last_read_at per participant)
Edit own message (within edit window) ──▶ status=edited, edited_at stamped
Delete own message ──▶ soft delete (shown as "message deleted")
Privacy ──▶ server refuses any thread fetch/send for non-participants (403)
```

## 5.6 Evaluation Flow (Committee Member)

```
Open Committee Dashboard ──▶ select term (must be within/open term)
Pick member (including self if enabled) ──▶ form with committee categories
Rate 1–5 each category (labels shown: 5 Highest … 1 Lowest)
Add comments / observations / recommendations / improvements
Save Draft ──▶ editable later
Submit ──▶ status = Pending Admin Review (locked for editing)
   └─▶ term closed? ──▶ blocked (grace period configurable)
Duplicate submit ──▶ impossible (unique constraint + status check)
```

## 5.7 Evaluation Approval & Release (Administrator)

```
Approval Center ──▶ filter committee/term/member/status/date/evaluator
Review drawer ──▶ ratings + comments + evaluator + dates
   ├─ Approve ──▶ status = Approved (approval recorded, admin noted)
   └─ Return ──▶ status = Returned (notes to committee)
        └─▶ committee resubmits ──▶ Pending Admin Review again
Release (individual or package, per settings):
   └─▶ status = Released ──▶ visible on member's My Evaluations
        └─▶ member notified; results marked Official/Approved
Package mode: all required committee evaluations for member+term must be
approved before any are released together.
```

## 5.8 Member Evaluation Results View

```
My Evaluations ──▶ shows ONLY released evaluations (server-enforced)
   ├─ term, committee, overall score, per-category ratings
   ├─ performance summary, strengths, areas for improvement
   ├─ authorized comments/recommendations + admin feedback
   └─ "Official / Approved" indicator
```

## 5.9 Reporting

```
Reports ──▶ pick scope (member/committee/term/overview)
   └─▶ averages, distribution, incomplete lists, history
        └─▶ visualize (SVG charts) ──▶ export CSV / XLSX / PDF
```
