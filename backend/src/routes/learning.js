const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { resolveCodingFields } = require("../utils/functionHarness");
const { generateCertificatePdf } = require("../utils/certificatePdf");
const { issueCertificate } = require("../utils/certificates");
const { getModuleLockMap } = require("../utils/learningLock");
const { processGamification } = require("../utils/gamification");
const { askClaude } = require("../utils/aiClient");

// True once every lesson in a module (including its practice test) is COMPLETED for this
// student — used to fire the one-time MODULE_COMPLETE XP award at the exact moment the last
// lesson in a module gets completed, from whichever route that happens on.
async function isModuleNowComplete(studentId, moduleId) {
  const lessons = await prisma.lesson.findMany({ where: { moduleId }, select: { id: true } });
  if (lessons.length === 0) return false;
  const completedCount = await prisma.lessonProgress.count({
    where: { studentId, status: "COMPLETED", lessonId: { in: lessons.map((l) => l.id) } },
  });
  return completedCount === lessons.length;
}

const router = express.Router();

const runLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });
// Tighter than runLimiter — each call is a real Claude API request, not a free local judge run.
const hintLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });

// Strips answer-revealing fields from a practice question before sending it to a student. For
// CODING questions this includes the sample (non-hidden) test cases, so a student can see what
// their code needs to produce before running it — hidden cases (used by /submit) never go out.
function sanitizeQuestion(q) {
  return {
    id: q.id, type: q.type, prompt: q.prompt, options: q.options,
    starterCode: q.starterCode, starterCodeByLanguage: q.starterCodeByLanguage || null, language: q.language, order: q.order,
    evaluationType: q.evaluationType, functionSignature: q.functionSignature,
    testCases: q.type === "CODING" ? (Array.isArray(q.testCases) ? q.testCases.filter((tc) => !tc.isHidden) : []) : undefined,
    // Descriptive-only fields, never reveal an answer — safe to send to every student.
    title: q.title || null, tags: q.tags || null, difficulty: q.difficulty,
    estimatedTimeMin: q.estimatedTimeMin ?? null,
    realWorldScenario: q.realWorldScenario || null,
    constraints: q.constraints || null,
    inputFormat: q.inputFormat || null,
    outputFormat: q.outputFormat || null,
    notes: q.notes || null,
    edgeCases: q.edgeCases || null,
    problemExplanation: q.problemExplanation || null,
    // Editorial/hints — safe here because Learning Module practice is self-paced, never a
    // proctored/graded assessment; TestTaking.jsx and ModuleCodingAssessment.jsx use their own
    // sanitizers which deliberately omit these fields (see moduleCoding.js/tests.js).
    hints: q.hints || null,
    timeComplexity: q.timeComplexity || null,
    spaceComplexity: q.spaceComplexity || null,
    editorial: q.editorial || null,
    similarQuestions: q.similarQuestions || null,
  };
}

const PASS_THRESHOLD = 70; // % correct required on a module's practice test to unlock the next module

// =========================== Student-facing (read) ===========================

// Any authenticated user: list all courses (inactive ones show as "coming soon" — the
// frontend greys them out rather than hiding them, so the roadmap itself is visible).
router.get("/courses", authenticate, async (req, res) => {
  const courses = await prisma.course.findMany({ orderBy: { order: "asc" } });
  res.json(courses);
});

// Any authenticated user: one course's full module/lesson tree. For a STUDENT, each lesson
// carries their own progress status/bookmark and each module + the course carry completion
// counts, so the dashboard can render progress bars without a second round trip.
router.get("/courses/:slug", authenticate, async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { slug: req.params.slug },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: { lessons: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!course) return res.status(404).json({ error: "Course not found" });

  let progressByLesson = new Map();
  let lockMap = new Map();
  let resumeLessonId = null;
  if (req.user.role === "STUDENT") {
    const allLessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
    const progress = await prisma.lessonProgress.findMany({
      where: { studentId: req.user.id, lessonId: { in: allLessonIds } },
    });
    progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
    lockMap = await getModuleLockMap(prisma, req.user.id, course.id);

    // Resume pointer: the most recently touched lesson still in progress, or otherwise the
    // first lesson of the first module that isn't fully completed yet.
    const inProgress = progress
      .filter((p) => p.status === "IN_PROGRESS")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    if (inProgress) {
      resumeLessonId = inProgress.lessonId;
    } else {
      for (const m of course.modules) {
        const lock = lockMap.get(m.id);
        if (lock?.locked) break;
        if (!lock?.completed && m.lessons.length > 0) { resumeLessonId = m.lessons[0].id; break; }
      }
    }
  }

  let totalLessons = 0, completedLessons = 0;
  const modules = course.modules.map((m) => {
    const lock = lockMap.get(m.id) || { locked: false, completed: false, lessonsComplete: false, codingTest: { required: false, passed: true } };
    const lessons = m.lessons.map((l) => {
      const p = progressByLesson.get(l.id);
      totalLessons++;
      if (p?.status === "COMPLETED") completedLessons++;
      return {
        id: l.id, title: l.title, order: l.order, estimatedMinutes: l.estimatedMinutes,
        isModuleTest: l.isModuleTest,
        status: p?.status || "NOT_STARTED", bookmarked: p?.bookmarked || false,
      };
    });
    const moduleCompleted = lessons.filter((l) => l.status === "COMPLETED").length;
    return {
      id: m.id, title: m.title, description: m.description, order: m.order, lessons,
      completedCount: moduleCompleted, totalCount: lessons.length,
      locked: lock.locked, completed: lock.completed,
      lessonsComplete: lock.lessonsComplete, codingTest: lock.codingTest,
    };
  });

  res.json({
    course: { id: course.id, slug: course.slug, name: course.name, description: course.description, isActive: course.isActive },
    modules,
    overall: { totalLessons, completedLessons, percent: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0 },
    resumeLessonId,
  });
});

