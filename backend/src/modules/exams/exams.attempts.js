// Section-wise examination: the attempt engine (start/resume, section transitions, answer saving, coding run/submit, completion, expiry, events, result).
// Every state change is a conditional update (`WHERE status = <expected>`) checked first against utils/examStateMachine.js, so two concurrent requests cannot both win a
// transition and a replayed request is a no-op. The server's clock is the only clock. Practice attempts (attemptKey PRACTICE-n) are separate rows and never appear in official results.
const crypto = require("crypto");
const prisma = require("../../prisma");
const SM = require("../../utils/examStateMachine");
const Scoring = require("../../utils/examScoring");
const Src = require("../../utils/examSources");
const Q = require("../../utils/examQuestions");
const P = require("../../utils/interviewViolationPolicy");
const { classifyViolation } = require("../../utils/proctoringSeverity");
const { judgeSubmission } = require("../../utils/judgeGateway");
const { runQueued } = require("../../utils/queue");
const { dedupe } = require("../../utils/requestDedup");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { SECTION_KEYS, SECTION_LABELS } = require("../../utils/examBlueprint");
const core = require("./exams.core");
const aiEval = require("./exams.interviewEval");

const { ATTEMPT, SECTION } = SM;
const MAX_PRACTICE_ATTEMPTS = 50;
const EVENT_CAP_PER_ATTEMPT = P.MAX_EVENT_ROWS_PER_SESSION;
const MAX_CODE_HISTORY = 20;
const isUniqueViolation = (e) => e && e.code === "P2002";
const fail = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });
const okv = (value = {}) => ({ ok: true, ...value });

// ---- loading ------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function loadFull(id) {
  const a = await prisma.examAttempt.findUnique({ where: { id }, include: { examVersion: true, sections: true, exam: { select: { id: true, title: true, instituteId: true, description: true } } } });
  if (!a) return null;
  a.blueprint = Src.normalizeBlueprint(a.examVersion.blueprint);
  a.sections.sort((x, y) => SECTION_KEYS.indexOf(x.key) - SECTION_KEYS.indexOf(y.key));
  return a;
}

// ---- eligibility and start ------------------------------------------------------------------------------------------------------------------------------------------------
function studentCanSee(student, exam) {
  if (!exam || exam.status !== "PUBLISHED") return false;
  if (exam.instituteId && exam.instituteId !== student.instituteId) return false;
  const groups = (exam.groups || []).map((g) => g.academicGroupId);
  return !groups.length || (student.academicGroupId && groups.includes(student.academicGroupId));
}

