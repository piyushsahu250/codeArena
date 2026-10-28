// Database access for changing a live test's duration and for the student's clock sync. No rules here (tests.duration.domain.js and the service decide).
const prisma = require("../../prisma");
const { buildAuditData, AUDIT_ACTIONS } = require("../../utils/auditLog");

const ACTION = AUDIT_ACTIONS.TEST_DURATION_CHANGED;
const forTest = (testId) => ({ action: ACTION, details: { path: ["testId"], equals: testId } });

const findTest = (id) => prisma.test.findUnique({ where: { id }, include: { shares: { select: { staffId: true } } } });

// Attempt counts by stored status (indexed by testId): started = all, active = IN_PROGRESS, completed = SUBMITTED + AUTO_SUBMITTED.
async function attemptCounts(testId) {
  const rows = await prisma.testAttempt.groupBy({ by: ["status"], where: { testId }, _count: { _all: true } });
  const by = Object.fromEntries(rows.map((r) => [String(r.status).toUpperCase(), r._count._all]));
  const active = by.IN_PROGRESS || 0;
  const completed = (by.SUBMITTED || 0) + (by.AUTO_SUBMITTED || 0);
  const started = rows.reduce((n, r) => n + r._count._all, 0);
  return { started, active, completed, other: started - active - completed };
}
const activeStarts = async (testId) => (await prisma.testAttempt.findMany({ where: { testId, status: "IN_PROGRESS" }, select: { startedAt: true } })).map((a) => a.startedAt);

// Earlier changes of this test, oldest first (the first one's "previous" is the duration the test was scheduled with).
const changeHistory = (testId) => prisma.auditLog.findMany({ where: forTest(testId), orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, adminName: true, details: true } });
const findByRequest = (testId, requestId) => prisma.auditLog.findFirst({ where: { AND: [forTest(testId), { details: { path: ["requestId"], equals: requestId } }] }, select: { details: true, createdAt: true } });

class VersionConflict extends Error {}

// The change and its audit record commit together or not at all. The write only succeeds when the version is still the one the administrator read (optimistic concurrency: a second
// administrator, or a repeat of a request, finds the version moved and is refused). `makeDetails(startedAtsOfRunningAttempts)` builds the audit details from the running attempts as
// seen AFTER the write, inside the same transaction, so the counts in the record are the counts the change actually applied to.
async function applyChange({ testId, expectedVersion, newMin, entry, makeDetails }) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.test.updateMany({ where: { id: testId, version: expectedVersion }, data: { durationMin: newMin, version: { increment: 1 } } });
    if (res.count !== 1) throw new VersionConflict();
    const starts = (await tx.testAttempt.findMany({ where: { testId, status: "IN_PROGRESS" }, select: { startedAt: true } })).map((a) => a.startedAt);
    const details = makeDetails(starts, expectedVersion + 1);
    await tx.auditLog.create({ data: buildAuditData({ ...entry, details }) });
    return { version: expectedVersion + 1, details };
  });
}

// What the student's clock sync needs: whose attempt it is, its stored status and start, and the test's current duration and configuration version.
const attemptClock = (attemptId) => prisma.testAttempt.findUnique({ where: { id: attemptId }, select: { id: true, studentId: true, status: true, startedAt: true, test: { select: { durationMin: true, version: true } } } });

module.exports = { findTest, attemptCounts, activeStarts, changeHistory, findByRequest, applyChange, attemptClock, VersionConflict };
