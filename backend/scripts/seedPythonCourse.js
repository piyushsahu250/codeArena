// Idempotent seed for the "Python Zero to Hero" learning course (Course.kind = LEARNING, slug python-zero-to-hero).
//   node scripts/seedPythonCourse.js            create whatever is missing; never modifies existing rows
//   node scripts/seedPythonCourse.js --sync     also refresh lesson HTML and practice questions of existing lessons
//   node scripts/seedPythonCourse.js --plan     print what would be created, touch nothing
//
// Everything is created as DRAFT (course DRAFT, modules/chapters/lessons/assessments unpublished) and is NOT assigned to
// any institute, so no student sees anything until an admin reviews, publishes and assigns it in Learning Management.
// The content is validated first (scripts/validatePythonContent.js); a failure aborts before any write.
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const { modules } = require("../content/python");
const { renderLesson } = require("../content/python/render");

const SLUG = "python-zero-to-hero";
const COURSE = {
  slug: SLUG,
  name: "Python Zero to Hero: Programming and Placement Mastery",
  description: "A beginner-to-job-ready Python course: programming basics, Python fundamentals, OOP, data structures and algorithms, databases, APIs, projects and placement preparation. Every lesson follows the same structure: explanation, diagram, worked example with verified output, practice, quiz and a coding task.",
  category: "Programming",
  instructorName: "CodeArena Learning Team",
  skillsCovered: ["Python syntax", "Problem solving", "Debugging", "Data structures", "OOP", "SQL and APIs", "Placement preparation"],
  difficulty: "EASY",
  estimatedDurationMin: 0, // recomputed from the lessons seeded so far
};

const ASSESSMENT_INSTRUCTIONS = [
  "Write your own solution. Do not ask for or give help during the assessment.",
  "Read the problem and the sample cases, then use Run to test against the samples. Submit runs the hidden cases.",
  "Output must match exactly, including spaces and line breaks.",
  "Switching tabs or leaving the page may be recorded and reviewed by your faculty.",
].map((l, i) => `${i + 1}. ${l}`).join("\n");

