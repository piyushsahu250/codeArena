// READ-ONLY duplicate roll-number conflict scan — spec section 2/24: "Before modifying any
// student data: run a read-only duplicate scan... DO NOT modify these records automatically."
// Makes NO writes at all. Same grouping key dailyHealthCheck.js already uses (academicGroupId +
// rollNumber — AcademicGroup IS Institute+Batch+Department(Branch)+Section, already the exact
// composite key the spec asks for), but uncapped (the health check's own query has a LIMIT 20,
// which is a display cap, not necessarily the true total — this report finds every conflict).
const prisma = require("../src/prisma");

async function main() {
  const dupGroups = await prisma.$queryRaw`
    SELECT "academicGroupId", "rollNumber", COUNT(*) c FROM "User"
    WHERE "rollNumber" IS NOT NULL AND "academicGroupId" IS NOT NULL AND role = 'STUDENT'
    GROUP BY "academicGroupId", "rollNumber" HAVING COUNT(*) > 1
    ORDER BY "academicGroupId", "rollNumber"`;

  console.log(`=== READ-ONLY ROLL NUMBER CONFLICT SCAN ===`);
  console.log(`Total duplicate (academicGroup, rollNumber) groups found: ${dupGroups.length}\n`);

  let totalStudentsInvolved = 0;
  const report = [];
  for (const g of dupGroups) {
    const group = await prisma.academicGroup.findUnique({
      where: { id: g.academicGroupId },
      select: { batch: true, section: true, institute: { select: { name: true } }, department: { select: { name: true } } },
    });
    const students = await prisma.user.findMany({
      where: { academicGroupId: g.academicGroupId, rollNumber: g.rollNumber, role: "STUDENT" },
      select: { id: true, name: true, registrationNumber: true, email: true, rollNumber: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
    totalStudentsInvolved += students.length;
    report.push({
      institute: group?.institute?.name || "(unknown)",
      batch: group?.batch || "(unknown)",
      branch: group?.department?.name || "(unknown)",
      section: group?.section || "(unknown)",
      rollNumber: g.rollNumber,
      academicGroupId: g.academicGroupId,
      students: students.map((s) => ({ id: s.id, name: s.name, prn: s.registrationNumber, email: s.email, createdAt: s.createdAt, updatedAt: s.updatedAt })),
    });
  }

  report.forEach((r, i) => {
    console.log(`--- Conflict ${i + 1}/${report.length} ---`);
    console.log(`Institute: ${r.institute} | Batch: ${r.batch} | Branch: ${r.branch} | Section: ${r.section} | Roll Number: ${r.rollNumber}`);
    console.log(`AcademicGroup ID: ${r.academicGroupId}`);
    r.students.forEach((s, j) => {
      console.log(`  Student ${j + 1}: ${s.name} | PRN: ${s.prn || "(none)"} | Student ID: ${s.id} | Email: ${s.email} | Created: ${s.createdAt.toISOString()} | Updated: ${s.updatedAt.toISOString()}`);
    });
    console.log("");
  });

  console.log(`=== SUMMARY: ${report.length} conflicting (academicGroup, rollNumber) group(s), ${totalStudentsInvolved} student(s) total involved ===`);
  console.log(JSON.stringify({ conflictGroups: report.length, studentsInvolved: totalStudentsInvolved }));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