async function listAvailable(student) {
  const exams = await prisma.examDefinition.findMany({
    where: { status: "PUBLISHED", OR: [{ instituteId: student.instituteId ?? undefined }, { instituteId: null }] },
    include: { groups: true, versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: 100,
  });
  const visible = exams.filter((e) => studentCanSee(student, e));
  const attempts = await prisma.examAttempt.findMany({ where: { studentId: student.id, examId: { in: visible.map((e) => e.id) } }, select: { id: true, examId: true, mode: true, status: true, attemptKey: true, createdAt: true, resultStatus: true }, orderBy: { createdAt: "desc" } });
  return visible.map((e) => {
    const bp = Src.normalizeBlueprint(e.versions[0]?.blueprint || e.blueprint);
    const mine = attempts.filter((a) => a.examId === e.id);
    const now = Date.now();
    return {
      id: e.id, title: e.title, description: e.description, mode: bp.mode, practiceEnabled: bp.mode === "PRACTICE" || !!bp.practiceEnabled,
      startAt: bp.startAt, endAt: bp.endAt, durationMin: bp.durationMin, totalMarks: bp.totalMarks,
      sections: bp.sections.map((s) => ({ key: s.key, label: SECTION_LABELS[s.key], questionCount: s.questionCount, maxMarks: s.maxMarks, durationMin: s.durationMin ?? null })),
      windowOpen: bp.mode === "PROCTORED" ? now >= new Date(bp.startAt).getTime() && now <= new Date(bp.endAt).getTime() : true,
      formalAttempt: mine.find((a) => a.attemptKey === "FORMAL") || null,
      practiceAttempts: mine.filter((a) => a.mode === "PRACTICE").slice(0, 5),
    };
  });
}

async function startAttempt({ student, examId, mode }) {
  if (!["PRACTICE", "PROCTORED"].includes(mode)) return fail(400, "MODE_INVALID", "Choose practice or proctored.");
  const exam = await prisma.examDefinition.findUnique({ where: { id: examId }, include: { groups: true } });
  if (!studentCanSee(student, exam)) return fail(404, "NOT_FOUND", "Examination not found.");
  const version = await prisma.examVersion.findUnique({ where: { examId_version: { examId, version: exam.version } } });
  if (!version) return fail(409, "NOT_PUBLISHED", "This examination has no published version.");
  const bp = Src.normalizeBlueprint(version.blueprint);

  if (mode === "PROCTORED") {
    if (bp.mode !== "PROCTORED") return fail(400, "PRACTICE_ONLY", "This examination is for practice only.");
    const existing = await prisma.examAttempt.findUnique({ where: { examId_studentId_attemptKey: { examId, studentId: student.id, attemptKey: "FORMAL" } }, select: { id: true } });
    if (existing) return okv({ attemptId: existing.id, resumed: true }); // refresh, a new tab or a new login: the same attempt, never a second one
    const now = Date.now();
    if (now < new Date(bp.startAt).getTime()) return fail(403, "NOT_STARTED", "This examination has not opened yet.");
    if (now > new Date(bp.endAt).getTime()) return fail(403, "CLOSED", "This examination is closed.");
  } else {
    if (bp.mode === "PROCTORED" && !bp.practiceEnabled) return fail(403, "PRACTICE_DISABLED", "Practice is not available for this examination.");
    const open = await prisma.examAttempt.findFirst({ where: { examId, studentId: student.id, mode: "PRACTICE", status: { in: [ATTEMPT.READINESS_CHECK, ATTEMPT.IN_PROGRESS] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (open) return okv({ attemptId: open.id, resumed: true });
  }

  let attemptKey = "FORMAL";
  if (mode === "PRACTICE") {
    const n = await prisma.examAttempt.count({ where: { examId, studentId: student.id, mode: "PRACTICE" } });
    if (n >= MAX_PRACTICE_ATTEMPTS) return fail(429, "PRACTICE_LIMIT", "You have reached the practice limit for this examination.");
    attemptKey = `PRACTICE-${n + 1}`;
  }

  const id = crypto.randomUUID();
  const built = await core.buildManifest({ blueprint: bp, instituteId: student.instituteId, attemptId: id });
  if (!built.ok) return fail(409, "EXAM_NOT_READY", "This examination does not have enough valid questions yet. Please contact your administrator.", { shortages: built.shortages });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.examAttempt.create({ data: { id, examId, versionId: version.id, studentId: student.id, instituteId: student.instituteId, mode, attemptKey, status: ATTEMPT.READINESS_CHECK, manifest: built.manifest } });
      await tx.examAttemptSection.createMany({ data: SECTION_KEYS.map((key) => ({ attemptId: id, key, status: SECTION.LOCKED })) });
    });
  } catch (e) {
    if (isUniqueViolation(e)) { // two requests raced: the database constraint decided, the loser gets the winner's attempt
      const winner = await prisma.examAttempt.findUnique({ where: { examId_studentId_attemptKey: { examId, studentId: student.id, attemptKey } }, select: { id: true } });
      if (winner) return okv({ attemptId: winner.id, resumed: true });
    }
    throw e;
  }
  logAudit({ action: AUDIT_ACTIONS.EXAM_ATTEMPT_STARTED, actorId: student.id, actorRole: "STUDENT", studentId: student.id, details: { examId, attemptId: id, mode } });
  return okv({ attemptId: id, resumed: false });
}

// ---- timing and expiry --------------------------------------------------------------------------------------------------------------------------------------------------
function timingFor(attempt) {
  const bp = attempt.blueprint;
  const open = attempt.sections.find((s) => s.status === SECTION.IN_PROGRESS);
  const bs = open ? core.sectionOf(bp, open.key) : null;
  return {
    attemptStartedAtMs: attempt.startedAt ? +attempt.startedAt : null, durationMin: bp.durationMin, timingPolicy: bp.timingPolicy, graceSec: bp.graceSec || 0,
    section: open && open.startedAt && bs?.durationMin ? { startedAtMs: +open.startedAt, durationMin: bs.durationMin } : null,
  };
}

// Run on every student request and by the sweep: if the deadline has passed, the attempt (or the open section) is closed by the server and scored from what was saved.
async function applyExpiry(attempt) {
  if (!attempt || attempt.status !== ATTEMPT.IN_PROGRESS || !attempt.startedAt) return attempt;
  const t = timingFor(attempt);
  const act = SM.expiryAction({ nowMs: Date.now() - t.graceSec * 1000, attemptStartedAtMs: t.attemptStartedAtMs, durationMin: t.durationMin, timingPolicy: t.timingPolicy, section: t.section });
  if (act.action === "EXPIRE_ATTEMPT") { await finalizeAttempt(attempt.id, { expired: true, by: "EXAM_DEADLINE" }); return loadFull(attempt.id); }
  if (act.action === "COMPLETE_SECTION_BY_TIMER") {
    const open = attempt.sections.find((s) => s.status === SECTION.IN_PROGRESS);
    await completeSectionInternal(attempt.id, open.key, "SECTION_TIMER");
    return loadFull(attempt.id);
  }
  return attempt;
}

async function sweepExpired(limit = 50) {
  const candidates = await prisma.examAttempt.findMany({ where: { status: ATTEMPT.IN_PROGRESS, startedAt: { not: null } }, select: { id: true }, orderBy: { startedAt: "asc" }, take: limit });
  let n = 0;
  for (const c of candidates) {
    try { const before = await loadFull(c.id); const after = await applyExpiry(before); if (after && after.status !== before.status) n++; } catch (e) { console.error("[exam-sweep]", c.id, e.message); }
  }
  return n;
}

// ---- begin / claim ------------------------------------------------------------------------------------------------------------------------------------------------------
// `readiness` is what the student's browser reports about the required checks. It is recorded, and a required check that is not reported as passed refuses the start; it is a
// guard against starting without the checks, not proof of them (a determined client can lie, which is why the proctoring events are reviewed by people).
async function beginAttempt(attempt, readiness) {
  const bp = attempt.blueprint;
  if (attempt.status === ATTEMPT.IN_PROGRESS) return okv({ already: true });
  if (attempt.status !== ATTEMPT.READINESS_CHECK) return fail(409, "INVALID_STATE", `This attempt is ${attempt.status} and cannot be started.`);
  if (attempt.mode === "PROCTORED") {
    const pr = bp.proctoring || {};
    const r = readiness || {};
    const missing = [];
    if (pr.cameraRequired && r.camera !== true) missing.push("camera");
    if (pr.microphoneRequired && r.microphone !== true) missing.push("microphone");
    if (pr.fullscreenRequired && r.fullscreen !== true) missing.push("fullscreen");
    if (r.browser !== true) missing.push("browser");
    if (r.connectivity !== true) missing.push("connectivity");
    if (missing.length) return fail(400, "READINESS_INCOMPLETE", `These readiness checks have not passed: ${missing.join(", ")}.`, { missing });
  }
  const sessionId = crypto.randomBytes(16).toString("hex");
  const won = await prisma.examAttempt.updateMany({ where: { id: attempt.id, status: ATTEMPT.READINESS_CHECK }, data: { status: ATTEMPT.IN_PROGRESS, startedAt: new Date(), sessionId, readiness: readiness || {} } });
  if (!won.count) return okv({ already: true });
  return okv({ sessionId });
}

// A new tab or device takes over the attempt: it gets a fresh session id and the old one is refused (409 SESSION_REPLACED).
async function claimSession(attempt) {
  if (attempt.mode !== "PROCTORED") return okv({ sessionId: null });
  if (attempt.status !== ATTEMPT.IN_PROGRESS && attempt.status !== ATTEMPT.READINESS_CHECK) return okv({ sessionId: null });
  const sessionId = crypto.randomBytes(16).toString("hex");
  await prisma.examAttempt.updateMany({ where: { id: attempt.id, status: { in: [ATTEMPT.IN_PROGRESS, ATTEMPT.READINESS_CHECK] } }, data: { sessionId } });
  return okv({ sessionId });
}

function sessionAllows(attempt, req) {
  if (attempt.mode !== "PROCTORED" || !attempt.sessionId) return true;
  const given = req.get("x-exam-session");
  if (!given && !req.get("x-client-features")) return true; // an old bundle that predates session control keeps working until it reloads
  return given === attempt.sessionId;
}

// ---- sections -----------------------------------------------------------------------------------------------------------------------------------------------------------------
async function openSection(attempt, key) {
  if (attempt.status !== ATTEMPT.IN_PROGRESS) return fail(409, "INVALID_STATE", "This examination is not in progress.");
  const check = SM.canOpenSection(attempt.sections, key);
  if (!check.ok) return fail(409, check.code, check.message);
  const won = await prisma.examAttemptSection.updateMany({ where: { attemptId: attempt.id, key, status: SECTION.LOCKED }, data: { status: SECTION.IN_PROGRESS, startedAt: new Date() } });
  if (!won.count) return fail(409, "ALREADY_OPEN", "This section was already opened.");
  return okv();
}

async function answeredCount(attemptId, key) {
  const rows = await prisma.examAnswer.findMany({ where: { attemptId, sectionKey: key }, select: { payload: true } });
  return rows.filter((r) => Q.isAnswerNonEmpty(key, r.payload)).length;
}

async function completeSection(attempt, key, { expectedAnswered } = {}) {
  if (attempt.status !== ATTEMPT.IN_PROGRESS) return fail(409, "INVALID_STATE", "This examination is not in progress.");
  const section = core.sectionOf(attempt.blueprint, key);
  const answered = await answeredCount(attempt.id, key);
  // pendingWrites: answers the student's page believes it saved that the server does not have. A section is never closed over answers the server has not confirmed.
  const pendingWrites = Number.isInteger(expectedAnswered) ? Math.max(0, expectedAnswered - answered) : 0;
  const check = SM.canCompleteSection(attempt.sections, key, { pendingWrites, answeredCount: answered, questionCount: core.itemsOf(attempt, key).length, requireAllAnswered: !!section?.requireAllAnswered });
  if (!check.ok) return fail(409, check.code, check.message);
  const summary = await completeSectionInternal(attempt.id, key, "STUDENT");
  return okv({ summary });
}

async function completeSectionInternal(attemptId, key, by) {
  const won = await prisma.examAttemptSection.updateMany({ where: { attemptId, key, status: SECTION.IN_PROGRESS }, data: { status: SECTION.COMPLETED, completedAt: new Date(), completedBy: by } });
  if (!won.count) return null; // another request completed it first
  return scoreAndStoreSection(attemptId, key);
}

// ---- answers --------------------------------------------------------------------------------------------------------------------------------------------------------------------
function findItem(attempt, itemRef) {
  for (const key of SECTION_KEYS) {
    const list = core.itemsOf(attempt, key);
    const idx = list.findIndex((i) => i.ref === itemRef);
    if (idx >= 0) return { key, idx, item: list[idx] };
  }
  return null;
}

async function saveAnswer(attempt, itemRef, { version, payload, finalize }) {
  if (!SM.attemptAcceptsAnswers(attempt.status)) return fail(409, "ATTEMPT_CLOSED", "This examination is no longer accepting answers.");
  const found = findItem(attempt, itemRef);
  if (!found) return fail(404, "ITEM_NOT_FOUND", "That question is not part of this examination.");
  const { key, idx } = found;
  const sec = attempt.sections.find((s) => s.key === key);
  if (!sec || sec.status !== SECTION.IN_PROGRESS) return fail(409, "SECTION_NOT_OPEN", "That section is not open.");
  const t = timingFor(attempt);
  const allowed = SM.isWriteAllowed({ nowMs: Date.now(), graceSec: t.graceSec, attemptStartedAtMs: t.attemptStartedAtMs, durationMin: t.durationMin, timingPolicy: t.timingPolicy, section: t.section });
  if (!allowed.allowed) { await applyExpiry(attempt); return fail(409, allowed.reason, "Time is up for this part of the examination."); }

  const section = core.sectionOf(attempt.blueprint, key);
  const practice = attempt.mode === "PRACTICE";
  const navigation = practice ? "FREE" : section.navigation;
  const editing = practice ? "EDITABLE_UNTIL_SECTION_SUBMIT" : section.answerEditing;

  let ctx = {};
  if (key === "APTITUDE" || key === "TECHNICAL") {
    const [row] = await core.loadObjectiveRows(key, [itemRef]);
    if (!row || !Array.isArray(row.options)) return fail(409, "QUESTION_UNAVAILABLE", "That question is no longer available.");
    ctx = { optionCount: row.options.length, multiple: row.questionType === "MULTISELECT" };
  } else if (key === "CODING") ctx = { allowedLanguages: section.source?.allowedLanguages };
  const norm = Q.normalizeAnswerPayload(key, payload, ctx);
  if (!norm.ok) return fail(400, norm.code, norm.message);

  const existing = await prisma.examAnswer.findUnique({ where: { attemptId_itemRef: { attemptId: attempt.id, itemRef } } });
  if (navigation === "FORWARD_ONLY") {
    const later = core.itemsOf(attempt, key).slice(idx + 1).map((i) => i.ref);
    if (later.length) {
      const saved = await prisma.examAnswer.findMany({ where: { attemptId: attempt.id, itemRef: { in: later } }, select: { payload: true } });
      if (saved.some((r) => Q.isAnswerNonEmpty(key, r.payload))) return fail(409, "NAVIGATION_FORWARD_ONLY", "In this section you cannot go back to an earlier question.");
    }
  }
  if (existing?.lockedAt) return fail(409, "ANSWER_LOCKED", "This answer can no longer be changed.");
  if (existing && editing === "LOCKED_AFTER_SAVE" && Q.isAnswerNonEmpty(key, existing.payload) && JSON.stringify(existing.payload) !== JSON.stringify(norm.value)) return fail(409, "ANSWER_LOCKED", "This answer can no longer be changed.");

  const expected = Number.isInteger(version) ? version : 0;
  const lockedAt = finalize && editing === "LOCKED_AFTER_NEXT" && Q.isAnswerNonEmpty(key, norm.value) ? new Date() : null;
  if (!existing) {
    if (expected !== 0) return fail(409, "STALE_VERSION", "Your answer is out of date.", { currentVersion: 0 });
    try {
      const row = await prisma.examAnswer.create({ data: { attemptId: attempt.id, sectionKey: key, itemRef, version: 1, payload: norm.value, lockedAt } });
      return okv({ version: row.version, savedAt: row.savedAt });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const cur = await prisma.examAnswer.findUnique({ where: { attemptId_itemRef: { attemptId: attempt.id, itemRef } }, select: { version: true } });
      return fail(409, "STALE_VERSION", "Your answer is out of date.", { currentVersion: cur?.version ?? 1 });
    }
  }
  if (expected !== existing.version) return fail(409, "STALE_VERSION", "Your answer is out of date.", { currentVersion: existing.version });
  const won = await prisma.examAnswer.updateMany({ where: { id: existing.id, version: expected }, data: { payload: norm.value, version: { increment: 1 }, savedAt: new Date(), ...(lockedAt ? { lockedAt } : {}) } });
  if (!won.count) {
    const cur = await prisma.examAnswer.findUnique({ where: { id: existing.id }, select: { version: true } });
    return fail(409, "STALE_VERSION", "Your answer is out of date.", { currentVersion: cur?.version ?? expected + 1 });
  }
  return okv({ version: expected + 1, savedAt: new Date() });
}

// ---- coding ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const judgeArgs = (question, language, code, cases) => ({
  language: question.questionType === "SQL" ? "sql" : language, code, testCases: cases, timeLimitMs: question.timeLimitMs, memoryLimitKb: question.memoryLimitKb || undefined,
  evaluationType: question.evaluationType, functionSignature: question.functionSignature, sqlSchema: question.sqlSchema, comparisonMode: question.comparisonMode,
  floatAbsoluteTolerance: question.floatAbsoluteTolerance, floatRelativeTolerance: question.floatRelativeTolerance,
});