// Any authenticated user: single lesson detail, with prev/next lesson ids for in-course
// navigation and (for a STUDENT) their own progress record.
router.get("/lessons/:id", authenticate, async (req, res) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: req.params.id },
    include: {
      module: { include: { course: true, lessons: { orderBy: { order: "asc" } } } },
      questions: { orderBy: { order: "asc" } },
    },
  });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });

  if (req.user.role === "STUDENT") {
    const lockMap = await getModuleLockMap(prisma, req.user.id, lesson.module.courseId);
    if (lockMap.get(lesson.module.id)?.locked) {
      return res.status(403).json({ error: "This module is locked. Complete the previous module's practice test to unlock it." });
    }
  }

  const allModules = await prisma.courseModule.findMany({
    where: { courseId: lesson.module.courseId },
    orderBy: { order: "asc" },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  const flat = allModules.flatMap((m) => m.lessons.map((l) => l.id));
  const idx = flat.indexOf(lesson.id);
  const prevLessonId = idx > 0 ? flat[idx - 1] : null;
  const nextLessonId = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;

  let progress = null;
  if (req.user.role === "STUDENT") {
    progress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId: req.user.id, lessonId: lesson.id } },
    });
    // First view: silently mark IN_PROGRESS so the course page reflects "started" without
    // requiring an explicit action.
    if (!progress) {
      progress = await prisma.lessonProgress.create({
        data: { studentId: req.user.id, lessonId: lesson.id, status: "IN_PROGRESS" },
      });
    }
  }

  res.json({
    lesson: {
      id: lesson.id, title: lesson.title, content: lesson.content,
      videoUrl: lesson.videoUrl, pdfUrl: lesson.pdfUrl, externalLinks: lesson.externalLinks,
      estimatedMinutes: lesson.estimatedMinutes, isModuleTest: lesson.isModuleTest,
    },
    module: { id: lesson.module.id, title: lesson.module.title },
    course: { id: lesson.module.course.id, slug: lesson.module.course.slug, name: lesson.module.course.name },
    prevLessonId, nextLessonId,
    progress: progress ? { status: progress.status, bookmarked: progress.bookmarked } : null,
    // Admin/Staff get full question data (correctAnswer/explanation/testCases) for the CMS
    // edit form; a Student only ever sees the sanitized, answer-free shape.
    questions: req.user.role === "STUDENT" ? lesson.questions.map(sanitizeQuestion) : lesson.questions,
  });
});

// =========================== Student progress + practice ===========================

