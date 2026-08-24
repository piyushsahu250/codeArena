const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { gradeModuleCodingAttempt, gradeOneModuleCodingSubmission } = require("../utils/gradeModuleCodingAttempt");
const { getModuleLockMap } = require("../utils/learningLock");
const { processGamification } = require("../utils/gamification");
const { resolveCodingFields } = require("../utils/functionHarness");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");
const { safeErrorMessage } = require("../utils/errors");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const execLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });

function sanitizeQuestion(q) {
  // FUNCTION-mode questions here were never created/edited through a route that calls
  // resolveCodingFields() (the admin routes below don't even accept evaluationType/
  // functionSignature — every FUNCTION-mode question in this module got that way via a one-off
  // seed-conversion script) — the whole "starterCodeByLanguage always matches the signature"
  // guarantee functionHarness.js documents never actually held here. Confirmed live: a Module 1
  // question ("String Length") had incomplete/wrong starterCodeByLanguage, so the frontend fell
  // back to a generic STDIO-shaped default template — structurally guaranteed to trip
  // wrapFunctionCode()'s "looks like a full Java program" guard the moment a student filled it in
  // and submitted, through no fault of their own. Regenerating here, unconditionally, for every
  // FUNCTION-mode question on every read is what actually delivers that guarantee, independent of
  // whatever drifted into the DB.
  let starterCodeByLanguage = q.starterCodeByLanguage || null;
  if (q.evaluationType === "FUNCTION" && q.functionSignature) {
    try {
      starterCodeByLanguage = resolveCodingFields({ evaluationType: q.evaluationType, functionSignature: q.functionSignature }).starterCodeByLanguage;
    } catch (err) {
      // A malformed functionSignature would otherwise throw here (validateSignature) and 500 the
      // whole assessment-start request for every student — falling back to whatever's stored is
      // strictly no worse than before this fix, and the question is broken either way; better to
      // surface that as a bad starter template than as a hard crash blocking the entire attempt.
      console.error(`sanitizeQuestion: failed to regenerate starterCodeByLanguage for question ${q.id}:`, err.message);
    }
  }
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    difficulty: q.difficulty,
    timeLimitMs: q.timeLimitMs,
    starterCode: q.starterCode,
    // Preferred over the single-language starterCode above when present — this is what lets the
    // editor load the actually-correct template per language instead of showing one language's
    // starter code regardless of which language the student picked.
    starterCodeByLanguage,
    // Was previously omitted entirely — not answer-revealing (functionSignature only names what
    // the starter code already shows: method name, params, return type), and the frontend needs
    // it to show students an unambiguous "this question expects a method body, not a full program"
    // indicator before they start typing, rather than finding out only after a rejected submit.
    evaluationType: q.evaluationType || "STDIO",
    functionSignature: q.functionSignature || null,
    tags: q.tags || null,
    estimatedTimeMin: q.estimatedTimeMin ?? null,
    realWorldScenario: q.realWorldScenario || null,
    constraints: q.constraints || null,
    inputFormat: q.inputFormat || null,
    outputFormat: q.outputFormat || null,
    notes: q.notes || null,
    edgeCases: q.edgeCases || null,
    problemExplanation: q.problemExplanation || null,
    // hints/timeComplexity/spaceComplexity/editorial/similarQuestions are deliberately NOT
    // included here — a Module Coding Test is a proctored, permanently-graded assessment, and
    // showing the editorial or hints mid-attempt would hand out the answer during a formal
    // evaluation. They're still stored on the Question row (admin routes below accept them) for
    // parity with every other coding surface; this sanitizer is what actually withholds them.
    testCases: (q.testCases || []).filter((tc) => !tc.isHidden).map((tc) => ({ input: tc.input, expected: tc.expected, explanation: tc.explanation || null })),
  };
}

async function loadOwnedAttempt(req, res, { requireInProgress = true } = {}) {
  const attempt = await prisma.moduleCodingAttempt.findUnique({
    where: { id: req.params.attemptId },
    include: { moduleCodingTest: true, questions: { select: { questionId: true } } },
  });
  if (!attempt || attempt.studentId !== req.user.id) {
    res.status(403).json({ error: "Invalid attempt" });
    return null;
  }
  if (requireInProgress && attempt.status !== "IN_PROGRESS") {
    res.status(403).json({ error: "This assessment attempt is already finalized" });
    return null;
  }
  return attempt;
}

// Must be one of the questions actually drawn for this attempt (ModuleCodingAttemptQuestion —
// snapshotted once at start, see schema comment), not just any coding question in the DB. Final
// grading (gradeModuleCodingAttempt.js) already only iterates attempt.questions, so this can't
// inflate a score — but without this check, run/autosave/submit-code would happily invoke the
// judge and reveal hidden-case pass/fail for an arbitrary question, including ones from other
// institutes' banks. Same fix as submissions.js's assigned-question check, applied here too.
function isAssignedQuestion(attempt, questionId) {
  return attempt.questions.some((q) => q.questionId === questionId);
}

function deadlineOf(attempt) {
  return new Date(attempt.startedAt).getTime() + attempt.moduleCodingTest.timeLimitMin * 60 * 1000;
}

// A client-side auto-submit ("reason: time") is only trusted once the server's own clock agrees
// the deadline has actually passed, within this grace window — see PREMATURE_FINALIZE_GRACE_MS in
// submissions.js for the identical rationale (that one guards Formal Tests, this one Module
// Coding Tests).
const PREMATURE_FINALIZE_GRACE_MS = 15000;

// =========================== Student-facing ===========================

