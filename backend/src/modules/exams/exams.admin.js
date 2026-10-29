// Section-wise examination: administration (definitions, validation, publish, attempts, analytics, review, result publication, export). Authorisation follows the platform's
// existing model: a platform-level administrator (no institute) sees everything; an institute administrator sees their institute's examinations; staff only the ones they created.
// Institute isolation is applied in every query here, never only in the screen.
const prisma = require("../../prisma");
const SM = require("../../utils/examStateMachine");
const Src = require("../../utils/examSources");
const B = require("../../utils/examBlueprint");
const Scoring = require("../../utils/examScoring");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const core = require("./exams.core");
const attempts = require("./exams.attempts");
const aiEval = require("./exams.interviewEval");

const { ATTEMPT } = SM;
const { fail, okv } = attempts;
const PAGE_MAX = 100;

// ---- authorisation ---------------------------------------------------------------------------------------------------------------------------------------------------------
function canManage(req, exam) {
  if (!exam) return false;
  if (req.requesterInstituteId && exam.instituteId !== req.requesterInstituteId) return false; // institute isolation
  if (req.user.role === "STAFF" && exam.createdById !== req.user.id) return false;
  return true;
}
function scopeWhere(req) {
  const where = {};
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  if (req.user.role === "STAFF") where.createdById = req.user.id;
  return where;
}
const paging = (q) => {
  const pageSize = Math.min(PAGE_MAX, Math.max(1, parseInt(q.pageSize, 10) || 25));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  return { take: pageSize, skip: (page - 1) * pageSize, page, pageSize };
};

async function validateGroups(instituteId, ids) {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((x) => typeof x === "string"))] : [];
  if (!list.length) return okv({ groupIds: [] });
  const rows = await prisma.academicGroup.findMany({ where: { id: { in: list } }, select: { id: true, instituteId: true } });
  if (rows.length !== list.length) return fail(400, "GROUP_NOT_FOUND", "One of the selected groups does not exist.");
  if (instituteId && rows.some((r) => r.instituteId !== instituteId)) return fail(400, "GROUP_OTHER_INSTITUTE", "A selected group belongs to another institute.");
  return okv({ groupIds: list });
}

// ---- definitions -----------------------------------------------------------------------------------------------------------------------------------------------------------
async function createExam(req, body) {
  const title = String(body?.blueprint?.title ?? body?.title ?? "").trim();
  if (!title) return fail(400, "TITLE_REQUIRED", "Enter an examination title.");
  const instituteId = req.requesterInstituteId || (body.instituteId ? String(body.instituteId) : null);
  const g = await validateGroups(instituteId, body.academicGroupIds);
  if (!g.ok) return g;
  const validation = Src.validateFullBlueprint({ ...(body.blueprint || {}), title });
  const exam = await prisma.$transaction(async (tx) => {
    const e = await tx.examDefinition.create({ data: { title, description: body.description ?? body.blueprint?.description ?? null, blueprint: validation.normalized, instituteId, createdById: req.user.id } });
    if (g.groupIds.length) await tx.examAcademicGroup.createMany({ data: g.groupIds.map((academicGroupId) => ({ examId: e.id, academicGroupId })) });
    return e;
  });
  return okv({ exam, validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings } });
}

async function updateExam(req, exam, body) {
  const nextBlueprint = body.blueprint ? { ...body.blueprint, title: body.title ?? body.blueprint.title ?? exam.title } : exam.blueprint;
  const validation = Src.validateFullBlueprint(nextBlueprint);
  const data = { blueprint: validation.normalized };
  if (body.title !== undefined || body.blueprint?.title !== undefined) data.title = String(body.title ?? body.blueprint.title).trim() || exam.title;
  if (body.description !== undefined) data.description = body.description;
  let groupIds = null;
  if (body.academicGroupIds !== undefined) {
    const g = await validateGroups(exam.instituteId, body.academicGroupIds);
    if (!g.ok) return g;
    groupIds = g.groupIds;
  }
  await prisma.$transaction(async (tx) => {
    await tx.examDefinition.update({ where: { id: exam.id }, data });
    if (groupIds) { await tx.examAcademicGroup.deleteMany({ where: { examId: exam.id } }); if (groupIds.length) await tx.examAcademicGroup.createMany({ data: groupIds.map((academicGroupId) => ({ examId: exam.id, academicGroupId })) }); }
  });
  // what the running attempts depend on does not change: they keep the published version they started under (see publishExam)
  const published = exam.version > 0 ? await prisma.examVersion.findUnique({ where: { examId_version: { examId: exam.id, version: exam.version } } }) : null;
  const changed = published ? B.lockedFieldsChanged(published.blueprint, validation.normalized) : [];
  return okv({ validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings }, changedSincePublished: changed });
}