// STUDENT: mark a lesson's status and/or bookmark. Upserts so the first call (even before
// GET /lessons/:id auto-creates an IN_PROGRESS row) still works.
router.post("/lessons/:id/progress", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const lesson = await prisma.lesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    const { status, bookmarked } = req.body;
    if (status && !["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    // A module's practice test can only be marked COMPLETED by passing it (POST
    // /lessons/:id/test-submit) — allowing a manual complete here would bypass the gate
    // that unlocks the next module.
    if (status === "COMPLETED" && lesson.isModuleTest) {
      return res.status(400).json({ error: "Submit the practice test to complete this lesson" });
    }

    const priorProgress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId: req.user.id, lessonId: lesson.id } },
    });
    const isNewCompletion = status === "COMPLETED" && priorProgress?.status !== "COMPLETED";

    const data = {};
    if (status) {
      data.status = status;
      data.completedAt = status === "COMPLETED" ? new Date() : null;
    }
    if (bookmarked !== undefined) data.bookmarked = !!bookmarked;

    const progress = await prisma.lessonProgress.upsert({
      where: { studentId_lessonId: { studentId: req.user.id, lessonId: lesson.id } },
      update: data,
      create: { studentId: req.user.id, lessonId: lesson.id, status: status || "IN_PROGRESS", bookmarked: !!bookmarked },
    });

    let gamification = null;
    if (isNewCompletion) {
      try {
        const moduleComplete = await isModuleNowComplete(req.user.id, lesson.moduleId);
        gamification = await processGamification(req.user.id, {
          xpActivities: moduleComplete ? ["MODULE_COMPLETE"] : [],
          xpMeta: { moduleId: lesson.moduleId },
          streakEligible: true,
        });
      } catch (e) {
        console.error("gamification failed", e);
      }
    }

    res.json({ ...progress, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update progress" });
  }
});

// STUDENT: submit a module's practice test as a batch — every non-CODING practice question on
// an isModuleTest lesson, answered together in one go, rather than checked one at a time.
// Passing (>= PASS_THRESHOLD%) marks the lesson COMPLETED, which is what the module-lock check
// (getModuleLockMap) looks for to unlock the next module. Failing leaves it IN_PROGRESS so the
// student can retry — there's no attempt cap or cooldown, this is learning, not an exam.
// Response includes the full per-question review (selected answer, correct/incorrect, the
// correct answer, and its explanation) — deliberately answer-revealing, since that's the whole
// point of a learning-module practice test, unlike the exam submission flow.
router.post("/lessons/:id/test-submit", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const lesson = await prisma.lesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    if (!lesson.isModuleTest) return res.status(400).json({ error: "This lesson is not a practice test" });

    const questions = await prisma.practiceQuestion.findMany({
      where: { lessonId: lesson.id, type: { not: "CODING" } },
      orderBy: { order: "asc" },
    });
    if (questions.length === 0) return res.status(400).json({ error: "This practice test has no questions yet" });

    const answers = req.body.answers || {};
    let correctCount = 0;
    const results = questions.map((q) => {
      const selected = answers[q.id];
      let correct;
      if (q.type === "FILL_BLANK") {
        correct = String(selected ?? "").trim().toLowerCase() === String(q.correctAnswer ?? "").trim().toLowerCase();
      } else {
        correct = selected !== undefined && selected !== null && Number(selected) === Number(q.correctAnswer);
      }
      if (correct) correctCount++;
      return {
        questionId: q.id, type: q.type, prompt: q.prompt, options: q.options,
        selected: selected ?? null, correct, correctAnswer: q.correctAnswer, explanation: q.explanation || null,
      };
    });

    const score = Math.round((correctCount / questions.length) * 100);
    const passed = score >= PASS_THRESHOLD;

    // A test already passed can be retaken for practice — a weaker score on a retake must
    // never downgrade COMPLETED back to IN_PROGRESS, or it would re-lock every module after
    // this one even though the student already earned the unlock.
    const existing = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId: req.user.id, lessonId: lesson.id } },
    });
    const alreadyPassed = existing?.status === "COMPLETED";
    const nextStatus = passed || alreadyPassed ? "COMPLETED" : "IN_PROGRESS";

    await prisma.lessonProgress.upsert({
      where: { studentId_lessonId: { studentId: req.user.id, lessonId: lesson.id } },
      update: { status: nextStatus, completedAt: nextStatus === "COMPLETED" ? existing?.completedAt || new Date() : null },
      create: { studentId: req.user.id, lessonId: lesson.id, status: nextStatus, completedAt: nextStatus === "COMPLETED" ? new Date() : null },
    });

    let gamification = null;
    if (passed) {
      try {
        const moduleComplete = !alreadyPassed && (await isModuleNowComplete(req.user.id, lesson.moduleId));
        gamification = await processGamification(req.user.id, {
          xpActivities: [
            ...(!alreadyPassed ? ["MODULE_QUIZ_PASS"] : []),
            ...(moduleComplete ? ["MODULE_COMPLETE"] : []),
          ],
          xpMeta: { lessonId: lesson.id, moduleId: lesson.moduleId },
          streakEligible: true,
        });
      } catch (e) {
        console.error("gamification failed", e);
      }
    }

    res.json({ passed, score, correctCount, totalCount: questions.length, passThreshold: PASS_THRESHOLD, results, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit practice test" });
  }
});

