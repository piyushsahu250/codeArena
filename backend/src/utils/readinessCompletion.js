const prisma = require("../prisma");
const { gradeReadinessAnswer, buildReadinessReport, READINESS_LEVEL_RANK } = require("./readinessScoring");
const { issueCertificate } = require("./certificates");
const { invalidate } = require("./cache");
const { shuffleQuestionOptions, toOriginalSelection } = require("./optionShuffle");
const logger = require("./logger");

// Server-side source of truth for when an assessment's answers stop being acceptable -- mirrors
// submissions.js's deadlineOf() for Formal Tests (same startedAt+durationMin shape). Before this
// existed durationMin was stored but never compared to the clock anywhere server-side, so the real
// time limit lived only in the client's countdown (see the fix history in routes/readiness.js).
function readinessDeadlineOf(assessment) {
  return new Date(assessment.startedAt).getTime() + assessment.durationMin * 60 * 1000;
}

// Grades every answer that was saved but never graded -- i.e. skipped:false with isCorrect still
// null. That's exactly the state a proctored attempt leaves coding/SQL answers in (drafts are
// autosaved ungraded, with no feedback shown during the exam, and graded here instead), and it also
// rescues any answer whose in-attempt grading never completed. Graded rows always have a boolean
// isCorrect (gradeReadinessAnswer returns one for every gradeable type), so this never regrades
// anything already scored. Sequential, not Promise.all: a whole cohort finishing at the same
// deadline already stacks judge work, and parallel grading of one student's N answers would turn
// that into N simultaneous DB connections at the worst possible moment (same reasoning as
// gradeAttempt.js's gradePendingCodingSubmissions).
async function gradePendingAnswers(assessment) {
  const pending = await prisma.readinessAnswer.findMany({ where: { assessmentId: assessment.id, skipped: false, isCorrect: null } });
  for (const a of pending) {
    const question = await prisma.question.findUnique({ where: { id: a.questionId }, include: { testCases: true } });
    if (!question) continue;
    // Quiz picks are stored in the SHUFFLED display space the student actually saw (see POST
    // /answer) and must be mapped back to original option indices before grading.
    let selectedOptions = a.selectedOptions;
    if (Array.isArray(selectedOptions) && Array.isArray(question.options)) {
      const order = shuffleQuestionOptions(question.options, null, `${assessment.id}:${question.id}`).order;
      selectedOptions = toOriginalSelection(selectedOptions, order);
    }
    // A whole cohort finishing at the same deadline fills the judge's bounded queue, which rejects
    // with err.queueBusy rather than waiting forever. Giving up on that first rejection would silently
    // score a correct answer as 0 purely because of timing -- so a busy queue is retried with
    // backoff (up to ~45s total) before an answer is allowed to stay ungraded.
    let graded = false;
    for (let attempt = 1; attempt <= 12 && !graded; attempt++) {
      try {
        const { score, isCorrect } = await gradeReadinessAnswer(question, {
          answerText: a.answerText, code: a.code, language: a.language, selectedOptions, skipped: false,
        });
        await prisma.readinessAnswer.update({ where: { id: a.id }, data: { score, isCorrect } });
        graded = true;
      } catch (err) {
        if (err?.queueBusy && attempt < 12) {
          await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
          continue;
        }
        // One answer failing to grade must not stop the student's whole assessment from being
        // submitted -- it stays ungraded (scores 0 in the report) and is logged loudly.
        logger.error("READINESS_ANSWER_GRADE_FAILED", { assessmentId: assessment.id, questionId: a.questionId, queueBusy: !!err?.queueBusy, message: err?.message });
        break;
      }
    }
  }
}