async function publishExam(req, exam) {
  const full = Src.validateFullBlueprint(exam.blueprint);
  const gate = B.canPublish(full.normalized);
  if (!gate.ok || !full.valid) return fail(422, "INVALID_CONFIGURATION", "Fix the configuration errors before publishing.", { errors: full.errors, warnings: full.warnings });
  const avail = await core.availability(full.normalized, exam.instituteId);
  if (avail.shortages.length) return fail(422, "NOT_ENOUGH_QUESTIONS", "The question banks do not hold enough valid questions for this examination.", { shortages: avail.shortages, invalidCount: avail.invalidCount });
  const version = exam.version + 1;
  await prisma.$transaction(async (tx) => {
    await tx.examVersion.create({ data: { examId: exam.id, version, blueprint: full.normalized, publishedById: req.user.id } });
    await tx.examDefinition.update({ where: { id: exam.id }, data: { status: "PUBLISHED", version } });
  });
  const onOlder = await prisma.examAttempt.count({ where: { examId: exam.id, status: { in: [ATTEMPT.READINESS_CHECK, ATTEMPT.IN_PROGRESS] } } });
  logAudit({ req, action: AUDIT_ACTIONS.EXAM_PUBLISHED, actorId: req.user.id, actorRole: req.user.role, details: { examId: exam.id, version, invalidQuestionsExcluded: avail.invalidCount } });
  return okv({ version, warnings: full.warnings, invalidQuestionsExcluded: avail.invalidCount, attemptsStillOnEarlierVersions: onOlder });
}

async function listExams(req, query) {
  const { take, skip, page, pageSize } = paging(query);
  const where = { ...scopeWhere(req), ...(query.status ? { status: String(query.status) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.examDefinition.findMany({ where, orderBy: { updatedAt: "desc" }, take, skip, select: { id: true, title: true, status: true, version: true, instituteId: true, createdById: true, updatedAt: true, blueprint: true, _count: { select: { attempts: true } } } }),
    prisma.examDefinition.count({ where }),
  ]);
  return { page, pageSize, total, exams: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, version: r.version, instituteId: r.instituteId, updatedAt: r.updatedAt, mode: r.blueprint?.mode, startAt: r.blueprint?.startAt, endAt: r.blueprint?.endAt, totalMarks: r.blueprint?.totalMarks, attempts: r._count.attempts })) };
}

async function getExam(req, exam) {
  const groups = await prisma.examAcademicGroup.findMany({ where: { examId: exam.id }, select: { academicGroupId: true } });
  const byStatus = await prisma.examAttempt.groupBy({ by: ["status", "mode"], where: { examId: exam.id }, _count: { _all: true } });
  const validation = Src.validateFullBlueprint(exam.blueprint);
  return { exam: { id: exam.id, title: exam.title, description: exam.description, status: exam.status, version: exam.version, instituteId: exam.instituteId, blueprint: exam.blueprint, academicGroupIds: groups.map((g) => g.academicGroupId), updatedAt: exam.updatedAt }, validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings }, attemptCounts: byStatus.map((r) => ({ status: r.status, mode: r.mode, count: r._count._all })) };
}