// STUDENT: check an MCQ/FILL_BLANK/DEBUG/OUTPUT_PREDICTION practice answer. Unlike exam
// submissions, learning-mode feedback is immediate and reveals the correct answer + explanation
// right away — that's the point of practice, not a leak.
router.post("/practice/:id/check", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const q = await prisma.practiceQuestion.findUnique({ where: { id: req.params.id } });
    if (!q) return res.status(404).json({ error: "Question not found" });
    if (q.type === "CODING") return res.status(400).json({ error: "Use /run for coding questions" });

    let correct;
    if (q.type === "FILL_BLANK") {
      correct = String(req.body.answer ?? "").trim().toLowerCase() === String(q.correctAnswer ?? "").trim().toLowerCase();
    } else {
      correct = Number(req.body.answer) === Number(q.correctAnswer);
    }
    res.json({ correct, correctAnswer: q.correctAnswer, explanation: q.explanation || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to check answer" });
  }
});

// STUDENT: this student's attempt history on one coding practice question — unlimited attempts
// by design (practice, not an exam), so this is purely informational: how many times they've
// tried, whether they've ever solved it, and their most recent verdict.
router.get("/practice/:id/history", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const [totalAttempts, solvedCount, latest] = await Promise.all([
      prisma.practiceRunLog.count({ where: { studentId: req.user.id, questionId: req.params.id } }),
      prisma.practiceRunLog.count({ where: { studentId: req.user.id, questionId: req.params.id, verdict: "ACCEPTED" } }),
      prisma.practiceRunLog.findFirst({ where: { studentId: req.user.id, questionId: req.params.id }, orderBy: { createdAt: "desc" } }),
    ]);
    res.json({
      totalAttempts,
      solved: solvedCount > 0,
      latestVerdict: latest?.verdict || null,
      latestAt: latest?.createdAt || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load attempt history" });
  }
});

// Splits a practice question's stored test cases into visible/hidden pools. Older questions
// authored before isHidden existed have no such key on any case — treated as all-visible, so
// /run keeps showing every case exactly as it always has, and /submit's hidden-fallback (below)
// naturally grades against the same full set for those questions too.
function splitPracticeCases(testCases) {
  const all = Array.isArray(testCases) ? testCases : [];
  const visible = all.filter((tc) => !tc.isHidden);
  const hidden = all.filter((tc) => tc.isHidden);
  return { visible, hidden };
}

