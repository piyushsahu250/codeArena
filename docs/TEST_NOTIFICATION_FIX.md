# Stop Automatic Email For Every Test

## Root cause

Exactly two automatic-email triggers existed for tests — both on **assignment/publish**, not on
create/edit/save-draft (those never sent any notification at all, before or after this fix):

1. `routes/tests.js` `PATCH /:id/publish` — the moment `isPublished` flipped `false -> true`,
   `notifyTestAssigned()` sent **both** an in-app notification and an email to every student in
   the test's assigned academic group(s), unconditionally, with no opt-out.
2. `routes/talentPools.js` `POST /:id/tests` (assigning a Test to a Talent Pool) —
   `notifyAssessmentAssigned()` did the same, unconditionally, to every pool member.

Both were fire-and-forget calls with no idempotency, no audience preview, and no way for staff to
choose email vs. in-app.

## Files changed

- `backend/prisma/schema.prisma` — new `TestNotificationSend` model.
- `backend/src/utils/notifications.js` — `notifyTestAssigned` and `notifyAssessmentAssigned` both
  gained an optional `{ sendEmail = false }`; `emailStudent` exported and gained an optional
  `batchId` passthrough.
- `backend/src/utils/testEligibility.js` — new `getTestRecipients()`, the single reverse-eligibility
  function both the automatic in-app notify and the manual send now share.
- `backend/src/routes/tests.js` — publish route now calls `notifyTestAssigned` with the new
  default (in-app only); three new routes: `GET /:id/notification-recipients`,
  `POST /:id/notify`, `GET /:id/notification-log`.
- `backend/src/routes/talentPools.js` — explicit `{ sendEmail: false }` on the Test-assignment call.
- `backend/src/utils/auditLog.js` — new `TEST_NOTIFICATION_SENT` action.
- `frontend/src/components/SendTestNotificationModal.jsx` — new.
- `frontend/src/pages/StaffDashboard.jsx` — "Send Notification" button (shown only for published
  tests) + clarified publish-confirmation copy so it no longer implies email.

## Automatic email triggers removed

| Trigger | Before | After |
|---|---|---|
| Create | never emailed | unchanged |
| Edit | never emailed | unchanged |
| Save draft | never emailed | unchanged |
| Publish | emailed every assigned student | in-app only |
| Assign to Talent Pool | emailed every pool member | in-app only |

## Manual notification implementation

`POST /tests/:id/notify` — `{ sendInApp, sendEmail, idempotencyKey }`, at least one of
`sendInApp`/`sendEmail` required, test must already be published. Authorization mirrors
`GET /:id/results` exactly: `canStaffAccessTest` (STAFF: own or shared tests only) layered on top
of `req.requesterInstituteId` vs. `test.instituteId` (institute-scoped roles blocked from any test
outside their own institute).

## In-app notification behavior

Always in-app on publish/assignment (students must still see the test inside CodeArena
regardless of email) via the pre-existing `Notification` model/`notifyMany`. The manual send's
in-app half uses the same mechanism.

## Email queue behavior

Manual send's email half runs through the existing `mapWithConcurrency` background-batch pattern
(same one bulk-upload/bulk-regenerate-password/System Announcements already use) — the response
returns immediately with `recipientCount`/`sendEmailQueued`; the actual sends happen after the
response, never blocking the request or test publishing.

## Duplicate protection

`TestNotificationSend.idempotencyKey` is a unique DB column. The frontend generates one UUID per
dialog open (`useState`'s lazy initializer, once per mount) and resends it unchanged on any retry
of that same click. The backend tries to `create` a record with that key first; a unique-constraint
collision (`P2002`) means this exact click was already processed and returns the original result
instead of sending anything again. A genuinely new dialog open later (e.g. after a refresh) gets
its own fresh key — a deliberate new send, not blocked.

## Institute isolation

Same `canStaffAccessTest` + `requesterInstituteId` check as every other test-scoped route on this
platform. Live-verified: an Institute B admin gets 403 on both the recipient preview and the send
for a test under Institute A.

## Tests performed (live, against isolated throwaway data — institutes/students/tests created and
deleted by the test script itself, nothing real touched)

1. Create test → 0 new EmailLog rows. **PASS**
2. Edit test (PATCH content route) → 0 new EmailLog rows. **PASS**
3. Save draft → same route as edit, confirmed same. **PASS**
4. Publish test → 0 new EmailLog rows; exactly 2 new in-app `Notification` rows (one per eligible
   student). **PASS**
5. Assign test to Talent Pool → fixed via the same `{sendEmail:false}` pattern as #4 and confirmed
   via code audit; **not independently live round-tripped through `POST /talent-pools/:id/tests`**
   in this pass (noted honestly, not claimed as tested).
6. Manual Send Notification → 2 EmailLog rows written, both reached genuine `SENT` status via
   real Gmail SMTP. **PASS**
7. In-app notification → 2 new `TEST_NOTIFICATION` rows written. **PASS**
8. Multiple clicks (same idempotencyKey, simulating double-click/retry) → second call returned
   `alreadySent:true`; EmailLog count and Notification count both stayed at 2, not 4. **PASS**
9. Refresh (fresh idempotencyKey) → sent successfully as a new, legitimate action (2 more
   notifications, total 4) — confirms a genuine repeat click is not silently swallowed. **PASS**
10. Different institute → both the recipient preview and the send correctly returned 403 for an
    Institute B admin against an Institute A test. **PASS**
11. (Bonus) Unpublished test → `POST /:id/notify` correctly rejected with 400. **PASS**
12. (Bonus) `GET /:id/notification-log` → showed exactly 2 sends, with the email send's
    success/failed rollup correctly accounting for both recipients. **PASS**

## Reminders

No scheduled reminder system (24h/1h/starting-soon) exists for ordinary Tests today — only Talent
Pool assessments have an opt-in reminder scheduler (`talentPoolReminderScheduler.js`,
`notifyDeadlineReminder`), which is unrelated to this fix and left untouched. Building test-specific
scheduled reminders was not in scope for this pass (the spec's own phrasing was conditional: "if
the platform has scheduled reminders, keep them separate").

## PASS / FAIL / BLOCKED

**Backend: PASS**, live-verified end-to-end per the test log above.

**Frontend: code complete, committed, and confirmed present on the canonical GitHub repo — BLOCKED
on deploy.** Vercel's live bundle had not picked up the new commit after 5+ minutes of polling,
unusual compared to every other frontend change deployed earlier this same session (each of which
appeared within ~1-2 minutes via the identical push). I have no Vercel dashboard/API access to
diagnose or trigger a redeploy from here — check the Vercel project's dashboard for a failed or
stuck build, or trigger a manual redeploy, then verify the "Send Notification" button appears on
`/staff` (or wherever `StaffDashboard.jsx` is mounted) next to a published test's Publish/Unpublish
buttons.