// STUDENT: this module's coding-test config + the student's own attempt history/eligibility.
router.get("/module/:moduleId", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const mod = await prisma.courseModule.findUnique({
      where: { id: req.params.moduleId },
      include: { codingTest: true },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });
    if (!mod.codingTest || !mod.codingTest.isActive) {
      return res.json({ exists: false });
    }
    const test = mod.codingTest;

    const lockMap = await getModuleLockMap(prisma, req.user.id, mod.courseId);
    const gate = lockMap.get(mod.id);
    const lessonsComplete = !!gate?.lessonsComplete;

    const attempts = await prisma.moduleCodingAttempt.findMany({
      where: { moduleCodingTestId: test.id, studentId: req.user.id },
      orderBy: { attemptNumber: "desc" },
    });
    const finalized = attempts.filter((a) => a.status !== "IN_PROGRESS");
    const activeAttempt = attempts.find((a) => a.status === "IN_PROGRESS") || null;
    const attemptsUsed = finalized.length;
    const attemptsRemaining = test.maxAttempts == null ? null : Math.max(0, test.maxAttempts - attemptsUsed);
    const bestScore = finalized.length ? Math.max(...finalized.map((a) => a.score)) : null;
    const lastFinalized = finalized[0] || null;
    const alreadyPassed = finalized.some((a) => a.passed);

    let cooldownRemainingSec = 0;
    if (lastFinalized && !alreadyPassed && test.cooldownMinutes > 0) {
      const cooldownUntil = new Date(lastFinalized.submittedAt).getTime() + test.cooldownMinutes * 60 * 1000;
      cooldownRemainingSec = Math.max(0, Math.round((cooldownUntil - Date.now()) / 1000));
    }

    const canStart =
      !!activeAttempt ||
      (lessonsComplete &&
        !alreadyPassed &&
        (attemptsRemaining === null || attemptsRemaining > 0) &&
        cooldownRemainingSec <= 0);

    res.json({
      exists: true,
      test: {
        id: test.id, title: test.title, instructions: test.instructions,
        allowedLanguages: test.allowedLanguages, questionCount: test.questionCount,
        passingPercent: test.passingPercent, timeLimitMin: test.timeLimitMin,
        maxAttempts: test.maxAttempts, cooldownMinutes: test.cooldownMinutes,
        maxViolations: test.maxViolations, requireFullscreen: test.requireFullscreen,
        requireWebcam: test.requireWebcam, requireMicrophone: test.requireMicrophone,
      },
      lessonsComplete, attemptsUsed, attemptsRemaining, bestScore, alreadyPassed,
      cooldownRemainingSec, canStart,
      activeAttemptId: activeAttempt?.id || null,
      status: alreadyPassed ? "PASSED" : lastFinalized ? "FAILED" : "PENDING",
      history: finalized.map((a) => ({
        id: a.id, attemptNumber: a.attemptNumber, score: a.score, passed: a.passed,
        status: a.status, submittedAt: a.submittedAt, violationCount: a.violationCount,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load coding assessment" });
  }
});

// STUDENT: start a new attempt, or resume the existing IN_PROGRESS one (allowResume permitting).
// requireFeature gates only the CREATION of a new attempt -- every other route below
// (/attempts/:attemptId/run|autosave|submit-code|violation|finalize) is deliberately left
// ungated, so an attempt already in progress when compiler/lms is disabled can always be
// completed. This is what makes "disable for new sessions, existing sessions continue" true by
// construction: an attempt that already exists was necessarily started before this gate could
// apply to it again.
router.post("/module/:moduleId/start", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("lms"), requireFeature("compiler"), async (req, res) => {
  try {
    const mod = await prisma.courseModule.findUnique({ where: { id: req.params.moduleId }, include: { codingTest: true } });
    if (!mod) return res.status(404).json({ error: "Module not found" });
    const test = mod.codingTest;
    if (!test || !test.isActive) return res.status(404).json({ error: "No coding assessment configured for this module" });

    const lockMap = await getModuleLockMap(prisma, req.user.id, mod.courseId);
    if (!lockMap.get(mod.id)?.lessonsComplete) {
      return res.status(403).json({ error: "Complete this module's lessons and practice test before starting the coding assessment" });
    }

    const existing = await prisma.moduleCodingAttempt.findFirst({
      where: { moduleCodingTestId: test.id, studentId: req.user.id, status: "IN_PROGRESS" },
      include: { questions: { orderBy: { order: "asc" }, include: { question: { include: { testCases: true } } } } },
    });
    // deadlineOf() reads attempt.moduleCodingTest.timeLimitMin, but the query above doesn't
    // include that relation (it's already in scope as `test`, same row by moduleCodingTestId, so
    // an extra join would be redundant) — without this, every attempt to resume an in-progress
    // attempt threw "Cannot read properties of undefined (reading 'timeLimitMin')" and 500'd the
    // whole request, which is exactly what "Failed to start assessment" was: not a fresh start at
    // all, but a resume that could never succeed once a student navigated away and back.
    if (existing) existing.moduleCodingTest = test;
    if (existing) {
      if (!test.allowResume) {
        await gradeModuleCodingAttempt(existing.id, { reason: "RESUME_DISABLED" });
        // fall through to start a fresh attempt below
      } else {
        if (Date.now() > deadlineOf(existing)) {
          await gradeModuleCodingAttempt(existing.id, { reason: "TIME_EXPIRED" });
        } else {
          // Resuming (e.g. after a page refresh or a dropped connection) must restore whatever
          // was last autosaved per question — otherwise a student's real progress, safely sitting
          // in ModuleCodingSubmission, would appear to vanish from the editor and get silently
          // overwritten with starter code on their next keystroke. This is the actual mechanism
          // behind the spec's "never lose work on refresh/reconnect" requirement.
          const submissions = await prisma.moduleCodingSubmission.findMany({ where: { attemptId: existing.id } });
          const subByQuestion = new Map(submissions.map((s) => [s.questionId, s]));
          return res.json({
            attemptId: existing.id,
            deadline: deadlineOf(existing),
            serverTime: Date.now(),
            questions: existing.questions.map((q) => sanitizeQuestion(q.question)),
            savedAnswers: Object.fromEntries(
              existing.questions.map((q) => {
                const sub = subByQuestion.get(q.questionId);
                if (!sub) return [q.questionId, null];
                // A PENDING verdict means autosaved-but-never-submitted — only a real graded
                // verdict is included, so the frontend's status dot can tell "in progress" apart
                // from "submitted" on resume, same distinction the live Submit response drives.
                const verdict = sub.verdict && sub.verdict !== "PENDING"
                  ? { verdict: sub.verdict, passedCases: sub.passedCases, totalCases: sub.totalCases }
                  : null;
                return [q.questionId, { language: sub.language, code: sub.code, ...verdict }];
              })
            ),
            allowedLanguages: test.allowedLanguages,
          });
        }
      }
    }

    const finalizedCount = await prisma.moduleCodingAttempt.count({
      where: { moduleCodingTestId: test.id, studentId: req.user.id, status: { not: "IN_PROGRESS" } },
    });
    const alreadyPassed = await prisma.moduleCodingAttempt.findFirst({ where: { moduleCodingTestId: test.id, studentId: req.user.id, passed: true } });
    if (alreadyPassed) return res.status(403).json({ error: "You have already passed this assessment" });
    if (test.maxAttempts != null && finalizedCount >= test.maxAttempts) {
      return res.status(403).json({ error: "You have used all allowed attempts for this assessment. Contact your instructor for an additional attempt." });
    }
    const lastFinalized = await prisma.moduleCodingAttempt.findFirst({
      where: { moduleCodingTestId: test.id, studentId: req.user.id, status: { not: "IN_PROGRESS" } },
      orderBy: { attemptNumber: "desc" },
    });
    if (lastFinalized && test.cooldownMinutes > 0) {
      const cooldownUntil = new Date(lastFinalized.submittedAt).getTime() + test.cooldownMinutes * 60 * 1000;
      if (Date.now() < cooldownUntil) {
        return res.status(403).json({ error: `Please wait before retrying — cooldown active for ${Math.ceil((cooldownUntil - Date.now()) / 60000)} more minute(s).` });
      }
    }

    const pool = await prisma.question.findMany({ where: { moduleCodingTestId: test.id, questionType: "CODING" }, orderBy: { questionNumber: "asc" } });
    if (pool.length === 0) return res.status(400).json({ error: "This assessment has no questions configured yet" });

    let selected;
    if (test.randomizeQuestions) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, test.questionCount);
    } else {
      selected = pool.slice(0, test.questionCount);
    }

    const attempt = await prisma.moduleCodingAttempt.create({
      data: {
        moduleCodingTestId: test.id, studentId: req.user.id, attemptNumber: finalizedCount + 1,
        questions: { create: selected.map((q, i) => ({ questionId: q.id, order: i })) },
      },
    });

    const withCases = await prisma.question.findMany({ where: { id: { in: selected.map((q) => q.id) } }, include: { testCases: true } });
    const byId = new Map(withCases.map((q) => [q.id, q]));

    res.json({
      attemptId: attempt.id,
      deadline: deadlineOf({ ...attempt, moduleCodingTest: test }),
      serverTime: Date.now(),
      questions: selected.map((q) => sanitizeQuestion(byId.get(q.id))),
      allowedLanguages: test.allowedLanguages,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start assessment" });
  }
});

// STUDENT: run code against public test cases only — self-check, doesn't save score.
router.post("/attempts/:attemptId/run", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const attempt = await loadOwnedAttempt(req, res);
    if (!attempt) return;
    if (Date.now() > deadlineOf(attempt)) return res.status(403).json({ error: "Time is up for this assessment" });

    const { questionId, language, code } = req.body;
    if (!isAssignedQuestion(attempt, questionId)) return res.status(403).json({ error: "This question is not part of your assessment" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: { where: { isHidden: false } } } });
    if (!question) return res.status(404).json({ error: "Question not found" });

    const result = await runQueued(() => judgeSubmission({ language, code, testCases: question.testCases, timeLimitMs: question.timeLimitMs, memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

// STUDENT: auto-save a coding draft — no judging, graded once at finalize (or auto-submit).
router.post("/attempts/:attemptId/autosave", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const attempt = await loadOwnedAttempt(req, res);
    if (!attempt) return;
    if (Date.now() > deadlineOf(attempt)) return res.status(403).json({ error: "Time is up for this assessment" });

    const { questionId, language, code, seq: rawSeq } = req.body;
    if (!isAssignedQuestion(attempt, questionId)) return res.status(403).json({ error: "This question is not part of your assessment" });
    const seq = Number.isFinite(Number(rawSeq)) ? Number(rawSeq) : Date.now();
    // Atomic upsert on the (attemptId, questionId) unique constraint — see submissions.js's
    // /autosave for why a findFirst-then-create/update pattern here is a real race hazard.
    //
    // The `update` branch only touches language/code, never verdict/passedCases/totalCases/score —
    // it used to also reset those to PENDING/0 on every autosave, which meant any edit made after
    // an explicit Submit-code click (below) silently erased that already-graded, locked-in result.
    // If the student didn't explicitly re-submit that question before time ran out, finalize would
    // grade whatever code was last autosaved and permanently discard the score they'd already
    // earned. A question that was never explicitly submitted is unaffected — its row already sits
    // at the PENDING/0 defaults (from `create` below or a prior autosave), so not re-writing those
    // fields here changes nothing for it.
    //
    // Conditional on codeSavedSeq (see Submission.codeSavedSeq's schema comment for the full
    // reasoning) instead of a plain upsert, so a reordered/delayed older autosave request can never
    // clobber newer code that already saved.
    const updateResult = await prisma.moduleCodingSubmission.updateMany({
      where: { attemptId: attempt.id, questionId, codeSavedSeq: { lte: seq } },
      data: { language: language || "", code: code || "", codeSavedSeq: seq },
    });
    if (updateResult.count === 0) {
      await prisma.moduleCodingSubmission.create({
        data: { attemptId: attempt.id, questionId, studentId: req.user.id, language: language || "", code: code || "", verdict: "PENDING", codeSavedSeq: seq },
      }).catch((err) => {
        if (err.code !== "P2002") throw err; // row already existed with a newer seq -- stale write, correctly dropped
      });
    }
    res.json({ status: "SAVED" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Autosave failed" });
  }
});

// STUDENT: explicit per-question Submit — saves the current code and immediately grades it
// against the HIDDEN test cases (unlike /run, which only checks the visible sample cases and
// never touches the score). Same counts-only-no-raw-hidden-data shape the finalize result already
// uses (questionBreakdown) — passedCases/totalCases/verdict/timing are safe to show immediately,
// the hidden inputs/outputs themselves never are.
router.post("/attempts/:attemptId/submit-code", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const attempt = await loadOwnedAttempt(req, res);
    if (!attempt) return;
    if (Date.now() > deadlineOf(attempt)) return res.status(403).json({ error: "Time is up for this assessment" });

    const { questionId, language, code } = req.body;
    if (!isAssignedQuestion(attempt, questionId)) return res.status(403).json({ error: "This question is not part of your assessment" });
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });

    // Snapshot the question's already-locked-in result (if any) before this resubmission
    // overwrites it — restored below if the new attempt scores worse, so a student can never
    // accidentally erase an already-earned better score just by resubmitting (or by autosave
    // saving further edits afterward — see /autosave above for the companion fix).
    const priorBest = await prisma.moduleCodingSubmission.findUnique({ where: { attemptId_questionId: { attemptId: attempt.id, questionId } } });
    const hadLockedBest = !!priorBest && priorBest.verdict !== "PENDING";

    const sub = await prisma.moduleCodingSubmission.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
      update: { language: language || "", code: code || "", verdict: "PENDING", passedCases: 0, totalCases: 0, timeMs: null, memoryKb: null },
      create: { attemptId: attempt.id, questionId, studentId: req.user.id, language: language || "", code: code || "", verdict: "PENDING" },
    });

    const result = await gradeOneModuleCodingSubmission(sub, question);

    // If this resubmission scored worse than the previously locked-in best, restore that best in
    // full (code/language/verdict/score together, never mixed) — the response below still reports
    // this attempt's true, live result so the student sees an honest verdict for what they just
    // ran; only the persisted/scored record is protected from regressing.
    if (hadLockedBest) {
      const freshSub = await prisma.moduleCodingSubmission.findUnique({ where: { id: sub.id } });
      if (freshSub && priorBest.score > freshSub.score) {
        await prisma.moduleCodingSubmission.update({
          where: { id: sub.id },
          data: {
            code: priorBest.code, language: priorBest.language, verdict: priorBest.verdict,
            score: priorBest.score, passedCases: priorBest.passedCases, totalCases: priorBest.totalCases,
            timeMs: priorBest.timeMs, memoryKb: priorBest.memoryKb,
          },
        });
      }
    }

    const { details, ...safeResult } = result;
    res.json(safeResult);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Submission failed" });
  }
});

