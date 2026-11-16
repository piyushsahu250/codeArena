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

(async () => {
  if (/amazonaws\.com|neon\.tech|render\.com/i.test(process.env.DATABASE_URL || "")) {
    console.error("refusing to run: DATABASE_URL looks like a hosted database. This script is for the disposable CI database only.");
    process.exit(2);
  }
  const a = await institute("Testing Institute", "TEST");
  const b = await institute("Second Test Institute", "TST2");
  console.log(`fixtures: ${a.inst.name} (${a.group.id.slice(0, 8)}), ${b.inst.name} (${b.group.id.slice(0, 8)})`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
