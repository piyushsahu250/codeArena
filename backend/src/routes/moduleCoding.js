const express = require("express");
const rateLimit = require("express-rate-limit");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { gradeModuleCodingAttempt, gradeOneModuleCodingSubmission } = require("../utils/gradeModuleCodingAttempt");
const { getModuleLockMap } = require("../utils/learningLock");
const { processGamification } = require("../utils/gamification");
const { resolveCodingFields } = require("../utils/functionHarness");

const router = express.Router();

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
    include: { moduleCodingTest: true },
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

function deadlineOf(attempt) {
  return new Date(attempt.startedAt).getTime() + attempt.moduleCodingTest.timeLimitMin * 60 * 1000;
}

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
router.post("/module/:moduleId/start", authenticate, requireRole("STUDENT"), async (req, res) => {
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

    const { questionId, language, code } = req.body;
    // Atomic upsert on the (attemptId, questionId) unique constraint — see submissions.js's
    // /autosave for why a findFirst-then-create/update pattern here is a real race hazard.
    await prisma.moduleCodingSubmission.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
      update: { language: language || "", code: code || "", verdict: "PENDING", passedCases: 0, totalCases: 0, timeMs: null, memoryKb: null },
      create: { attemptId: attempt.id, questionId, studentId: req.user.id, language: language || "", code: code || "", verdict: "PENDING" },
    });
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
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });

    const sub = await prisma.moduleCodingSubmission.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
      update: { language: language || "", code: code || "", verdict: "PENDING", passedCases: 0, totalCases: 0, timeMs: null, memoryKb: null },
      create: { attemptId: attempt.id, questionId, studentId: req.user.id, language: language || "", code: code || "", verdict: "PENDING" },
    });

    const result = await gradeOneModuleCodingSubmission(sub, question);
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

    const reason = Date.now() > deadlineOf(attempt) ? "TIME_EXPIRED" : null;
    const updated = await gradeModuleCodingAttempt(attempt.id, { reason });

    let gamification = null;
    if (updated.passed) {
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

// ADMIN/STAFF: this module's coding-test config (or null) + its full question pool.
router.get("/admin/module/:moduleId", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const test = await prisma.moduleCodingTest.findUnique({
    where: { moduleId: req.params.moduleId },
    include: { questions: { include: { testCases: true }, orderBy: { questionNumber: "asc" } } },
  });
  res.json(test);
});

router.post("/admin/module/:moduleId", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
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
        maxAttempts: maxAttempts === "" || maxAttempts == null ? null : Number(maxAttempts),
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

router.patch("/admin/tests/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const f = req.body;
    const data = {};
    for (const key of ["title", "instructions"]) if (f[key] !== undefined) data[key] = f[key];
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

router.post("/admin/tests/:id/questions", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
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

router.patch("/admin/questions/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
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
      await prisma.testCase.deleteMany({ where: { questionId: req.params.id } });
      data.testCases = { create: testCases.map((tc) => ({ input: tc.input || "", expected: tc.expected || "", isHidden: !!tc.isHidden, explanation: tc.explanation || null })) };
    }
    const q = await prisma.question.update({ where: { id: req.params.id }, data, include: { testCases: true } });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update question" });
  }
});

router.delete("/admin/questions/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    await prisma.question.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// ADMIN/STAFF: review every student's attempts on this test — score, status, violation count.
router.get("/admin/tests/:id/attempts", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const attempts = await prisma.moduleCodingAttempt.findMany({
    where: { moduleCodingTestId: req.params.id },
    include: { student: { select: { id: true, name: true, email: true, rollNumber: true } } },
    orderBy: { startedAt: "desc" },
  });
  res.json(attempts);
});

// ADMIN/STAFF: full detail on one attempt — submitted code per question, execution results,
// and the proctoring violation log (event-level, not just a count).
router.get("/admin/attempts/:attemptId", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const attempt = await prisma.moduleCodingAttempt.findUnique({
    where: { id: req.params.attemptId },
    include: {
      student: { select: { id: true, name: true, email: true, rollNumber: true } },
      moduleCodingTest: true,
      questions: { orderBy: { order: "asc" }, include: { question: true } },
      submissions: true,
      violations: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  res.json(attempt);
});

// ADMIN/STAFF: reset a student's attempts on this test — the lever for "manual approval of
// additional attempts": rather than a separate grant-workflow/model, an admin can just clear a
// student's attempt history so they can start fresh (attempt numbering restarts at 1).
router.delete("/admin/tests/:id/students/:studentId/attempts", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: req.params.id, studentId: req.params.studentId } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset attempts" });
  }
});

// ADMIN/STAFF: export all attempts on this test as a CSV.
router.get("/admin/tests/:id/export", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const attempts = await prisma.moduleCodingAttempt.findMany({
      where: { moduleCodingTestId: req.params.id },
      include: { student: { select: { name: true, email: true, rollNumber: true } } },
      orderBy: { startedAt: "desc" },
    });
    const rows = attempts.map((a) => ({
      Student: a.student.name, Email: a.student.email, RollNumber: a.student.rollNumber || "",
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
