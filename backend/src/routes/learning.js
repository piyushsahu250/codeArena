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
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { attachRequesterInstitute } = require("../middleware/institute");
const { courseEligibilityWhere, isEligibilityUnresolvable, studentCanAccessCourse, isCourseVisibleToStudent } = require("../utils/courseEligibility");
const { safeErrorMessage } = require("../utils/errors");
const { getCourseLockInfo, wouldCreateCycle } = require("../utils/courseLock");
const { cached } = require("../utils/cache");
const { computeLearningRecommendations } = require("../utils/learningRecommendations");

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

// ADMIN/STAFF: unfiltered — CourseAssignments.jsx and LearningManagement.jsx both need to see
// every course (including DRAFT and institute-unassigned ones) to manage them.
// STUDENT: filtered to courses that are actually PUBLISHED and actually assigned to their own
// institute/academic group — previously this route returned every course to every role, so a
// student could see (and, via /courses/:slug below, open) courses meant for another institute or
// never even published. courseEligibilityWhere/isEligibilityUnresolvable are the same helpers
// already used on the admin assignment routes; this just closes the gap where students were the
// one place they were never actually applied.
router.get("/courses", authenticate, async (req, res) => {
  const where = {};
  if (req.user.role === "STUDENT") {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true } });
    if (isEligibilityUnresolvable(student?.instituteId, student?.academicGroupId)) return res.json([]);
    where.status = "PUBLISHED";
    Object.assign(where, courseEligibilityWhere(student.instituteId, student.academicGroupId));
  }
  const courses = await prisma.course.findMany({
    where,
    orderBy: { order: "asc" },
    include: { prerequisites: { select: { prerequisiteCourseId: true } } },
  });
  res.json(courses);
});

// ADMIN/STAFF: unfiltered. STUDENT: same PUBLISHED + institute/group-assignment gate as
// GET /courses above — without this, a student who knew (or guessed) a slug could open a course's
// full content directly even though it was filtered out of their course list. A student who fails
// this gate gets the same 404 as a genuinely nonexistent slug, rather than a 403 that would confirm
// the course exists.
router.get("/courses/:slug", authenticate, async (req, res) => {
  const where = { slug: req.params.slug };
  if (req.user.role === "STUDENT") {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true } });
    if (isEligibilityUnresolvable(student?.instituteId, student?.academicGroupId)) return res.status(404).json({ error: "Course not found" });
    where.status = "PUBLISHED";
    Object.assign(where, courseEligibilityWhere(student.instituteId, student.academicGroupId));
  }
  // Module metadata only, no nested lessons — the full per-lesson list (title/estimatedMinutes/
  // isModuleTest/etc.) is fetched on demand per module via GET .../modules/:moduleId/lessons
  // below, once a student actually expands it. Overview stats (totals/resume-pointer/per-module
  // completion) below still need every lesson's id+order+moduleId, but that's a much narrower
  // row (3 small columns, no text content) than the full lesson list this route used to return
  // for every module on every page load — this is what actually stops the response from growing
  // linearly with total course content as more courses/modules get authored.
  const course = await prisma.course.findFirst({
    where,
    include: { modules: { orderBy: { order: "asc" } } },
  });
  if (!course) return res.status(404).json({ error: "Course not found" });

  let progressByLesson = new Map();
  let lockMap = new Map();
  let resumeLessonId = null;
  let lessonMeta = []; // { id, moduleId, order } — lightweight, all lessons in the course
  if (req.user.role === "STUDENT") {
    lessonMeta = await prisma.lesson.findMany({
      where: { moduleId: { in: course.modules.map((m) => m.id) } },
      select: { id: true, moduleId: true, order: true },
      orderBy: { order: "asc" },
    });
    const allLessonIds = lessonMeta.map((l) => l.id);
    const progress = allLessonIds.length
      ? await prisma.lessonProgress.findMany({ where: { studentId: req.user.id, lessonId: { in: allLessonIds } } })
      : [];
    progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
    lockMap = await getModuleLockMap(prisma, req.user.id, course.id);

    // Resume pointer: the most recently touched lesson still in progress, or otherwise the
    // first lesson (by order) of the first module that isn't fully completed yet.
    const inProgress = progress
      .filter((p) => p.status === "IN_PROGRESS")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    if (inProgress) {
      resumeLessonId = inProgress.lessonId;
    } else {
      const lessonsByModule = new Map();
      for (const l of lessonMeta) {
        if (!lessonsByModule.has(l.moduleId)) lessonsByModule.set(l.moduleId, []);
        lessonsByModule.get(l.moduleId).push(l);
      }
      for (const m of course.modules) {
        const lock = lockMap.get(m.id);
        if (lock?.locked) break;
        const firstLesson = lessonsByModule.get(m.id)?.[0];
        if (!lock?.completed && firstLesson) { resumeLessonId = firstLesson.id; break; }
      }
    }
  }

  let totalLessons = 0, completedLessons = 0;
  const countsByModule = new Map();
  for (const l of lessonMeta) {
    const c = countsByModule.get(l.moduleId) || { total: 0, completed: 0 };
    c.total++;
    totalLessons++;
    if (progressByLesson.get(l.id)?.status === "COMPLETED") { c.completed++; completedLessons++; }
    countsByModule.set(l.moduleId, c);
  }
  const modules = course.modules.map((m) => {
    const lock = lockMap.get(m.id) || { locked: false, completed: false, lessonsComplete: false, codingTest: { required: false, passed: true } };
    const counts = countsByModule.get(m.id) || { total: 0, completed: 0 };
    return {
      id: m.id, title: m.title, description: m.description, order: m.order,
      completedCount: counts.completed, totalCount: counts.total,
      locked: lock.locked, completed: lock.completed,
      lessonsComplete: lock.lessonsComplete, codingTest: lock.codingTest,
    };
  });

  // ADMIN/STAFF (LearningManagement.jsx's content-editing tree) still need the full inline
  // lesson list on this same response — unlike the student-facing overview, that page is a
  // single-course-at-a-time CMS, not a scalability concern, and reworking it onto the new
  // on-demand endpoint is out of scope here. Only the STUDENT path (the one with an actual
  // growing-course-count concern) uses the lighter counts-only shape above.
  if (req.user.role !== "STUDENT") {
    const allLessons = await prisma.lesson.findMany({
      where: { moduleId: { in: course.modules.map((m) => m.id) } },
      orderBy: { order: "asc" },
    });
    const lessonsByModule = new Map();
    for (const l of allLessons) {
      if (!lessonsByModule.has(l.moduleId)) lessonsByModule.set(l.moduleId, []);
      lessonsByModule.get(l.moduleId).push({
        id: l.id, title: l.title, order: l.order, estimatedMinutes: l.estimatedMinutes,
        isModuleTest: l.isModuleTest, status: "NOT_STARTED", bookmarked: false,
      });
    }
    for (const m of modules) m.lessons = lessonsByModule.get(m.id) || [];
  }

  res.json({
    course: { id: course.id, slug: course.slug, name: course.name, description: course.description, isActive: course.isActive },
    modules,
    overall: { totalLessons, completedLessons, percent: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0 },
    resumeLessonId,
  });
});