async function codingContext(attempt, itemRef) {
  const found = findItem(attempt, itemRef);
  if (!found || found.key !== "CODING") return fail(404, "ITEM_NOT_FOUND", "That problem is not part of this examination.");
  const sec = attempt.sections.find((s) => s.key === "CODING");
  if (!sec || sec.status !== SECTION.IN_PROGRESS) return fail(409, "SECTION_NOT_OPEN", "The coding section is not open.");
  if (!SM.attemptAcceptsAnswers(attempt.status)) return fail(409, "ATTEMPT_CLOSED", "This examination is no longer accepting answers.");
  const t = timingFor(attempt);
  const allowed = SM.isWriteAllowed({ nowMs: Date.now(), graceSec: t.graceSec, attemptStartedAtMs: t.attemptStartedAtMs, durationMin: t.durationMin, timingPolicy: t.timingPolicy, section: t.section });
  if (!allowed.allowed) { await applyExpiry(attempt); return fail(409, allowed.reason, "Time is up for this part of the examination."); }
  const question = await prisma.question.findUnique({ where: { id: itemRef }, include: { testCases: true } });
  if (!question) return fail(409, "QUESTION_UNAVAILABLE", "That problem is no longer available.");
  return okv({ question, section: core.sectionOf(attempt.blueprint, "CODING") });
}

