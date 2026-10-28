// Test authoring and management rules: create, edit, duplicate, delete, publish, notify, share. No req/res: callers pass an `actor`
//   { user, requesterInstituteId, req }   (req is used only for the audit entry's IP and device)
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/tests-contract.json).
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { canStaffAccessTest } = require("../../utils/testOwnership");
const { resolveSubjectUnitTopic, canStaffUseSubject } = require("../../utils/subjectAccess");
const { parseSecurityInput } = require("../../utils/testExamSecurity");
const { validateTestForPublish } = require("../../utils/testPublishValidation");
const { getTestRecipients } = require("../../utils/testEligibility");
const { notifyTestAssigned, notifyMany, emailStudent } = require("../../utils/notifications");
const { escapeHtml } = require("../../utils/mailer");
const { mapWithConcurrency } = require("../../utils/queue");
const prisma = require("../../prisma");
const d = require("./tests.domain");
const repo = require("./tests.repository");
const { assertNoLiveDurationChange } = require("./tests.duration.service");

const NOTIFY_EMAIL_CONCURRENCY = Number(process.env.EMAIL_CONCURRENCY) || 5;
// Minutes before the SAME test can be e-mailed to its students again (in-app notifications are not limited). TEST_EMAIL_NOTIFY_COOLDOWN_MIN overrides it.
const EMAIL_NOTIFY_COOLDOWN_MIN = Number(process.env.TEST_EMAIL_NOTIFY_COOLDOWN_MIN) || 10;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";

// A service result that also needs work done AFTER the response has been sent (the background e-mail batch).
const AFTER = Symbol("after");

const audit = (actor, action, instituteId, details) => logAudit({ req: actor.req, action, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role, instituteId, details });

// ---- shared guards ----
function requireInstitute(actor, test, message, strict) {
  if (d.outsideInstitute(actor, test, strict)) throw new ServiceError(403, message);
}
function requireAccess(actor, test, message) {
  if (!canStaffAccessTest(actor, test)) throw new ServiceError(403, message);
}
async function loadOr404(promise) {
  const test = await promise;
  if (!test) throw new ServiceError(404, "Test not found");
  return test;
}

// Subject alone (no Unit) is valid for a test; when a Unit is given it is validated against the Subject like Question authoring.
async function resolveTestSubjectUnit(actor, { subjectId, unitId }) {
  if (!subjectId) return { subjectId: null, unitId: null };
  if (unitId) return resolveSubjectUnitTopic(actor, { subjectId, unitId });
  if (!(await canStaffUseSubject(actor, subjectId))) return { error: "You aren't authorized to use this subject" };
  return { subjectId, unitId: null };
}

// RANDOM mode resolves the pool server-side from the chosen bank folder; the client never supplies the id list.
async function resolveQuestionIds(mode, questionIds, randomBankFolderId) {
  if (mode !== "RANDOM") return questionIds || [];
  if (!randomBankFolderId) throw new Error("Select a Question Bank folder for random question selection");
  const bankQuestions = await repo.bankCodingQuestionIds(randomBankFolderId);
  if (bankQuestions.length === 0) throw new Error("The selected Question Bank has no coding questions");
  return bankQuestions.map((q) => q.id);
}

// Every submitted academic group must belong to the requester's own institute (no-op for a platform-level requester).
async function assertGroupsBelongToInstitute(academicGroupIds, requesterInstituteId) {
  if (!requesterInstituteId || !academicGroupIds || academicGroupIds.length === 0) return;
  const groups = await repo.groupsByIds(academicGroupIds);
  const foreign = groups.some((g) => g.instituteId !== requesterInstituteId);
  if (foreign || groups.length !== academicGroupIds.length) throw new ServiceError(403, "You can only assign a test to academic groups under your own institute");
}