// Per-module lesson list, fetched on demand when a student expands a module in the UI (see
// GET /courses/:slug above, which now returns module metadata + counts only, no lesson list).
// Same shape the old inline `lessons` array had (id/title/order/estimatedMinutes/isModuleTest/
// status/bookmarked). ADMIN/STAFF: unfiltered (module just needs to exist). STUDENT: the parent
// course must still pass the same eligibility gate, and a locked module's lessons are not
// returned (matches the intent of the lock — a student shouldn't even see what's inside a
// module they can't access yet).
router.get("/courses/:slug/modules/:moduleId/lessons", authenticate, async (req, res) => {
  const where = { slug: req.params.slug };
  if (req.user.role === "STUDENT") {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true } });
    if (isEligibilityUnresolvable(student?.instituteId, student?.academicGroupId)) return res.status(404).json({ error: "Course not found" });
    where.status = "PUBLISHED";
    Object.assign(where, courseEligibilityWhere(student.instituteId, student.academicGroupId));
  }
  const course = await prisma.course.findFirst({ where, select: { id: true } });
  if (!course) return res.status(404).json({ error: "Course not found" });

  const module = await prisma.courseModule.findFirst({ where: { id: req.params.moduleId, courseId: course.id }, select: { id: true } });
  if (!module) return res.status(404).json({ error: "Module not found" });

  if (req.user.role === "STUDENT") {
    const lockMap = await getModuleLockMap(prisma, req.user.id, course.id);
    if (lockMap.get(module.id)?.locked) return res.status(403).json({ error: "This module is locked" });
  }

  const lessons = await prisma.lesson.findMany({ where: { moduleId: module.id }, orderBy: { order: "asc" } });
  let progressByLesson = new Map();
  if (req.user.role === "STUDENT" && lessons.length) {
    const progress = await prisma.lessonProgress.findMany({
      where: { studentId: req.user.id, lessonId: { in: lessons.map((l) => l.id) } },
    });
    progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
  }
  res.json(lessons.map((l) => {
    const p = progressByLesson.get(l.id);
    return {
      id: l.id, title: l.title, order: l.order, estimatedMinutes: l.estimatedMinutes,
      isModuleTest: l.isModuleTest,
      status: p?.status || "NOT_STARTED", bookmarked: p?.bookmarked || false,
    };
  }));
});

