// Administrator override of a failed STRICT start requirement (a secure-client session) for ONE student on ONE module-coding assessment.
//
// Why it exists: a strict exam never silently runs in a plain browser. If a student's managed device fails at the exam desk, an authorised administrator may let that
// one student start anyway, deliberately and on the record. Rules the code enforces:
//   * the grant is a server-side record (an ExamSecurityEvent row, no schema change), created only by an institute admin / admin of the test's institute, with a reason;
//   * it is for one student and one test, expires (default 30 minutes, at most 120) and is single-use: the first start consumes it atomically;
//   * it only waives the missing secure-client session. Phone refusal, the timer, attempt limits, single-session, publishing and every other check still apply;
//   * an attempt that was started under an override remembers it (START_OVERRIDE_USED event), so it can be resumed without a secure session, and nothing else can;
//   * every grant, use and revoke is a HIGH-visibility security event AND an audit-log entry, shown in the attempt's security timeline.
// Not a verdict and not a score: these events carry no weight in the risk score.
const { cleanMetadata } = require("./examSecurity");

const TYPES = Object.freeze({ GRANTED: "START_OVERRIDE_GRANTED", USED: "START_OVERRIDE_USED", REVOKED: "START_OVERRIDE_REVOKED" });
const KIND = "MODULE_CODING";
const MIN_REASON = 10;
const MAX_REASON = 200;
const DEFAULT_TTL_MIN = 30;
const MAX_TTL_MIN = 120;

// Validates an administrator's request body. Returns { ok, error } or { ok, value }.
function parseGrantInput(body) {
  const b = body && typeof body === "object" ? body : {};
  const testId = typeof b.testId === "string" ? b.testId.trim() : "";
  const studentId = typeof b.studentId === "string" ? b.studentId.trim() : "";
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!testId || testId.length > 64) return { ok: false, error: "testId is required" };
  if (!studentId || studentId.length > 64) return { ok: false, error: "studentId is required" };
  if (reason.length < MIN_REASON) return { ok: false, error: `A reason of at least ${MIN_REASON} characters is required (it is written to the audit log)` };
  const ttlRaw = b.ttlMinutes === undefined || b.ttlMinutes === null ? DEFAULT_TTL_MIN : Number(b.ttlMinutes);
  if (!Number.isFinite(ttlRaw) || ttlRaw <= 0) return { ok: false, error: "ttlMinutes must be a positive number" };
  return { ok: true, value: { testId, studentId, reason: reason.slice(0, MAX_REASON), ttlMin: Math.min(MAX_TTL_MIN, Math.max(1, Math.floor(ttlRaw))) } };
}

// A grant is usable only while it is unused and unrevoked (reviewStatus PENDING) and has not expired.
const isActiveGrant = (row, now = Date.now()) => !!row && row.type === TYPES.GRANTED && row.reviewStatus === "PENDING" && Number(row.metadata?.expiresAt) > now;

async function findActiveGrant(prisma, studentId, testId, now = Date.now()) {
  const rows = await prisma.examSecurityEvent.findMany({ where: { attemptKind: KIND, type: TYPES.GRANTED, studentId, testId, reviewStatus: "PENDING" }, orderBy: { createdAt: "desc" }, take: 5 });
  return rows.find((r) => isActiveGrant(r, now)) || null;
}

async function createGrant(prisma, { student, test, instituteId, actor, reason, ttlMin, now = Date.now() }) {
  const expiresAt = now + ttlMin * 60 * 1000;
  const row = await prisma.examSecurityEvent.create({
    data: {
      attemptKind: KIND, attemptId: "none", studentId: student.id, testId: test.id, type: TYPES.GRANTED, severity: "HIGH", instituteId: instituteId || student.instituteId || null,
      metadata: cleanMetadata({ reason, expiresAt, ttlMin, grantedById: actor.id, grantedByRole: actor.role }),
    },
  });
  return { row, expiresAt };
}

// Atomic single use: only one caller can move the grant from PENDING to REVIEWED.
async function consumeGrant(prisma, grantId) {
  const r = await prisma.examSecurityEvent.updateMany({ where: { id: grantId, type: TYPES.GRANTED, reviewStatus: "PENDING" }, data: { reviewStatus: "REVIEWED", reviewNote: "USED", reviewedAt: new Date() } });
  return r.count === 1;
}

async function recordUse(prisma, { grant, attemptId, studentId, testId, instituteId }) {
  await prisma.examSecurityEvent.create({
    data: { attemptKind: KIND, attemptId, studentId, testId, type: TYPES.USED, severity: "HIGH", instituteId: instituteId || null, metadata: cleanMetadata({ grantId: grant.id, grantedById: grant.metadata?.grantedById, reason: grant.metadata?.reason }) },
  });
  positive.set(attemptId, Date.now());
}

// Revokes an unused grant. False when it was already used or revoked (nothing to revoke).
async function revokeGrant(prisma, grant, actor) {
  const r = await prisma.examSecurityEvent.updateMany({
    where: { id: grant.id, type: TYPES.GRANTED, reviewStatus: "PENDING" },
    data: { reviewStatus: "REVIEWED", reviewNote: "REVOKED", reviewedById: actor.id, reviewedAt: new Date() },
  });
  if (r.count !== 1) return false;
  await prisma.examSecurityEvent.create({
    data: { attemptKind: KIND, attemptId: "none", studentId: grant.studentId, testId: grant.testId, type: TYPES.REVOKED, severity: "MEDIUM", instituteId: grant.instituteId || null, metadata: cleanMetadata({ grantId: grant.id, revokedById: actor.id }) },
  });
  return true;
}

// Did this attempt start under an override? Positive answers are cached briefly (an attempt never loses its override), so this is not a query per exam call.
const positive = new Map();
const POSITIVE_TTL_MS = 5 * 60 * 1000;
async function attemptHasOverride(prisma, attemptId) {
  const hit = positive.get(attemptId);
  if (hit && Date.now() - hit < POSITIVE_TTL_MS) return true;
  const row = await prisma.examSecurityEvent.findFirst({ where: { attemptKind: KIND, attemptId, type: TYPES.USED }, select: { id: true } });
  if (row) positive.set(attemptId, Date.now());
  return !!row;
}

module.exports = { TYPES, MIN_REASON, MAX_REASON, DEFAULT_TTL_MIN, MAX_TTL_MIN, parseGrantInput, isActiveGrant, findActiveGrant, createGrant, consumeGrant, recordUse, revokeGrant, attemptHasOverride };