// ---- attempts and analytics ---------------------------------------------------------------------------------------------------------------------------------------------
async function listAttempts(exam, query) {
  const { take, skip, page, pageSize } = paging(query);
  const where = { examId: exam.id, ...(query.mode ? { mode: String(query.mode) } : { mode: "PROCTORED" }), ...(query.status ? { status: String(query.status) } : {}), ...(query.resultStatus ? { resultStatus: String(query.resultStatus) } : {}), ...(query.needsReview === "true" ? { needsReview: true } : {}) };
  const [rows, total] = await Promise.all([
    prisma.examAttempt.findMany({ where, orderBy: { createdAt: "desc" }, take, skip, select: { id: true, status: true, mode: true, resultStatus: true, startedAt: true, submittedAt: true, warningCount: true, needsReview: true, result: true, student: { select: { name: true, registrationNumber: true, rollNumber: true, department: true, batchYear: true } } } }),
    prisma.examAttempt.count({ where }),
  ]);
  return { page, pageSize, total, attempts: rows.map((a) => ({ id: a.id, status: a.status, mode: a.mode, resultStatus: a.resultStatus, startedAt: a.startedAt, submittedAt: a.submittedAt, warningCount: a.warningCount, needsReview: a.needsReview, student: a.student, obtained: a.result?.obtained ?? null, percent: a.result?.percent ?? null, passed: a.result?.passed ?? null, final: a.result?.final ?? null })) };
}

// Aggregates over official (proctored) attempts in bounded batches: the whole table is never loaded into memory.
async function analytics(exam) {
  const base = { examId: exam.id, mode: "PROCTORED" };
  const byStatus = await prisma.examAttempt.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const eligible = await eligibleCount(exam);
  const sums = { n: 0, final: 0, passed: 0, failed: 0, percent: 0, sections: {} };
  let cursor;
  for (;;) {
    const rows = await prisma.examAttempt.findMany({ where: { ...base, result: { not: null } }, select: { id: true, result: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!rows.length) break;
    for (const r of rows) {
      cursor = r.id;
      if (!r.result?.final) continue;
      sums.final++; sums.percent += r.result.percent || 0;
      if (r.result.passed === true) sums.passed++; else if (r.result.passed === false) sums.failed++;
      for (const s of r.result.sections || []) { const t = (sums.sections[s.key] ||= { n: 0, percent: 0 }); if (typeof s.percent === "number") { t.n++; t.percent += s.percent; } }
    }
    if (rows.length < 500) break;
  }
  const [evalFailed, evalPending, reviewPending] = await Promise.all([
    prisma.examAnswer.count({ where: { attempt: { examId: exam.id, mode: "PROCTORED" }, evaluation: { path: ["status"], equals: "FAILED" } } }),
    prisma.examAnswer.count({ where: { attempt: { examId: exam.id, mode: "PROCTORED" }, evaluation: { path: ["status"], equals: "PENDING" } } }),
    prisma.examEvent.count({ where: { attempt: { examId: exam.id, mode: "PROCTORED" }, reviewStatus: "PENDING" } }),
  ]);
  const started = byStatus.reduce((a, r) => a + r._count._all, 0);
  const completed = byStatus.filter((r) => ["SUBMITTED", "EXPIRED", "EVALUATING", "COMPLETED"].includes(r.status)).reduce((a, r) => a + r._count._all, 0);
  const avg = (t) => (t && t.n ? Scoring.round2(t.percent / t.n) : null);
  return {
    eligibleStudents: eligible, started, participationRate: eligible ? Scoring.round2((started / eligible) * 100) : null, completed, completionRate: started ? Scoring.round2((completed / started) * 100) : null,
    byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })), finalResults: sums.final, averagePercent: sums.final ? Scoring.round2(sums.percent / sums.final) : null,
    passRate: sums.passed + sums.failed ? Scoring.round2((sums.passed / (sums.passed + sums.failed)) * 100) : null,
    sectionAveragePercent: Object.fromEntries(B.SECTION_KEYS.map((k) => [k, avg(sums.sections[k])])),
    evaluationsFailed: evalFailed, evaluationsPending: evalPending, proctoringEventsAwaitingReview: reviewPending,
  };
}

async function eligibleCount(exam) {
  const groups = await prisma.examAcademicGroup.findMany({ where: { examId: exam.id }, select: { academicGroupId: true } });
  const where = { role: "STUDENT", isActive: true, ...(exam.instituteId ? { instituteId: exam.instituteId } : {}), ...(groups.length ? { academicGroupId: { in: groups.map((g) => g.academicGroupId) } } : {}) };
  return prisma.user.count({ where });
}

