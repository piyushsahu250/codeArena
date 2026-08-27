// One-off, read-only: list every Subject that currently exists, grouped by institute, so a bulk-
// upload "Subject not found" failure can be checked against what's actually configured (exact
// name/spelling required — see resolveSubjectUnitTopicByName in routes/questions.js).
const prisma = require("../src/prisma");

async function main() {
  const subjects = await prisma.subject.findMany({
    select: { name: true, instituteId: true, institute: { select: { name: true } } },
    orderBy: [{ institute: { name: "asc" } }, { name: "asc" }],
  });
  console.log(`Total subjects in the database: ${subjects.length}\n`);
  const byInstitute = new Map();
  for (const s of subjects) {
    const key = s.institute?.name || "(no institute / global)";
    if (!byInstitute.has(key)) byInstitute.set(key, []);
    byInstitute.get(key).push(s.name);
  }
  for (const [institute, names] of byInstitute) {
    console.log(`${institute} (${names.length}):`);
    for (const n of names) console.log(`  - ${n}`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
