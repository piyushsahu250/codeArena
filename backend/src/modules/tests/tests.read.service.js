// Reading tests: the list and the single-test detail, for staff (management view) and students (their assigned tests). No req/res.
// One deliberate change from the route this replaced: a student can no longer open an UNPUBLISHED test by id. The list always hid drafts, but the detail
// route returned a draft's instructions, schedule, creator and question summary to any student in its audience. A student who already has an attempt on a
// test keeps access if it is later unpublished, so an exam in progress never breaks.
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { isTestVisibleToStudent, testEligibilityWhere } = require("../../utils/testEligibility");
const { getStudentPoolIds } = require("../../utils/talentPoolEligibility");
const { staffTestAccessWhere, canStaffAccessTest } = require("../../utils/testOwnership");
const { policyOf } = require("../../utils/testExamSecurity");
const X = require("../../utils/examSecurity");
const questionImages = require("../../utils/questionImages");
const { logCountMismatch } = require("../../utils/attemptManifest");
const d = require("./tests.domain");
const repo = require("./tests.repository");

const accountGone = () => new ServiceError(401, "This account no longer exists. Please log in again.", { authExpired: true });

async function listTests(actor) {
  const staff = d.isStaffRole(actor.user.role);
  let where;
  if (staff) {
    where = d.staffListWhere(actor.requesterInstituteId, staffTestAccessWhere(actor));
  } else {
    const student = await repo.studentScope(actor.user.id);
    // A valid session can outlive the user row; treat it like any other dead session.
    if (!student) throw accountGone();
    const memberPoolIds = await getStudentPoolIds(prisma, actor.user.id);
    where = { isPublished: true, ...testEligibilityWhere(student.academicGroupId, student.classId, [...memberPoolIds], student.instituteId) };
  }
  const tests = await repo.listTests(where, staff, d.TESTS_LIST_CAP);
  if (staff) return tests;
  // The student's own attempt status per test, so the dashboard can show "Completed" up front.
  const mine = await repo.attemptStatusesFor(actor.user.id, tests.map((t) => t.id));
  const statusByTest = Object.fromEntries(mine.map((a) => [a.testId, a.status]));
  return tests.map((t) => ({ ...t, myStatus: statusByTest[t.id] || null }));
}

async function getTest(actor, id) {
  const staff = d.isStaffRole(actor.user.role);
  const test = await repo.findDetail(id, staff);
  if (!test) throw new ServiceError(404, "Test not found");

  if (staff) {
    if (actor.requesterInstituteId && test.instituteId && test.instituteId !== actor.requesterInstituteId) throw new ServiceError(403, "You can only view tests under your own institute");
    if (!canStaffAccessTest(actor, test)) throw new ServiceError(403, "You can only view tests you created or that were shared with you");
  } else {
    const student = await repo.studentScope(actor.user.id);
    if (!student) throw accountGone();
    const memberPoolIds = await getStudentPoolIds(prisma, actor.user.id);
    if (!isTestVisibleToStudent(test, student.academicGroupId, student.classId, memberPoolIds, student.instituteId)) throw new ServiceError(404, "Test not found");

    const attempt = await repo.attemptLayout(test.id, actor.user.id);
    if (!test.isPublished && !attempt) throw new ServiceError(404, "Test not found");

    // Question content only while the attempt is running (or finished after the window closed); otherwise an aggregate summary.
    if (!d.questionsVisible(attempt, test)) {
      test.questionSummary = d.questionSummaryOf(test);
      test.questions = [];
      test.questionsWithheld = true;
    }
    if (!test.questionsWithheld && attempt?.questionOrder) {
      const onTest = new Set(test.questions.map((tq) => tq.questionId));
      const missingIds = attempt.questionOrder.filter((qId) => !onTest.has(qId));
      const extra = missingIds.length > 0 ? await repo.questionsByIds(missingIds, staff) : [];
      const { ordered, stillMissing } = d.orderForAttempt(test.questions, attempt.questionOrder, extra);
      if (stillMissing.length > 0) console.error(`[tests] attempt for student ${actor.user.id} on test ${test.id} references deleted question(s): ${stillMissing.join(", ")}`);
      test.questions = ordered;
      // Authoritative manifest for the client: how many questions this attempt must show and exactly which (ids only).
      const expected = attempt.expectedQuestionCount ?? attempt.questionOrder.length;
      test.manifest = { version: attempt.manifestVersion ?? 0, expectedCount: expected, questionIds: attempt.questionOrder, unavailableCount: stillMissing.length };
      logCountMismatch("GET /tests/:id", { attemptId: attempt.id, testId: test.id, expected, manifest: attempt.questionOrder.length, delivered: test.questions.length });
    }
    if (!test.questionsWithheld && attempt?.optionOrder) d.applyOptionOrder(test.questions, attempt.optionOrder);
  }

  // The student's own attendance status for a test that requires it, computed here and never trusted from the client.
  if (actor.user.role === "STUDENT" && test.attendanceMandatory) {
    const record = await repo.attendanceStatus(actor.user.id, test.id);
    test.attendanceStatus = record ? record.status : "NOT_MARKED";
  }

  test.security = X.clientPolicy(policyOf(test));
  if (!staff) delete test.securityPolicy;
  await questionImages.attachQuestionImageUrls(test.questions);
  return test;
}

module.exports = { listTests, getTest };
