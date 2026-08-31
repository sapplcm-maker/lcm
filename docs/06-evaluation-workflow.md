# 6. Evaluation Workflow (State Machine)

## 6.1 Status Model

```
                    ┌────────────────────────────────────────────────┐
                    │                                                │
   Draft ──▶ Submitted ──▶ Pending Admin Review ──▶ Approved ──▶ Released
     ▲                        │      ▲                  │
     │                        │      │                  │
     └──────── Returned ◀─────┘      │                  │
                │                    │                  │
                └── Resubmitted ─────┘                  │
                                                        │
        (Package mode: release deferred until ALL       │
         committee evaluations for member+term          │
         are Approved) ─────────────────────────────────┘
```

| Status | Meaning | Editable by |
|---|---|---|
| `draft` | Saved but not submitted | Evaluator |
| `submitted` | Handed in, awaiting admin (transition marker) | — |
| `pending_review` | In the Administrator's approval queue | Admin only (approve/return) |
| `returned` | Sent back for correction/clarification with notes | Evaluator (resubmit) |
| `resubmitted` | Re-entered queue (auto-set on resubmit) | Admin only |
| `approved` | Administrator approved; **still confidential** | Admin (release) |
| `released` | Published to the evaluated member's dashboard | — |

## 6.2 Transitions & Guards

| From | To | Trigger | Guard |
|---|---|---|---|
| draft | submitted / pending_review | Evaluator clicks Submit | Term open (or grace period); all categories rated 1–5; duplicate row impossible (UNIQUE); member active or explicitly allowed |
| pending_review | returned | Admin Return + notes | Notes required |
| returned | resubmitted → pending_review | Evaluator edits + resubmits | Same guards as first submit |
| pending_review / approved | approved | Admin Approve (+ optional notes) | — |
| approved | released | Admin Release | **individual mode**: no guard beyond approval. **package mode**: every committee evaluation for (member, term) must be `approved`; then all flip to `released` together |
| draft/returned | draft | Save Draft | any time while term open |

## 6.3 Mandatory Administrator Review

- Committee-submitted evaluations (Screening & Evaluation, Discipline, Reader's Evaluation) **never** bypass review.
- The results are **invisible to the evaluated member until `released`** — enforced by the API/data layer, not the UI:
  - `GET /api/evaluations/my-results` selects only `status = 'released'`.
  - There is no other endpoint through which a member could retrieve ratings/comments for themselves.
- Approval Center shows: Pending Review, Returned for Revision, Approved, Released to Members, Incomplete Evaluations, Evaluations by Committee, Evaluations by Term — with filters Committee | Term | Member | Status | Date | Evaluator.

## 6.4 Release Modes (configurable via System Settings)

- `individual` — the Administrator releases each approved evaluation as soon as it is ready.
- `package` (default) — release happens only when the complete evaluation package for a member + term is approved (all required committees); the Administrator then releases the whole set at once. The Admin may override per case.

## 6.5 Confidentiality Rule

> Committee-submitted evaluations, individual evaluator ratings, confidential comments, and unapproved results are **never** displayed to the evaluated member before Administrator approval — enforced at backend/API/database permission level.

- Evaluator identities are not exposed to the evaluated member unless an administrator explicitly configures that behavior (release payload only ever includes `evaluation_comments` rows flagged `is_visible_to_member`, plus an optional admin summary).
- Admin notes (in `evaluations.admin_notes`) are only revealed to the member when the admin intends them for the member (released summary field), never raw.

## 6.6 Audit Trail (Evaluation)

Every transition is recorded in `evaluation_approvals` **and** `audit_logs`:

Evaluated member · Committee · Evaluation term · Evaluator · Admin reviewer · Submitted at · Approved at · Previous status · New status · Revision/return history · Administrative notes · IP · Timestamp.

## 6.7 Averages

- Category rating: the raw 1–5 value.
- Member Average (per evaluation) = Σ(valid category ratings) ÷ count(valid ratings). Stored in `evaluations.overall_average`.
- Member Average (term) = mean of released evaluation averages across committees.
- Consolidated result = per-committee result list + overall mean.