// STUDENT: run a coding practice question against its VISIBLE (sample) test cases only — a
// free, unlimited, side-effect-free self-check. Does not log an attempt or award XP; use
// /submit for that. Full pass/fail detail on these sample cases is returned since nothing here
// is hidden from the student anyway.
router.post("/practice/:id/run", authenticate, requireRole("STUDENT"), runLimiter, async (req, res) => {
  try {
    const q = await prisma.practiceQuestion.findUnique({ where: { id: req.params.id } });
    if (!q || q.type !== "CODING") return res.status(400).json({ error: "Not a coding question" });

    const { language, code } = req.body;
    const { visible } = splitPracticeCases(q.testCases);
    const result = await runQueued(() => judgeSubmission({ language, code, testCases: visible, timeLimitMs: 3000, evaluationType: q.evaluationType, functionSignature: q.functionSignature }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

// STUDENT: submit a coding practice question for real grading — evaluated against the HIDDEN
// test cases (falling back to the full case set for legacy questions with none marked hidden,
// same policy used for Coding Tests and Module Coding Tests). This is the action that's logged
// to PracticeRunLog (the streak/badge signal) and that awards tiered XP on first solve.
router.post("/practice/:id/submit", authenticate, requireRole("STUDENT"), runLimiter, async (req, res) => {
  try {
    const q = await prisma.practiceQuestion.findUnique({ where: { id: req.params.id } });
    if (!q || q.type !== "CODING") return res.status(400).json({ error: "Not a coding question" });

    const { language, code } = req.body;
    const { visible, hidden } = splitPracticeCases(q.testCases);
    const gradingCases = hidden.length > 0 ? hidden : visible;
    const result = await runQueued(() => judgeSubmission({ language, code, testCases: gradingCases, timeLimitMs: 3000, evaluationType: q.evaluationType, functionSignature: q.functionSignature }));

    let gamification = null;
    try {
      const alreadySolved = result.verdict === "ACCEPTED"
        ? (await prisma.practiceRunLog.count({ where: { studentId: req.user.id, questionId: q.id, verdict: "ACCEPTED" } })) > 0
        : false;
      await prisma.practiceRunLog.create({ data: { studentId: req.user.id, questionId: q.id, verdict: result.verdict } });

      if (result.verdict === "ACCEPTED") {
        const xpActivity = q.difficulty === "HARD" ? "CODING_HARD" : q.difficulty === "MEDIUM" ? "CODING_MEDIUM" : "CODING_EASY";
        gamification = await processGamification(req.user.id, {
          xpActivities: alreadySolved ? [] : [xpActivity],
          xpMeta: { questionId: q.id },
          streakEligible: true,
        });
      }
    } catch (e) {
      console.error("gamification failed", e);
    }

    // Hidden test-case inputs/expected outputs never leave the server — only pass/fail counts,
    // verdict, timing, and (when every case failed the same way) a compile/runtime error summary
    // that judge.js already keeps content-free by design.
    const { details, ...safeResult } = result;
    res.json({ ...safeResult, gamification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Submission failed" });
  }
});

// STUDENT: a short, non-answer-revealing hint after a wrong practice submission — gated on
// Institute.aiHintsEnabled (admin opt-in, default off) and only ever wired into Practice Coding,
// never Coding Tests / Module Coding Tests / exams, which stay 100% unassisted. Requires the
// student's most recent logged attempt on this question to be a non-ACCEPTED verdict, so a hint
// can't be requested before actually trying (or after already solving it).
router.post("/practice/:id/hint", authenticate, requireRole("STUDENT"), hintLimiter, async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { institute: { select: { aiHintsEnabled: true } } } });
    if (!student?.institute?.aiHintsEnabled) {
      return res.status(403).json({ error: "AI hints aren't enabled for your institute" });
    }

    const q = await prisma.practiceQuestion.findUnique({ where: { id: req.params.id } });
    if (!q || q.type !== "CODING") return res.status(400).json({ error: "Not a coding question" });

    const lastAttempt = await prisma.practiceRunLog.findFirst({
      where: { studentId: req.user.id, questionId: q.id },
      orderBy: { createdAt: "desc" },
    });
    if (!lastAttempt || lastAttempt.verdict === "ACCEPTED") {
      return res.status(400).json({ error: "Hints are only available after a wrong submission attempt" });
    }

    const { code, language } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ error: "code is required" });

    const hint = await askClaude({
      system: "You are a patient programming tutor. Give a short, specific hint that nudges the student toward finding and fixing their own bug — never write corrected code, never give the full solution. 2-4 sentences.",
      prompt: `Question: ${q.prompt}\n\nStudent's ${language || "code"} submission (verdict: ${lastAttempt.verdict}):\n\`\`\`\n${code.slice(0, 4000)}\n\`\`\`\n\nGive one concise hint.`,
      maxTokens: 300,
      temperature: 0.5,
    });
    res.json({ hint });
  } catch (err) {
    if (err.notConfigured) return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to generate hint" });
  }
});

// STUDENT: autosave the in-progress code draft for a practice coding question — same atomic
// upsert pattern used for Coding Test / Module Coding Test autosave, keyed generically since
// practice questions have no "attempt" row of their own to hang a draft off of.
router.post("/practice/:id/autosave", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { language, code } = req.body;
    if (typeof code !== "string" || !language) return res.status(400).json({ error: "language and code are required" });
    await prisma.codeDraft.upsert({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "PRACTICE", contextId: req.params.id } },
      update: { code, language },
      create: { studentId: req.user.id, contextType: "PRACTICE", contextId: req.params.id, code, language },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Autosave failed" });
  }
});

// STUDENT: fetch the saved draft (if any) for a practice coding question, so reopening a lesson
// restores in-progress code instead of resetting to the question's starter code.
router.get("/practice/:id/draft", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const draft = await prisma.codeDraft.findUnique({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "PRACTICE", contextId: req.params.id } },
    });
    res.json(draft ? { code: draft.code, language: draft.language } : null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load draft" });
  }
});

// =========================== Certificates ===========================

async function checkCourseCompletion(studentId, course) {
  const totalLessons = await prisma.lesson.count({ where: { module: { courseId: course.id } } });
  const completedLessons = await prisma.lessonProgress.count({
    where: { studentId, status: "COMPLETED", lesson: { module: { courseId: course.id } } },
  });
  return { totalLessons, completedLessons, complete: totalLessons > 0 && completedLessons >= totalLessons };
}

// Auto-issues (idempotently, via the studentId+courseId unique constraint) the LEARNING_MODULE
// certificate for a fully-completed course, and returns the existing one on any later call.
async function getOrIssueLearningCertificate(studentId, course) {
  let cert = await prisma.certificate.findUnique({
    where: { studentId_courseId_type: { studentId, courseId: course.id, type: "LEARNING_MODULE" } },
  });
  if (!cert) {
    const student = await prisma.user.findUnique({ where: { id: studentId }, include: { institute: true } });
    cert = await issueCertificate({
      type: "LEARNING_MODULE",
      studentId,
      courseId: course.id,
      title: `${course.name} Learning Course`,
      instituteCode: student.institute?.code,
      programCode: course.slug,
    });
  }
  return cert;
}

