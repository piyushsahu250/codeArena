// Publishes the "Module Practice Test" lessons of the Python Zero to Hero course, after seedPythonCourse.js has created them as Draft.
//   node scripts/publishPythonModuleTests.js --plan    print what would change, touch nothing
//   node scripts/publishPythonModuleTests.js           publish
// Touches only lessons of this course that are flagged isModuleTest, and only ones still Draft. Nothing else (no other lesson, module, student progress) is read for writing.
"use strict";
const { modules } = require("../content/python");
const { SLUG } = require("./seedPythonCourse");
const { TITLE } = require("../content/python/moduleTest");

const plan = process.argv.includes("--plan");

async function main() {
  const prisma = require("../src/prisma");
  const course = await prisma.course.findUnique({ where: { slug: SLUG } });
  if (!course) throw new Error(`course ${SLUG} not found; nothing changed`);
  const expected = modules.filter((m) => m.module.chapters.some((c) => c.lessons.some((l) => l.moduleTest))).length;
  const tests = await prisma.lesson.findMany({ where: { module: { courseId: course.id }, isModuleTest: true }, select: { id: true, title: true, isActive: true, archivedAt: true, module: { select: { title: true } } } });
  if (tests.length !== expected) throw new Error(`expected ${expected} module tests, found ${tests.length}; run seedPythonCourse.js first. Nothing changed`);
  const odd = tests.filter((t) => t.title !== TITLE);
  if (odd.length) throw new Error(`unexpected module-test lesson(s) ${odd.map((t) => `"${t.title}"`).join(", ")}; nothing changed`);
  const draft = tests.filter((t) => !t.isActive && !t.archivedAt);
  const archived = tests.filter((t) => t.archivedAt);
  if (archived.length) console.log(`  skipping ${archived.length} archived test(s): an administrator archived them on purpose`);
  for (const t of draft) console.log(`  publish: ${t.module.title}`);
  console.log(`${plan ? "Would publish" : "Publishing"} ${draft.length} of ${tests.length} module test(s).`);
  if (plan || !draft.length) return;
  const r = await prisma.lesson.updateMany({ where: { id: { in: draft.map((t) => t.id) }, isActive: false, archivedAt: null }, data: { isActive: true, archivedAt: null, publishedAt: new Date() } });
  console.log(`Done: ${r.count} published.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
