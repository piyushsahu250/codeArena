# Notifications

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/notifications.js`

## Model
`Notification` — in-app, per-user, bell-icon feed. Separate from email (`EmailLog`, [FIXED_ISSUES.md](FIXED_ISSUES.md) has the history of a false-"sent successfully" email bug root-caused there — see that file).

## Routes
`GET /` (list), `GET /unread-count`, `PATCH /:id/read`, `POST /mark-all-read` — all authenticated-only (no `requireRole`), self-scoped to `req.user.id`.

## What Triggers a Notification
Per project history: placement offer verification, result publication (`notifyResultPublished`), Talent Pool auto-selection, document verification/rejection (recommended per an earlier planning pass — verify current implementation status directly if this matters for a task), Talent Pool reminders (background scheduler).

## Not a Persisted "Notification System" Beyond This
There is no separate push-notification service or SMS integration — this is purely an in-app database-backed feed plus whatever email is sent alongside it via `mailer.js`.

## Related
[AUDIT_LOG.md](AUDIT_LOG.md) (a different, admin-facing record of actions — don't confuse the two), [DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md), [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md).
