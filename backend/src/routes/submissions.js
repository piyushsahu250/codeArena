const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { judgeSubmission } = require("../utils/judge");
const { runQueued, getQueueStatus } = require("../utils/queue");
const { gradePendingCodingSubmissions, gradeCodingSubmission, recomputeAttemptScore } = require("../utils/gradeAttempt");
const { processGamification } = require("../utils/gamification");
const { safeErrorMessage } = require("../utils/errors");

const router = express.Router();

// Per-student (not per-IP) throttling on code EXECUTION specifically. Keying by IP would let a
// single shared campus/lab network IP — which many students behind one router/NAT genuinely
// share during an exam — collectively exhaust one shared budget. Only applied to routes that
// actually invoke the judge (/run, /submit for quiz grading) — /autosave is a plain DB write
// with no compute cost, so it isn't throttled here.
const execLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user.id,
});

// Any authenticated user: how busy the judge is right now. Polled by the frontend while a
// Run/Submit is pending so a slow response under heavy concurrent load reads as "N students
// ahead of you" instead of a silent, seemingly-frozen spinner.
router.get("/queue-status", authenticate, (req, res) => {
  res.json(getQueueStatus());
});

// MCQ/TRUE_FALSE/MULTISELECT only: withholds correctness from the submit response — students only
// see it after the test ends (via GET /tests/:id/my-result, gated on Test.showResults), same
// principle as hiding the answer key before a test. Not used for CODING/SQL — see
// sanitizeCodingResult below, which does reveal the verdict live (matches the question
// navigator's live green/yellow/red status and the identical, already-live behavior of Module
// Coding Test submissions).
function sanitizeSubmitResponse(question, result) {
  return { status: "SUBMITTED" };
}

// CODING/SQL only: reveals the real verdict/passedCases/totalCases/timing immediately — this is
// what drives the question navigator's live status color (green = ACCEPTED, red = anything else).
// Only the raw per-hidden-case `details` (actual hidden inputs/expected outputs) stays stripped;
// the pass/fail *count* and verdict are safe to show, same policy Module Coding Test submissions
// already use (see routes/moduleCoding.js submit-code).
function sanitizeCodingResult(result) {
  const { details, ...safe } = result;
  return safe;
}

// When Test.shuffleOptions is on, the student saw and clicked options in a per-attempt shuffled
// display order (see GET /tests/:id), so `selectedOptions` arrives as positions in THAT shuffled
// array, not the original Question.options/correctAnswer indices grading compares against.
// attempt.optionOrder[questionId] is the permutation used to build the display order (position i
// shows original option optionOrder[i]) — invert it back to original indices before grading. A
// question with no entry in optionOrder (shuffleOptions off, or a legacy attempt from before this
// feature) passes through untouched.
function toOriginalIndices(selectedOptions, order) {
  if (!order) return selectedOptions;
  return (Array.isArray(selectedOptions) ? selectedOptions : []).map((pos) => order[pos]).filter((v) => v !== undefined);
}

// The student's own individual deadline: their server-recorded startedAt plus the test's
// configured duration — never clamped to the test's scheduled availability window (Test.endTime
// only gates whether a *new* attempt can be started, see tests.js's POST /:id/start; a student who
// starts near the window's close still gets the full duration, matching moduleCoding.js's
// deadlineOf() for Module Coding Tests). This is the server-side source of truth mirrored by
// TestTaking.jsx's client-side countdown — every write endpoint below enforces it directly rather
// than trusting the client's timer to fire, since a client that never calls /finalize (blocked JS,
// closed tab, tampered devtools) must not be able to keep submitting past time.
function deadlineOf(attempt) {
  return new Date(attempt.startedAt).getTime() + attempt.test.durationMin * 60 * 1000;
}

// Exact-match grading for MCQ / TRUE_FALSE / MULTISELECT: the selected set of
// option indices must equal the correct set exactly (no partial credit).
function gradeQuizAnswer(question, selectedOptions) {
  const correct = Array.isArray(question.correctAnswer) ? [...question.correctAnswer].sort() : [];
  const selected = Array.isArray(selectedOptions) ? [...new Set(selectedOptions)].sort() : [];
  const isMatch = correct.length === selected.length && correct.every((v, i) => v === selected[i]);
  return {
    passedCases: isMatch ? 1 : 0,
    totalCases: 1,
    verdict: isMatch ? "ACCEPTED" : "WRONG_ANSWER",
    details: [{ verdict: isMatch ? "PASSED" : "WRONG_ANSWER" }],
  };
}

// STUDENT: run code against sample (non-hidden) test cases only — for self-check, doesn't save score
router.post("/run", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const { questionId, language, code } = req.body;
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { testCases: { where: { isHidden: false } } },
    });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING" && question.questionType !== "SQL") {
      return res.status(400).json({ error: "Run is only available for coding questions" });
    }

    const runLanguage = question.questionType === "SQL" ? "sql" : language;
    const result = await runQueued(() =>
      judgeSubmission({ language: runLanguage, code, testCases: question.testCases, timeLimitMs: question.timeLimitMs, memoryLimitKb: question.memoryLimitKb || undefined, evaluationType: question.evaluationType, functionSignature: question.functionSignature, sqlSchema: question.sqlSchema })
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: safeErrorMessage(err, "Failed to run your code. Please try again in a moment.") });
  }
});

