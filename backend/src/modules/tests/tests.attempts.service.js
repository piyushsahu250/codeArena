// The student attempt flow: start or resume, record proctoring violations, ask the in-page AI helper, read their own result; plus the staff view of an
// attempt's violation log. No req/res: callers pass an `actor` { user, requesterInstituteId, req }.
const crypto = require("crypto");
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { isTestVisibleToStudent } = require("../../utils/testEligibility");
const { getStudentPoolIds } = require("../../utils/talentPoolEligibility");
const { canStaffAccessTest } = require("../../utils/testOwnership");
const { policyOf, startRequirementFailure } = require("../../utils/testExamSecurity");
const X = require("../../utils/examSecurity");
const { gradePendingCodingSubmissions } = require("../../utils/gradeAttempt");
const { processGamification } = require("../../utils/gamification");
const { classifyViolation } = require("../../utils/proctoringSeverity");
const { MANIFEST_VERSION, validateManifest, scoreBase } = require("../../utils/attemptManifest");
const aiService = require("../../services/ai/aiService");
const { annotateEvents } = require("../../utils/evidenceClassification");
const { POLICY_VERSION } = require("../../utils/proctoringPolicy");
const d = require("./tests.domain");
const repo = require("./tests.repository");

const accountGone = () => new ServiceError(401, "This account no longer exists. Please log in again.", { authExpired: true });

// ---- start / resume ----
async function startAttempt(actor, testId) {
  const userId = actor.user.id;
  const test = await repo.findForStart(testId);
  if (!test || !test.isPublished) throw new ServiceError(404, "Test not available");

  const student = await repo.studentScope(userId);
  if (!student) throw accountGone();
  const memberPoolIds = await getStudentPoolIds(prisma, userId);
  // Eligibility relations were loaded with the test itself, so this uses the synchronous already-loaded check (this is the most synchronised endpoint on
  // the platform: a whole class starts within seconds).
  if (!isTestVisibleToStudent(test, student.academicGroupId, student.classId, memberPoolIds, student.instituteId)) throw new ServiceError(404, "Test not available");

  // Server-side start requirements (the page cannot override these), for resume as well as a first start.
  const startPolicy = policyOf(test);
  const startFailure = startRequirementFailure(actor.req, startPolicy);
  if (startFailure) throw new ServiceError(403, startFailure.error, { rawBody: startFailure });

  const existing = await repo.findAttempt(testId, userId);
  if (existing && existing.status !== "IN_PROGRESS") throw new ServiceError(403, "Thank you. You have already completed this assessment.");

  const now = new Date();
  const window = d.startWindow(now, test, existing);
  if (window.failure) throw new ServiceError(403, window.failure);
  // An admin-approved reattempt is a one-time exception to the closed-window check; only relevant when a brand-new attempt is being created.
  let reattemptGrant = null;
  if (window.needsGrant) {
    reattemptGrant = await repo.findReattemptGrant(testId, userId);
    if (!reattemptGrant) throw new ServiceError(403, "Test window has closed");
  }

  // The random order is generated exactly once, here, at attempt creation; a resume never recomputes it.
  let attempt = existing;
  if (!attempt) {
    // Attendance gating applies only to creating a new attempt, never to a resume.
    if (test.attendanceMandatory) {
      const record = await repo.attendanceStatus(userId, test.id);
      if (!record) throw new ServiceError(403, "Attendance has not yet been marked for this test. Please contact your faculty.");
      if (record.status === "ABSENT") throw new ServiceError(403, "You have been marked absent for this test and cannot start it.");
    }
    const { questionOrder, optionOrder } = d.buildAttemptOrder(test);
    // Never start a shorter (or empty, or duplicated) assessment than the one configured.
    const manifestCheck = validateManifest(test, questionOrder);
    if (!manifestCheck.ok) {
      console.error(JSON.stringify({ event: "assessment_manifest_invalid", testId, studentId: userId, errors: manifestCheck.errors, configured: manifestCheck.configuredCount, available: manifestCheck.availableCount, delivered: manifestCheck.deliveredCount, at: new Date().toISOString() }));
      throw new ServiceError(409, manifestCheck.message, { code: "ASSESSMENT_CONFIG_INVALID", configuredCount: manifestCheck.configuredCount, availableCount: manifestCheck.availableCount });
    }
    try {
      attempt = await repo.createAttempt({ testId, studentId: userId, questionOrder, optionOrder, expectedQuestionCount: questionOrder.length, manifestVersion: MANIFEST_VERSION });
    } catch (err) {
      // A double-click or client retry racing two starts hits the unique constraint: not an error, return the attempt the first request created.
      if (err.code === "P2002") attempt = await repo.findAttempt(testId, userId);
      else throw err;
    }
    // A reattempt grant is a one-time pass: consumed the moment it actually produces an attempt.
    if (reattemptGrant) await repo.consumeReattemptGrant(reattemptGrant.id);
  }

  // One-active-session control: the newest start/resume owns attempt.sessionId; a second tab or device holding the old id is the one refused.
  const sessionId = crypto.randomBytes(16).toString("hex");
  if (attempt.status === "IN_PROGRESS") await repo.setSession(attempt.id, sessionId);
  // Saved answers come back so a refresh restores exactly where the candidate left off. codeSavedSeq is a BigInt and must not reach JSON.
  const submissions = (await repo.submissionsOf(attempt.id)).map(({ codeSavedSeq, ...rest }) => rest);
  // serverTime lets the client compute its clock offset, so a skewed device clock does not auto-submit early or late.
  return { ...attempt, sessionId, submissions, serverTime: Date.now(), security: X.clientPolicy(startPolicy) };
}

