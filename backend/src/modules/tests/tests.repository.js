// All database access for test authoring and management. No rules here: the service decides what is allowed; this only reads and writes.
const prisma = require("../../prisma");
const { TEST_PUBLISH_VALIDATION_INCLUDE } = require("../../utils/testPublishValidation");

const FULL_INCLUDE = { questions: true, classes: true, academicGroups: true };
const SHARES = { shares: { select: { staffId: true } } };

const findWithShares = (id) => prisma.test.findUnique({ where: { id }, include: SHARES });
const findForDuplicate = (id) => prisma.test.findUnique({ where: { id }, include: { questions: true, classes: true, academicGroups: true, ...SHARES } });
const findForPublish = (id) => prisma.test.findUnique({ where: { id }, include: { ...SHARES, ...TEST_PUBLISH_VALIDATION_INCLUDE } });
const findForNotify = (id, select) => prisma.test.findUnique({ where: { id }, select: { id: true, title: true, instituteId: true, createdById: true, ...select, ...SHARES } });
const findOwnership = (id) => prisma.test.findUnique({ where: { id }, select: { id: true, createdById: true, instituteId: true } });
const findInstituteAndTitle = (id) => prisma.test.findUnique({ where: { id }, select: { instituteId: true, title: true } });
const findFull = (id) => prisma.test.findUnique({ where: { id }, include: FULL_INCLUDE });

const findSameTitle = (userId, subject, unit, title) => prisma.test.findFirst({
  where: {
    createdById: userId,
    subject: { equals: subject, mode: "insensitive" },
    unit: unit ? { equals: unit, mode: "insensitive" } : null,
    title: { equals: title, mode: "insensitive" },
  },
});

const instituteExists = (id) => prisma.institute.findUnique({ where: { id }, select: { id: true } });
const groupsByIds = (ids) => prisma.academicGroup.findMany({ where: { id: { in: ids } }, select: { id: true, instituteId: true } });
const bankCodingQuestionIds = (folderId) => prisma.question.findMany({ where: { folderId, questionType: "CODING" }, select: { id: true } });

const createTest = (data) => prisma.test.create({ data, include: FULL_INCLUDE });
const deleteTest = (id) => prisma.test.delete({ where: { id } });
const setPublished = (id, isPublished) => prisma.test.update({ where: { id }, data: { isPublished, scheduledPublishAt: null } });

// Edit: the test row plus (when sent) a full replacement of its questions and group assignments, in one transaction.
function updateTest(id, data, questionRows, groupIds) {
  return prisma.$transaction(async (tx) => {
    await tx.test.update({ where: { id }, data });
    if (questionRows) {
      await tx.testQuestion.deleteMany({ where: { testId: id } });
      await tx.testQuestion.createMany({ data: questionRows.map((q) => ({ ...q, testId: id })) });
    }
    if (groupIds) {
      await tx.testAcademicGroup.deleteMany({ where: { testId: id } });
      if (groupIds.length > 0) await tx.testAcademicGroup.createMany({ data: groupIds.map((academicGroupId) => ({ testId: id, academicGroupId })) });
    }
  });
}

async function groupCountsForStudents(studentIds) {
  if (studentIds.length === 0) return { counts: [], info: new Map() };
  const counts = await prisma.user.groupBy({ by: ["academicGroupId"], where: { id: { in: studentIds } }, _count: true });
  const groupIds = counts.map((g) => g.academicGroupId).filter(Boolean);
  const groups = groupIds.length > 0
    ? await prisma.academicGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, batch: true, section: true, department: { select: { name: true } }, institute: { select: { name: true } } } })
    : [];
  return { counts, info: new Map(groups.map((g) => [g.id, g])) };
}

const createNotificationSend = (data) => prisma.testNotificationSend.create({ data });
const findNotificationSendByKey = (idempotencyKey) => prisma.testNotificationSend.findUnique({ where: { idempotencyKey } });
const listNotificationSends = (testId) => prisma.testNotificationSend.findMany({ where: { testId }, orderBy: { createdAt: "desc" } });
const emailLogsForBatch = (batchId) => prisma.emailLog.findMany({ where: { batchId }, select: { status: true, recipientEmail: true, errorMessage: true } });

const listStaff = (excludeUserId, instituteId) => prisma.user.findMany({
  where: { role: "STAFF", id: { not: excludeUserId }, ...(instituteId ? { instituteId } : {}) },
  select: { id: true, name: true },
  orderBy: { name: "asc" },
});
const staffInScope = (ids, instituteId) => prisma.user.findMany({ where: { id: { in: ids }, role: "STAFF", ...(instituteId ? { instituteId } : {}) }, select: { id: true } });
const addShares = (rows) => prisma.testShare.createMany({ data: rows, skipDuplicates: true });
const removeShare = (testId, staffId) => prisma.testShare.deleteMany({ where: { testId, staffId } });