// Any authenticated user: single lesson detail, with prev/next lesson ids for in-course
// navigation and (for a STUDENT) their own progress record.
router.get("/lessons/:id", authenticate, async (req, res) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: req.params.id },
    include: {
      module: {
        include: {
          course: {
            include: {
              instituteAssignments: { select: { instituteId: true } },
              academicGroupAssignments: { select: { academicGroupId: true } },
            },
          },
          lessons: { orderBy: { order: "asc" } },
        },
      },
      questions: { orderBy: { order: "asc" } },
    },
  });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });

  if (req.user.role === "STUDENT") {
    // Same PUBLISHED + institute/group-assignment gate as GET /courses/:slug — otherwise a
    // student could reach a course's lesson content directly by id even though the course itself
    // was filtered out of their course list and blocked at /courses/:slug.
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true } });
    const eligible = lesson.module.course.status === "PUBLISHED"
      && !isEligibilityUnresolvable(student?.instituteId, student?.academicGroupId)
      && isCourseVisibleToStudent(lesson.module.course, student.instituteId, student.academicGroupId);
    if (!eligible) return res.status(404).json({ error: "Lesson not found" });

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
      // score always reflects this attempt, even on a retake after already passing — the
      // Recommendations engine (learningRecommendations.js) wants "how did they actually do
      // most recently," not the best-ever score, since a fresh low score on a retake is exactly
      // the "review this topic" signal it looks for.
      update: { status: nextStatus, score, completedAt: nextStatus === "COMPLETED" ? existing?.completedAt || new Date() : null },
      create: { studentId: req.user.id, lessonId: lesson.id, status: nextStatus, score, completedAt: nextStatus === "COMPLETED" ? new Date() : null },
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

// =========================== Learning Recommendations (rule-based) ===========================
// Same cached() key as GET /dashboard/student's recommendations block — a student loading both
// the dashboard and the Learning Hub within the same 5-minute window costs one real computation.

router.get("/recommendations", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const recommendations = await cached(`recommendations:${req.user.id}`, 5 * 60 * 1000, () =>
      computeLearningRecommendations(prisma, req.user.id)
    );
    res.json({ recommendations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load recommendations" });
  }
});

// =========================== Learning Notes (private, student-owned) ===========================
// Every route below is scoped to `studentId: req.user.id` server-side, never taken from the
// request body/query — a student can never read, edit, or delete another student's note, and no
// Staff/Admin route anywhere exposes this table.

router.get("/notes", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { q, courseId, moduleId, chapterId, lessonId } = req.query;
    const where = { studentId: req.user.id };
    if (courseId) where.courseId = courseId;
    if (moduleId) where.moduleId = moduleId;
    if (chapterId) where.chapterId = chapterId;
    if (lessonId) where.lessonId = lessonId;
    if (q) where.content = { contains: String(q), mode: "insensitive" };
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const [rows, total] = await Promise.all([
      prisma.learningNote.findMany({
        where,
        include: {
          course: { select: { id: true, name: true, slug: true } },
          module: { select: { id: true, title: true } },
          chapter: { select: { id: true, title: true } },
          lesson: { select: { id: true, title: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.learningNote.count({ where }),
    ]);
    res.json({ rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load notes" });
  }
});

router.post("/notes", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { courseId, moduleId, chapterId, lessonId, content } = req.body;
    if (!courseId) return res.status(400).json({ error: "courseId is required" });
    if (!content || !content.trim()) return res.status(400).json({ error: "content is required" });
    const note = await prisma.learningNote.create({
      data: {
        studentId: req.user.id, courseId,
        moduleId: moduleId || null, chapterId: chapterId || null, lessonId: lessonId || null,
        content,
      },
    });
    res.json(note);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create note" });
  }
});

router.patch("/notes/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined || !content.trim()) return res.status(400).json({ error: "content is required" });
    const result = await prisma.learningNote.updateMany({
      where: { id: req.params.id, studentId: req.user.id }, // ownership check baked into the write itself
      data: { content },
    });
    if (result.count === 0) return res.status(404).json({ error: "Note not found" });
    const note = await prisma.learningNote.findUnique({ where: { id: req.params.id } });
    res.json(note);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save note" });
  }
});

router.delete("/notes/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const result = await prisma.learningNote.deleteMany({ where: { id: req.params.id, studentId: req.user.id } });
    if (result.count === 0) return res.status(404).json({ error: "Note not found" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete note" });
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
      verifyUrl: `${process.env.FRONTEND_URL || "https://codearena.site"}/certificate/verify/${cert.certificateCode}`,
      instituteName: student.institute?.name,
      instituteLogoUrl: student.institute?.logoUrl,
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

// =========================== Admin/Staff content management (CMS) ===========================
// Course and Module create/edit/delete/activate/deactivate are ADMIN-only — Staff can still view
// everything here (the GET routes above have no role restriction beyond `authenticate`) and can
// still manage everything nested below a Module (Chapters, Lessons, Practice Questions, Coding
// Assessments) — only the Course/Module records themselves are restricted. Every action here is
// audit-logged via logAudit for the same reason every other admin-changeable record on this
// platform is: so "who deleted this course, and when" is answerable later.

// Fields shared by create/edit — course metadata beyond the original slug/name/description/order.
function extractCourseMetadata(body) {
  const { category, thumbnailUrl, bannerUrl, instructorName, skillsCovered, estimatedDurationMin, difficulty } = body;
  return {
    ...(category !== undefined ? { category: category || null } : {}),
    ...(thumbnailUrl !== undefined ? { thumbnailUrl: thumbnailUrl || null } : {}),
    ...(bannerUrl !== undefined ? { bannerUrl: bannerUrl || null } : {}),
    ...(instructorName !== undefined ? { instructorName: instructorName || null } : {}),
    ...(skillsCovered !== undefined ? { skillsCovered: skillsCovered || null } : {}),
    ...(estimatedDurationMin !== undefined ? { estimatedDurationMin: estimatedDurationMin === "" || estimatedDurationMin == null ? null : Number(estimatedDurationMin) } : {}),
    ...(difficulty !== undefined ? { difficulty: difficulty || null } : {}),
  };
}

// Full-replace a course's prerequisite list (delete-then-recreate, same idiom tests.js uses for
// academicGroupIds on PATCH). Rejects self-reference and any prerequisite that would create a
// cycle (A requires B, B transitively requires A) before writing anything.
async function setCoursePrerequisites(courseId, prerequisiteCourseIds) {
  const ids = (prerequisiteCourseIds || []).filter((id) => id && id !== courseId);
  if (ids.length !== (prerequisiteCourseIds || []).filter(Boolean).length) {
    throw Object.assign(new Error("A course cannot be its own prerequisite"), { status: 400 });
  }
  if (ids.length && (await wouldCreateCycle(prisma, courseId, ids))) {
    throw Object.assign(new Error("That prerequisite list would create a cycle"), { status: 400 });
  }
  await prisma.$transaction([
    prisma.coursePrerequisite.deleteMany({ where: { courseId } }),
    ...(ids.length ? [prisma.coursePrerequisite.createMany({ data: ids.map((prerequisiteCourseId) => ({ courseId, prerequisiteCourseId })) })] : []),
  ]);
}

router.post("/courses", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { slug, name, description, order, isActive, status, prerequisiteCourseIds } = req.body;
    if (!slug || !name) return res.status(400).json({ error: "slug and name are required" });
    const resolvedStatus = status || "DRAFT";
    const course = await prisma.course.create({
      data: {
        slug, name, description: description || null, order: Number(order) || 0,
        status: resolvedStatus, isActive: resolvedStatus === "PUBLISHED" || !!isActive,
        ...extractCourseMetadata(req.body),
      },
    });
    if (prerequisiteCourseIds !== undefined) await setCoursePrerequisites(course.id, prerequisiteCourseIds);
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "course", operation: "create", courseId: course.id, name: course.name, slug: course.slug, status: course.status },
    });
    res.json(course);
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A course with this slug already exists" : "Failed to create course" });
  }
});

