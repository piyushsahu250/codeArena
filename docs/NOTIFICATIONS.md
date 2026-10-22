# Notifications

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/notifications.js`

## Model
`Notification` — in-app, per-user, bell-icon feed. Separate from email (`EmailLog`, [FIXED_ISSUES.md](FIXED_ISSUES.md) has the history of a false-"sent successfully" email bug root-caused there — see that file).

## Routes
`GET /` (list), `GET /unread-count`, `PATCH /:id/read`, `POST /mark-all-read` — all authenticated-only (no `requireRole`), self-scoped to `req.user.id`.

## What Triggers a Notification
Per project history: placement offer verification, result publication (`notifyResultPublished`), Talent Pool auto-selection, document verification/rejection (recommended per an earlier planning pass — verify current implementation status directly if this matters for a task), Talent Pool reminders (background scheduler).

## E-mail sending rules (2026-10 audit, batch 6)
* **One e-mail per person is always bounded.** Use `emailEach(people, fn)` (or `notifyInBackground(label, people, fn)` when the request must not wait) from `utils/notifications.js`, never `Promise.all(people.map(...send...))`: that starts every send at once through the single mail account. A unit test (`backend/test/emailFanout.test.js`) scans the source and fails the build if the pattern returns.
* **Critical e-mail is protected.** Non-critical types share a rolling 24-hour allowance (`BULK_EMAIL_DAILY_BUDGET`); `PASSWORD_RESET`, `PASSWORD_RESET_BY_ADMIN`, `CREDENTIALS`, `CREDENTIALS_RESEND` and `EMAIL_VERIFICATION` (`CRITICAL_EMAIL_TYPES` in `utils/mailer.js`) are exempt. A refused e-mail is logged `FAILED` with the reason; the in-app notification is unaffected.
* **Stuck rows are corrected.** A row still `PENDING` after 30 minutes (a restart in the middle of a send) is marked `FAILED` by a sweeper so it is visible and retryable.
* **Limits on the senders themselves.** `POST /admin/announcements`: message at most 2,000 and subject at most 150 characters, 5 accepted announcements per administrator per hour. `POST /tests/:id/notify`: an e-mail notification for the same test is refused for 10 minutes after the last one (in-app is not limited). Settings are in [ENVIRONMENT.md](ENVIRONMENT.md).

## Not a Persisted "Notification System" Beyond This
There is no separate push-notification service or SMS integration — this is purely an in-app database-backed feed plus whatever email is sent alongside it via `mailer.js`.

## Related
[AUDIT_LOG.md](AUDIT_LOG.md) (a different, admin-facing record of actions — don't confuse the two), [DOCUMENT_VERIFICATION.md](DOCUMENT_VERIFICATION.md), [RESULT_MANAGEMENT.md](RESULT_MANAGEMENT.md).
