// Course Content Validation (LMS master-spec section 45): "Before publishing... Show: Course
// Validation PASS / WARNING / ERROR." Advisory only — this does NOT block the existing
// PATCH /learning/courses/:id publish route (which has its own working lifecycle logic already);
// it's a report an admin/staff consults, same spirit as a linter, not a hard gate grafted onto a
// route other things already depend on.
const prisma = require("../prisma");

async function validateCourse(courseId) {
  const findings = []; // { severity: "ERROR"|"WARNING", area, message }
  const add = (severity, area, message) => findings.push({ severity, area, message });

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: { orderBy: { order: "asc" } },
          codingTest: { include: { _count: { select: { questions: true } } } },
          projects: { include: { tasks: true } },
        },
      },
    },
  });
  if (!course) return { status: "ERROR", findings: [{ severity: "ERROR", area: "course", message: "Course not found" }] };

  // --- Missing lesson / broken sequence at the course level ---
  if (course.modules.length === 0) {
    add("ERROR", "modules", "This course has no modules — students would see an empty course.");
  }

  for (const mod of course.modules) {
    if (mod.lessons.length === 0) {
      add("WARNING", "lessons", `Module "${mod.title}" has no lessons.`);
    }

    // Broken sequence: two lessons in the same module sharing the same order value makes their
    // student-facing sequence ambiguous (whichever the DB happens to return first).
    const orderCounts = new Map();
    for (const l of mod.lessons) orderCounts.set(l.order, (orderCounts.get(l.order) || 0) + 1);
    for (const [order, count] of orderCounts) {
      if (count > 1) add("WARNING", "sequence", `Module "${mod.title}" has ${count} lessons sharing order position ${order} — their sequence is ambiguous.`);
    }

    // Missing content: a lesson with no body text, no blocks, and no video is effectively empty.
    for (const l of mod.lessons) {
      const hasContent = (l.content && l.content.trim().length > 0) || (Array.isArray(l.blocks) && l.blocks.length > 0);
      if (!hasContent && !l.videoUrl) {
        add("WARNING", "content", `Lesson "${l.title}" (Module "${mod.title}") has no content, blocks, or video.`);
      }
      // Broken link: a lightweight format check only (never fetched — this must stay fast/offline),
      // catching the obvious case of a pasted non-URL rather than proving the link resolves.
      for (const [field, label] of [["videoUrl", "video"], ["pdfUrl", "PDF"]]) {
        const val = l[field];
        if (val && !/^https?:\/\//i.test(val)) {
          add("WARNING", "links", `Lesson "${l.title}"'s ${label} link doesn't look like a valid URL: "${val}"`);
        }
      }
    }

    // Missing assessment / invalid coding question: this module's Coding Assessment, if
    // configured active, must actually have questions — an active-but-empty gate is exactly the
    // real production incident learningLock.js's own header comment documents (2026-09-02): it
    // silently makes the module permanently unpassable for every student. Catching this here, at
    // publish-review time, is the whole point of this validator — prevention, not post-hoc audit.
    if (mod.codingTest?.isActive && mod.codingTest._count.questions === 0) {
      add("ERROR", "assessment", `Module "${mod.title}" has an active Coding Assessment with zero questions configured — it will silently block every student from ever unlocking the next module.`);
    }

    for (const project of mod.projects) {
      if (project.isActive && project.tasks.length === 0) {
        add("WARNING", "project", `Project "${project.title}" (Module "${mod.title}") is published but has no tasks yet.`);
      }
    }
  }

  // --- Invalid coding question / missing test case, platform-wide within this course ---
  const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  if (lessonIds.length > 0) {
    const codingQuestions = await prisma.practiceQuestion.findMany({
      where: { lessonId: { in: lessonIds }, type: "CODING" },
      select: { id: true, title: true, prompt: true, testCases: true, lesson: { select: { title: true } } },
    });
    for (const q of codingQuestions) {
      const cases = Array.isArray(q.testCases) ? q.testCases : [];
      if (cases.length === 0) {
        add("ERROR", "coding-question", `Coding practice question "${q.title || q.prompt.slice(0, 40)}" (Lesson "${q.lesson.title}") has zero test cases — it can never be graded.`);
      } else if (!cases.some((c) => c.isHidden)) {
        add("WARNING", "coding-question", `Coding practice question "${q.title || q.prompt.slice(0, 40)}" (Lesson "${q.lesson.title}") has no hidden test cases — /submit will grade against the same sample cases the student already saw.`);
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === "ERROR").length;
  const warningCount = findings.filter((f) => f.severity === "WARNING").length;
  const status = errorCount > 0 ? "ERROR" : warningCount > 0 ? "WARNING" : "PASS";
  return { status, errorCount, warningCount, findings };
}

module.exports = { validateCourse };