module.exports = {
  findWithShares, findForDuplicate, findForPublish, findForNotify, findOwnership, findInstituteAndTitle, findFull, findSameTitle, instituteExists, groupsByIds,
  bankCodingQuestionIds, createTest, deleteTest, setPublished, updateTest, groupCountsForStudents, createNotificationSend, findNotificationSendByKey,
  listNotificationSends, emailLogsForBatch, listStaff, staffInScope, addShares, removeShare,
};

// ================= batch 2: reading tests and the student attempt flow =================

const STAFF_LIST_INCLUDE = {
  _count: { select: { questions: true, attempts: true } },
  institute: { select: { id: true, name: true } },
  classes: { include: { class: { select: { id: true, name: true, batchYear: true, instituteId: true, institute: { select: { id: true, name: true } }, _count: { select: { users: true } } } } } },
  academicGroups: {
    include: {
      academicGroup: {
        select: { id: true, batch: true, section: true, instituteId: true, institute: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, _count: { select: { users: true } } },
      },
    },
  },
  talentPools: { select: { poolId: true } },
  createdBy: { select: { id: true, name: true } },
  shares: { select: { staffId: true } },
};
const STUDENT_LIST_SELECT = {
  id: true, title: true, company: true, startTime: true, endTime: true, durationMin: true, attendanceMandatory: true, _count: { select: { questions: true } },
};

const listTests = (where, forStaff, take) => prisma.test.findMany({ where, orderBy: { startTime: "asc" }, take, ...(forStaff ? { include: STAFF_LIST_INCLUDE } : { select: STUDENT_LIST_SELECT }) });
const studentScope = (userId) => prisma.user.findUnique({ where: { id: userId }, select: { classId: true, academicGroupId: true, instituteId: true } });
const attemptStatusesFor = (studentId, testIds) => prisma.testAttempt.findMany({ where: { studentId, testId: { in: testIds } }, select: { testId: true, status: true } });

// The answer-key fields are selected for staff only; for a student the select drops them (allowlist), and hidden test cases are filtered out.
function questionSelect(isStaff) {
  return {
    id: true, questionNumber: true, title: true, description: true, subject: true, topic: true, questionType: true, difficulty: true, points: true, timeLimitMs: true,
    starterCode: true, starterCodeByLanguage: true, evaluationType: true, functionSignature: true, options: true,
    correctAnswer: isStaff, numericAnswer: isStaff, numericTolerance: isStaff, numericAnswerDisplay: isStaff, explanation: isStaff,
    imageKey: true,
    testCases: { where: isStaff ? {} : { isHidden: false } },
  };
}
const findDetail = (id, isStaff) => prisma.test.findUnique({
  where: { id },
  include: {
    classes: { select: { classId: true } },
    academicGroups: { select: { academicGroupId: true } },
    talentPools: { select: { poolId: true } },
    shares: { select: { staffId: true, staff: { select: { id: true, name: true } } } },
    questions: { include: { question: { select: questionSelect(isStaff) } }, orderBy: { order: "asc" } },
  },
});
const attemptLayout = (testId, studentId) => prisma.testAttempt.findUnique({
  where: { testId_studentId: { testId, studentId } },
  select: { questionOrder: true, optionOrder: true, status: true, id: true, expectedQuestionCount: true, manifestVersion: true },
});
const questionsByIds = (ids, isStaff) => prisma.question.findMany({ where: { id: { in: ids } }, select: questionSelect(isStaff) });
const attendanceStatus = (studentId, testId) => prisma.attendanceRecord.findFirst({ where: { studentId, session: { testId } }, select: { status: true } });

const findForStart = (id) => prisma.test.findUnique({
  where: { id },
  include: {
    classes: { select: { classId: true } },
    academicGroups: { select: { academicGroupId: true } },
    talentPools: { select: { poolId: true } },
    questions: { include: { question: { select: { id: true, questionType: true, options: true, difficulty: true } } } },
  },
});
const findAttempt = (testId, studentId) => prisma.testAttempt.findUnique({ where: { testId_studentId: { testId, studentId } } });
const findReattemptGrant = (testId, studentId) => prisma.testReattemptGrant.findUnique({ where: { testId_studentId: { testId, studentId } } });
const consumeReattemptGrant = (id) => prisma.testReattemptGrant.delete({ where: { id } }).catch(() => {});
const createAttempt = (data) => prisma.testAttempt.create({ data });
const setSession = (attemptId, sessionId) => prisma.testAttempt.update({ where: { id: attemptId }, data: { sessionId } });
const submissionsOf = (attemptId) => prisma.submission.findMany({ where: { attemptId } });

const attemptById = (id) => prisma.testAttempt.findUnique({ where: { id } });
const suspiciousCount = (attemptId) => prisma.testViolation.count({ where: { attemptId, severity: "SUSPICIOUS" } });
const logViolation = (attemptId, type, severity, penalized) => prisma.testViolation.create({ data: { attemptId, type, severity, penalized } });
// A penalized event and the strike-count update describe one event: written together so a partial write never leaves them out of sync.
const logPenalizedViolation = (attemptId, type, severity, tabSwitchCount, autoSubmitted) => prisma.$transaction([
  prisma.testViolation.create({ data: { attemptId, type, severity, penalized: true } }),
  prisma.testAttempt.update({ where: { id: attemptId }, data: { tabSwitchCount, ...(autoSubmitted ? { status: "AUTO_SUBMITTED", submittedAt: new Date() } : {}) } }),
]);
const attemptForAdminReview = (id) => prisma.testAttempt.findUnique({
  where: { id },
  include: { test: { select: { instituteId: true, createdById: true, shares: { select: { staffId: true } } } }, student: { select: { name: true, email: true } } },
});
const violationsOf = (attemptId) => prisma.testViolation.findMany({ where: { attemptId }, orderBy: { createdAt: "asc" } });