// STUDENT: fetch (auto-issuing on first call) the certificate for a fully-completed course.
router.get("/courses/:slug/certificate", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const course = await prisma.course.findUnique({ where: { slug: req.params.slug } });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const { totalLessons, completedLessons, complete } = await checkCourseCompletion(req.user.id, course);
    if (!complete) {
      return res.status(400).json({ error: "Course not yet completed", totalLessons, completedLessons });
    }

    const cert = await getOrIssueLearningCertificate(req.user.id, course);
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    res.json({ ...cert, studentName: student.name, courseName: course.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load certificate" });
  }
});

// PUBLIC (no auth) — kept for back-compat with existing Learning Module certificate links;
// GET /api/certificates/verify/:code (routes/certificates.js) is the unified verify endpoint
// going forward and covers this same Certificate model plus CODING_ASSESSMENT/MANUAL types.
router.get("/certificate/verify/:code", async (req, res) => {
  try {
    const cert = await prisma.certificate.findUnique({
      where: { certificateCode: req.params.code },
      include: { student: { select: { name: true } }, course: { select: { name: true } } },
    });
    if (!cert) return res.status(404).json({ valid: false });
    res.json({
      valid: true,
      status: cert.status,
      revoked: cert.status === "REVOKED",
      studentName: cert.student.name,
      courseName: cert.course?.name || cert.title,
      issuedAt: cert.issuedAt,
      certificateCode: cert.certificateCode,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false, error: "Verification failed" });
  }
});

// STUDENT: download the certificate as a PDF (must already be eligible/issued).
router.get("/courses/:slug/certificate/download", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const course = await prisma.course.findUnique({ where: { slug: req.params.slug } });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const { complete } = await checkCourseCompletion(req.user.id, course);
    if (!complete) return res.status(400).json({ error: "Course not yet completed" });

    const cert = await getOrIssueLearningCertificate(req.user.id, course);
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, include: { institute: true } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${course.slug}-certificate.pdf"`);
    await generateCertificatePdf({
      studentName: student.name,
      title: cert.title,
      programName: course.name,
      certificateCode: cert.certificateCode,
      issuedAt: cert.issuedAt,
      status: cert.status,
      verifyUrl: `${process.env.FRONTEND_URL || "https://codearena-app.vercel.app"}/certificate/verify/${cert.certificateCode}`,
      instituteName: student.institute?.name,
      instituteLogoUrl: student.institute?.logoUrl,
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

// =========================== Admin/Staff content management (CMS) ===========================

router.post("/courses", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { slug, name, description, order, isActive } = req.body;
    if (!slug || !name) return res.status(400).json({ error: "slug and name are required" });
    const course = await prisma.course.create({
      data: { slug, name, description: description || null, order: Number(order) || 0, isActive: !!isActive },
    });
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A course with this slug already exists" : "Failed to create course" });
  }
});

router.patch("/courses/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { name, description, order, isActive } = req.body;
    const course = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(order !== undefined ? { order: Number(order) } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update course" });
  }
});

router.delete("/courses/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    await prisma.course.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete course" });
  }
});

router.post("/courses/:id/modules", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { title, description, order } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const mod = await prisma.courseModule.create({
      data: { courseId: req.params.id, title, description: description || null, order: Number(order) || 0 },
    });
    res.json(mod);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A module with this title already exists in this course" : "Failed to create module" });
  }
});

router.patch("/modules/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { title, description, order, isActive } = req.body;
    const mod = await prisma.courseModule.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(order !== undefined ? { order: Number(order) } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });
    res.json(mod);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update module" });
  }
});

router.delete("/modules/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    await prisma.courseModule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete module" });
  }
});

// =========================== Chapters (admin CRUD) ===========================
// A Chapter groups a Module's "Learn" topics (Lessons) with the Coding Assessment Level(s)
// that gate progress past it. Every pre-Chapter module gets backfilled with one "General"
// chapter (see scripts/backfillChapters.js) so this is purely additive on top of existing data.

router.get("/modules/:id/chapters", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const chapters = await prisma.chapter.findMany({
      where: { moduleId: req.params.id },
      orderBy: { order: "asc" },
      include: { _count: { select: { topics: true, levels: true } } },
    });
    res.json(chapters);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load chapters" });
  }
});