const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; }; // also neutralises spreadsheet formulas

async function* csvRows(exam) {
  yield ["Attempt ID", "Student", "PRN", "Roll", "Department", "Batch", "Status", "Result status", "Aptitude", "Technical", "Coding", "AI interview", "Total", "Max", "Percent", "Passed", "Warnings", "Needs review"].map(csvCell).join(",") + "\n";
  let cursor;
  for (;;) {
    const rows = await prisma.examAttempt.findMany({ where: { examId: exam.id, mode: "PROCTORED" }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), select: { id: true, status: true, resultStatus: true, result: true, warningCount: true, needsReview: true, student: { select: { name: true, registrationNumber: true, rollNumber: true, department: true, batchYear: true } } } });
    if (!rows.length) return;
    for (const r of rows) {
      cursor = r.id;
      const sec = Object.fromEntries((r.result?.sections || []).map((s) => [s.key, s.obtained]));
      yield [r.id, r.student?.name, r.student?.registrationNumber, r.student?.rollNumber, r.student?.department, r.student?.batchYear, r.status, r.resultStatus, sec.APTITUDE, sec.TECHNICAL, sec.CODING, sec.AI_INTERVIEW, r.result?.final ? r.result.obtained : "", r.result?.totalMarks, r.result?.final ? r.result.percent : "", r.result?.passed, r.warningCount, r.needsReview].map(csvCell).join(",") + "\n";
    }
    if (rows.length < 500) return;
  }
}

// ---- review, invalidation, publication ----------------------------------------------------------------------------------------------------------------------------
async function invalidateAttempt(req, attempt, reason) {
  const text = String(reason || "").trim();
  if (text.length < 5) return fail(400, "REASON_REQUIRED", "Give a reason (at least 5 characters). It is recorded in the audit log.");
  const check = SM.checkAttemptTransition(attempt.status, ATTEMPT.INVALIDATED, { actor: "ADMIN" });
  if (!check.ok) return fail(409, check.code, check.message);
  const won = await prisma.examAttempt.updateMany({ where: { id: attempt.id, status: attempt.status }, data: { status: ATTEMPT.INVALIDATED, resultStatus: "INVALIDATED", invalidatedReason: text } });
  if (!won.count) return fail(409, "CONFLICT", "The attempt changed while you were invalidating it. Reload and try again.");
  logAudit({ req, action: AUDIT_ACTIONS.EXAM_ATTEMPT_INVALIDATED, actorId: req.user.id, actorRole: req.user.role, studentId: attempt.studentId, details: { attemptId: attempt.id, examId: attempt.examId, from: attempt.status, reason: text } });
  return okv();
}

async function reviewEvent(req, attempt, eventId, { status, note }) {
  if (!["DISMISSED", "CONFIRMED"].includes(status)) return fail(400, "STATUS_INVALID", "A review is either DISMISSED or CONFIRMED.");
  const text = String(note || "").trim().slice(0, 1000);
  if (status === "CONFIRMED" && text.length < 5) return fail(400, "NOTE_REQUIRED", "Confirming a violation needs a note explaining the evidence.");
  const ev = await prisma.examEvent.findFirst({ where: { id: eventId, attemptId: attempt.id } });
  if (!ev) return fail(404, "EVENT_NOT_FOUND", "Event not found.");
  await prisma.examEvent.update({ where: { id: ev.id }, data: { reviewStatus: status, reviewNote: text || null, reviewedById: req.user.id, reviewedAt: new Date() } });
  const open = await prisma.examEvent.count({ where: { attemptId: attempt.id, reviewStatus: "PENDING" } });
  if (!open) await prisma.examAttempt.update({ where: { id: attempt.id }, data: { needsReview: false } });
  logAudit({ req, action: AUDIT_ACTIONS.EXAM_EVENT_REVIEWED, actorId: req.user.id, actorRole: req.user.role, studentId: attempt.studentId, details: { attemptId: attempt.id, eventId, type: ev.type, status, note: text } });
  await attempts.recomputeResult(attempt.id); // UNDER_REVIEW becomes COMPLETED once nothing is waiting
  return okv({ openReviews: open });
}