router.patch("/courses/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { name, description, order, isActive, status, prerequisiteCourseIds } = req.body;

    if (status !== undefined && status === "PUBLISHED") {
      const moduleCount = await prisma.courseModule.count({ where: { courseId: req.params.id } });
      if (moduleCount === 0) return res.status(400).json({ error: "Add at least one module before publishing this course" });
    }

    const course = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(order !== undefined ? { order: Number(order) } : {}),
        ...(status !== undefined ? { status, isActive: status === "PUBLISHED" } : (isActive !== undefined ? { isActive: !!isActive } : {})),
        ...extractCourseMetadata(req.body),
      },
    });
    if (prerequisiteCourseIds !== undefined) await setCoursePrerequisites(course.id, prerequisiteCourseIds);

    let operation = "edit";
    if (status !== undefined) operation = "status_change";
    else if (isActive !== undefined) operation = isActive ? "activate" : "deactivate";
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "course", operation, courseId: course.id, name: course.name, status: course.status, changedFields: Object.keys(req.body) },
    });
    res.json(course);
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: "Failed to update course" });
  }
});

router.delete("/courses/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) return res.status(404).json({ error: "Course not found" });

    // Certificate.course is Restrict, not Cascade — a course that has already issued
    // certificates to students must not have them silently destroyed by deleting the course.
    const certCount = await prisma.certificate.count({ where: { courseId: req.params.id } });
    if (certCount > 0) {
      return res.status(409).json({
        error: `${certCount} certificate${certCount === 1 ? "" : "s"} have been issued for this course. Revoke or reassign ${certCount === 1 ? "it" : "them"} first, then delete the course.`,
      });
    }

    await prisma.course.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "course", operation: "delete", courseId: course.id, name: course.name },
    });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This course has related data that must be removed first." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete course" });
  }
});

// =========================== Institute / academic-group course assignment ===========================
// Two-tier grant mirroring the Test<->AcademicGroup pattern (courseEligibility.js), except a
// course with zero rows across both tables is invisible to students, not open. Only a PUBLISHED
// course may be assigned. Archiving a course leaves these rows untouched — visibility is gated
// by status, not by deleting assignments — so re-publishing restores visibility instantly.

async function assertPublishedAndScoped(req, res, courseId) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) { res.status(404).json({ error: "Course not found" }); return null; }
  if (course.status !== "PUBLISHED") { res.status(400).json({ error: "Only Published courses can be assigned" }); return null; }
  return course;
}

// Rejects instituteIds/academicGroupIds outside a scoped Admin's own institute (unscoped
// Platform Admin, req.requesterInstituteId === null, is unrestricted — same convention as every
// other attachRequesterInstitute-guarded route on this platform).
async function assertAssignmentScope(req, res, instituteIds, academicGroupIds) {
  if (!req.requesterInstituteId) return true;
  if (instituteIds?.some((id) => id !== req.requesterInstituteId)) {
    res.status(403).json({ error: "You can only assign courses within your own institute" });
    return false;
  }
  if (academicGroupIds?.length) {
    const groups = await prisma.academicGroup.findMany({ where: { id: { in: academicGroupIds } }, select: { id: true, instituteId: true } });
    if (groups.some((g) => g.instituteId !== req.requesterInstituteId)) {
      res.status(403).json({ error: "You can only assign courses within your own institute" });
      return false;
    }
  }
  return true;
}