// STUDENT: auto-save a coding draft (language + code) with no judging — coding is no longer
// graded per-question mid-test; the candidate can edit freely until the test ends, and the
// final saved draft is judged once at finalize time (or on a violation-triggered auto-submit).
// Stores/overwrites a single PENDING Submission row per attempt+question, same "latest answer
// wins" principle as quiz auto-save, just without running the compiler on every keystroke.
router.post("/autosave", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { attemptId, questionId, language, code } = req.body;

    const attempt = await prisma.testAttempt.findUnique({ where: { id: attemptId }, include: { test: { select: { durationMin: true } } } });
    if (!attempt || attempt.studentId !== req.user.id) {
      return res.status(403).json({ error: "Invalid attempt" });
    }
    if (attempt.status !== "IN_PROGRESS") {
      return res.status(403).json({ error: "This test attempt is already finalized" });
    }
    if (Date.now() > deadlineOf(attempt)) return res.status(403).json({ error: "Time is up for this test" });

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING" && question.questionType !== "SQL") {
      return res.status(400).json({ error: "Autosave is only for coding questions" });
    }
    // Derived from the question's actual type, not trusted from the client — the judge dispatch
    // (judge.js) picks the SQLite path purely on this string, so a SQL question must never end up
    // stored with anything else, regardless of what the request body claims.
    const savedLanguage = question.questionType === "SQL" ? "sql" : language;

    // Atomic upsert on the (attemptId, questionId) unique constraint — a plain findFirst-then-
    // create/update here would race under concurrent autosave triggers (10s interval tick vs.
    // question-switch flush vs. beforeunload flush all firing close together) and could create
    // two rows for the same question, leaving grading to pick between them arbitrarily.
    await prisma.submission.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: { language: savedLanguage || "", code: code || "", verdict: "PENDING", score: 0, passedCases: 0, totalCases: 0, timeMs: null, memoryKb: null },
      create: { attemptId, questionId, studentId: req.user.id, language: savedLanguage || "", code: code || "", verdict: "PENDING" },
    });

    res.json({ status: "SAVED" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: safeErrorMessage(err, "Failed to save your code — your latest changes may not be saved. Please try again.") });
  }
});

// STUDENT: explicit per-question Submit — saves the current code and immediately grades it
// against the HIDDEN test cases (never the sample cases the student already checked via /run),
// unlike /autosave which never judges anything. The response reveals the real verdict (see
// sanitizeCodingResult above) — this is what drives the live green/red status in the question
// navigator. A student can Submit as many times as the test allows re-submission;
// recomputeAttemptScore always keeps each question's BEST scoring submission.
router.post("/submit-code", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const { attemptId, questionId, language, code } = req.body;

    const attempt = await prisma.testAttempt.findUnique({ where: { id: attemptId }, include: { test: { select: { durationMin: true } } } });
    if (!attempt || attempt.studentId !== req.user.id) {
      return res.status(403).json({ error: "Invalid attempt" });
    }
    if (attempt.status !== "IN_PROGRESS") {
      return res.status(403).json({ error: "This test attempt is already finalized" });
    }
    if (Date.now() > deadlineOf(attempt)) return res.status(403).json({ error: "Time is up for this test" });

    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType !== "CODING" && question.questionType !== "SQL") {
      return res.status(400).json({ error: "Submit is only for coding questions" });
    }
    const savedLanguage = question.questionType === "SQL" ? "sql" : language;

    const sub = await prisma.submission.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: { language: savedLanguage || "", code: code || "", verdict: "PENDING", score: 0, passedCases: 0, totalCases: 0, timeMs: null, memoryKb: null },
      create: { attemptId, questionId, studentId: req.user.id, language: savedLanguage || "", code: code || "", verdict: "PENDING" },
    });

    const result = await gradeCodingSubmission(sub, question);
    await recomputeAttemptScore(attemptId);

    res.json(sanitizeCodingResult(result));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: safeErrorMessage(err, "Failed to submit your code. Please try again — if this keeps happening, contact your proctor.") });
  }
});