router.post("/modules/:id/chapters", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { title, description, order, isActive, countsTowardCertificate } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const chapter = await prisma.chapter.create({
      data: {
        moduleId: req.params.id, title, description: description || null,
        order: Number(order) || 0,
        isActive: isActive === undefined ? true : !!isActive,
        countsTowardCertificate: countsTowardCertificate === undefined ? true : !!countsTowardCertificate,
      },
    });
    res.json(chapter);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A chapter with this title already exists in this module" : "Failed to create chapter" });
  }
});

// Full topic list for one chapter (the chapter list route above only returns a count) — used by
// the admin CMS's "Learn" tab.
router.get("/chapters/:id/lessons", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const lessons = await prisma.lesson.findMany({
      where: { chapterId: req.params.id },
      orderBy: { order: "asc" },
    });
    res.json(lessons);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load topics" });
  }
});

router.patch("/chapters/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { title, description, order, isActive, countsTowardCertificate } = req.body;
    const chapter = await prisma.chapter.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(order !== undefined ? { order: Number(order) } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
        ...(countsTowardCertificate !== undefined ? { countsTowardCertificate: !!countsTowardCertificate } : {}),
      },
    });
    res.json(chapter);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update chapter" });
  }
});

router.delete("/chapters/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    await prisma.chapter.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete chapter" });
  }
});

router.post("/modules/:id/lessons", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { title, content, blocks, videoUrl, pdfUrl, externalLinks, order, estimatedMinutes, isModuleTest, isActive } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId: req.params.id, title,
        content: content || null, blocks: blocks || undefined, videoUrl: videoUrl || null, pdfUrl: pdfUrl || null,
        externalLinks: externalLinks || undefined, order: Number(order) || 0,
        estimatedMinutes: Number(estimatedMinutes) || 10, isModuleTest: !!isModuleTest,
        isActive: isActive === undefined ? true : !!isActive,
      },
    });
    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A lesson with this title already exists in this module" : "Failed to create lesson" });
  }
});

// Chapter-scoped Learning Topic creation — a Learning Topic IS a Lesson row, just with
// chapterId set. moduleId is denormalized from the chapter's own module so every existing
// moduleId-keyed query (isModuleNowComplete, LessonProgress counting, etc.) keeps working
// unchanged for chapter-scoped topics too.
router.post("/chapters/:id/lessons", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.id } });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    const { title, content, blocks, videoUrl, pdfUrl, externalLinks, order, estimatedMinutes, isModuleTest, isActive } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId: chapter.moduleId, chapterId: chapter.id, title,
        content: content || null, blocks: blocks || undefined, videoUrl: videoUrl || null, pdfUrl: pdfUrl || null,
        externalLinks: externalLinks || undefined, order: Number(order) || 0,
        estimatedMinutes: Number(estimatedMinutes) || 10, isModuleTest: !!isModuleTest,
        isActive: isActive === undefined ? true : !!isActive,
      },
    });
    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A topic with this title already exists in this module" : "Failed to create topic" });
  }
});

router.patch("/lessons/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { title, content, blocks, videoUrl, pdfUrl, externalLinks, order, estimatedMinutes, isModuleTest, isActive, chapterId } = req.body;
    const lesson = await prisma.lesson.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(blocks !== undefined ? { blocks } : {}),
        ...(videoUrl !== undefined ? { videoUrl } : {}),
        ...(pdfUrl !== undefined ? { pdfUrl } : {}),
        ...(externalLinks !== undefined ? { externalLinks } : {}),
        ...(order !== undefined ? { order: Number(order) } : {}),
        ...(estimatedMinutes !== undefined ? { estimatedMinutes: Number(estimatedMinutes) } : {}),
        ...(isModuleTest !== undefined ? { isModuleTest: !!isModuleTest } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
        ...(chapterId !== undefined ? { chapterId: chapterId || null } : {}),
      },
    });
    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update lesson" });
  }
});

router.delete("/lessons/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    await prisma.lesson.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete lesson" });
  }
});

router.post("/lessons/:id/questions", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const {
      type, prompt, options, correctAnswer, explanation, starterCode, testCases, language, order,
      title, tags, estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat,
      notes, edgeCases, problemExplanation, evaluationType, functionSignature, starterCodeByLanguage,
      hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
    } = req.body;
    if (!type || !prompt) return res.status(400).json({ error: "type and prompt are required" });
    let resolved = { evaluationType: "STDIO", functionSignature: null, starterCodeByLanguage: undefined };
    if (type === "CODING") {
      const cases = Array.isArray(testCases) ? testCases : [];
      if (cases.filter((tc) => !tc.isHidden).length < 2) {
        return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
      }
      if (cases.filter((tc) => tc.isHidden).length < 10) {
        return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
      }
      resolved = resolveCodingFields({ evaluationType, functionSignature, starterCodeByLanguage });
    }
    const q = await prisma.practiceQuestion.create({
      data: {
        lessonId: req.params.id, type, prompt,
        title: title || null,
        options: options ?? undefined, correctAnswer: correctAnswer ?? undefined,
        explanation: explanation || null, starterCode: starterCode || null,
        testCases: testCases ?? undefined, language: language || null, order: Number(order) || 0,
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
        evaluationType: resolved.evaluationType,
        functionSignature: resolved.functionSignature,
        starterCodeByLanguage: resolved.starterCodeByLanguage,
      },
    });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to create practice question" });
  }
});