// ---- create ----
async function createTest(actor, body) {
  const { subject, unit, title, allowDuplicate, subjectId, unitId, academicGroupIds, questionSelectionMode, randomBankFolderId, randomQuestionsPerStudent, difficultyDistribution, questionIds, instituteId: bodyInstituteId } = body;
  const sec = parseSecurityInput(body);
  if (sec.error) throw new ServiceError(400, sec.error);

  const resolvedSubject = await resolveTestSubjectUnit(actor, { subjectId, unitId });
  if (resolvedSubject.error) throw new ServiceError(400, resolvedSubject.error);

  if (subject?.trim() && !allowDuplicate) {
    const duplicate = await repo.findSameTitle(actor.user.id, subject.trim(), unit?.trim() || null, (title || "").trim());
    if (duplicate) {
      throw new ServiceError(409, "duplicate test", { rawBody: { duplicate: true, existing: { id: duplicate.id, title: duplicate.title, subject: duplicate.subject, unit: duplicate.unit } } });
    }
  }

  const effectiveInstituteId = actor.requesterInstituteId || (bodyInstituteId || null);
  if (!actor.requesterInstituteId && bodyInstituteId) {
    if (!(await repo.instituteExists(bodyInstituteId))) throw new ServiceError(400, "Selected institute was not found");
  }
  await assertGroupsBelongToInstitute(academicGroupIds, effectiveInstituteId);

  const mode = d.SELECTION_MODES.includes(questionSelectionMode) ? questionSelectionMode : "FIXED";
  const resolvedQuestionIds = await resolveQuestionIds(mode, questionIds, randomBankFolderId);
  d.validateRandomConfig(mode, randomQuestionsPerStudent, difficultyDistribution, resolvedQuestionIds.length);

  const test = await repo.createTest(d.buildCreateData(body, { mode, resolvedQuestionIds, sec, subject: resolvedSubject, instituteId: effectiveInstituteId, userId: actor.user.id }));
  await audit(actor, AUDIT_ACTIONS.TEST_CREATED, effectiveInstituteId, { testId: test.id, title: test.title, questionCount: test.questions.length });
  return test;
}

// ---- edit ----
async function updateTest(actor, id, body) {
  const existing = await loadOr404(repo.findWithShares(id));
  requireInstitute(actor, existing, "You can only manage tests under your own institute", true);
  requireAccess(actor, existing, "You can only edit tests you created or that were shared with you");

  // Optimistic concurrency: only enforced when the client sent the version it read.
  if (body.version !== undefined && Number(body.version) !== existing.version) {
    throw new ServiceError(409, "This test was modified by another user. Please refresh before saving.", { conflict: true });
  }
  // A duration change while attempts are running goes through "Edit live duration" (preview, confirmation, audit), never silently through this form.
  await assertNoLiveDurationChange(existing, body);

  const { questionIds, questionTimeLimits, questionAiAllowed, academicGroupIds, questionSelectionMode, randomBankFolderId, randomQuestionsPerStudent, difficultyDistribution, instituteId: bodyInstituteId, subjectId, unitId, scheduledPublishAt } = body;
  const sec = parseSecurityInput(body);
  if (sec.error) throw new ServiceError(400, sec.error);

  const schedule = d.resolveScheduledPublishAt(existing, scheduledPublishAt);
  if (schedule.error) throw new ServiceError(400, schedule.error);

  let resolvedSubject = { subjectId: existing.subjectId, unitId: existing.unitId };
  if (subjectId !== undefined || unitId !== undefined) {
    if (subjectId) {
      resolvedSubject = await resolveTestSubjectUnit(actor, { subjectId, unitId: unitId !== undefined ? unitId : existing.unitId });
      if (resolvedSubject.error) throw new ServiceError(400, resolvedSubject.error);
    } else {
      resolvedSubject = { subjectId: null, unitId: null };
    }
  }

  // Only a platform-level requester may move a test to another institute.
  let effectiveInstituteId = existing.instituteId;
  if (!actor.requesterInstituteId && bodyInstituteId !== undefined) {
    if (bodyInstituteId && !(await repo.instituteExists(bodyInstituteId))) throw new ServiceError(400, "Selected institute was not found");
    effectiveInstituteId = bodyInstituteId || null;
  }
  await assertGroupsBelongToInstitute(academicGroupIds, effectiveInstituteId);

  const mode = d.selectionModeForUpdate(existing, questionSelectionMode);
  const bankFolderId = mode === "RANDOM" ? (randomBankFolderId ?? existing.randomBankFolderId) : null;
  const perStudent = mode === "RANDOM" ? (randomQuestionsPerStudent ?? existing.randomQuestionsPerStudent) : null;
  const distribution = mode === "RANDOM" ? (difficultyDistribution !== undefined ? difficultyDistribution : existing.difficultyDistribution) : null;

  // RANDOM mode re-resolves from the bank folder on every save; FIXED mode replaces questions only when questionIds is sent.
  const resolvedQuestionIds = mode === "RANDOM" ? await resolveQuestionIds("RANDOM", null, bankFolderId) : questionIds;
  if (mode === "RANDOM") d.validateRandomConfig("RANDOM", perStudent, distribution, resolvedQuestionIds.length);

  const data = d.buildUpdateData(existing, body, { instituteId: effectiveInstituteId, subject: resolvedSubject, sec, mode, bankFolderId, perStudent, distribution, scheduledPublishAt: schedule.value });
  const questionRows = resolvedQuestionIds ? d.questionCreateData(resolvedQuestionIds, questionTimeLimits, questionAiAllowed) : null;
  await repo.updateTest(existing.id, data, questionRows, academicGroupIds || null);

  const test = await repo.findFull(existing.id);
  await audit(actor, AUDIT_ACTIONS.TEST_UPDATED, existing.instituteId, { testId: test.id, title: test.title });
  return test;
}