const attemptForAi = (id) => prisma.testAttempt.findUnique({ where: { id }, select: { id: true, testId: true, studentId: true, status: true } });
const testQuestionForAi = (testId, questionId) => prisma.testQuestion.findUnique({
  where: { testId_questionId: { testId, questionId } },
  select: { aiAllowed: true, question: { select: { title: true, description: true, questionType: true, subject: true, topic: true, options: true } } },
});
const studentInstitute = (userId) => prisma.user.findUnique({ where: { id: userId }, select: { instituteId: true } });

const testForResult = (id) => prisma.test.findUnique({ where: { id }, select: { id: true, showResults: true, passingMarks: true } });
const attemptWithSubmissions = (testId, studentId) => prisma.testAttempt.findUnique({ where: { testId_studentId: { testId, studentId } }, include: { submissions: true } });

Object.assign(module.exports, {
  listTests, studentScope, attemptStatusesFor, findDetail, attemptLayout, questionsByIds, attendanceStatus, findForStart, findAttempt, findReattemptGrant, consumeReattemptGrant,
  createAttempt, setSession, submissionsOf, attemptById, suspiciousCount, logViolation, logPenalizedViolation, attemptForAdminReview, violationsOf, attemptForAi, testQuestionForAi,
  studentInstitute, testForResult, attemptWithSubmissions,
});

// ================= batch 3: results, export, question analytics, reattempt =================

const testForResults = (id) => prisma.test.findUnique({ where: { id }, select: { instituteId: true, createdById: true, shares: { select: { staffId: true } } } });
const attemptsForResults = (testId, studentWhere) => prisma.testAttempt.findMany({
  where: { testId, ...studentWhere },
  include: { student: { select: { name: true, email: true, rollNumber: true, registrationNumber: true } }, submissions: { select: { questionId: true } } },
  orderBy: { totalScore: "desc" },
  take: 20000,
});
const testForExport = (id) => prisma.test.findUnique({
  where: { id },
  select: { title: true, passingMarks: true, instituteId: true, createdById: true, shares: { select: { staffId: true } }, questions: { select: { questionId: true, question: { select: { points: true } } } } },
});
const attemptsForExport = (testId, studentWhere) => prisma.testAttempt.findMany({
  where: { testId, ...studentWhere },
  include: { student: { select: { name: true, email: true, rollNumber: true, registrationNumber: true } }, submissions: { select: { questionId: true } } },
  orderBy: [{ totalScore: "desc" }, { startedAt: "asc" }],
  take: 20000,
});
const testForAnalytics = (id) => prisma.test.findUnique({
  where: { id },
  select: {
    instituteId: true, createdById: true, shares: { select: { staffId: true } },
    questions: { orderBy: { order: "asc" }, select: { questionId: true, question: { select: { questionNumber: true, title: true, points: true, questionType: true } } } },
  },
});
const submissionsForAnalytics = (testId, questionIds, studentWhere) => (questionIds.length
  ? prisma.submission.findMany({ where: { attempt: { testId }, questionId: { in: questionIds }, ...(studentWhere.student ? { student: studentWhere.student } : {}) }, select: { questionId: true, score: true, studentId: true } })
  : Promise.resolve([]));

const reattemptInputs = (testId, studentId) => Promise.all([
  prisma.test.findUnique({ where: { id: testId }, select: { id: true, title: true, createdById: true, shares: { select: { staffId: true } } } }),
  prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true, rollNumber: true, instituteId: true } }),
  prisma.testAttempt.findUnique({ where: { testId_studentId: { testId, studentId } } }),
]);
const adminName = (userId) => prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
// Delete the old attempt (its submissions cascade), grant a one-time bypass of the closed window, and write the audit entry: all or nothing.
const grantReattemptTx = ({ attemptId, testId, studentId, grantedByUserId, grantedByName, audit }) => prisma.$transaction([
  prisma.testAttempt.delete({ where: { id: attemptId } }),
  prisma.testReattemptGrant.upsert({
    where: { testId_studentId: { testId, studentId } },
    create: { testId, studentId, grantedByUserId, grantedByName },
    update: { grantedByUserId, grantedByName, grantedAt: new Date() },
  }),
  prisma.auditLog.create({ data: audit }),
]);

Object.assign(module.exports, { testForResults, attemptsForResults, testForExport, attemptsForExport, testForAnalytics, submissionsForAnalytics, reattemptInputs, adminName, grantReattemptTx });
