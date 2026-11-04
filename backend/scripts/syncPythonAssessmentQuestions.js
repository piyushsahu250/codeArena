// Repairs two things on the module assessments and mock tests of the Python Zero to Hero course after they were seeded:
//   1. a sample case shown twice (the first seed did not drop a repeated sample, so a student saw the same Input/Expected twice);
//   2. no starter code (the editor then showed the generic "Read input via input()" line, wrong for a program that takes no input).
//   node scripts/syncPythonAssessmentQuestions.js --plan    print what would change, touch nothing
//   node scripts/syncPythonAssessmentQuestions.js           apply
// Only ever: deletes the SECOND and later copy of a visible sample that is identical (input and expected) to an earlier visible one, and fills a missing Python starter. It never changes a statement,
// never touches a hidden case, never overwrites a starter someone wrote, and only looks at questions that match the course content by assessment title and question title.
// Anything else that differs from the course content is only reported.
"use strict";
const { modules } = require("../content/python");
const { starterFor } = require("../content/python/starter");
const { SLUG } = require("./seedPythonCourse");

const plan = process.argv.includes("--plan");
const key = (c) => JSON.stringify([c.input, c.expected]);

async function main() {
  const prisma = require("../src/prisma");
  const course = await prisma.course.findUnique({ where: { slug: SLUG } });
  if (!course) throw new Error(`course ${SLUG} not found; nothing changed`);
  const specs = modules.flatMap((m) => [m.module.assessment, ...(m.module.mocks || [])].filter(Boolean));
  const levels = await prisma.moduleCodingTest.findMany({ where: { chapter: { module: { courseId: course.id } } }, select: { id: true, title: true } });
  const byTitle = new Map(levels.map((l) => [l.title, l]));
  const stats = { questions: 0, duplicateSamples: 0, starters: 0, hiddenDiffers: 0, missingInDb: 0, unmatched: 0 };
  const deletes = [], starters = [], notes = [];
  for (const a of specs) {
    const level = byTitle.get(a.title);
    if (!level) { notes.push(`level not found: ${a.title}`); stats.unmatched++; continue; }
    const rows = await prisma.question.findMany({ where: { moduleCodingTestId: level.id }, select: { id: true, title: true, starterCodeByLanguage: true, testCases: { select: { id: true, input: true, expected: true, isHidden: true }, orderBy: { id: "asc" } } } });
    for (const q of a.questions) {
      const row = rows.find((r) => r.title === q.title);
      if (!row) { notes.push(`question not found: ${a.title} / ${q.title}`); stats.unmatched++; continue; }
      stats.questions++;
      // 1. identical visible samples: keep the first
      const seen = new Set();
      for (const c of row.testCases.filter((t) => !t.isHidden)) {
        if (seen.has(key(c))) { deletes.push(c.id); stats.duplicateSamples++; notes.push(`duplicate sample removed: ${a.title.slice(0, 40)} / ${q.title}`); } else seen.add(key(c));
      }
      // report only: cases in the content that the database does not have, and a different number of hidden cases
      const have = new Set(row.testCases.map((c) => key(c) + c.isHidden));
      for (const c of q.testCases) if (!have.has(key(c) + c.isHidden)) { stats.missingInDb++; notes.push(`content case missing in database (reported only): ${q.title}`); }
      if (row.testCases.filter((t) => t.isHidden).length !== q.testCases.filter((t) => t.isHidden).length) { stats.hiddenDiffers++; notes.push(`hidden case count differs (reported only): ${q.title}`); }
      // 2. starter
      const existing = row.starterCodeByLanguage && typeof row.starterCodeByLanguage === "object" ? row.starterCodeByLanguage.python : null;
      if (!existing || !String(existing).trim()) { starters.push({ id: row.id, base: row.starterCodeByLanguage && typeof row.starterCodeByLanguage === "object" ? row.starterCodeByLanguage : {}, code: starterFor(q) }); stats.starters++; }
    }
  }
  for (const n of notes.slice(0, 40)) console.log("  " + n);
  console.log(JSON.stringify(stats));
  if (plan) return console.log(`Would delete ${deletes.length} duplicate sample row(s) and fill ${starters.length} starter(s).`);
  if (deletes.length) await prisma.testCase.deleteMany({ where: { id: { in: deletes }, isHidden: false } });
  for (const s of starters) await prisma.question.update({ where: { id: s.id }, data: { starterCodeByLanguage: { ...s.base, python: s.code } } });
  console.log(`Done: deleted ${deletes.length} duplicate sample row(s), filled ${starters.length} starter(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
