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
  name: "Python Zero to Hero",
  description: "Learn Python from your first program to placement-ready skills: fundamentals, OOP, data structures and algorithms, databases, APIs, real-world projects and interview preparation.",
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
          moduleId: mod.id, chapterId: chapter.id, title: L.title, order: li, content: html, estimatedMinutes: L.minutes, isActive: false, isModuleTest: !!L.moduleTest,
        } }), `lesson ${L.title}`);
        if (existed && sync && !plan && lesson.content !== html) {
          await prisma.lesson.update({ where: { id: lesson.id }, data: { content: html, estimatedMinutes: L.minutes } });
          stats.updated++; note(`~ lesson ${L.title}`);
        }

        // Quiz questions first, then the coding task(s); order is the position inside the lesson.
        let order = 0;
        // Phase 6 projects: the guide is the lesson above; the structured project and its tasks go into CourseProject / ProjectTask.
        if (L.project) {
          const P = L.project;
          const project = await take(plan ? null : await prisma.courseProject.findUnique({ where: { moduleId_title: { moduleId: mod.id, title: P.title } } }),
            () => prisma.courseProject.create({ data: {
              moduleId: mod.id, title: P.title, description: P.problem, objective: P.objectives.join(" "), realWorldScenario: P.scenario,
              requirements: P.requirements, expectedOutput: P.sample.out, skillsRequired: P.prerequisites, interviewQuestions: P.interview,
              possibleImprovements: P.extensions, level: P.kind === "MAJOR" ? "COURSE_PROJECT" : "MINI_PROJECT", difficulty: P.difficulty,
              order: li, isActive: false,
            } }), `project ${P.title}`);
          for (let ti = 0; ti < P.tasks.length; ti++) {
            const t = P.tasks[ti];
            const found = plan ? null : await prisma.projectTask.findFirst({ where: { projectId: project.id, title: t.title } });
            await take(found, () => prisma.projectTask.create({ data: {
              projectId: project.id, order: ti, title: t.title, instructions: t.testCases ? t.statement : t.instructions, hints: t.hints || undefined,
              starterCode: t.starter || null, language: "python", evaluationType: "STDIO", testCases: t.testCases || undefined,
            } }), `project task ${t.title}`);
          }
        }

        const qs = [
          ...(L.quiz || []).map((q) => ({ key: { type: q.type, prompt: q.prompt }, data: { type: q.type, prompt: q.prompt, options: q.options ?? undefined, correctAnswer: q.correctAnswer, explanation: q.explanation } })),
          ...(L.tasks || []).map((t) => ({ key: { type: "CODING", title: t.title }, data: {
            type: "CODING", title: t.title, prompt: t.statement, starterCode: t.starter || null, language: "python", difficulty: t.meta?.difficulty || "EASY",
            testCases: t.testCases, evaluationType: "STDIO", estimatedTimeMin: t.meta?.minutes || 10,
            explanation: "Compare your output with the sample cases. Output must match exactly.",
            // Interview-bank problems carry structured fields the PracticeQuestion table already has.
            ...(t.meta ? {
              tags: t.meta.tags, timeComplexity: t.meta.timeComplexity, spaceComplexity: t.meta.spaceComplexity,
              inputFormat: t.meta.inputFormat, outputFormat: t.meta.outputFormat, constraints: t.meta.constraints, edgeCases: t.meta.edgeCases,
              hints: t.meta.hints, notes: "Learning objective: " + t.meta.goal,
            } : {}),
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

    // Module assessment and timed mock tests: Levels on the module's first chapter. All stay Draft until an admin publishes them.
    // A mock may set its own timeLimitMin, passingPercent, securityLevel, difficulty and instructions (Module 23).
    const assessments = [m.assessment, ...(m.mocks || [])].filter(Boolean);
    for (let ai = 0; ai < assessments.length; ai++) {
      const firstChapter = plan ? null : await prisma.chapter.findFirst({ where: { moduleId: mod.id }, orderBy: { order: "asc" } });
      const a = assessments[ai];
      const level = await take(plan ? null : await prisma.moduleCodingTest.findFirst({ where: { chapterId: firstChapter.id, title: a.title } }),
        () => prisma.moduleCodingTest.create({ data: {
          chapterId: firstChapter.id, title: a.title, description: a.description, order: 100 + ai, difficulty: a.difficulty || "Beginner", instructions: a.instructions || ASSESSMENT_INSTRUCTIONS,
          allowedLanguages: ["python"], questionCount: a.questions.length, randomizeQuestions: false, passingPercent: a.passingPercent || 60, timeLimitMin: a.timeLimitMin || 45, maxAttempts: 3,
          cooldownMinutes: 0, maxViolations: 3, requireFullscreen: false, requireWebcam: false, allowResume: true, proctoring: true,
          securityLevel: a.securityLevel || "STANDARD", unlockRule: "NONE", isActive: false,
        } }), `assessment ${a.title}`);
      for (const q of a.questions) {
        const found = plan ? null : await prisma.question.findFirst({ where: { moduleCodingTestId: level.id, title: q.title } });
        await take(found, () => prisma.question.create({ data: {
          title: q.title, description: q.statement, difficulty: q.difficulty || "EASY", questionType: "CODING", timeLimitMs: 2000, moduleCodingTestId: level.id, questionStatus: "PUBLISHED",
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

module.exports = { seedPythonCourse, SLUG, COURSE };

if (require.main === module) {
  const plan = process.argv.includes("--plan");
  const prisma = plan ? {} : require("../src/prisma"); // --plan never touches the database
  seedPythonCourse(prisma, { sync: process.argv.includes("--sync"), plan })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}