// Run against the sample (visible) cases only. Nothing is stored and nothing is scored.
async function runCode(attempt, itemRef, { language, code }) {
  const ctx = await codingContext(attempt, itemRef);
  if (!ctx.ok) return ctx;
  const norm = Q.normalizeAnswerPayload("CODING", { code, language }, { allowedLanguages: ctx.section.source?.allowedLanguages });
  if (!norm.ok) return fail(400, norm.code, norm.message);
  const samples = ctx.question.testCases.filter((c) => !c.isHidden);
  if (!samples.length) return fail(409, "NO_SAMPLES", "This problem has no sample cases to run against. Use Submit.");
  try {
    const r = await runQueued(() => judgeSubmission(judgeArgs(ctx.question, norm.value.language, norm.value.code, samples)));
    return okv({ result: { verdict: r.verdict, passedCases: r.passedCases, totalCases: r.totalCases, details: r.details, errorSummary: r.errorSummary || null } });
  } catch (err) {
    return fail(err.queueBusy ? 503 : 502, err.queueBusy ? "JUDGE_BUSY" : "JUDGE_UNAVAILABLE", "The code runner is busy or unavailable. Your code is safe; try again in a moment.");
  }
}

// Judges `code` on the hidden cases (all cases when none are hidden) and stores the result with the answer. A judge failure is stored as PENDING, never as a wrong answer.
async function judgeAndStore(attempt, question, { language, code, auto }) {
  const cases = question.testCases; // a submission is graded on every case, the visible samples and the hidden ones; only the samples are ever shown to the student
  const prior = await prisma.examAnswer.findUnique({ where: { attemptId_itemRef: { attemptId: attempt.id, itemRef: question.id } } });
  const submissions = (prior?.evaluation?.submissions || 0) + (auto ? 0 : 1);
  const history = [...(prior?.evaluation?.history || [])];
  let evaluation;
  try {
    const r = await dedupe(`exam-judge:${attempt.id}:${question.id}:${core.sha(code)}`, () => runQueued(() => judgeSubmission(judgeArgs(question, language, code, cases))));
    const judgeFailed = r.verdict === "JUDGE_ERROR" || r.verdict === "PENDING";
    evaluation = {
      status: judgeFailed ? "PENDING" : "DONE", verdict: r.verdict, passedCases: r.passedCases, totalCases: r.totalCases, errorSummary: r.errorSummary || null,
      maxTimeMs: r.maxTimeMs ?? null, maxMemoryKb: r.maxMemoryKb ?? null, codeHash: core.sha(code), language, submittedAt: new Date().toISOString(), submissions, auto: !!auto,
      ...(judgeFailed ? { judgeError: true } : {}),
    };
  } catch (err) {
    evaluation = { status: "PENDING", judgeError: true, error: err.queueBusy ? "JUDGE_BUSY" : "JUDGE_UNAVAILABLE", codeHash: core.sha(code), language, submittedAt: new Date().toISOString(), submissions, auto: !!auto };
  }
  history.push({ at: evaluation.submittedAt, verdict: evaluation.verdict || "PENDING", passed: evaluation.passedCases ?? null, total: evaluation.totalCases ?? null });
  evaluation.history = history.slice(-MAX_CODE_HISTORY);
  const payload = { code, language };
  if (prior) await prisma.examAnswer.update({ where: { id: prior.id }, data: { payload, evaluation, version: { increment: 1 }, savedAt: new Date() } });
  else await prisma.examAnswer.create({ data: { attemptId: attempt.id, sectionKey: "CODING", itemRef: question.id, version: 1, payload, evaluation } });
  return evaluation;
}