// STUDENT: report a proctoring violation. Auto-submits (grades + finalizes) once the
// test-configured maxViolations is reached.
router.post("/attempts/:attemptId/violation", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: req.params.attemptId }, include: { moduleCodingTest: true } });
    if (!attempt || attempt.studentId !== req.user.id) return res.status(403).json({ error: "Invalid attempt" });
    if (attempt.status !== "IN_PROGRESS") {
      return res.json({ violationCount: attempt.violationCount, maxViolations: attempt.moduleCodingTest.maxViolations, autoSubmitted: true });
    }

    const type = String(req.body.type || "UNKNOWN").toUpperCase().slice(0, 40);
    await prisma.proctoringViolation.create({ data: { attemptId: attempt.id, type } });
    const violationCount = attempt.violationCount + 1;
    const autoSubmitted = violationCount >= attempt.moduleCodingTest.maxViolations;

    await prisma.moduleCodingAttempt.update({ where: { id: attempt.id }, data: { violationCount } });
    if (autoSubmitted) {
      await gradeModuleCodingAttempt(attempt.id, { reason: "MAX_VIOLATIONS" });
    }

    res.json({ violationCount, maxViolations: attempt.moduleCodingTest.maxViolations, autoSubmitted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record violation" });
  }
});

// STUDENT: finalize the attempt — grades every PENDING submission against all (incl. hidden)
// test cases, computes pass/fail, and (on pass) awards XP. Idempotent.
router.post("/attempts/:attemptId/finalize", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: req.params.attemptId }, include: { moduleCodingTest: { include: { module: true } } } });
    if (!attempt || attempt.studentId !== req.user.id) return res.status(403).json({ error: "Invalid attempt" });

    if (attempt.status !== "IN_PROGRESS") {
      return res.json({ score: attempt.score, passed: attempt.passed, status: attempt.status });
    }

    // An automatic ("TIME_EXPIRED") finalize call is only honored once the server's own clock
    // agrees time is actually up — same guard as Formal Tests' /submissions/finalize. A manual
    // Submit click (reason omitted) is never blocked, since a student is always allowed to submit
    // early.
    if (req.body?.reason === "TIME_EXPIRED") {
      const remainingMs = deadlineOf(attempt) - Date.now();
      if (remainingMs > PREMATURE_FINALIZE_GRACE_MS) {
        return res.json({ premature: true, deadline: deadlineOf(attempt), serverNow: Date.now() });
      }
    }

    const reason = Date.now() > deadlineOf(attempt) ? "TIME_EXPIRED" : null;
    const updated = await gradeModuleCodingAttempt(attempt.id, { reason });

    // wasFinalizedByThisCall is false when a concurrent request (double-click, client retry, or a
    // violation-triggered auto-submit landing at the same instant) already won the race to
    // actually flip this attempt out of IN_PROGRESS (see gradeModuleCodingAttempt's atomic claim).
    // Without this check, both racing requests would independently see `alreadyAwarded === 0`
    // (excluding only their own attempt id, which is the SAME attempt for both) and both award
    // MODULE_CODING_PASS XP for what is really one single completion event.
    let gamification = null;
    if (updated.wasFinalizedByThisCall && updated.passed) {
      try {
        const alreadyAwarded = await prisma.moduleCodingAttempt.count({
          where: { moduleCodingTestId: attempt.moduleCodingTestId, studentId: req.user.id, passed: true, id: { not: updated.id } },
        });
        gamification = await processGamification(req.user.id, {
          xpActivities: alreadyAwarded === 0 ? ["MODULE_CODING_PASS"] : [],
          xpMeta: { moduleId: attempt.moduleCodingTest.moduleId, attemptId: updated.id },
          streakEligible: true,
        });
      } catch (e) {
        console.error("gamification failed", e);
      }
    }

    res.json({ score: updated.score, passed: updated.passed, status: updated.status, submittedAt: updated.submittedAt, questionBreakdown: updated.questionBreakdown, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to finalize assessment" });
  }
});