router.get("/courses/:id/assignments", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const [instituteRows, groupRows] = await Promise.all([
    prisma.courseInstituteAssignment.findMany({ where: { courseId: req.params.id }, include: { institute: { select: { id: true, name: true } } } }),
    prisma.courseAcademicGroupAssignment.findMany({ where: { courseId: req.params.id }, include: { academicGroup: { select: { id: true, batch: true, section: true, institute: { select: { name: true } }, department: { select: { name: true } } } } } }),
  ]);
  res.json({
    institutes: instituteRows.map((r) => r.institute),
    academicGroups: groupRows.map((r) => r.academicGroup),
  });
});

// ADMIN/STAFF diagnostic: exactly reproduces what a specific student sees on their own Course
// Overview page (reuses getModuleLockMap directly, the same single source of truth the student-
// facing routes use — spec: admin/staff progress views must never independently re-derive
// completion with different logic) plus the raw per-lesson LessonProgress rows behind it, so a
// support request like "student X can't unlock Module 2" can be diagnosed without DB access.
router.get("/admin/student-progress", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const registrationNumber = String(req.query.registrationNumber || "").trim();
    if (!registrationNumber) return res.status(400).json({ error: "registrationNumber is required" });

    const student = await prisma.user.findFirst({
      where: {
        registrationNumber, role: "STUDENT",
        ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      },
      select: { id: true, name: true, registrationNumber: true, email: true, institute: { select: { name: true } } },
    });
    if (!student) return res.status(404).json({ error: "No student found with that registration number in your institute" });

    const courseSlug = req.query.courseSlug ? String(req.query.courseSlug).trim() : null;
    const courses = await prisma.course.findMany({
      where: courseSlug ? { slug: courseSlug } : {},
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    });

    const courseResults = [];
    for (const course of courses) {
      const modules = await prisma.courseModule.findMany({
        where: { courseId: course.id },
        orderBy: { order: "asc" },
        select: { id: true, title: true, order: true, lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, isModuleTest: true } } },
      });
      if (modules.length === 0) continue;

      const lockMap = await getModuleLockMap(prisma, student.id, course.id);
      const lessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
      const progress = lessonIds.length
        ? await prisma.lessonProgress.findMany({ where: { studentId: student.id, lessonId: { in: lessonIds } }, select: { lessonId: true, status: true, completedAt: true } })
        : [];
      const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));

      const hasAnyProgress = progress.some((p) => p.status !== "NOT_STARTED");
      if (!courseSlug && !hasAnyProgress) continue; // skip courses the student never touched, unless explicitly requested

      courseResults.push({
        courseId: course.id,
        courseSlug: course.slug,
        courseName: course.name,
        modules: modules.map((m) => {
          const lock = lockMap.get(m.id);
          return {
            moduleId: m.id,
            title: m.title,
            order: m.order,
            locked: lock.locked,
            completed: lock.completed,
            lessonsComplete: lock.lessonsComplete,
            codingAssessment: lock.codingTest, // { required, passed } — no longer blocks unlock, kept for visibility
            lessons: m.lessons.map((l) => ({
              id: l.id,
              title: l.title,
              isModuleTest: l.isModuleTest,
              status: progressByLesson.get(l.id)?.status || "NOT_STARTED",
              completedAt: progressByLesson.get(l.id)?.completedAt || null,
            })),
          };
        }),
      });
    }

    res.json({ student, courses: courseResults });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student progress" });
  }
});

router.post("/courses/:id/assignments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteIds = [], academicGroupIds = [] } = req.body;
    const course = await assertPublishedAndScoped(req, res, req.params.id);
    if (!course) return;
    if (!(await assertAssignmentScope(req, res, instituteIds, academicGroupIds))) return;

    await prisma.$transaction([
      ...(instituteIds.length ? [prisma.courseInstituteAssignment.createMany({
        data: instituteIds.map((instituteId) => ({ courseId: course.id, instituteId, assignedByUserId: req.user.id, assignedByName: req.user.name })),
        skipDuplicates: true,
      })] : []),
      ...(academicGroupIds.length ? [prisma.courseAcademicGroupAssignment.createMany({
        data: academicGroupIds.map((academicGroupId) => ({ courseId: course.id, academicGroupId, assignedByUserId: req.user.id, assignedByName: req.user.name })),
        skipDuplicates: true,
      })] : []),
    ]);
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "course_assignment", operation: "assign", courseId: course.id, courseName: course.name, instituteIds, academicGroupIds },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign course" });
  }
});

