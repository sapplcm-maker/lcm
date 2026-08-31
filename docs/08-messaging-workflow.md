# 8. Messaging Workflow

## 8.1 Model

- Conversations are **threads** with 2..N participants (`message_thread_participants`).
- Threads are **private**: a user only ever sees threads they participate in. Server rejects (403) any fetch/send/read operation on a non-participant thread.
- Messages carry `sender_id`, timestamps, optional attachments, and a status (`sent`/`edited`/`deleted`).

## 8.2 Flow

```
Compose ──▶ select recipients (directory limited by role) ──▶ create thread + first message
   └─▶ participants receive a notification + unread thread appears
Reply ──▶ POST to thread ──▶ appended; participants notified; unread++ for others
Read ──▶ participant marks thread read (per-participant last_read_at)
Unread count ──▶ messages with created_at > last_read_at, sender != me
Edit (own message, within 15 min) ──▶ status=edited, edited_at; "(edited)" shown
Delete (own message) ──▶ soft delete; placeholder shown; other messages intact
Search ──▶ filter threads by title/participant name/body (own threads only)
```

## 8.3 Permissions

| Action | Allowed |
|---|---|
| Start a thread | Any authenticated member (recipients: all active members for admin/officer; directory-limited for others) |
| Read thread | Participants only |
| Reply | Participants only |
| Edit message | Author only, ≤ 15 minutes after sending |
| Delete message | Author only (soft delete, audit logged) |
| Delete thread | Creator/participant — mark thread archived (admin can purge) |
| Attachments | Participants only, validated uploads (2 MB), allowlisted types |

## 8.4 Edge Cases

- Duplicate accidental submissions → sending is a simple append; UI disables submit while in flight; no idempotency issue.
- Message sent to a deactivated member → delivered but flagged; reactivated member sees it.
- Timestamps always UTC ISO-8601, rendered in member timezone by the client.
- Privacy: no endpoint enumerates threads by member except the participant-scoped list.