// =========================== Admin/Staff CMS ===========================
// Staff gets read-only access to everything in this section (view test config + question pool)
// but every mutating route (create/edit/delete/bulk-import) below is ADMIN-only.

// ADMIN/STAFF: this module's coding-test config (or null) + its full question pool.
router.get("/admin/module/:moduleId", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const test = await prisma.moduleCodingTest.findUnique({
    where: { moduleId: req.params.moduleId },
    include: { questions: { include: { testCases: true }, orderBy: { questionNumber: "asc" } } },
  });
  res.json(test);
});

// Generic single-test lookup by its own id — used by the Level detail UI, since a chapter-scoped
// Level has no moduleId to look it up by (unlike the legacy route above).
router.get("/admin/tests/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const test = await prisma.moduleCodingTest.findUnique({
    where: { id: req.params.id },
    include: { questions: { include: { testCases: true }, orderBy: { questionNumber: "asc" } } },
  });
  if (!test) return res.status(404).json({ error: "Not found" });
  res.json(test);
});

// ADMIN/STAFF: flat list of every coding assessment (title + course/module/chapter label only —
// no config, no questions) so Staff can search for one to reset attempts on without any course-
// structure browsing access. This is the only "list assessments" surface Staff gets.
router.get("/admin/tests", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const tests = await prisma.moduleCodingTest.findMany({
    select: {
      id: true, title: true, maxAttempts: true, isActive: true,
      module: { select: { title: true, course: { select: { name: true } } } },
      chapter: { select: { title: true, module: { select: { title: true, course: { select: { name: true } } } } } },
    },
    orderBy: { title: "asc" },
  });
  res.json(tests.map((t) => ({
    id: t.id, title: t.title, maxAttempts: t.maxAttempts, isActive: t.isActive,
    courseName: t.module?.course?.name || t.chapter?.module?.course?.name || "",
    moduleTitle: t.module?.title || t.chapter?.module?.title || "",
    chapterTitle: t.chapter?.title || null,
  })));
});

router.post("/admin/module/:moduleId", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { title, instructions, allowedLanguages, questionCount, randomizeQuestions, passingPercent, timeLimitMin, maxAttempts, cooldownMinutes, maxViolations, requireFullscreen, requireWebcam, requireMicrophone, allowResume } = req.body;
    const test = await prisma.moduleCodingTest.create({
      data: {
        moduleId: req.params.moduleId,
        title: title || "Module Coding Assessment",
        instructions: instructions || null,
        allowedLanguages: allowedLanguages ?? undefined,
        questionCount: Number(questionCount) || 3,
        randomizeQuestions: randomizeQuestions !== undefined ? !!randomizeQuestions : true,
        passingPercent: Number(passingPercent) || 70,
        timeLimitMin: Number(timeLimitMin) || 45,
        // Default to 3 attempts when omitted (was null/unlimited) — every coding assessment
        // should have a real cap unless an admin deliberately overrides it.
        maxAttempts: maxAttempts === "" || maxAttempts == null ? 3 : Number(maxAttempts),
        cooldownMinutes: Number(cooldownMinutes) || 0,
        maxViolations: Number(maxViolations) || 3,
        requireFullscreen: requireFullscreen !== undefined ? !!requireFullscreen : true,
        requireWebcam: !!requireWebcam,
        requireMicrophone: !!requireMicrophone,
        allowResume: allowResume !== undefined ? !!allowResume : true,
      },
    });
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "This module already has a coding assessment configured" : "Failed to create coding assessment" });
  }
});