router.delete("/courses/:id/assignments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteIds = [], academicGroupIds = [] } = req.body;
    const course = await prisma.course.findUnique({ where: { id: req.params.id } });
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!(await assertAssignmentScope(req, res, instituteIds, academicGroupIds))) return;

    await prisma.$transaction([
      prisma.courseInstituteAssignment.deleteMany({ where: { courseId: course.id, instituteId: { in: instituteIds } } }),
      prisma.courseAcademicGroupAssignment.deleteMany({ where: { courseId: course.id, academicGroupId: { in: academicGroupIds } } }),
    ]);
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "course_assignment", operation: "unassign", courseId: course.id, courseName: course.name, instituteIds, academicGroupIds },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to unassign course" });
  }
});

// Cross-course bulk assign: many courses x many institutes/groups in one call.
router.post("/courses/assignments/bulk", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { courseIds = [], instituteIds = [], academicGroupIds = [] } = req.body;
    if (!(await assertAssignmentScope(req, res, instituteIds, academicGroupIds))) return;

    const courses = await prisma.course.findMany({ where: { id: { in: courseIds } } });
    const nonPublished = courses.filter((c) => c.status !== "PUBLISHED");
    if (nonPublished.length) {
      return res.status(400).json({ error: `Only Published courses can be assigned: ${nonPublished.map((c) => c.name).join(", ")}` });
    }

    const instituteRows = courseIds.flatMap((courseId) => instituteIds.map((instituteId) => ({ courseId, instituteId, assignedByUserId: req.user.id, assignedByName: req.user.name })));
    const groupRows = courseIds.flatMap((courseId) => academicGroupIds.map((academicGroupId) => ({ courseId, academicGroupId, assignedByUserId: req.user.id, assignedByName: req.user.name })));
    await prisma.$transaction([
      ...(instituteRows.length ? [prisma.courseInstituteAssignment.createMany({ data: instituteRows, skipDuplicates: true })] : []),
      ...(groupRows.length ? [prisma.courseAcademicGroupAssignment.createMany({ data: groupRows, skipDuplicates: true })] : []),
    ]);
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "course_assignment", operation: "bulk_assign", courseIds, instituteIds, academicGroupIds },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to bulk-assign courses" });
  }
});

router.post("/courses/:id/modules", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { title, description, order } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const mod = await prisma.courseModule.create({
      data: { courseId: req.params.id, title, description: description || null, order: Number(order) || 0 },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "module", operation: "create", moduleId: mod.id, courseId: req.params.id, title: mod.title },
    });
    res.json(mod);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A module with this title already exists in this course" : "Failed to create module" });
  }
});

router.patch("/modules/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: {
        entity: "module",
        operation: isActive !== undefined ? (isActive ? "activate" : "deactivate") : "edit",
        moduleId: mod.id, title: mod.title, changedFields: Object.keys(req.body),
      },
    });
    res.json(mod);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update module" });
  }
});

router.delete("/modules/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const mod = await prisma.courseModule.findUnique({ where: { id: req.params.id } });
    if (!mod) return res.status(404).json({ error: "Module not found" });
    // Same rationale as the Chapter delete guard just above: Lesson->module, Chapter->module, and
    // ModuleCodingTest->module/->chapter are all onDelete:Cascade, so deleting a module would
    // otherwise silently wipe every lesson/level under it plus all student progress and coding
    // attempts recorded against them — Cascade never raises a catchable FK error. Lesson.moduleId
    // is denormalized onto every lesson (chapter-scoped or not), so filtering progress by it alone
    // covers both; a "Level" has moduleId set only when NOT chapter-scoped, so attempts also need
    // the chapter->moduleId path checked.
    const [progressCount, directAttemptCount, chapterAttemptCount] = await Promise.all([
      prisma.lessonProgress.count({ where: { lesson: { moduleId: mod.id } } }),
      prisma.moduleCodingAttempt.count({ where: { moduleCodingTest: { moduleId: mod.id } } }),
      prisma.moduleCodingAttempt.count({ where: { moduleCodingTest: { chapter: { moduleId: mod.id } } } }),
    ]);
    const attemptCount = directAttemptCount + chapterAttemptCount;
    if (progressCount > 0 || attemptCount > 0) {
      return res.status(409).json({
        error: `Cannot delete this module: ${progressCount} student lesson-progress record(s) and ${attemptCount} coding-assessment attempt(s) exist under it. Deactivate the module instead, or remove its individual chapters/lessons/levels first.`,
      });
    }
    await prisma.courseModule.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "module", operation: "delete", moduleId: mod.id, courseId: mod.courseId, title: mod.title },
    });
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

router.post("/modules/:id/chapters", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "chapter", operation: "create", chapterId: chapter.id, moduleId: chapter.moduleId, title: chapter.title },
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

router.patch("/chapters/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "chapter", operation: "edit", chapterId: chapter.id, title: chapter.title, changedFields: Object.keys(req.body) },
    });
    res.json(chapter);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update chapter" });
  }
});