router.patch("/practice/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const {
      type, prompt, options, correctAnswer, explanation, starterCode, testCases, language, order,
      title, tags, estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat,
      notes, edgeCases, problemExplanation, evaluationType, functionSignature, starterCodeByLanguage,
      hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
    } = req.body;
    const existing = await prisma.practiceQuestion.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Practice question not found" });
    const effectiveType = type !== undefined ? type : existing.type;

    let resolvedData = {};
    if (effectiveType === "CODING") {
      if (testCases !== undefined) {
        const cases = Array.isArray(testCases) ? testCases : [];
        if (cases.filter((tc) => !tc.isHidden).length < 2) {
          return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
        }
        if (cases.filter((tc) => tc.isHidden).length < 10) {
          return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
        }
      }
      // Only re-resolve when one of these three actually changed — otherwise re-running FUNCTION
      // mode's generator on every unrelated field edit is wasted work, and a legacy STDIO question
      // with none of these fields set stays STDIO rather than being force-migrated.
      if (evaluationType !== undefined || functionSignature !== undefined || starterCodeByLanguage !== undefined) {
        const resolved = resolveCodingFields({
          evaluationType: evaluationType !== undefined ? evaluationType : existing.evaluationType,
          functionSignature: functionSignature !== undefined ? functionSignature : existing.functionSignature,
          starterCodeByLanguage: starterCodeByLanguage !== undefined ? starterCodeByLanguage : existing.starterCodeByLanguage,
        });
        resolvedData = { evaluationType: resolved.evaluationType, functionSignature: resolved.functionSignature, starterCodeByLanguage: resolved.starterCodeByLanguage };
      }
    } else if (type !== undefined) {
      // Switching a question away from CODING must clear any leftover FUNCTION-mode state —
      // otherwise sanitizeQuestion() would keep exposing a stale signature/per-language starter
      // code on a question that's no longer CODING at all.
      resolvedData = { evaluationType: "STDIO", functionSignature: null, starterCodeByLanguage: null };
    }

    const q = await prisma.practiceQuestion.update({
      where: { id: req.params.id },
      data: {
        ...(type !== undefined ? { type } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(options !== undefined ? { options } : {}),
        ...(correctAnswer !== undefined ? { correctAnswer } : {}),
        ...(explanation !== undefined ? { explanation } : {}),
        ...(starterCode !== undefined ? { starterCode } : {}),
        ...(testCases !== undefined ? { testCases } : {}),
        ...(language !== undefined ? { language } : {}),
        ...(order !== undefined ? { order: Number(order) } : {}),
        ...(tags !== undefined ? { tags: Array.isArray(tags) && tags.length > 0 ? tags : null } : {}),
        ...(estimatedTimeMin !== undefined ? { estimatedTimeMin } : {}),
        ...(realWorldScenario !== undefined ? { realWorldScenario } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(inputFormat !== undefined ? { inputFormat } : {}),
        ...(outputFormat !== undefined ? { outputFormat } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(edgeCases !== undefined ? { edgeCases } : {}),
        ...(problemExplanation !== undefined ? { problemExplanation } : {}),
        ...(hints !== undefined ? { hints } : {}),
        ...(timeComplexity !== undefined ? { timeComplexity } : {}),
        ...(spaceComplexity !== undefined ? { spaceComplexity } : {}),
        ...(editorial !== undefined ? { editorial } : {}),
        ...(similarQuestions !== undefined ? { similarQuestions } : {}),
        ...resolvedData,
      },
    });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to update practice question" });
  }
});

router.delete("/practice/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    await prisma.practiceQuestion.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete practice question" });
  }
});

// ADMIN/STAFF: full question detail (with correctAnswer/explanation) for the CMS edit form —
// distinct from the sanitized shape /lessons/:id returns to students.
router.get("/practice/:id", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const q = await prisma.practiceQuestion.findUnique({ where: { id: req.params.id } });
  if (!q) return res.status(404).json({ error: "Question not found" });
  res.json(q);
});

module.exports = router;