// Chapter-scoped Level creation — a "Level" IS a ModuleCodingTest row with chapterId set and
// moduleId left null. A Chapter can have many Levels (unlike a legacy Module-direct test,
// which is capped at one by ModuleCodingTest.moduleId's @unique constraint). Every downstream
// route (question CRUD, bulk-import, attempts, export) already operates purely on test.id, so
// none of them need any change to support this.
router.get("/admin/chapter/:chapterId/levels", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const levels = await prisma.moduleCodingTest.findMany({
    where: { chapterId: req.params.chapterId },
    orderBy: { order: "asc" },
    include: { _count: { select: { questions: true, attempts: true } } },
  });
  res.json(levels);
});

router.post("/admin/chapter/:chapterId/levels", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { title, instructions, order, allowedLanguages, questionCount, randomizeQuestions, passingPercent, timeLimitMin, maxAttempts, cooldownMinutes, maxViolations, requireFullscreen, requireWebcam, requireMicrophone, allowResume } = req.body;
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    const level = await prisma.moduleCodingTest.create({
      data: {
        chapterId: chapter.id,
        order: Number(order) || 0,
        title: title || "Coding Assessment Level",
        instructions: instructions || null,
        allowedLanguages: allowedLanguages ?? undefined,
        questionCount: Number(questionCount) || 3,
        randomizeQuestions: randomizeQuestions !== undefined ? !!randomizeQuestions : true,
        passingPercent: Number(passingPercent) || 70,
        timeLimitMin: Number(timeLimitMin) || 45,
        maxAttempts: maxAttempts === "" || maxAttempts == null ? 3 : Number(maxAttempts),
        cooldownMinutes: Number(cooldownMinutes) || 0,
        maxViolations: Number(maxViolations) || 3,
        requireFullscreen: requireFullscreen !== undefined ? !!requireFullscreen : true,
        requireWebcam: !!requireWebcam,
        requireMicrophone: !!requireMicrophone,
        allowResume: allowResume !== undefined ? !!allowResume : true,
      },
    });
    res.json(level);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create coding assessment level" });
  }
});

router.patch("/admin/tests/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const f = req.body;
    const data = {};
    for (const key of ["title", "instructions"]) if (f[key] !== undefined) data[key] = f[key];
    if (f.order !== undefined) data.order = Number(f.order);
    if (f.allowedLanguages !== undefined) data.allowedLanguages = f.allowedLanguages;
    if (f.questionCount !== undefined) data.questionCount = Number(f.questionCount);
    if (f.randomizeQuestions !== undefined) data.randomizeQuestions = !!f.randomizeQuestions;
    if (f.passingPercent !== undefined) data.passingPercent = Number(f.passingPercent);
    if (f.timeLimitMin !== undefined) data.timeLimitMin = Number(f.timeLimitMin);
    if (f.maxAttempts !== undefined) data.maxAttempts = f.maxAttempts === "" || f.maxAttempts === null ? null : Number(f.maxAttempts);
    if (f.cooldownMinutes !== undefined) data.cooldownMinutes = Number(f.cooldownMinutes);
    if (f.maxViolations !== undefined) data.maxViolations = Number(f.maxViolations);
    if (f.requireFullscreen !== undefined) data.requireFullscreen = !!f.requireFullscreen;
    if (f.requireWebcam !== undefined) data.requireWebcam = !!f.requireWebcam;
    if (f.requireMicrophone !== undefined) data.requireMicrophone = !!f.requireMicrophone;
    if (f.allowResume !== undefined) data.allowResume = !!f.allowResume;
    if (f.isActive !== undefined) data.isActive = !!f.isActive;
    const test = await prisma.moduleCodingTest.update({ where: { id: req.params.id }, data });
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update coding assessment" });
  }
});

router.delete("/admin/tests/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    await prisma.moduleCodingTest.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete coding assessment" });
  }
});

router.post("/admin/tests/:id/questions", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const {
      title, description, difficulty, timeLimitMs, starterCode, starterCodeByLanguage, testCases,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
      edgeCases, problemExplanation, tags, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
    } = req.body;
    if (!description) return res.status(400).json({ error: "description is required" });
    const cases = Array.isArray(testCases) ? testCases : [];
    if (cases.filter((tc) => !tc.isHidden).length < 2) {
      return res.status(400).json({ error: "Each question needs at least 2 visible sample test cases" });
    }
    if (cases.filter((tc) => tc.isHidden).length < 10) {
      return res.status(400).json({ error: "Each question needs at least 10 hidden test cases for final evaluation" });
    }
    const q = await prisma.question.create({
      data: {
        title: title || null, description, difficulty: difficulty || "EASY",
        questionType: "CODING", timeLimitMs: Number(timeLimitMs) || 2000, starterCode: starterCode || null,
        starterCodeByLanguage: starterCodeByLanguage && Object.keys(starterCodeByLanguage).length > 0 ? starterCodeByLanguage : undefined,
        tags: Array.isArray(tags) && tags.length > 0 ? tags : undefined,
        estimatedTimeMin: estimatedTimeMin ?? null,
        realWorldScenario: realWorldScenario || null,
        constraints: constraints || null,
        inputFormat: inputFormat || null,
        outputFormat: outputFormat || null,
        notes: notes || null,
        edgeCases: edgeCases || null,
        problemExplanation: problemExplanation || null,
        hints: hints ?? undefined,
        timeComplexity: timeComplexity || null,
        spaceComplexity: spaceComplexity || null,
        editorial: editorial ?? undefined,
        similarQuestions: similarQuestions ?? undefined,
        moduleCodingTestId: req.params.id,
        testCases: { create: cases.map((tc) => ({ input: tc.input || "", expected: tc.expected || "", isHidden: !!tc.isHidden, explanation: tc.explanation || null })) },
      },
      include: { testCases: true },
    });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add question" });
  }
});