// ---- duplicate ----
async function duplicateTest(actor, id) {
  const original = await loadOr404(repo.findForDuplicate(id));
  requireInstitute(actor, original, "You can only duplicate tests under your own institute", true);
  requireAccess(actor, original, "You can only duplicate tests you created or that were shared with you");
  const copy = await repo.createTest(d.buildDuplicateData(original, actor.user.id));
  await audit(actor, AUDIT_ACTIONS.TEST_DUPLICATED, original.instituteId, { originalTestId: original.id, newTestId: copy.id, title: copy.title });
  return copy;
}

// ---- delete (admin tier only) ----
async function deleteTest(actor, id) {
  const existing = await loadOr404(repo.findInstituteAndTitle(id));
  requireInstitute(actor, existing, "You can only delete tests under your own institute", true);
  await repo.deleteTest(id);
  await audit(actor, AUDIT_ACTIONS.TEST_DELETED, existing.instituteId, { testId: id, title: existing.title });
  return { success: true };
}

// ---- publish / unpublish ----
async function setPublished(actor, id, isPublished) {
  const existing = await loadOr404(repo.findForPublish(id));
  requireInstitute(actor, existing, "You can only manage tests under your own institute", true);
  requireAccess(actor, existing, "You can only publish tests you created or that were shared with you");

  // Going live must never succeed silently on a broken configuration; taking a test down always succeeds.
  if (isPublished) {
    const problems = validateTestForPublish(existing);
    if (problems.length) throw new ServiceError(400, "Cannot publish — please fix the following:", { problems });
  }

  const test = await repo.setPublished(id, !!isPublished);
  const change = d.publishTransition(existing.isPublished, test.isPublished);
  if (change === "PUBLISHED") {
    await audit(actor, AUDIT_ACTIONS.TEST_PUBLISHED, actor.requesterInstituteId, { testId: test.id, title: test.title });
    // In-app notification only: publishing must never e-mail students (that is the separate, explicit notify action).
    getTestRecipients(prisma, test.id).then((students) => notifyTestAssigned(prisma, students, test)).catch((err) => console.error("[tests.publish] notification failed:", err));
  } else if (change === "UNPUBLISHED") {
    await audit(actor, AUDIT_ACTIONS.TEST_UNPUBLISHED, actor.requesterInstituteId, { testId: test.id, title: test.title });
  }
  return test;
}

