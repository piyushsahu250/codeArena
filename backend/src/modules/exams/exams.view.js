// Section-wise examination: what a client is shown. The attempt view for the exam screen and the consolidated report. Keys, explanations and hidden test cases never appear in
// the attempt view; the report shows a student only their own results (and, for practice attempts after they are submitted, the review of each objective question).
const prisma = require("../../prisma");
const SM = require("../../utils/examStateMachine");
const Scoring = require("../../utils/examScoring");
const Q = require("../../utils/examQuestions");
const R = require("../../utils/examReport");
const { SECTION_KEYS, SECTION_LABELS } = require("../../utils/examBlueprint");
const core = require("./exams.core");
const attempts = require("./exams.attempts");

const { ATTEMPT, SECTION } = SM;
const TERMINAL_FOR_REVIEW = [ATTEMPT.SUBMITTED, ATTEMPT.EXPIRED, ATTEMPT.EVALUATING, ATTEMPT.COMPLETED];

function resultVisibleToStudent(attempt) {
  const bp = attempt.blueprint;
  if (!attempt.result) return false;
  if (attempt.resultStatus === "INVALIDATED") return false;
  if (attempt.mode === "PRACTICE") return TERMINAL_FOR_REVIEW.includes(attempt.status);
  return attempt.resultStatus === "PUBLISHED" || (bp.resultVisibility === "IMMEDIATE" && attempt.resultStatus === "COMPLETED");
}

function proctoringPolicyFor(attempt) {
  if (attempt.mode !== "PROCTORED") return null;
  const p = attempt.blueprint.proctoring || {};
  return { camera: !!p.cameraRequired, microphone: !!p.microphoneRequired, fullscreen: !!p.fullscreenRequired, maxWarnings: p.maxWarnings ?? 3, networkGraceSec: p.networkGraceSec ?? 0, cameraLossPolicy: p.cameraLossPolicy || "WARN", autoSubmitOnExpiry: p.autoSubmitOnExpiry !== false };
}

function publicEvaluation(key, ev) {
  if (!ev) return null;
  if (key === "CODING") return { status: ev.status, verdict: ev.verdict || null, passedCases: ev.passedCases ?? null, totalCases: ev.totalCases ?? null, errorSummary: ev.errorSummary || null, submissions: ev.submissions || 0, pending: ev.status === "PENDING", history: (ev.history || []).slice(-10) };
  return null; // interview and objective evaluations are not shown while the examination is running
}