// The one place a ReadinessAssessment is turned from IN_PROGRESS into a finished, reported attempt.
// Used by the student's manual Submit, the client timer's auto-submit, the server-side violation
// limit (terminationReason "MAX_VIOLATIONS"), and the background sweep for attempts whose time ran
// out with no client around to submit them -- so every path grades and reports identically.
//
// Idempotent and race-safe: report upsert is idempotent, and the status flip is an atomic
// updateMany keyed on status still being IN_PROGRESS, so a manual submit racing a violation
// auto-submit can't both "win" (and award a certificate twice).
async function completeReadinessAssessmentOnce(assessmentId, { terminationReason = null } = {}) {
  const assessment = await prisma.readinessAssessment.findUnique({
    where: { id: assessmentId },
    include: { report: true, subject: true, student: { include: { institute: true } } },
  });
  if (!assessment) return null;
  if (assessment.status !== "IN_PROGRESS") return { assessment, report: assessment.report, alreadyCompleted: true };

  await gradePendingAnswers(assessment);

  const answers = await prisma.readinessAnswer.findMany({ where: { assessmentId: assessment.id } });
  const questions = await prisma.question.findMany({ where: { id: { in: answers.map((a) => a.questionId) } } });
  const answersWithQuestions = answers.map((a) => ({ ...a, question: questions.find((q) => q.id === a.questionId) || {} }));

  // Grade against the scoring policy in effect when this attempt STARTED, not whatever the subject
  // looks like now (see the scoringPolicy snapshot in POST /assessments). Attempts created before
  // that snapshot existed fall back to the live subject -- unavoidable, nothing was captured.
  const scoringPolicy = assessment.config?.scoringPolicy;
  const effectiveSubject = scoringPolicy ? { ...assessment.subject, ...scoringPolicy } : assessment.subject;
  const built = buildReadinessReport(answersWithQuestions, effectiveSubject);

  const isLate = Date.now() > readinessDeadlineOf(assessment);
  const status = terminationReason ? "TERMINATED" : isLate ? "EXPIRED" : "COMPLETED";

  const report = await prisma.readinessReport.upsert({
    where: { assessmentId: assessment.id },
    update: built,
    create: { assessmentId: assessment.id, studentId: assessment.studentId, ...built },
  });
  const claim = await prisma.readinessAssessment.updateMany({
    where: { id: assessment.id, status: "IN_PROGRESS" },
    data: { status, submittedAt: new Date(), terminationReason },
  });
  const updated = await prisma.readinessAssessment.findUnique({ where: { id: assessment.id } });
  if (claim.count === 0) return { assessment: updated, report, alreadyCompleted: true };

  logger.info("READINESS_ASSESSMENT_COMPLETED", {
    assessmentId: assessment.id, studentId: assessment.studentId, subjectId: assessment.subjectId,
    status, terminationReason, overallScore: report.overallScore, readinessLevel: report.readinessLevel,
  });

  // Every filter combination admin/staff have ever queried gets its own cache key, so a plain
  // single-key invalidate can't target them all -- invalidate() supports prefix matching for this.
  invalidate("readinessAnalytics");
  invalidate("readinessAnalyticsCompare");
  invalidate("readinessPlacementOverview");

  // Certificate-on-completion: opt-in per subject, one per student per subject (DB unique), never
  // revoked by a later weaker attempt. A TERMINATED (proctoring-violation) attempt never earns one,
  // regardless of the score it was force-submitted with. Fire-and-forget so a certificate failure
  // never blocks the student's report.
  const subject = assessment.subject;
  if (!terminationReason && subject.certificateEnabled && subject.certificateMinLevel) {
    const requiredRank = READINESS_LEVEL_RANK[subject.certificateMinLevel] ?? 0;
    const earnedRank = READINESS_LEVEL_RANK[report.readinessLevel] ?? 0;
    if (earnedRank >= requiredRank) {
      const already = await prisma.certificate.findUnique({
        where: { studentId_readinessSubjectId_type: { studentId: assessment.studentId, readinessSubjectId: subject.id, type: "READINESS" } },
      });
      if (!already) {
        issueCertificate({
          type: "READINESS", studentId: assessment.studentId, readinessSubjectId: subject.id,
          readinessLevel: report.readinessLevel, title: `${subject.name} Employability Readiness`,
          instituteCode: assessment.student.institute?.code, programCode: subject.code,
        }).catch((err) => console.error("Readiness certificate issuance failed:", err));
      }
    }
  }

  return { assessment: updated, report };
}

// Concurrent calls for the SAME assessment (a client retry after its own timeout, a manual submit
// racing the violation auto-submit or the sweep) share one in-flight run instead of each grading
// every answer again -- duplicate judge work is exactly what makes a submit stampede slower.
const inflight = new Map();
function completeReadinessAssessment(assessmentId, opts = {}) {
  const existing = inflight.get(assessmentId);
  if (existing) return existing;
  const p = completeReadinessAssessmentOnce(assessmentId, opts).finally(() => inflight.delete(assessmentId));
  inflight.set(assessmentId, p);
  return p;
}

module.exports = { completeReadinessAssessment, readinessDeadlineOf };