router.delete("/chapters/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.id } });
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    // Lesson->chapter and ModuleCodingTest->chapter are both onDelete:Cascade in schema.prisma,
    // which in turn cascades to LessonProgress and ModuleCodingAttempt — a chapter delete would
    // otherwise silently destroy real student completion/attempt data with no FK-violation error
    // to catch (Cascade never throws P2003). Block outright rather than allow an override here:
    // reorganizing content should never be able to erase a student's record of having done it.
    const [progressCount, attemptCount] = await Promise.all([
      prisma.lessonProgress.count({ where: { lesson: { chapterId: chapter.id } } }),
      prisma.moduleCodingAttempt.count({ where: { moduleCodingTest: { chapterId: chapter.id } } }),
    ]);
    if (progressCount > 0 || attemptCount > 0) {
      return res.status(409).json({
        error: `Cannot delete this chapter: ${progressCount} student lesson-progress record(s) and ${attemptCount} coding-assessment attempt(s) exist under it. Deactivate the chapter instead, or move/delete its individual lessons and levels first.`,
      });
    }
    await prisma.chapter.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "chapter", operation: "delete", chapterId: chapter.id, moduleId: chapter.moduleId, title: chapter.title },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete chapter" });
  }
});

router.post("/modules/:id/lessons", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", operation: "create", lessonId: lesson.id, moduleId: lesson.moduleId, title: lesson.title },
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
router.post("/chapters/:id/lessons", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", operation: "create", lessonId: lesson.id, moduleId: lesson.moduleId, chapterId: lesson.chapterId, title: lesson.title },
    });
    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(err.code === "P2002" ? 409 : 500).json({ error: err.code === "P2002" ? "A topic with this title already exists in this module" : "Failed to create topic" });
  }
});

router.patch("/lessons/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    // content/blocks are deliberately NOT accepted here anymore — they now move exclusively
    // through the versions API below (POST /lessons/:id/versions -> .../publish), so a student
    // never sees anything that hasn't gone through Draft -> Review -> Publish. Everything else
    // (title/order/isActive/etc.) is still a direct, immediate edit as before.
    const { title, videoUrl, pdfUrl, externalLinks, order, estimatedMinutes, isModuleTest, isActive, chapterId } = req.body;
    const lesson = await prisma.lesson.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined ? { title } : {}),
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
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", operation: "edit", lessonId: lesson.id, title: lesson.title, changedFields: Object.keys(req.body) },
    });
    res.json(lesson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update lesson" });
  }
});

// =========================== Lesson Content Versioning (Draft -> Review -> Publish) ===========================
// Lesson.content/Lesson.blocks remain the only fields every student-facing read path uses
// (LessonView.jsx, CourseOverview.jsx, search, etc.) — completely unchanged. A version only ever
// touches those live columns at the moment it's published (see .../publish below); drafts and
// in-review versions live entirely in LessonContentVersion and are never reachable by a student.

// Version history, newest first. Lazily synthesizes "Version 1 / PUBLISHED" from the lesson's
// current content/blocks on first read if no version rows exist yet — no bulk migration script
// needed, and it's safe because it only ever creates a version that already matches what's live.
router.get("/lessons/:id/versions", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const lesson = await prisma.lesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    let versions = await prisma.lessonContentVersion.findMany({ where: { lessonId: lesson.id }, orderBy: { versionNumber: "desc" } });
    if (versions.length === 0) {
      const seed = await prisma.lessonContentVersion.create({
        data: {
          lessonId: lesson.id, versionNumber: 1, content: lesson.content, blocks: lesson.blocks,
          status: "PUBLISHED", changeSummary: "Initial version", createdById: "system", createdByName: "System",
          publishedById: "system", publishedByName: "System", publishedAt: lesson.createdAt,
        },
      });
      versions = [seed];
    }
    res.json(versions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load version history" });
  }
});

// Creates a new draft, or updates the lesson's existing open draft if one is already in progress
// (upsert-by-latest-DRAFT — avoids spawning a new draft row on every autosave-style edit).
router.post("/lessons/:id/versions", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const lesson = await prisma.lesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    const { content, blocks, changeSummary } = req.body;
    const openDraft = await prisma.lessonContentVersion.findFirst({
      where: { lessonId: lesson.id, status: { in: ["DRAFT", "IN_REVIEW"] } },
      orderBy: { versionNumber: "desc" },
    });
    let version;
    if (openDraft) {
      version = await prisma.lessonContentVersion.update({
        where: { id: openDraft.id },
        data: { content: content ?? openDraft.content, blocks: blocks !== undefined ? blocks : openDraft.blocks, changeSummary: changeSummary ?? openDraft.changeSummary },
      });
    } else {
      const last = await prisma.lessonContentVersion.findFirst({ where: { lessonId: lesson.id }, orderBy: { versionNumber: "desc" } });
      const nextNumber = (last?.versionNumber || 0) + 1;
      version = await prisma.lessonContentVersion.create({
        data: {
          lessonId: lesson.id, versionNumber: nextNumber, content: content ?? lesson.content, blocks: blocks !== undefined ? blocks : lesson.blocks,
          status: "DRAFT", changeSummary: changeSummary || null, createdById: req.user.id, createdByName: req.user.name,
        },
      });
    }
    await logAudit({
      req, action: AUDIT_ACTIONS.CONTENT_VERSION_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", lessonId: lesson.id, versionId: version.id, versionNumber: version.versionNumber },
    });
    res.json(version);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save draft" });
  }
});

