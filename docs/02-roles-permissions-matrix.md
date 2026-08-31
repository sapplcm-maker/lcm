# 2. User Roles & Permission Matrix

## 2.1 Member Classifications

Every user account has **one role** (access level) and **one classification** (ministry category, e.g. Lector, Commentator, Server, Usher). Classification is data, not an access level — changing classification never changes a member's access rights, and historical records stay linked to the member (by `users.id`), not the classification.

| Classification | Meaning |
|---|---|
| Lector | Proclaims the Word |
| Commentator | Guides the assembly |
| Server | Altar service |
| Usher / Greeter | Hospitality |
| *(Admin-configurable)* | Add more freely |

## 2.2 Roles

| Role | Code | Summary |
|---|---|---|
| Regular Member | `member` | Personal portal, own schedule, announcements, messages, profile, released evaluation results |
| Officer | `officer` | Member capabilities **plus** schedule viewing/management support, announcement creation/publishing, limited member directory |
| Committee Member | `committee` | Member capabilities **plus** the Evaluation Module for the committee(s) they belong to |
| Administrator | `admin` | Everything: member/user management, all modules, evaluation approval & release, reports, audit, settings |

**Composite roles**: a committee member is not a separate "role" — committee access is granted through **committee membership** rows (`committee_members`). A user's role stays `member`/`officer` and the committees table grants evaluation dashboards. A member may belong to multiple committees.

## 2.3 Permission Codes

| Code | Description |
|---|---|
| `members.view` / `members.manage` | View directory / full member management (CRUD, status, classification, role) |
| `members.reset_password` | Reset any member's password |
| `roles.manage` | Edit roles & permission matrix |
| `classifications.manage` | Manage member classifications |
| `committees.manage` | Manage committees, membership, rating categories |
| `schedule.view` / `schedule.manage` | View schedules / create, edit, assign, publish |
| `announcements.view` / `announcements.manage` | View published / full announcement management |
| `announcements.publish` | Publish announcements |
| `messages.use` | Internal messaging |
| `profile.manage` | Edit own profile & photo |
| `evaluations.view` | See evaluation module & committee dashboards |
| `evaluations.evaluate` | Create/submit evaluations (committee members) |
| `evaluations.approve` | Admin review/approval of evaluations |
| `evaluations.release` | Release results to members |
| `evaluations.manage` | Manage evaluation terms |
| `reports.view` / `reports.export` | View / export evaluation reports |
| `audit.view` | View audit log |
| `settings.manage` | System settings |
| `notifications.broadcast` | Send admin-defined ministry notifications |
| `own.results` | View own released evaluation results |

## 2.4 Role → Permission Matrix

| Module / Action | Admin | Officer | Committee Member | Regular Member |
|---|---|---|---|---|
| Login, own dashboard | ✅ | ✅ | ✅ | ✅ |
| Own profile, photo, account settings, password change | ✅ | ✅ | ✅ | ✅ |
| Own notifications | ✅ | ✅ | ✅ | ✅ |
| Own released evaluation results | ✅ | ✅ | ✅ | ✅ |
| View own schedule / monthly ministry calendar | ✅ | ✅ | ✅ | ✅ |
| View published announcements | ✅ | ✅ | ✅ | ✅ |
| Create/edit/publish announcements | ✅ | ✅ (create+publish) | ❌ | ❌ |
| Announcement attachments (view/download) | ✅ | ✅ | ✅ | ✅ |
| Internal messaging (threads they participate in) | ✅ | ✅ | ✅ | ✅ |
| Member directory (basic: name, classification, photo) | ✅ | ✅ (limited) | ✅ (limited) | ❌ |
| Member management (CRUD, status, classification, role) | ✅ | ❌ | ❌ | ❌ |
| Password reset for members | ✅ | ❌ | ❌ | ❌ |
| Roles & permission matrix | ✅ | ❌ | ❌ | ❌ |
| Committees & committee membership | ✅ | ❌ | ❌ | ❌ |
| Schedule management (create/edit/assign/publish) | ✅ | ❌ | ❌ | ❌ |
| Schedule viewing (full calendar) | ✅ | ✅ | ❌ | ❌ (own assignments only) |
| Evaluation terms | ✅ | ❌ | ❌ | ❌ |
| Committee evaluation dashboards | ✅ (all) | ❌ | ✅ (own committees) | ❌ |
| Rate members (incl. self, if enabled) | ✅ | ❌ | ✅ (own committees) | ❌ |
| View own committee drafts/submissions | ✅ | ❌ | ✅ (own) | ❌ |
| **Evaluation Approval Center** | ✅ | ❌ | ❌ | ❌ |
| Approve / return / release evaluations | ✅ | ❌ | ❌ | ❌ |
| Evaluation reports & exports | ✅ | ❌ | ✅ (own committee, limited) | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ |
| System settings | ✅ | ❌ | ❌ | ❌ |
| Admin broadcast notifications | ✅ | ❌ | ❌ | ❌ |

> Enforcement is **server-side** (`requireRole` / `requirePermission` middleware). The UI merely hides what the API would refuse.

## 2.5 Evaluation Data Visibility

| Data | Evaluated member | Committee member (of that committee) | Administrator |
|---|---|---|---|
| Their own released results (Official/Approved) | ✅ | ✅ | ✅ |
| Drafts/submissions they authored | ❌ | ✅ | ✅ |
| Other evaluators' ratings & comments | ❌ | ❌ (aggregates only) | ✅ |
| Unapproved / returned / pending evaluations | ❌ | ✅ (own work only) | ✅ |
| Evaluator identities | ❌ (hidden unless admin configures release to show) | ❌ (except own) | ✅ |
| Committee/term aggregate summaries | ❌ | ✅ (own committee) | ✅ |
| All committees' data | ❌ | ❌ | ✅ |