async function publishResult(req, attempt) {
  if (attempt.mode !== "PROCTORED") return fail(400, "NOT_OFFICIAL", "Only an official result is published.");
  await attempts.recomputeResult(attempt.id);
  const fresh = await prisma.examAttempt.findUnique({ where: { id: attempt.id }, select: { result: true, resultStatus: true, status: true } });
  const open = await prisma.examEvent.count({ where: { attemptId: attempt.id, reviewStatus: "PENDING", requiresReview: true } });
  const reviewRequired = !!attempt.blueprint.proctoring?.reviewRequired;
  const can = Scoring.canPublishResult(fresh.result, { reviewOpen: reviewRequired && open > 0 });
  if (!can.ok) return fail(409, can.code, can.message || "The result cannot be published yet.");
  if (fresh.status === ATTEMPT.INVALIDATED) return fail(409, "INVALIDATED", "An invalidated attempt cannot be published.");
  await prisma.examAttempt.update({ where: { id: attempt.id }, data: { resultStatus: "PUBLISHED" } });
  logAudit({ req, action: AUDIT_ACTIONS.EXAM_RESULT_PUBLISHED, actorId: req.user.id, actorRole: req.user.role, studentId: attempt.studentId, details: { attemptId: attempt.id, examId: attempt.examId, obtained: fresh.result.obtained } });
  return okv();
}

async function publishAllResults(req, exam) {
  let published = 0; const skipped = {}; let cursor;
  for (;;) {
    const rows = await prisma.examAttempt.findMany({ where: { examId: exam.id, mode: "PROCTORED", resultStatus: "COMPLETED" }, select: { id: true }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!rows.length) break;
    for (const r of rows) {
      cursor = r.id;
      const a = await attempts.loadFull(r.id);
      const res = await publishResult(req, a);
      if (res.ok) published++; else skipped[res.code] = (skipped[res.code] || 0) + 1;
    }
    if (rows.length < 100) break;
  }
  return { published, skipped };
}

async function retryEvaluation(req, attempt) {
  const count = await aiEval.retryFailedEvaluations(attempt.id, { onSettled: attempts.refreshAfterEvaluation });
  // coding submissions that were waiting for the judge are judged again; the result is recomputed afterwards
  await attempts.scoreAndStoreSection(attempt.id, "CODING");
  await attempts.refreshAfterEvaluation(attempt.id);
  logAudit({ req, action: AUDIT_ACTIONS.EXAM_EVALUATION_RETRIED, actorId: req.user.id, actorRole: req.user.role, studentId: attempt.studentId, details: { attemptId: attempt.id, interviewAnswersRetried: count } });
  return okv({ interviewAnswersRetried: count });
}

// ---- helper lists for the editor -------------------------------------------------------------------------------------------------------------------------------------------
async function sources(req, query) {
  const { instituteWhere } = require("../../utils/questionVisibility");
  const instituteId = req.requesterInstituteId || (query.instituteId ? String(query.instituteId) : null);
  const [subjects, aptitude, coding] = await Promise.all([
    prisma.subject.findMany({ where: instituteId ? { OR: [{ instituteId }, { instituteId: null }] } : {}, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.interviewQuestion.groupBy({ by: ["aptitudeCategory"], where: { category: "APTITUDE", isActive: true, generatedForStudentId: null, ...instituteWhere(instituteId) }, _count: { _all: true } }),
    prisma.question.findMany({ where: { questionType: { in: ["CODING", "SQL"] }, questionStatus: "PUBLISHED", ...(query.search ? { OR: [{ title: { contains: String(query.search), mode: "insensitive" } }, { description: { contains: String(query.search), mode: "insensitive" } }] } : {}), ...instituteWhere(instituteId) }, select: { id: true, title: true, questionNumber: true, difficulty: true, questionType: true }, orderBy: { questionNumber: "desc" }, take: 50 }),
  ]);
  return { subjects, aptitudeCounts: aptitude.map((r) => ({ category: r.aptitudeCategory, count: r._count._all })), codingQuestions: coding };
}

module.exports = { canManage, scopeWhere, createExam, updateExam, publishExam, listExams, getExam, listAttempts, analytics, csvRows, invalidateAttempt, reviewEvent, publishResult, publishAllResults, retryEvaluation, sources };
