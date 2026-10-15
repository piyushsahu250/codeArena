// Staff-side results for a test: the leaderboard, the spreadsheet export, per-question analytics, and granting a student a reattempt. No req/res: callers pass
// an `actor` { user, requesterInstituteId, req }.
//
// Changes from the routes this replaced (all tightenings or additions, none alters a response shape):
//   * An institute-bound requester only sees attempts by students of their OWN institute. A platform-wide test can be attempted by students of several
//     institutes, and the old routes returned every one of them (names, e-mails, roll numbers, scores) to any institute's staff.
//   * The leaderboard has the same 20,000-row cap the export always had.
//   * An export writes an audit entry (it carries student names, e-mails and PRNs) and is rate limited per user.
//   * A reattempt's audit entry now records the institute, the acting role and what the deleted attempt held (it was the only record of that attempt).
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { canStaffAccessTest } = require("../../utils/testOwnership");
const { scoreBases } = require("../../utils/attemptManifest");
const d = require("./tests.domain");
const repo = require("./tests.repository");

async function loadScoped(promise, actor, outsideMessage, accessMessage) {
  const test = await promise;
  if (!test) throw new ServiceError(404, "Test not found");
  if (actor.requesterInstituteId && test.instituteId && test.instituteId !== actor.requesterInstituteId) throw new ServiceError(403, outsideMessage);
  if (!canStaffAccessTest(actor, test)) throw new ServiceError(403, accessMessage);
  return test;
}

async function leaderboard(actor, testId) {
  await loadScoped(repo.testForResults(testId), actor, "You can only view results for tests under your own institute", "You can only view results for tests you created or that were shared with you");
  return repo.attemptsForResults(testId, d.studentInstituteWhere(actor.requesterInstituteId));
}

// Returns what the controller needs to send the file: rows, file name, format.
async function exportResults(actor, testId, query) {
  const test = await loadScoped(repo.testForExport(testId), actor, "You can only export results for tests under your own institute", "You can only export results for tests you created or that were shared with you");
  const attempts = await repo.attemptsForExport(testId, d.studentInstituteWhere(actor.requesterInstituteId));
  // Each attempt is scored out of ITS OWN assigned questions (manifest); points come from the Question table so a question removed later still counts.
  const bases = await scoreBases(prisma, attempts);
  const rows = d.resultExportRows(attempts, bases, test, query.roll, typeof query.q === "string" ? query.q : "");
  const format = query.format === "csv" ? "csv" : "xlsx";
  await logAudit({
    req: actor.req, action: AUDIT_ACTIONS.DATA_EXPORTED, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role, instituteId: actor.requesterInstituteId,
    details: { entity: "test-results", testId, rows: rows.length, format, rollFilter: query.roll ? true : false, searchFilter: typeof query.q === "string" && query.q.trim() ? true : false },
  });
  return { rows, filename: `${d.exportFilename(test.title)}-results`, format };
}

async function questionAnalytics(actor, testId) {
  const test = await loadScoped(repo.testForAnalytics(testId), actor, "You can only view analytics for tests under your own institute", "You can only view analytics for tests you created or that were shared with you");
  const questionIds = test.questions.map((tq) => tq.questionId);
  const submissions = await repo.submissionsForAnalytics(testId, questionIds, d.studentInstituteWhere(actor.requesterInstituteId));
  return d.questionAnalyticsRows(test.questions, submissions);
}

// Deletes the student's finished attempt and grants a one-time bypass of the test window, so their next start creates a fresh attempt.
async function grantReattempt(actor, testId, studentId) {
  const [test, student, attempt] = await repo.reattemptInputs(testId, studentId);
  if (!test) throw new ServiceError(404, "Test not found");
  if (!student) throw new ServiceError(404, "Student not found");
  if (actor.requesterInstituteId && student.instituteId !== actor.requesterInstituteId) throw new ServiceError(403, "You can only manage students under your own institute");
  if (!canStaffAccessTest(actor, test)) throw new ServiceError(403, "You can only manage reattempts for tests you created or that were shared with you");
  if (!attempt) throw new ServiceError(404, "This student has not attempted this test");
  if (attempt.status === "IN_PROGRESS") throw new ServiceError(400, "This student's attempt is still in progress — nothing to reset");

  const admin = await repo.adminName(actor.user.id);
  const name = admin?.name || actor.user.email;
  await repo.grantReattemptTx({
    attemptId: attempt.id, testId, studentId, grantedByUserId: actor.user.id, grantedByName: name,
    audit: {
      action: AUDIT_ACTIONS.REATTEMPT_GRANTED, adminId: actor.user.id, adminName: name, adminRole: actor.user.role, studentId: student.id, instituteId: student.instituteId,
      details: d.reattemptAuditDetails(student, test, attempt),
    },
  });
  return { success: true };
}

module.exports = { leaderboard, exportResults, questionAnalytics, grantReattempt };
