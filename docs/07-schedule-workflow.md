# 7. Schedule Workflow

## 7.1 Roles

| Actor | Capability |
|---|---|
| Administrator | Create, edit, delete, assign, publish schedules; override conflicts |
| Officer | Same as admin for schedules (subject to `schedule.manage` permission) |
| Member | View only — their assignments appear on the monthly calendar |

## 7.2 Process

```
1. Create schedule  → date, start/end time, venue, notes (status = draft)
2. Add assignments  → member + role (Lector, Commentator, …) + per-assignment notes
3. Conflict check   → automatic, server-side, at save time:
       same member + overlapping [start,end) on the same date
       ├─ exact/any overlap by default  → BLOCK with message
       └─ admin chooses "allow override" → saved, warning flagged in UI
4. Publish          → status = published; assigned members notified
5. Ongoing changes  → edits re-run conflict checks; affected members notified
6. Cancel           → status = cancelled; assignments statuses cleared; notified
```

## 7.3 Conflict Rules

- **Blocked by default**: assigning a member to a slot that overlaps any existing confirmed/pending assignment of theirs (same day, time ranges intersect).
- **Warning (partial overlap)**: when the overlap is with a *draft* schedule or the admin explicitly overrides, the conflict is recorded as a warning, not an error.
- **Unique constraint** `UNIQUE(schedule_id, user_id)` prevents duplicate rows for the same member on the same service even if the conflict check is bypassed.

## 7.4 Member Calendar View

- Month grid; each day shows assignments (role + time + venue).
- Click a day → details: date, time, assignment, assigned role, venue, notes, status (confirmed/pending/declined/replaced).
- Only the member's own assignments are shown to the member; admins/officers see all assignments.
- Status colors: confirmed (green), pending (amber), declined (red), replaced (grey).

## 7.5 Edge Cases

- Schedule edited after publication → members notified; `updated_at` refreshed; audit entry.
- Duplicate assignment attempt → friendly error (server + DB constraints).
- Member deactivated → their historical assignments remain; new assignment to an inactive member blocked with a warning.