async function studentView(attempt, { sessionId } = {}) {
  const bp = attempt.blueprint;
  const t = attempts.timingFor(attempt);
  const allAnswers = await prisma.examAnswer.findMany({ where: { attemptId: attempt.id }, select: { sectionKey: true, itemRef: true, version: true, payload: true, evaluation: true, lockedAt: true, savedAt: true } });
  const answeredBySection = {};
  for (const a of allAnswers) if (Q.isAnswerNonEmpty(a.sectionKey, a.payload)) answeredBySection[a.sectionKey] = (answeredBySection[a.sectionKey] || 0) + 1;
  const nowMs = Date.now();
  const remaining = t.attemptStartedAtMs ? SM.remainingSeconds({ nowMs, attemptStartedAtMs: t.attemptStartedAtMs, durationMin: t.durationMin, timingPolicy: t.timingPolicy, section: t.section }) : { overall: t.durationMin * 60, section: null };
  const deadlines = t.attemptStartedAtMs ? SM.deadlines({ attemptStartedAtMs: t.attemptStartedAtMs, durationMin: t.durationMin, timingPolicy: t.timingPolicy, section: t.section }) : null;

  const sections = SECTION_KEYS.map((key) => {
    const row = attempt.sections.find((s) => s.key === key);
    const bs = core.sectionOf(bp, key);
    const practice = attempt.mode === "PRACTICE";
    return {
      key, label: SECTION_LABELS[key], order: bs.order, status: row?.status || SECTION.LOCKED, questionCount: core.itemsOf(attempt, key).length, maxMarks: bs.maxMarks, durationMin: bs.durationMin ?? null,
      navigation: practice ? "FREE" : bs.navigation, answerEditing: practice ? "EDITABLE_UNTIL_SECTION_SUBMIT" : bs.answerEditing, requireAllAnswered: !!bs.requireAllAnswered,
      instructions: bs.instructions || null, answered: answeredBySection[key] || 0, startedAt: row?.startedAt || null, completedAt: row?.completedAt || null,
      interview: key === "AI_INTERVIEW" ? { category: bs.interview?.category, answerInput: bs.interview?.answerInput, speechToText: !!bs.interview?.speechToText, cameraRequired: !!bs.interview?.cameraRequired } : undefined,
      maxSubmissionsPerProblem: key === "CODING" ? bs.maxSubmissionsPerProblem ?? null : undefined,
    };
  });

  const open = attempt.sections.find((s) => s.status === SECTION.IN_PROGRESS);
  let current = null;
  if (open && attempt.status === ATTEMPT.IN_PROGRESS) {
    const items = await core.studentItems(attempt, bp, open.key);
    const answers = allAnswers.filter((a) => a.sectionKey === open.key).map((a) => ({ itemRef: a.itemRef, version: a.version, payload: a.payload, locked: !!a.lockedAt, savedAt: a.savedAt, evaluation: publicEvaluation(open.key, a.evaluation) }));
    current = { key: open.key, items, answers, remainingSeconds: remaining.section };
  }

  const showResult = resultVisibleToStudent(attempt);
  return {
    attempt: { id: attempt.id, examId: attempt.examId, title: attempt.exam.title, mode: attempt.mode, status: attempt.status, label: SM.combinedLabel(attempt.status, attempt.sections), startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, warningCount: attempt.warningCount, resultStatus: attempt.resultStatus, official: attempt.mode === "PROCTORED" },
    ...(sessionId ? { sessionId } : {}),
    policy: { durationMin: bp.durationMin, timingPolicy: bp.timingPolicy, graceSec: bp.graceSec || 0, proctoring: proctoringPolicyFor(attempt), resultVisibility: bp.resultVisibility, totalMarks: bp.totalMarks },
    timing: { serverNow: nowMs, overallDeadline: deadlines ? deadlines.overallDeadlineMs : null, sectionDeadline: deadlines ? deadlines.sectionDeadlineMs : null, remaining },
    sections, current,
    result: showResult ? { status: attempt.resultStatus, provisional: !!attempt.result?.provisional, totalMarks: attempt.result.totalMarks, obtained: attempt.result.obtained, percent: attempt.result.percent, passed: attempt.result.passed, sections: attempt.result.sections } : null,
    resultNotice: !showResult && TERMINAL_FOR_REVIEW.includes(attempt.status) ? (attempt.mode === "PROCTORED" ? "Your examination was submitted. Your result will be available when it is published." : "Your practice attempt is being evaluated.") : null,
  };
}

// ---- the consolidated report -----------------------------------------------------------------------------------------------------------------------------------------------
async function objectiveReview(attempt, key, answers) {
  const items = core.itemsOf(attempt, key);
  const rows = await core.loadObjectiveRows(key, items.map((i) => i.ref));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const section = core.sectionOf(attempt.blueprint, key);
  const ans = core.answerMap(answers);
  return items.map((item) => {
    const q = byId.get(item.ref);
    if (!q) return { id: item.ref, unavailable: true, marks: item.marks };
    const order = section.shuffleOptions && Array.isArray(q.options) ? Q.optionOrderFor(q.options.length, `${attempt.id}:${q.id}`) : null;
    const sel = ans.get(item.ref)?.payload?.selected ?? null;
    const origSel = sel === null || !order ? sel : Q.toOriginalIndices(sel, order);
    const key_ = Q.correctIndices(q.options, q.correctAnswer);
    const asArray = (v) => (v === null ? [] : Array.isArray(v) ? v : [v]);
    const chosen = asArray(origSel);
    return { id: q.id, text: key === "APTITUDE" ? q.prompt : q.description, options: q.options, selected: chosen, correct: key_, isCorrect: !!key_ && chosen.length === key_.length && chosen.every((x) => key_.includes(x)), explanation: q.explanation || null, marks: item.marks };
  });
}