// ---- notifications ----
async function notificationRecipients(actor, id) {
  const test = await loadOr404(repo.findForNotify(id, {}));
  requireInstitute(actor, test, "You can only manage notifications for tests under your own institute", false);
  requireAccess(actor, test, "You can only manage notifications for tests you created or that were shared with you");
  const recipients = await getTestRecipients(prisma, test.id);
  const { counts, info } = await repo.groupCountsForStudents(recipients.map((s) => s.id));
  const { breakdown, ungroupedCount } = d.recipientBreakdown(recipients.length, counts, info);
  return { test: { id: test.id, title: test.title }, recipientCount: recipients.length, breakdown, ungroupedCount };
}

async function notify(actor, id, body) {
  const { sendEmail, sendInApp, idempotencyKey } = body;
  if (!sendEmail && !sendInApp) throw new ServiceError(400, "Select at least one notification type (Email or In-App)");
  if (!idempotencyKey || typeof idempotencyKey !== "string") throw new ServiceError(400, "idempotencyKey is required");

  const test = await loadOr404(repo.findForNotify(id, { isPublished: true }));
  requireInstitute(actor, test, "You can only send notifications for tests under your own institute", false);
  requireAccess(actor, test, "You can only send notifications for tests you created or that were shared with you");
  if (!test.isPublished) throw new ServiceError(400, "Publish this test before notifying students — an unpublished test isn't visible to them yet.");

  const recipients = await getTestRecipients(prisma, test.id);

  // Idempotency: a key already used for THIS test means this exact click was already processed. A key that belongs to a different test is a collision, never an answer to hand
  // back: the lookup is by key alone, so it used to return another test's (possibly another institute's) send details and silently skip this send.
  const answerFor = (existing) => {
    if (existing.testId !== test.id) throw new ServiceError(409, "This request key was already used for a different notification. Please try again.");
    return { alreadySent: true, recipientCount: existing.recipientCount, sentAt: existing.createdAt, sendEmail: existing.sendEmail, sendInApp: existing.sendInApp };
  };
  const earlier = await repo.findNotificationSendByKey(idempotencyKey);
  if (earlier) return answerFor(earlier);

  // E-mail cooldown per test. The idempotency key only stops a double click: a dialog opened again, or a new key per request, e-mailed every eligible student again each time,
  // and the mail sender's daily allowance is shared with password and credential e-mails. In-app notifications are not affected.
  if (sendEmail && recipients.length > 0) {
    const cooldownMs = EMAIL_NOTIFY_COOLDOWN_MIN * 60 * 1000;
    const recent = await repo.latestEmailSendSince(test.id, new Date(Date.now() - cooldownMs));
    if (recent) {
      const waitMin = Math.max(1, Math.ceil((recent.createdAt.getTime() + cooldownMs - Date.now()) / 60000));
      throw new ServiceError(429, `An e-mail notification for this test was already sent a few minutes ago. To avoid flooding students, wait about ${waitMin} more minute${waitMin === 1 ? "" : "s"} before e-mailing again (an in-app notification can still be sent).`);
    }
  }

  // Create the record; a unique-key collision here is a concurrent request with the same key.
  let sendRecord;
  try {
    sendRecord = await repo.createNotificationSend({
      testId: test.id, idempotencyKey, sendEmail: !!sendEmail, sendInApp: !!sendInApp,
      recipientCount: recipients.length, sentById: actor.user.id, sentByName: actor.user.name,
    });
  } catch (err) {
    if (err.code === "P2002") {
      const existing = await repo.findNotificationSendByKey(idempotencyKey);
      if (existing) return answerFor(existing);
    }
    throw err;
  }

  if (sendInApp && recipients.length > 0) {
    await notifyMany(prisma, recipients.map((s) => s.id), { type: "TEST_NOTIFICATION", message: `Reminder: "${test.title}" is available`, link: "/dashboard" });
  }
  await audit(actor, AUDIT_ACTIONS.TEST_NOTIFICATION_SENT, actor.requesterInstituteId, {
    testId: test.id, title: test.title, sendEmail: !!sendEmail, sendInApp: !!sendInApp, recipientCount: recipients.length, sendId: sendRecord.id,
  });

  const result = { recipientCount: recipients.length, sendEmailQueued: !!sendEmail && recipients.length > 0, sendId: sendRecord.id };
  // The e-mail batch runs after the response so a slow mail server never holds up the click.
  const after = () => {
    if (!(sendEmail && recipients.length > 0)) return;
    mapWithConcurrency(recipients, NOTIFY_EMAIL_CONCURRENCY, (s) =>
      emailStudent(
        prisma, s, `Notification: "${test.title}"`,
        `<p>Hi ${escapeHtml(s.name)},</p><p>You have a notification about <strong>${escapeHtml(test.title)}</strong>.</p><p><a href="${FRONTEND_URL}/tests">View your Tests</a></p>`,
        "TEST_NOTIFICATION", sendRecord.id
      ).catch((e) => ({ ok: false, error: e.message }))
    ).catch((err) => console.error("[tests.notify] background email batch failed:", err));
  };
  return { [AFTER]: after, body: result };
}