function validateOrThrow() {
  const r = spawnSync(process.execPath, [path.join(__dirname, "validatePythonContent.js")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Content validation failed; nothing was written.\n${r.stdout}${r.stderr}`);
}

async function seedPythonCourse(prisma, { sync = false, plan = false, log = console.log } = {}) {
  validateOrThrow();
  const stats = { created: 0, existing: 0, updated: 0 };
  const note = (s) => log(`  ${s}`);
  const take = async (found, make, label) => {
    if (found) { stats.existing++; return found; }
    stats.created++;
    if (plan) { note(`+ ${label}`); return { id: `plan-${stats.created}` }; }
    return make();
  };

  const course = await take(plan ? null : await prisma.course.findUnique({ where: { slug: SLUG } }), () => prisma.course.create({ data: {
    ...COURSE, kind: "LEARNING", status: "DRAFT", isActive: false, instituteId: null, order: 20,
  } }), `course ${COURSE.name}`);

  let totalMinutes = 0;
  for (let mi = 0; mi < modules.length; mi++) {
    const m = modules[mi].module;
    const mod = await take(plan ? null : await prisma.courseModule.findUnique({ where: { courseId_title: { courseId: course.id, title: m.title } } }),
      () => prisma.courseModule.create({ data: { courseId: course.id, title: m.title, description: m.description, order: mi, isActive: false, unlockRule: "NONE" } }), `module ${m.title}`);

    for (let ci = 0; ci < m.chapters.length; ci++) {
      const c = m.chapters[ci];
      const chapter = await take(plan ? null : await prisma.chapter.findUnique({ where: { moduleId_title: { moduleId: mod.id, title: c.title } } }),
        () => prisma.chapter.create({ data: { moduleId: mod.id, title: c.title, description: c.description, order: ci, isActive: false, unlockRule: "NONE" } }), `chapter ${c.title}`);

      for (let li = 0; li < c.lessons.length; li++) {
        const L = c.lessons[li];
        totalMinutes += L.minutes;
        const html = renderLesson(L);
        let lesson = plan ? null : await prisma.lesson.findUnique({ where: { moduleId_title: { moduleId: mod.id, title: L.title } } });
        const existed = !!lesson;
        lesson = await take(lesson, () => prisma.lesson.create({ data: {
          moduleId: mod.id, chapterId: chapter.id, title: L.title, order: li, content: html, estimatedMinutes: L.minutes, isActive: false,
        } }), `lesson ${L.title}`);
        if (existed && sync && !plan && lesson.content !== html) {
          await prisma.lesson.update({ where: { id: lesson.id }, data: { content: html, estimatedMinutes: L.minutes } });
          stats.updated++; note(`~ lesson ${L.title}`);
        }

        // Quiz questions first, then the coding task(s); order is the position inside the lesson.
        let order = 0;
        const qs = [
          ...L.quiz.map((q) => ({ key: { type: q.type, prompt: q.prompt }, data: { type: q.type, prompt: q.prompt, options: q.options ?? undefined, correctAnswer: q.correctAnswer, explanation: q.explanation } })),
          ...L.tasks.map((t) => ({ key: { type: "CODING", title: t.title }, data: {
            type: "CODING", title: t.title, prompt: t.statement, starterCode: t.starter || null, language: "python", difficulty: "EASY",
            testCases: t.testCases, evaluationType: "STDIO", estimatedTimeMin: 10,
            explanation: "Compare your output with the sample cases. Output must match exactly.",
          } })),
        ];
        for (const q of qs) {
          const found = plan ? null : await prisma.practiceQuestion.findFirst({ where: { lessonId: lesson.id, ...q.key } });
          await take(found, () => prisma.practiceQuestion.create({ data: { lessonId: lesson.id, order, ...q.data } }), `question ${q.key.title || q.key.prompt.slice(0, 40)}`);
          if (found && sync && !plan) {
            await prisma.practiceQuestion.update({ where: { id: found.id }, data: { order, ...q.data } });
            stats.updated++;
          }
          order++;
        }
      }
    }

    // Module assessment: a Level on the module's first chapter. Draft until an admin publishes it.
    if (m.assessment) {
      const firstChapter = plan ? null : await prisma.chapter.findFirst({ where: { moduleId: mod.id }, orderBy: { order: "asc" } });
      const a = m.assessment;
      const level = await take(plan ? null : await prisma.moduleCodingTest.findFirst({ where: { chapterId: firstChapter.id, title: a.title } }),
        () => prisma.moduleCodingTest.create({ data: {
          chapterId: firstChapter.id, title: a.title, description: a.description, order: 100, difficulty: "Beginner", instructions: ASSESSMENT_INSTRUCTIONS,
          allowedLanguages: ["python"], questionCount: a.questions.length, randomizeQuestions: false, passingPercent: 60, timeLimitMin: 45, maxAttempts: 3,
          cooldownMinutes: 0, maxViolations: 3, requireFullscreen: false, requireWebcam: false, allowResume: true, proctoring: true,
          securityLevel: "STANDARD", unlockRule: "NONE", isActive: false,
        } }), `assessment ${a.title}`);
      for (const q of a.questions) {
        const found = plan ? null : await prisma.question.findFirst({ where: { moduleCodingTestId: level.id, title: q.title } });
        await take(found, () => prisma.question.create({ data: {
          title: q.title, description: q.statement, difficulty: "EASY", questionType: "CODING", timeLimitMs: 2000, moduleCodingTestId: level.id, questionStatus: "PUBLISHED",
          starterCodeByLanguage: q.starter ? { python: q.starter } : undefined,
          testCases: { create: q.testCases.map((c) => ({ input: c.input, expected: c.expected, isHidden: c.isHidden })) },
        } }), `assessment question ${q.title}`);
      }
    }
  }

  if (!plan) await prisma.course.update({ where: { id: course.id }, data: { estimatedDurationMin: totalMinutes } });
  log(`Python course seed${plan ? " (plan)" : ""}: created ${stats.created}, already existed ${stats.existing}, refreshed ${stats.updated}.`);
  return stats;
}

module.exports = { seedPythonCourse, SLUG };

if (require.main === module) {
  const plan = process.argv.includes("--plan");
  const prisma = plan ? {} : require("../src/prisma"); // --plan never touches the database
  seedPythonCourse(prisma, { sync: process.argv.includes("--sync"), plan })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}
