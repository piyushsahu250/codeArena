// Fixtures the manual verification scripts assume. They were written against the production database, which has an institute called "Testing Institute", more than one institute, and academic groups;
// the CI database from `npm run seed` has none of them, so 44 of the 67 scripts stopped at their first line ("Testing Institute not found", "Need 2 institutes", "No AcademicGroup exists...")
// without testing anything (audit 2026-11, finding A2-03). This creates just those rows, idempotently, on a DISPOSABLE database. Never run it against production: it is only invoked by
// .github/workflows/extended-verification.yml. Feature flags need no rows (an institute with no FeatureSetting row has every feature enabled).
"use strict";
const prisma = require("../src/prisma");

async function institute(name, code) {
  const inst = await prisma.institute.upsert({ where: { name }, update: {}, create: { name, code } });
  const dept = (await prisma.department.findFirst({ where: { instituteId: inst.id, name: "Computer Science" } })) || (await prisma.department.create({ data: { name: "Computer Science", instituteId: inst.id } }));
  const group = (await prisma.academicGroup.findFirst({ where: { instituteId: inst.id, departmentId: dept.id, batch: "2025-2028", section: "Section A" } })) || (await prisma.academicGroup.create({ data: { instituteId: inst.id, departmentId: dept.id, batch: "2025-2028", section: "Section A" } }));
  return { inst, dept, group };
}

// The four readiness scripts stop at "No ReadinessSubject has any ReadinessQuestionPool rows": the seeded subjects (seedReadinessSubjects.js) start with an empty pool by design, and the repository's content
// scripts that fill it need the production taxonomy. A small synthetic pool on the first active subject: 15 multiple-choice questions across the BTL levels and 4 coding questions with a hidden case.
async function readinessPool() {
  const subject = await prisma.readinessSubject.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!subject) { console.log("fixtures: no readiness subject was seeded, readiness pool skipped"); return; }
  if ((await prisma.readinessQuestionPool.count({ where: { subjectId: subject.id } })) > 0) return;
  const topics = (Array.isArray(subject.topics) ? subject.topics : []).map((t) => t.name).filter(Boolean);
  const topic = (i) => topics.length ? topics[i % topics.length] : "General";
  const ids = [];
  for (let i = 0; i < 15; i++) {
    const q = await prisma.question.create({ data: { title: `CI readiness MCQ ${i}`, description: `CI readiness fixture question ${i}: pick the first option.`, questionType: "MCQ", questionStatus: "PUBLISHED", options: ["correct", "wrong one", "wrong two", "wrong three"], correctAnswer: [0], btlLevel: 1 + (i % 4), topic: topic(i), difficulty: "EASY", points: 5 } });
    ids.push(q.id);
  }
  for (let i = 0; i < 4; i++) {
    const q = await prisma.question.create({ data: { title: `CI readiness coding ${i}`, description: "Read two integers and print their sum.", questionType: "CODING", questionStatus: "PUBLISHED", btlLevel: 2 + (i % 2), topic: topic(i), difficulty: "EASY", points: 10, testCases: { create: [{ input: "1 2", expected: "3", isHidden: false }, { input: "20 22", expected: "42", isHidden: true }] } } });
    ids.push(q.id);
  }
  await prisma.readinessQuestionPool.createMany({ data: ids.map((questionId) => ({ subjectId: subject.id, questionId, addedByUserId: "ci-fixture", addedByName: "CI fixture" })) });
  console.log(`fixtures: readiness pool of ${ids.length} questions on "${subject.name}"`);
}

(async () => {
  if (/amazonaws\.com|neon\.tech|render\.com/i.test(process.env.DATABASE_URL || "")) {
    console.error("refusing to run: DATABASE_URL looks like a hosted database. This script is for the disposable CI database only.");
    process.exit(2);
  }
  const a = await institute("Testing Institute", "TEST");
  const b = await institute("Second Test Institute", "TST2");
  await readinessPool();
  console.log(`fixtures: ${a.inst.name} (${a.group.id.slice(0, 8)}), ${b.inst.name} (${b.group.id.slice(0, 8)})`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