async function notificationLog(actor, id) {
  const test = await loadOr404(repo.findForNotify(id, {}));
  requireInstitute(actor, test, "You can only view notification history for tests under your own institute", false);
  requireAccess(actor, test, "You can only view notification history for tests you created or that were shared with you");
  const sends = await repo.listNotificationSends(test.id);
  const results = await Promise.all(sends.map(async (send) => {
    let emailSuccess = 0, emailFailed = 0, failures = [];
    if (send.sendEmail) {
      const logs = await repo.emailLogsForBatch(send.id);
      emailSuccess = logs.filter((l) => l.status === "SENT").length;
      emailFailed = logs.filter((l) => l.status === "FAILED").length;
      failures = logs.filter((l) => l.status === "FAILED").map((l) => ({ email: l.recipientEmail, reason: l.errorMessage }));
    }
    return { id: send.id, sendEmail: send.sendEmail, sendInApp: send.sendInApp, recipientCount: send.recipientCount, sentByName: send.sentByName, createdAt: send.createdAt, emailSuccess, emailFailed, failures };
  }));
  return { test: { id: test.id, title: test.title }, sends: results };
}

// ---- sharing (only the creator or an admin may grant or revoke; a shared-with colleague cannot re-share) ----
async function shareTest(actor, id, staffIds = []) {
  const test = await loadOr404(repo.findOwnership(id));
  requireInstitute(actor, test, "You can only manage tests under your own institute", false);
  if (actor.user.role === "STAFF" && test.createdById !== actor.user.id) throw new ServiceError(403, "Only the test's creator can share it");
  if (staffIds.length > 0) {
    // Every target must be an actual STAFF account in the requester's institute: never trusted from the client.
    const rows = await repo.staffInScope(staffIds, actor.requesterInstituteId);
    if (rows.length !== staffIds.length) throw new ServiceError(400, "One or more selected staff members are not valid for this institute");
    await repo.addShares(staffIds.map((staffId) => ({ testId: test.id, staffId, sharedByUserId: actor.user.id, sharedByName: actor.user.name })));
  }
  return { success: true };
}

async function unshareTest(actor, id, staffId) {
  const test = await loadOr404(repo.findOwnership(id));
  requireInstitute(actor, test, "You can only manage tests under your own institute", false);
  if (actor.user.role === "STAFF" && test.createdById !== actor.user.id) throw new ServiceError(403, "Only the test's creator can revoke sharing");
  await repo.removeShare(test.id, staffId);
  return { success: true };
}

const staffDirectory = (actor) => repo.listStaff(actor.user.id, actor.requesterInstituteId);

module.exports = { AFTER, createTest, updateTest, duplicateTest, deleteTest, setPublished, notificationRecipients, notify, notificationLog, shareTest, unshareTest, staffDirectory };