// ADMIN: attach an existing Question Bank CODING question onto this test's pool, instead of
// forcing every question to be authored from scratch here. CreateTest.jsx already lets an admin
// pick an existing question for a Formal Test (GET /questions + the real many-to-many
// TestQuestion join) — Module Coding Tests had no equivalent reuse path at all, only the
// hand-author form above and bulk-import. This clones the source question (title/problem
// statement/starter code/test cases) into a new row scoped to this test, rather than reassigning
// the original in place: Question.moduleCodingTestId is a single nullable FK (a question can
// belong to at most one Module Coding Test's pool at a time), so moving the original instead of
// cloning would silently pull it out of the shared Question Bank — and out of any Formal Test it's
// already attached to via TestQuestion.
router.post("/admin/tests/:id/questions/link", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const test = await prisma.moduleCodingTest.findUnique({ where: { id: req.params.id } });
    if (!test) return res.status(404).json({ error: "Coding assessment not found" });

    const source = await prisma.question.findUnique({ where: { id: req.body.questionId }, include: { testCases: true } });
    if (!source || source.questionType !== "CODING") return res.status(404).json({ error: "Coding question not found" });

    const visible = source.testCases.filter((tc) => !tc.isHidden).length;
    const hidden = source.testCases.filter((tc) => tc.isHidden).length;
    if (visible < 2 || hidden < 10) {
      return res.status(400).json({ error: `That question doesn't meet this test's minimum test-case requirements (needs 2 visible, 10 hidden — has ${visible} visible, ${hidden} hidden)` });
    }

    const {
      id, questionNumber, createdAt, testCases, folderId, instituteId, createdById,
      subjectId, unitId, topicId, moduleCodingTestId, questionStatus, ...rest
    } = source;
    const clone = await prisma.question.create({
      data: {
        ...rest,
        moduleCodingTestId: test.id,
        testCases: {
          create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation || null })),
        },
      },
      include: { testCases: true },
    });
    res.json(clone);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to add question from bank") });
  }
});

const MODULE_CODING_TEMPLATE_HEADERS = [
  "Question Title", "Problem Statement", "Difficulty",
  "Time Limit (seconds)", "Constraints", "Input Format", "Output Format",
  "Sample Input 1", "Sample Output 1", "Sample Explanation 1",
  "Sample Input 2", "Sample Output 2", "Sample Explanation 2",
  "Hidden Test Cases (input->output pairs, separated by ||)",
  "Starter Code (Java)", "Starter Code (Python)", "Starter Code (Cpp)", "Starter Code (C)",
  "Tags",
];

const MODULE_CODING_IMPORT_HEADER_ALIASES = {
  title: ["question title", "title", "question name", "name"],
  description: ["problem statement", "question text", "description"],
  difficulty: ["difficulty", "difficulty level"],
  timeLimitSec: ["time limit seconds", "time limit s", "time limit"],
  constraints: ["constraints"],
  inputFormat: ["input format"],
  outputFormat: ["output format"],
  sampleInput1: ["sample input 1"],
  sampleOutput1: ["sample output 1"],
  sampleExplanation1: ["sample explanation 1"],
  sampleInput2: ["sample input 2"],
  sampleOutput2: ["sample output 2"],
  sampleExplanation2: ["sample explanation 2"],
  hiddenTestCases: ["hidden test cases input output pairs separated by", "hidden test cases"],
  starterJava: ["starter code java"],
  starterPython: ["starter code python"],
  starterCpp: ["starter code cpp", "starter code c++"],
  starterC: ["starter code c"],
  tags: ["tags"],
};
const MODULE_CODING_DIFFICULTY_ALIASES = { easy: "EASY", medium: "MEDIUM", hard: "HARD" };

function normalizeModuleCodingHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildModuleCodingHeaderMap(headers) {
  const map = {};
  for (const header of headers) {
    const norm = normalizeModuleCodingHeader(header);
    for (const [field, aliases] of Object.entries(MODULE_CODING_IMPORT_HEADER_ALIASES)) {
      if (!map[field] && aliases.includes(norm)) map[field] = header;
    }
  }
  return map;
}

// "5->25||3->9" -> [{input:"5",expected:"25"},{input:"3",expected:"9"}] — same pipe-delimited
// hidden-test-case cell format the main question bank's coding bulk-import uses (questions.js),
// so admins moving between the two surfaces see one consistent convention.
function parseModuleCodingHiddenTestCases(raw) {
  return String(raw || "")
    .split("||")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("->");
      if (idx === -1) return null;
      return { input: pair.slice(0, idx).trim(), expected: pair.slice(idx + 2).trim(), isHidden: true };
    })
    .filter(Boolean);
}

