// Publishes the module assessments and timed mock tests of the Python Zero to Hero course, after seedPythonCourse.js has created them as Draft.
//   node scripts/publishPythonAssessments.js --plan    print what would change, touch nothing
//   node scripts/publishPythonAssessments.js           publish
// Touches only Levels (ModuleCodingTest) of this course whose title is in the course content, and only ones still Draft. Archived ones are left alone (an administrator did that on purpose).
// These Levels do not gate module unlocking or the learning certificate (see utils/learningLock.js); students take them from the module page and each has its own result.
"use strict";
const { modules } = require("../content/python");
const { SLUG } = require("./seedPythonCourse");

const plan = process.argv.includes("--plan");

async function main() {
  const prisma = require("../src/prisma");
  const course = await prisma.course.findUnique({ where: { slug: SLUG } });
  if (!course) throw new Error(`course ${SLUG} not found; nothing changed`);
  const specsOf = (m) => [m.module.assessment, ...(m.module.mocks || [])].filter(Boolean);
  const titles = new Set(modules.flatMap((m) => specsOf(m).map((a) => a.title)));
  const expected = modules.reduce((n, m) => n + specsOf(m).length, 0);
  const levels = await prisma.moduleCodingTest.findMany({
    where: { chapter: { module: { courseId: course.id } } },
    select: { id: true, title: true, isActive: true, archivedAt: true, chapter: { select: { module: { select: { title: true } } } }, _count: { select: { questions: { where: { questionStatus: "PUBLISHED" } } } } },
  });
  if (levels.length !== expected) throw new Error(`expected ${expected} assessments and mocks, found ${levels.length}; run seedPythonCourse.js first. Nothing changed`);
  const odd = levels.filter((l) => !titles.has(l.title));
  if (odd.length) throw new Error(`unexpected level(s) ${odd.map((l) => `"${l.title}"`).join(", ")}; nothing changed`);
  const empty = levels.filter((l) => l._count.questions === 0);
  if (empty.length) throw new Error(`${empty.length} level(s) have no published questions (${empty.map((l) => l.title).join(", ")}); nothing changed`);
  const draft = levels.filter((l) => !l.isActive && !l.archivedAt);
  const archived = levels.filter((l) => l.archivedAt);
  if (archived.length) console.log(`  skipping ${archived.length} archived level(s): an administrator archived them on purpose`);
  for (const l of draft) console.log(`  publish: ${l.chapter.module.title} - ${l.title} (${l._count.questions} questions)`);
  console.log(`${plan ? "Would publish" : "Publishing"} ${draft.length} of ${levels.length} assessment(s) and mock(s).`);
  if (plan || !draft.length) return;
  const r = await prisma.moduleCodingTest.updateMany({ where: { id: { in: draft.map((l) => l.id) }, isActive: false, archivedAt: null }, data: { isActive: true, archivedAt: null, publishedAt: new Date() } });
  console.log(`Done: ${r.count} published.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