// ---- proctoring violation ----
async function recordViolation(actor, attemptId, rawType) {
  const attempt = await repo.attemptById(attemptId);
  if (!attempt || attempt.studentId !== actor.user.id) throw new ServiceError(403, "Invalid attempt");
  if (attempt.status !== "IN_PROGRESS") return { tabSwitchCount: attempt.tabSwitchCount, autoSubmitted: true };

  const type = String(rawType || "UNKNOWN").toUpperCase().slice(0, 40);
  // Escalation counts SUSPICIOUS events fresh from the log each time, so the threshold can change without a backfill.
  const prior = await repo.suspiciousCount(attempt.id);
  const outcome = d.violationOutcome(attempt, classifyViolation(type, prior));
  const { severity, penalized, tabSwitchCount, autoSubmitted } = outcome;

  // A violation-triggered submit is a submission like any other: coding drafts must be graded or they would stay at 0 forever.
  if (autoSubmitted) await gradePendingCodingSubmissions(attempt.id);

  if (penalized) await repo.logPenalizedViolation(attempt.id, type, severity, tabSwitchCount, autoSubmitted);
  else await repo.logViolation(attempt.id, type, severity, penalized);

  if (autoSubmitted) {
    processGamification(actor.user.id, { xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true }).catch((e) => console.error("gamification failed", e));
  }
  return { tabSwitchCount, maxViolations: d.MAX_TAB_VIOLATIONS, severity, penalized, autoSubmitted };
}