// ADMIN/STAFF: download a sample .xlsx template for bulk-importing this test's questions.
router.get("/admin/tests/:id/questions/bulk-template", authenticate, requireRole("ADMIN"), (req, res) => {
  const sampleRows = [
    [
      "Sum of Two Integers", "Return the sum of two integers.", "Easy",
      2, "1 <= a, b <= 10^9", "Two space-separated integers a and b on one line", "A single integer: a + b",
      "2 3", "5", "2 + 3 = 5",
      "10 20", "30", "",
      "4 6->10||100 200->300||-5 5->0",
      "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    int a = sc.nextInt(), b = sc.nextInt();\n    System.out.println(a + b);\n  }\n}",
      "a, b = map(int, input().split())\nprint(a + b)",
      "#include <iostream>\nusing namespace std;\nint main() {\n  int a, b; cin >> a >> b;\n  cout << a + b;\n}",
      "#include <stdio.h>\nint main() {\n  int a, b; scanf(\"%d %d\", &a, &b);\n  printf(\"%d\", a + b);\n}",
      "Math, Basics",
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([MODULE_CODING_TEMPLATE_HEADERS, ...sampleRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Questions");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=module-coding-question-template.xlsx");
  res.send(buffer);
});

// ADMIN/STAFF: bulk-import coding questions directly onto this Module Coding Test from an
// uploaded .xlsx/.csv file — same column conventions as the main question bank's coding
// bulk-import (questions.js), scoped straight to this test instead of a Question Bank folder.
// STDIO-only, matching the single "+ Add question" form this mirrors (which doesn't offer
// FUNCTION-mode evaluationType/functionSignature fields either).
router.post("/admin/tests/:id/questions/bulk-import", authenticate, requireRole("ADMIN"), upload.single("file"), async (req, res) => {
  try {
    const test = await prisma.moduleCodingTest.findUnique({ where: { id: req.params.id } });
    if (!test) return res.status(404).json({ error: "Module coding test not found" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .xlsx or .csv file." });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const headerMap = buildModuleCodingHeaderMap(Object.keys(rows[0]));
    if (!headerMap.title || !headerMap.description) {
      return res.status(400).json({ error: "Missing required columns. The file must include Question Title and Problem Statement." });
    }

    const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
    const created = [];
    const errors = [];
    const seenTitles = new Set();
    const existingTitles = new Set(
      (await prisma.question.findMany({ where: { moduleCodingTestId: req.params.id }, select: { title: true } }))
        .map((q) => (q.title || "").toLowerCase())
        .filter(Boolean)
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const title = field(row, "title");
      const description = field(row, "description");

      if (!title && !description) continue; // blank row
      if (!title) { errors.push({ row: rowNum, reason: "Missing Question Title" }); continue; }
      if (!description) { errors.push({ row: rowNum, reason: "Missing Problem Statement" }); continue; }

      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey) || existingTitles.has(titleKey)) {
        errors.push({ row: rowNum, reason: `Duplicate title: "${title}" already exists on this test` });
        continue;
      }

      const difficultyRaw = field(row, "difficulty");
      if (difficultyRaw && !MODULE_CODING_DIFFICULTY_ALIASES[normalizeModuleCodingHeader(difficultyRaw)]) {
        errors.push({ row: rowNum, reason: `Invalid Difficulty "${difficultyRaw}" — use Easy, Medium, or Hard` });
        continue;
      }
      const difficulty = MODULE_CODING_DIFFICULTY_ALIASES[normalizeModuleCodingHeader(difficultyRaw)] || "EASY";

      const timeLimitSecRaw = field(row, "timeLimitSec");
      const timeLimitSec = timeLimitSecRaw ? Number(timeLimitSecRaw) : 2;
      if (!Number.isFinite(timeLimitSec) || timeLimitSec <= 0) {
        errors.push({ row: rowNum, reason: `Invalid Time Limit "${timeLimitSecRaw}"` });
        continue;
      }

      const sample1In = field(row, "sampleInput1"), sample1Out = field(row, "sampleOutput1");
      const sample2In = field(row, "sampleInput2"), sample2Out = field(row, "sampleOutput2");
      if (!sample1In || !sample1Out || !sample2In || !sample2Out) {
        errors.push({ row: rowNum, reason: "Each coding question needs 2 complete sample test cases (input + output)" });
        continue;
      }
      const hiddenCases = parseModuleCodingHiddenTestCases(field(row, "hiddenTestCases"));
      if (hiddenCases.length < 10) {
        errors.push({ row: rowNum, reason: `Needs at least 10 hidden test cases — found ${hiddenCases.length} (check the "input->output||input->output" format)` });
        continue;
      }

      const starterCodeByLanguage = {};
      const javaCode = field(row, "starterJava");
      const pyCode = field(row, "starterPython");
      const cppCode = field(row, "starterCpp");
      const cCode = field(row, "starterC");
      if (javaCode) starterCodeByLanguage.java = javaCode;
      if (pyCode) starterCodeByLanguage.python = pyCode;
      if (cppCode) starterCodeByLanguage.cpp = cppCode;
      if (cCode) starterCodeByLanguage.c = cCode;

      const tags = field(row, "tags").split(",").map((s) => s.trim()).filter(Boolean);

      try {
        const question = await prisma.question.create({
          data: {
            title, description, questionType: "CODING", difficulty,
            timeLimitMs: Math.round(timeLimitSec * 1000),
            starterCode: Object.values(starterCodeByLanguage)[0] || "",
            starterCodeByLanguage: Object.keys(starterCodeByLanguage).length > 0 ? starterCodeByLanguage : undefined,
            tags: tags.length > 0 ? tags : undefined,
            constraints: field(row, "constraints") || null,
            inputFormat: field(row, "inputFormat") || null,
            outputFormat: field(row, "outputFormat") || null,
            moduleCodingTestId: req.params.id,
            testCases: {
              create: [
                { input: sample1In, expected: sample1Out, isHidden: false, explanation: field(row, "sampleExplanation1") || null },
                { input: sample2In, expected: sample2Out, isHidden: false, explanation: field(row, "sampleExplanation2") || null },
                ...hiddenCases,
              ],
            },
          },
        });
        seenTitles.add(titleKey);
        created.push(question);
      } catch (err) {
        errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
      }
    }

    res.json({ total: rows.length, createdCount: created.length, errorCount: errors.length, errors, created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

router.patch("/admin/questions/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const {
      title, description, difficulty, timeLimitMs, starterCode, starterCodeByLanguage, testCases,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
      edgeCases, problemExplanation, tags, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
    } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (difficulty !== undefined) data.difficulty = difficulty;
    if (timeLimitMs !== undefined) data.timeLimitMs = Number(timeLimitMs);
    if (starterCode !== undefined) data.starterCode = starterCode;
    if (starterCodeByLanguage !== undefined) data.starterCodeByLanguage = starterCodeByLanguage;
    if (tags !== undefined) data.tags = Array.isArray(tags) && tags.length > 0 ? tags : null;
    if (estimatedTimeMin !== undefined) data.estimatedTimeMin = estimatedTimeMin;
    if (realWorldScenario !== undefined) data.realWorldScenario = realWorldScenario;
    if (constraints !== undefined) data.constraints = constraints;
    if (inputFormat !== undefined) data.inputFormat = inputFormat;
    if (outputFormat !== undefined) data.outputFormat = outputFormat;
    if (notes !== undefined) data.notes = notes;
    if (edgeCases !== undefined) data.edgeCases = edgeCases;
    if (problemExplanation !== undefined) data.problemExplanation = problemExplanation;
    if (hints !== undefined) data.hints = hints;
    if (timeComplexity !== undefined) data.timeComplexity = timeComplexity;
    if (spaceComplexity !== undefined) data.spaceComplexity = spaceComplexity;
    if (editorial !== undefined) data.editorial = editorial;
    if (similarQuestions !== undefined) data.similarQuestions = similarQuestions;

    if (Array.isArray(testCases)) {
      if (testCases.filter((tc) => !tc.isHidden).length < 2) {
        return res.status(400).json({ error: "Each question needs at least 2 visible sample test cases" });
      }
      if (testCases.filter((tc) => tc.isHidden).length < 10) {
        return res.status(400).json({ error: "Each question needs at least 10 hidden test cases for final evaluation" });
      }
      // Nested deleteMany+create inside the SAME update() call below, instead of a separate
      // prisma.testCase.deleteMany() run ahead of it — keeps the replace atomic with the update,
      // so a failure in the update() call itself can never leave this question's old test cases
      // wiped with no replacement written (same fix applied to questions.js's PATCH /:id).
      data.testCases = { deleteMany: {}, create: testCases.map((tc) => ({ input: tc.input || "", expected: tc.expected || "", isHidden: !!tc.isHidden, explanation: tc.explanation || null })) };
    }
    const q = await prisma.question.update({ where: { id: req.params.id }, data, include: { testCases: true } });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update question" });
  }
});

// A hard delete here must never destroy the record of a question a student has already been
// graded on (spec: "Do not permanently delete challenges that already have student submissions
// ... use archive/soft delete where appropriate"). Question.moduleCodingTestId carries NO
// FK-restrict back to Question (a Module Coding Test question is only ever removed from its pool
// by deleting the row outright, there's no join table to restrict on the way TestQuestion does for
// Formal Tests) and ModuleCodingSubmission.questionId is a plain column with no enforced FK at
// all — so without this check, deleting a question a student already has graded submissions for
// would succeed silently: ModuleCodingAttemptQuestion rows (onDelete: Cascade) documenting which
// questions that attempt was assigned would be wiped, and any ModuleCodingSubmission rows (code,
// score, verdict) would be left pointing at a questionId that no longer exists — breaking that
// student's attempt-review screen with no admin-visible error at delete time.
router.delete("/admin/questions/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const [hasSubmissions, hasAttemptSnapshots] = await Promise.all([
      prisma.moduleCodingSubmission.findFirst({ where: { questionId: req.params.id }, select: { id: true } }),
      prisma.moduleCodingAttemptQuestion.findFirst({ where: { questionId: req.params.id }, select: { id: true } }),
    ]);
    if (hasSubmissions || hasAttemptSnapshots) {
      return res.status(409).json({ error: "This question already has student attempts/submissions and can't be permanently deleted. Edit it instead, or contact engineering to archive it without losing student records." });
    }
    await prisma.question.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This question is used in one or more tests and can't be deleted." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// ADMIN/STAFF: review every student's attempts on this test — score, status, violation count.
// A Staff member tied to a specific institute (req.requesterInstituteId set) only ever sees
// students from their own institute; an unscoped Platform Admin sees everyone — same convention
// attachRequesterInstitute already enforces on 40+ other routes across the platform.
router.get("/admin/tests/:id/attempts", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const attempts = await prisma.moduleCodingAttempt.findMany({
    where: {
      moduleCodingTestId: req.params.id,
      ...(req.requesterInstituteId ? { student: { instituteId: req.requesterInstituteId } } : {}),
    },
    include: { student: { select: { id: true, name: true, email: true, rollNumber: true, registrationNumber: true } } },
    orderBy: { startedAt: "desc" },
  });
  res.json(attempts);
});

// ADMIN/STAFF: full detail on one attempt — submitted code per question, execution results,
// and the proctoring violation log (event-level, not just a count).
router.get("/admin/attempts/:attemptId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const attempt = await prisma.moduleCodingAttempt.findUnique({
    where: { id: req.params.attemptId },
    include: {
      student: { select: { id: true, name: true, email: true, rollNumber: true, registrationNumber: true, instituteId: true } },
      moduleCodingTest: true,
      questions: { orderBy: { order: "asc" }, include: { question: true } },
      submissions: true,
      violations: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (req.requesterInstituteId && attempt.student.instituteId !== req.requesterInstituteId) {
    return res.status(404).json({ error: "Attempt not found" });
  }
  res.json(attempt);
});

// ADMIN/STAFF (own institute only): reset a student's attempts on this test — the lever for
// "manual approval of additional attempts". Two modes:
// - Full (default): clears all attempt history, student gets a completely fresh maxAttempts.
// - Custom: restores a specific number of remaining attempts by deleting only the oldest
//   finalized attempts needed to reach that count — no schema change, and recent attempts stay
//   visible for audit/history. Both modes are audit-logged with before/after remaining counts.
router.delete("/admin/tests/:id/students/:studentId/attempts", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const test = await prisma.moduleCodingTest.findUnique({ where: { id: req.params.id } });
    if (!test) return res.status(404).json({ error: "Assessment not found" });
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, name: true, instituteId: true, institute: { select: { name: true } } },
    });
    if (!student) return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage students in your own institute" });
    }

    const { mode, attemptsRemaining, reason } = req.body || {};
    const finalizedWhere = { moduleCodingTestId: req.params.id, studentId: req.params.studentId, status: { not: "IN_PROGRESS" } };
    const finalizedBefore = await prisma.moduleCodingAttempt.count({ where: finalizedWhere });

    if (mode === "custom" && test.maxAttempts != null) {
      const desiredRemaining = Math.max(0, Math.min(Number(attemptsRemaining) || 0, test.maxAttempts));
      const desiredFinalizedAfter = test.maxAttempts - desiredRemaining;
      const toDelete = Math.max(0, finalizedBefore - desiredFinalizedAfter);
      if (toDelete > 0) {
        const oldest = await prisma.moduleCodingAttempt.findMany({
          where: finalizedWhere, orderBy: { startedAt: "asc" }, take: toDelete, select: { id: true },
        });
        await prisma.moduleCodingAttempt.deleteMany({ where: { id: { in: oldest.map((a) => a.id) } } });
      }
    } else {
      await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: req.params.id, studentId: req.params.studentId } });
    }

    const finalizedAfter = await prisma.moduleCodingAttempt.count({ where: finalizedWhere });
    await logAudit({
      req, action: AUDIT_ACTIONS.REATTEMPT_GRANTED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: student.id, instituteId: student.instituteId,
      details: {
        assessmentName: test.title, mode: mode === "custom" ? "custom" : "full",
        studentName: student.name, instituteName: student.institute?.name || null,
        attemptsUsedBefore: finalizedBefore, attemptsUsedAfter: finalizedAfter,
        attemptsRemainingBefore: test.maxAttempts != null ? Math.max(0, test.maxAttempts - finalizedBefore) : null,
        attemptsRemainingAfter: test.maxAttempts != null ? Math.max(0, test.maxAttempts - finalizedAfter) : null,
        reason: reason || null,
      },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset attempts" });
  }
});