// Edits an existing draft in place, or moves it DRAFT -> IN_REVIEW.
router.patch("/lessons/:id/versions/:versionId", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const version = await prisma.lessonContentVersion.findUnique({ where: { id: req.params.versionId } });
    if (!version || version.lessonId !== req.params.id) return res.status(404).json({ error: "Version not found" });
    if (version.status === "PUBLISHED" || version.status === "ARCHIVED") {
      return res.status(409).json({ error: "Cannot edit a published or archived version — start a new draft instead" });
    }
    const { content, blocks, changeSummary, status } = req.body;
    const updated = await prisma.lessonContentVersion.update({
      where: { id: version.id },
      data: {
        ...(content !== undefined ? { content } : {}),
        ...(blocks !== undefined ? { blocks } : {}),
        ...(changeSummary !== undefined ? { changeSummary } : {}),
        ...(status === "IN_REVIEW" ? { status: "IN_REVIEW" } : {}),
      },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update version" });
  }
});

// Publishes a DRAFT/IN_REVIEW version: copies content/blocks onto the live Lesson row (the only
// place that ever happens), archives whatever was PUBLISHED before (never deleted), marks this
// one PUBLISHED. This is the sole write path that changes what a student can read.
router.post("/lessons/:id/versions/:versionId/publish", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const version = await prisma.lessonContentVersion.findUnique({ where: { id: req.params.versionId } });
    if (!version || version.lessonId !== req.params.id) return res.status(404).json({ error: "Version not found" });
    if (version.status === "PUBLISHED") return res.status(409).json({ error: "This version is already published" });
    if (!version.changeSummary) return res.status(400).json({ error: "A change summary is required before publishing" });
    const [, , published] = await prisma.$transaction([
      prisma.lessonContentVersion.updateMany({ where: { lessonId: version.lessonId, status: "PUBLISHED" }, data: { status: "ARCHIVED" } }),
      prisma.lesson.update({ where: { id: version.lessonId }, data: { content: version.content, blocks: version.blocks } }),
      prisma.lessonContentVersion.update({
        where: { id: version.id },
        data: { status: "PUBLISHED", publishedById: req.user.id, publishedByName: req.user.name, publishedAt: new Date() },
      }),
    ]);
    await logAudit({
      req, action: AUDIT_ACTIONS.CONTENT_VERSION_PUBLISHED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", lessonId: version.lessonId, versionId: version.id, versionNumber: version.versionNumber },
    });
    res.json(published);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to publish version" });
  }
});

// Restores an old (ARCHIVED or PUBLISHED) version by creating a NEW version row copying its
// content, then publishing that new row immediately. Never resurrects/renumbers the old version
// — "Restore Version 2" produces Version 4, keeping full history intact.
router.post("/lessons/:id/versions/:versionId/restore", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const source = await prisma.lessonContentVersion.findUnique({ where: { id: req.params.versionId } });
    if (!source || source.lessonId !== req.params.id) return res.status(404).json({ error: "Version not found" });
    const last = await prisma.lessonContentVersion.findFirst({ where: { lessonId: source.lessonId }, orderBy: { versionNumber: "desc" } });
    const nextNumber = (last?.versionNumber || 0) + 1;
    const restored = await prisma.lessonContentVersion.create({
      data: {
        lessonId: source.lessonId, versionNumber: nextNumber, content: source.content, blocks: source.blocks,
        status: "DRAFT", changeSummary: `Restored from version ${source.versionNumber}`, createdById: req.user.id, createdByName: req.user.name,
      },
    });
    const [, , published] = await prisma.$transaction([
      prisma.lessonContentVersion.updateMany({ where: { lessonId: source.lessonId, status: "PUBLISHED" }, data: { status: "ARCHIVED" } }),
      prisma.lesson.update({ where: { id: source.lessonId }, data: { content: restored.content, blocks: restored.blocks } }),
      prisma.lessonContentVersion.update({
        where: { id: restored.id },
        data: { status: "PUBLISHED", publishedById: req.user.id, publishedByName: req.user.name, publishedAt: new Date() },
      }),
    ]);
    await logAudit({
      req, action: AUDIT_ACTIONS.CONTENT_VERSION_RESTORED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", lessonId: source.lessonId, restoredFromVersion: source.versionNumber, newVersionId: restored.id, newVersionNumber: restored.versionNumber },
    });
    res.json(published);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to restore version" });
  }
});

router.delete("/lessons/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const lesson = await prisma.lesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    // Lesson->LessonProgress is onDelete:Cascade — same rationale as the chapter/module guards
    // above: block rather than silently erase a student's completion record for this lesson.
    const progressCount = await prisma.lessonProgress.count({ where: { lessonId: lesson.id } });
    if (progressCount > 0) {
      return res.status(409).json({
        error: `Cannot delete this lesson: ${progressCount} student has recorded progress on it. Deactivate it instead if you want to hide it from students.`,
      });
    }
    await prisma.lesson.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.COURSE_MANAGEMENT_CHANGED,
      actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { entity: "lesson", operation: "delete", lessonId: lesson.id, moduleId: lesson.moduleId, title: lesson.title },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete lesson" });
  }
});

router.post("/lessons/:id/questions", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    res.status(400).json({ error: safeErrorMessage(err, "Failed to create practice question") });
  }
});

router.patch("/practice/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
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
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update practice question") });
  }
});

router.delete("/practice/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
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