async function submitCode(attempt, itemRef, { language, code }) {
  const ctx = await codingContext(attempt, itemRef);
  if (!ctx.ok) return ctx;
  const norm = Q.normalizeAnswerPayload("CODING", { code, language }, { allowedLanguages: ctx.section.source?.allowedLanguages });
  if (!norm.ok) return fail(400, norm.code, norm.message);
  const limit = ctx.section.maxSubmissionsPerProblem;
  const prior = await prisma.examAnswer.findUnique({ where: { attemptId_itemRef: { attemptId: attempt.id, itemRef } }, select: { evaluation: true } });
  if (limit && (prior?.evaluation?.submissions || 0) >= limit) return fail(409, "SUBMISSION_LIMIT", `You have used all ${limit} submissions for this problem.`);
  const ev = await judgeAndStore(attempt, ctx.question, { language: norm.value.language, code: norm.value.code, auto: false });
  return okv({ submission: { status: ev.status, verdict: ev.verdict || null, passedCases: ev.passedCases ?? null, totalCases: ev.totalCases ?? null, errorSummary: ev.errorSummary || null, submissions: ev.submissions, limit: limit || null, pending: ev.status === "PENDING" } });
}

// ---- scoring a section and the whole result ---------------------------------------------------------------------------------------------------------------------------
async function judgePending(attempt, answers) {
  const needed = answers.filter((a) => a.payload?.code?.trim() && (!a.evaluation || a.evaluation.status === "PENDING" || a.evaluation.codeHash !== core.sha(a.payload.code)));
  if (!needed.length) return;
  const questions = await prisma.question.findMany({ where: { id: { in: needed.map((a) => a.itemRef) } }, include: { testCases: true } });
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const a of needed) {
    const q = byId.get(a.itemRef);
    if (q) await judgeAndStore(attempt, q, { language: a.payload.language, code: a.payload.code, auto: true });
  }
}