// STUDENT: auto-save/record an MCQ / TRUE_FALSE / MULTISELECT answer — graded instantly since
// exact-match grading is free (no compiler involved), but the response withholds correctness
// until results are published. A resubmission replaces the prior one for this question, so the
// most recently selected option is always what counts.
router.post("/submit", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const { attemptId, questionId, selectedOptions } = req.body;

    const attempt = await prisma.testAttempt.findUnique({ where: { id: attemptId }, include: { test: { select: { durationMin: true } } } });
    if (!attempt || attempt.studentId !== req.user.id) {
      return res.status(403).json({ error: "Invalid attempt" });
    }
    if (attempt.status !== "IN_PROGRESS") {
      return res.status(403).json({ error: "This test attempt is already finalized" });
    }
    if (Date.now() > deadlineOf(attempt)) return res.status(403).json({ error: "Time is up for this test" });

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (question.questionType === "CODING") {
      return res.status(400).json({ error: "Coding questions are auto-saved via /autosave, not /submit" });
    }

    const originalIndices = toOriginalIndices(selectedOptions, attempt.optionOrder?.[questionId]);
    const result = gradeQuizAnswer(question, originalIndices);
    const score =
      result.verdict === "ACCEPTED"
        ? question.points
        : Math.round((result.passedCases / result.totalCases) * question.points);

    // A re-submission replaces the prior one for this question — otherwise changing your
    // answer just added another row, and scoring picked whichever of the two scored higher,
    // which meant an earlier, since-changed answer could still silently win. The whole
    // delete-replace-recompute-update sequence runs in one transaction — without it, a crash
    // partway through could leave TestAttempt.totalScore stale relative to the student's actual
    // last-saved answer, or (very briefly) let a concurrent read see zero submissions for this
    // question between the delete and the create.
    let submission;
    await prisma.$transaction(async (tx) => {
      await tx.submission.deleteMany({ where: { attemptId, questionId } });
      submission = await tx.submission.create({
        data: {
          attemptId,
          questionId,
          studentId: req.user.id,
          language: question.questionType,
          code: JSON.stringify(selectedOptions || []),
          score,
          passedCases: result.passedCases,
          totalCases: result.totalCases,
          verdict: result.verdict,
        },
      });

      const allSubs = await tx.submission.findMany({ where: { attemptId } });
      const bestByQuestion = {};
      for (const s of allSubs) {
        if (!bestByQuestion[s.questionId] || s.score > bestByQuestion[s.questionId]) {
          bestByQuestion[s.questionId] = s.score;
        }
      }
      const totalScore = Object.values(bestByQuestion).reduce((a, b) => a + b, 0);
      await tx.testAttempt.update({ where: { id: attemptId }, data: { totalScore } });
    });

    res.json({ submissionId: submission.id, execution: sanitizeSubmitResponse(question, result) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: safeErrorMessage(err, "Failed to save your answer. Please try again.") });
  }
});

// A client-side auto-submit ("reason: time") is only trusted once the server's own clock agrees
// the deadline has actually passed, within this grace window — the timer sync fix means a synced
// client should never trip this in practice, but a stale/unsynced/tampered client still might, and
// this is the last line of defense so clock skew can never truncate a student's real time.
const PREMATURE_FINALIZE_GRACE_MS = 15000;

// STUDENT: finalize the whole test attempt — grades every still-PENDING coding draft (the
// final saved version of each) before marking the attempt SUBMITTED. Idempotent: calling it
// again on an already-finalized attempt just returns the current state.
router.post("/finalize/:attemptId", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({ where: { id: req.params.attemptId }, include: { test: { select: { durationMin: true } } } });
    if (!attempt || attempt.studentId !== req.user.id) {
      return res.status(403).json({ error: "Invalid attempt" });
    }

    if (attempt.status !== "IN_PROGRESS") {
      return res.json(attempt);
    }

    // An automatic ("time") finalize call is only honored once the server's own clock agrees time
    // is actually up — a manual Submit click (reason omitted) is never blocked here, since a
    // student is always allowed to submit early on purpose. This is what makes the server, not the
    // student's device clock, the source of truth for when the test actually ends.
    if (req.body?.reason === "time") {
      const remainingMs = deadlineOf(attempt) - Date.now();
      if (remainingMs > PREMATURE_FINALIZE_GRACE_MS) {
        return res.json({ premature: true, deadline: deadlineOf(attempt), serverNow: Date.now() });
      }
    }

    await gradePendingCodingSubmissions(attempt.id);

    // Finalize is never blocked by the deadline (unlike autosave/submit-code/submit above) — it
    // must always be able to close out whatever was legitimately submitted before time ran out,
    // whether triggered by the client's own timer hitting zero or a manual Submit click. Past the
    // deadline, though, mark it AUTO_SUBMITTED rather than SUBMITTED for accurate reporting — same
    // status a violation-triggered auto-submit already uses, and mirrors moduleCoding.js's
    // TIME_EXPIRED handling for Module Coding Test attempts.
    const isLate = Date.now() > deadlineOf(attempt);
    const updated = await prisma.testAttempt.update({
      where: { id: req.params.attemptId },
      data: { status: isLate ? "AUTO_SUBMITTED" : "SUBMITTED", submittedAt: new Date() },
    });

    let gamification = null;
    try {
      gamification = await processGamification(req.user.id, {
        xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true,
      });
    } catch (e) {
      console.error("gamification failed", e);
    }

    res.json({ ...updated, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: safeErrorMessage(err, "Failed to submit your test. Please try again immediately — if this persists, contact your proctor so your submission isn't lost.") });
  }
});

module.exports = router;