// ADMIN only: export all attempts on this test as a CSV — Staff's only permission in this
// router is view + reset attempts, export is explicitly excluded from that grant.
// attachRequesterInstitute still applies here: an institute-scoped ADMIN (as opposed to the
// unscoped Platform Admin) must still only export their own institute's data.
router.get("/admin/tests/:id/export", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    // Capped like every sibling export route (interview.js's session export, exports.js's
    // MAX_ROWS, users.js's audit-log CSV) — this route previously had no take at all, so a test
    // with an unusually large attempt count would build its entire XLSX buffer in memory with
    // nothing bounding it.
    const attempts = await prisma.moduleCodingAttempt.findMany({
      where: {
        moduleCodingTestId: req.params.id,
        ...(req.requesterInstituteId ? { student: { instituteId: req.requesterInstituteId } } : {}),
      },
      include: { student: { select: { name: true, email: true, rollNumber: true, registrationNumber: true } } },
      orderBy: { startedAt: "desc" },
      take: 5000,
    });
    const rows = attempts.map((a) => ({
      Student: a.student.name, Email: a.student.email, "Roll Number": a.student.rollNumber || "", "Registration Number (PRN)": a.student.registrationNumber || "",
      Attempt: a.attemptNumber, Status: a.status, Score: a.score, Passed: a.passed ? "Yes" : "No",
      Violations: a.violationCount, StartedAt: a.startedAt.toISOString(), SubmittedAt: a.submittedAt ? a.submittedAt.toISOString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attempts");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "csv" });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=coding-assessment-attempts.csv");
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export attempts" });
  }
});

module.exports = router;