async function prepareInterviewEvaluations(attempt, answers) {
  const mode = core.sectionOf(attempt.blueprint, "AI_INTERVIEW")?.interview?.evaluationMode || "RULES";
  const todo = answers.filter((a) => a.payload?.text?.trim() && !a.evaluation);
  if (!todo.length) return false;
  const rows = await prisma.interviewQuestion.findMany({ where: { id: { in: todo.map((a) => a.itemRef) } }, select: { id: true, prompt: true, category: true, expectedKeywords: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  let aiQueued = false;
  for (const a of todo) {
    const q = byId.get(a.itemRef);
    if (!q) { await prisma.examAnswer.update({ where: { id: a.id }, data: { evaluation: { status: "FAILED", method: mode, lastError: "question no longer available", attempts: 0 } } }); continue; }
    if (mode === "AI") { await prisma.examAnswer.update({ where: { id: a.id }, data: { evaluation: { status: "PENDING", method: "AI", attempts: 0 } } }); aiQueued = true; }
    else await prisma.examAnswer.update({ where: { id: a.id }, data: { evaluation: core.ruleEvaluate(q, a.payload.text) } });
  }
  return aiQueued;
}

async function scoreAndStoreSection(attemptId, key) {
  const attempt = await loadFull(attemptId);
  if (!attempt) return null;
  let answers = await prisma.examAnswer.findMany({ where: { attemptId, sectionKey: key } });
  let summary;
  if (key === "APTITUDE" || key === "TECHNICAL") summary = await core.scoreObjective(attempt, attempt.blueprint, key, answers);
  else if (key === "CODING") {
    await judgePending(attempt, answers);
    answers = await prisma.examAnswer.findMany({ where: { attemptId, sectionKey: key } });
    summary = await core.scoreCoding(attempt, attempt.blueprint, answers);
  } else {
    const aiQueued = await prepareInterviewEvaluations(attempt, answers);
    answers = await prisma.examAnswer.findMany({ where: { attemptId, sectionKey: key } });
    summary = await core.scoreInterview(attempt, attempt.blueprint, answers);
    if (aiQueued) aiEval.runInterviewEvaluations(attemptId, { onSettled: refreshAfterEvaluation }).catch(() => {});
  }
  await prisma.examAttemptSection.updateMany({ where: { attemptId, key }, data: { summary } });
  return summary;
}

// Called when a background evaluation (or an administrator's retry) settles: re-reads the pending sections and recomputes the result.
async function refreshAfterEvaluation(attemptId) {
  const sections = await prisma.examAttemptSection.findMany({ where: { attemptId, status: SECTION.COMPLETED } });
  for (const s of sections) if (!s.summary || s.summary.status !== "FINAL") await scoreAndStoreSection(attemptId, s.key);
  await recomputeResult(attemptId);
}

async function recomputeResult(attemptId) {
  const attempt = await loadFull(attemptId);
  if (!attempt) return null;
  // No result exists before the examination is submitted (or expired): a partial figure must never be written, let alone shown, while the student is still working.
  if (attempt.status === ATTEMPT.READINESS_CHECK || attempt.status === ATTEMPT.IN_PROGRESS) return null;
  const bp = attempt.blueprint;
  const summaries = [];
  for (const s of attempt.sections) {
    let summary = s.summary;
    if (!summary) summary = s.status === SECTION.COMPLETED ? await scoreAndStoreSection(attemptId, s.key) : { key: s.key, maxMarks: core.sectionOf(bp, s.key).maxMarks, obtained: 0, percent: 0, status: "FINAL", questions: core.itemsOf(attempt, s.key).length, notReached: true };
    summaries.push(summary);
  }
  const events = await prisma.examEvent.findMany({ where: { attemptId }, select: { type: true, severity: true, requiresReview: true, reviewStatus: true } });
  const proctoring = Scoring.summarizeProctoringEvents(events.map((e) => ({ ...e, reviewStatus: e.reviewStatus === "NONE" ? null : e.reviewStatus })));
  const result = Scoring.buildExamResult({
    sections: summaries, totalMarks: bp.totalMarks, passing: { passingMarks: bp.passingMarks, passingPercent: bp.passingPercent }, proctoring,
    policy: { reviewRequired: attempt.mode === "PROCTORED" && !!bp.proctoring?.reviewRequired },
  });
  if (!result.ok) { console.error(`[exam-result] attempt ${attemptId}: ${result.message}`); return null; }
  const keepStatus = attempt.resultStatus === "PUBLISHED" || attempt.resultStatus === "INVALIDATED";
  await prisma.examAttempt.update({ where: { id: attemptId }, data: { result: { ...result, proctoring: { ...proctoring }, computedFrom: "SECTION_SUMMARIES" }, resultStatus: keepStatus ? attempt.resultStatus : result.status, resultComputedAt: new Date() } });
  if (result.final) await prisma.examAttempt.updateMany({ where: { id: attemptId, status: ATTEMPT.EVALUATING }, data: { status: ATTEMPT.COMPLETED } });
  return result;
}

// ---- submit / finalize (idempotent) ---------------------------------------------------------------------------------------------------------------------------------------
async function finalizeAttempt(attemptId, { expired = false, by = "STUDENT" } = {}) {
  const won = await prisma.examAttempt.updateMany({ where: { id: attemptId, status: ATTEMPT.IN_PROGRESS }, data: { status: expired ? ATTEMPT.EXPIRED : ATTEMPT.SUBMITTED, submittedAt: new Date() } });
  if (!won.count) return false; // already submitted or expired by another request: submitting twice is harmless and scores nothing twice
  const rows = await prisma.examAttemptSection.findMany({ where: { attemptId, status: { not: SECTION.COMPLETED } } });
  for (const s of rows) {
    const closed = await prisma.examAttemptSection.updateMany({ where: { attemptId, key: s.key, status: { not: SECTION.COMPLETED } }, data: { status: SECTION.COMPLETED, completedAt: new Date(), completedBy: by } });
    if (closed.count) await scoreAndStoreSection(attemptId, s.key);
  }
  await prisma.examAttempt.updateMany({ where: { id: attemptId, status: { in: [ATTEMPT.SUBMITTED, ATTEMPT.EXPIRED] } }, data: { status: ATTEMPT.EVALUATING } });
  await recomputeResult(attemptId);
  const a = await prisma.examAttempt.findUnique({ where: { id: attemptId }, select: { studentId: true, examId: true, mode: true } });
  logAudit({ action: AUDIT_ACTIONS.EXAM_ATTEMPT_SUBMITTED, actorId: a?.studentId, actorRole: by === "STUDENT" ? "STUDENT" : "SYSTEM", studentId: a?.studentId, details: { attemptId, examId: a?.examId, mode: a?.mode, expired, by } });
  return true;
}

async function submitAttempt(attempt) {
  if (attempt.status !== ATTEMPT.IN_PROGRESS) return okv({ already: true });
  const notDone = attempt.sections.filter((s) => s.status !== SECTION.COMPLETED).map((s) => s.key);
  if (notDone.length) return fail(409, "SECTIONS_INCOMPLETE", `Finish these sections first: ${notDone.map((k) => SECTION_LABELS[k]).join(", ")}.`, { sections: notDone });
  await finalizeAttempt(attempt.id, { by: "STUDENT" });
  return okv({ already: false });
}

// ---- proctoring events (observations, never verdicts) ----------------------------------------------------------------------------------------------------------------
async function recordEvent(attempt, { type: rawType, sectionKey, clientAt }) {
  if (attempt.mode !== ATTEMPT_PROCTORED) return okv({ ignored: true, reason: "Practice attempts are not proctored." });
  if (attempt.status !== ATTEMPT.IN_PROGRESS) return okv({ ignored: true });
  const type = P.normalizeViolationType(rawType);
  if (!P.isKnownViolationType(type)) return fail(400, "EVENT_TYPE_UNKNOWN", "Unknown event type.");
  const section = SECTION_KEYS.includes(sectionKey) ? sectionKey : null;
  const maxWarnings = attempt.blueprint.proctoring?.maxWarnings || 3;
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ExamAttempt" WHERE "id" = ${attempt.id} FOR UPDATE`;
    const fresh = await tx.examAttempt.findUnique({ where: { id: attempt.id }, select: { status: true, warningCount: true } });
    if (!fresh || fresh.status !== ATTEMPT.IN_PROGRESS) return { kind: "closed", warningCount: fresh?.warningCount ?? 0 };
    const last = await tx.examEvent.findFirst({ where: { attemptId: attempt.id, type }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (P.isDuplicateEvent(last?.createdAt, Date.now(), P.duplicateWindowMs(type))) return { kind: "duplicate", warningCount: fresh.warningCount };
    if (P.exceedsEventCap(await tx.examEvent.count({ where: { attemptId: attempt.id } }))) return { kind: "capped", warningCount: fresh.warningCount };
    const priorSuspicious = await tx.examEvent.count({ where: { attemptId: attempt.id, severity: "SUSPICIOUS" } });
    const { severity, penalized } = classifyViolation(type, priorSuspicious);
    const requiresReview = severity === "CONFIRMED_VIOLATION" || severity === "SUSPICIOUS";
    const parsedClient = clientAt ? new Date(clientAt) : null;
    await tx.examEvent.create({ data: { attemptId: attempt.id, sectionKey: section, type, severity, penalized, requiresReview, reviewStatus: requiresReview ? "PENDING" : "NONE", clientAt: parsedClient && !Number.isNaN(+parsedClient) ? parsedClient : null } });
    let warningCount = fresh.warningCount;
    if (penalized) warningCount = (await tx.examAttempt.update({ where: { id: attempt.id }, data: { warningCount: { increment: 1 }, needsReview: true }, select: { warningCount: true } })).warningCount;
    else if (requiresReview) await tx.examAttempt.update({ where: { id: attempt.id }, data: { needsReview: true } });
    return { kind: "recorded", warningCount, severity, penalized };
  }, { timeout: 10000 });
  // A warning is a notice for the student and a flag for a human reviewer. Reaching the limit never ends or fails the attempt: that is a decision for a reviewer.
  return okv({ warningCount: out.warningCount, maxWarnings, deduplicated: out.kind === "duplicate", severity: out.severity || null, penalized: !!out.penalized });
}
const ATTEMPT_PROCTORED = "PROCTORED";

module.exports = {
  loadFull, studentCanSee, listAvailable, startAttempt, timingFor, applyExpiry, sweepExpired, beginAttempt, claimSession, sessionAllows, openSection, completeSection, completeSectionInternal,
  saveAnswer, runCode, submitCode, scoreAndStoreSection, refreshAfterEvaluation, recomputeResult, finalizeAttempt, submitAttempt, recordEvent, answeredCount, fail, okv, findItem,
};
