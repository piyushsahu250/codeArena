// One-off, read-only: a test was reported as "created but not visible to me or to students."
// Staff/Admin visibility requires the test's institute-scoping (own instituteId, or its assigned
// classes'/academicGroups' institute) to match the requester's institute (see routes/tests.js's
// GET / `instituteWhere`); Student visibility ADDITIONALLY requires isPublished=true and a
// matching class/academicGroup/pool assignment (testEligibilityWhere). Prints the most recently
// created tests with every field those checks depend on, so the actual cause (unpublished vs.
// institute/assignment mismatch vs. both) can be confirmed instead of guessed. No writes.
const prisma = require("../src/prisma");

async function main() {
  const tests = await prisma.test.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, title: true, isPublished: true, instituteId: true,
      startTime: true, endTime: true, createdAt: true,
      createdBy: { select: { id: true, name: true, email: true, role: true, instituteId: true } },
      institute: { select: { name: true } },
      classes: { select: { class: { select: { id: true, name: true, instituteId: true, institute: { select: { name: true } } } } } },
      academicGroups: { select: { academicGroup: { select: { id: true, batch: true, section: true, instituteId: true, institute: { select: { name: true } } } } } },
      talentPools: { select: { poolId: true } },
      shares: { select: { staff: { select: { name: true, email: true } } } },
      _count: { select: { questions: true } },
    },
  });

  console.log(`Most recent ${tests.length} test(s):\n`);
  for (const t of tests) {
    console.log(`"${t.title}" (id=${t.id}) — created ${t.createdAt.toISOString()}`);
    console.log(`  isPublished: ${t.isPublished}`);
    console.log(`  questions: ${t._count.questions}`);
    console.log(`  Test.instituteId: ${t.instituteId || "null"} (${t.institute?.name || "none"})`);
    console.log(`  createdBy: ${t.createdBy ? `${t.createdBy.name} <${t.createdBy.email}> role=${t.createdBy.role} instituteId=${t.createdBy.instituteId || "null"}` : "(unknown)"}`);
    console.log(`  startTime: ${t.startTime} | endTime: ${t.endTime}`);
    console.log(`  assigned classes (${t.classes.length}): ${t.classes.map((c) => `${c.class.name} [inst=${c.class.institute?.name || "none"}]`).join(", ") || "(none)"}`);
    console.log(`  assigned academicGroups (${t.academicGroups.length}): ${t.academicGroups.map((g) => `${g.academicGroup.batch}/${g.academicGroup.section} [inst=${g.academicGroup.institute?.name || "none"}]`).join(", ") || "(none)"}`);
    console.log(`  assigned talent pools: ${t.talentPools.length}`);
    console.log(`  shared with: ${t.shares.map((s) => s.staff.name).join(", ") || "(none)"}`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