// ---- staff view of an attempt's violation log ----
async function violationLog(actor, attemptId) {
  const attempt = await repo.attemptForAdminReview(attemptId);
  if (!attempt) throw new ServiceError(404, "Attempt not found");
  if (actor.requesterInstituteId && attempt.test.instituteId && attempt.test.instituteId !== actor.requesterInstituteId) throw new ServiceError(403, "You can only view attempts for tests under your own institute");
  if (!canStaffAccessTest(actor, attempt.test)) throw new ServiceError(403, "You can only view attempts for tests you created or that were shared with you");
  const [violations, signals] = await Promise.all([repo.violationsOf(attempt.id), repo.securitySignalsOf(attempt.id)]);
  const byType = {};
  for (const v of violations) byType[v.type] = (byType[v.type] || 0) + 1;
  // Keyboard signals live in the security-event table (they are not strikes); show them in the same log, in time order, flagged as not counted.
  const signalRows = signals.map((s) => ({ id: `sig-${s.id}`, type: s.type, severity: null, penalized: false, counted: false, metadata: s.metadata || null, createdAt: s.createdAt }));
  const merged = [...violations, ...signalRows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  // Each event carries the evidence class the server can honestly give it, judged against THIS test's own policy (the rules the student was shown).
  // `severity` and `penalized` are the legacy counting rules, unchanged.
  const policy = policyOf(attempt.test);
  return {
    student: attempt.student, tabSwitchCount: attempt.tabSwitchCount, byType, policyVersion: POLICY_VERSION,
    events: annotateEvents(merged, policy),
    evidenceNote: "Browser signals are observations, not proof. A page cannot see other apps, devices or assistants. A finding under a published exam rule says that the prohibited action was observed, not why, and only an authorised reviewer can confirm misconduct.",
  };
}

// ---- in-page AI helper ----
// Gated per question by TestQuestion.aiAllowed (looked up fresh, never a client claim). The model is never given the answer key, hidden tests or the
// explanation, so it cannot reveal them.
async function aiAssist(actor, attemptId, body) {
  const attempt = await repo.attemptForAi(attemptId);
  if (!attempt || attempt.studentId !== actor.user.id) throw new ServiceError(403, "Invalid attempt");
  if (attempt.status !== "IN_PROGRESS") throw new ServiceError(400, "This attempt is no longer in progress");
  const { questionId, message } = body;
  if (!questionId || !message || !message.trim()) throw new ServiceError(400, "questionId and message are required");

  const testQuestion = await repo.testQuestionForAi(attempt.testId, questionId);
  if (!testQuestion || !testQuestion.aiAllowed) throw new ServiceError(403, "AI assistance is not enabled for this question");

  const student = await repo.studentInstitute(actor.user.id);
  if (!student) throw accountGone();
  const q = testQuestion.question;
  const questionContext = [
    `Question type: ${q.questionType}`,
    q.subject ? `Subject: ${q.subject}` : null,
    q.topic ? `Topic: ${q.topic}` : null,
    `Title: ${q.title}`,
    `Description: ${q.description}`,
    Array.isArray(q.options) && q.options.length ? `Options: ${q.options.join(" | ")}` : null,
  ].filter(Boolean).join("\n");

  const reply = await aiService.generateText({
    feature: aiService.FEATURES.EXAM_AI_ASSIST, userId: actor.user.id, instituteId: student?.instituteId,
    system: "You are a patient exam-time teaching assistant. Help the student understand the question, clarify terminology, and think through their approach with hints -- never state the final answer, never write a complete solution, never reveal or guess a hidden test case. If asked directly for the answer or a full solution, politely decline and offer a hint toward it instead. Keep replies short (3-6 sentences).",
    prompt: `${questionContext}\n\n${aiService.wrapUntrusted("Student's question", message.trim().slice(0, 1000))}`,
    maxTokens: 400,
    temperature: 0.5,
  });
  return { reply };
}

// ---- the student's own result ----
async function myResult(actor, testId) {
  const test = await repo.testForResult(testId);
  if (!test) throw new ServiceError(404, "Test not found");
  const attempt = await repo.attemptWithSubmissions(test.id, actor.user.id);
  if (!attempt) throw new ServiceError(404, "You have not attempted this test");
  // codeSavedSeq is a BigInt and must never reach the JSON response raw.
  if (attempt.submissions) attempt.submissions = attempt.submissions.map(({ codeSavedSeq, ...rest }) => rest);
  if (attempt.status === "IN_PROGRESS") throw new ServiceError(403, "Test not yet submitted");
  if (!test.showResults) return { status: attempt.status, showResults: false };

  // Scored out of the questions this attempt was assigned (its manifest), never out of what was answered or rendered.
  const base = await scoreBase(prisma, attempt);
  const answeredCount = new Set((attempt.submissions || []).map((s) => s.questionId)).size;
  return {
    status: attempt.status, showResults: true, totalScore: attempt.totalScore, maxScore: base.maxScore, expectedQuestionCount: base.expectedCount, answeredCount,
    unansweredCount: Math.max(0, base.expectedCount - answeredCount), passingMarks: test.passingMarks, submittedAt: attempt.submittedAt,
    tabSwitchCount: attempt.tabSwitchCount, submissions: attempt.submissions,
  };
}

module.exports = { startAttempt, recordViolation, violationLog, aiAssist, myResult };