async function buildReport(attempt, { audience }) {
  const admin = audience === "ADMIN";
  const bp = attempt.blueprint;
  const [student, institute, answers, events] = await Promise.all([
    prisma.user.findUnique({ where: { id: attempt.studentId }, select: { name: true, email: true, registrationNumber: true, rollNumber: true, department: true, batchYear: true, section: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } } }),
    attempt.instituteId ? prisma.institute.findUnique({ where: { id: attempt.instituteId }, select: { name: true } }) : null,
    prisma.examAnswer.findMany({ where: { attemptId: attempt.id } }),
    prisma.examEvent.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, type: true, severity: true, sectionKey: true, requiresReview: true, reviewStatus: true, reviewNote: admin, createdAt: true } }),
  ]);
  const released = admin || resultVisibleToStudent(attempt);
  const sectionRows = attempt.sections;
  const summaries = SECTION_KEYS.map((k) => sectionRows.find((s) => s.key === k)?.summary).filter(Boolean);
  const started = attempt.startedAt ? +attempt.startedAt : null;
  const ended = attempt.submittedAt ? +attempt.submittedAt : null;

  const header = {
    examTitle: attempt.exam.title, attemptId: attempt.id, mode: attempt.mode, official: attempt.mode === "PROCTORED", status: attempt.status, resultStatus: attempt.resultStatus,
    student: { name: student?.name, prn: student?.registrationNumber || null, rollNumber: student?.rollNumber || null },
    institute: institute?.name || null, department: student?.academicGroup?.department?.name || student?.department || null, batch: student?.academicGroup?.batch || student?.batchYear || null, section: student?.academicGroup?.section || student?.section || null,
    examDate: started ? new Date(started).toISOString() : null, startTime: started ? new Date(started).toISOString() : null, endTime: ended ? new Date(ended).toISOString() : null, durationSeconds: started && ended ? Math.round((ended - started) / 1000) : null,
  };
  if (!released) return { header, released: false, message: attempt.mode === "PROCTORED" ? "The result has not been published yet." : "The result is not ready yet." };

  const result = attempt.result;
  const sections = [];
  const interviewEvals = [];
  for (const key of SECTION_KEYS) {
    const row = sectionRows.find((s) => s.key === key);
    const summary = row?.summary || null;
    const bs = core.sectionOf(bp, key);
    const secAnswers = answers.filter((a) => a.sectionKey === key);
    const base = { key, label: SECTION_LABELS[key], status: row?.status, maxMarks: bs.maxMarks, obtained: summary?.obtained ?? null, provisionalObtained: summary?.provisionalObtained ?? summary?.obtained ?? null, percent: summary?.percent ?? null, final: summary?.status === "FINAL", timeTakenSeconds: row?.startedAt && row?.completedAt ? Math.round((+row.completedAt - +row.startedAt) / 1000) : null, completedBy: row?.completedBy || null };
    if (key === "APTITUDE" || key === "TECHNICAL") {
      const ins = R.topicInsights(key === "TECHNICAL" && summary?.bySubject && Object.keys(summary.bySubject).length ? summary.bySubject : summary?.byTopic);
      const topicIns = R.topicInsights(summary?.byTopic);
      const review = (admin || (attempt.mode === "PRACTICE")) ? await objectiveReview(attempt, key, secAnswers) : undefined;
      sections.push({ ...base, correct: summary?.correct, incorrect: summary?.incorrect, unanswered: summary?.unanswered, attempted: summary?.attempted, questions: summary?.questions, keyMissing: summary?.keyMissing || 0, byTopic: summary?.byTopic || {}, bySubject: summary?.bySubject || {}, strengths: ins.strengths, weaknesses: ins.weaknesses, topicStrengths: topicIns.strengths, topicWeaknesses: topicIns.weaknesses, review });
    } else if (key === "CODING") {
      const qRows = await prisma.question.findMany({ where: { id: { in: core.itemsOf(attempt, "CODING").map((i) => i.ref) } }, select: { id: true, title: true, questionNumber: true } });
      const title = new Map(qRows.map((r) => [r.id, r.title || `Problem ${r.questionNumber}`]));
      const ans = core.answerMap(secAnswers);
      sections.push({
        ...base, problems: summary?.problems, attempted: summary?.attempted, solved: summary?.solved, testsPassed: summary?.testsPassed, testsFailed: summary?.testsFailed, compileFailures: summary?.compileFailures, runtimeFailures: summary?.runtimeFailures, pendingItems: summary?.pendingItems || 0,
        perProblem: (summary?.perProblem || []).map((p) => { const ev = ans.get(p.id)?.evaluation; return { ...p, title: title.get(p.id) || p.id, verdict: ev?.verdict || null, language: ev?.language || null, submissions: ev?.submissions || 0, errorSummary: ev?.errorSummary || null, maxTimeMs: ev?.maxTimeMs ?? null, maxMemoryKb: ev?.maxMemoryKb ?? null, code: admin ? ans.get(p.id)?.payload?.code : undefined }; }),
      });
    } else {
      const items = core.itemsOf(attempt, "AI_INTERVIEW");
      const qRows = await prisma.interviewQuestion.findMany({ where: { id: { in: items.map((i) => i.ref) } }, select: { id: true, prompt: true, category: true } });
      const qById = new Map(qRows.map((r) => [r.id, r]));
      const ans = core.answerMap(secAnswers);
      const perQuestion = (summary?.perQuestion || []).map((pq) => {
        const a = ans.get(pq.id); const ev = a?.evaluation;
        if (ev) interviewEvals.push(ev);
        return { ...pq, question: qById.get(pq.id)?.prompt, category: qById.get(pq.id)?.category, answer: a?.payload?.text || "", method: ev?.method || null, rubricVersion: ev?.rubricVersion || null, dimensions: ev?.dimensions || ev?.breakdown || null, strengths: ev?.strengths || [], missingConcepts: ev?.missingConcepts || [], suggestions: ev?.suggestions || [], confidence: ev?.confidence ?? null };
      });
      const dims = R.aggregateInterviewDimensions(interviewEvals);
      sections.push({ ...base, questions: summary?.questions, answered: summary?.answered, skipped: summary?.skipped, pendingItems: summary?.pendingItems || 0, failedItems: summary?.failedItems || 0, perQuestion, dimensions: dims, ...R.interviewInsights(dims), limitations: "Interview scores come from a fixed rubric applied to the text of the answer. They do not measure accent, speaking style or appearance, and they are one input to the overall result, not a complete assessment of a candidate." });
    }
  }
  const dims = R.aggregateInterviewDimensions(interviewEvals);
  const proctoring = Scoring.summarizeProctoringEvents(events.map((e) => ({ ...e, reviewStatus: e.reviewStatus === "NONE" ? null : e.reviewStatus })));
  return {
    header, released: true, result: result ? { status: attempt.resultStatus, final: !!result.final, provisional: !!result.provisional, totalMarks: result.totalMarks, obtained: result.obtained, percent: result.percent, passed: result.passed, passingCriteria: bp.passingMarks != null ? { passingMarks: bp.passingMarks } : { passingPercent: bp.passingPercent }, strongestSection: result.strongestSection, weakestSection: result.weakestSection, pendingSections: result.pendingSections } : null,
    sections, pending: R.pendingIndicators(summaries),
    proctoring: { ...proctoring, warningCount: attempt.warningCount, needsReview: attempt.needsReview, note: "Recorded events are observations for review. They are not findings of misconduct unless a reviewer confirmed them.", timeline: admin ? events.map((e) => ({ id: e.id, type: e.type, severity: e.severity, section: e.sectionKey, at: e.createdAt, requiresReview: e.requiresReview, reviewStatus: e.reviewStatus, note: e.reviewNote || null })) : undefined },
    recommendations: R.buildRecommendations({ sections: summaries, interviewDimensions: dims }),
    invalidatedReason: admin ? attempt.invalidatedReason : undefined,
  };
}

module.exports = { studentView, buildReport, resultVisibleToStudent };
