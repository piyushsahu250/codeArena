// One-off: surface the actual duplicate-roll-number records the daily health check flagged, so a
// real decision can be made about each one (never auto-renamed — see docs/PLATFORM_HEALTH.md).
const prisma = require("../src/prisma");

async function main() {
  const dupes = await prisma.$queryRaw`
    SELECT "academicGroupId", "rollNumber", COUNT(*) c FROM "User"
    WHERE "rollNumber" IS NOT NULL AND "academicGroupId" IS NOT NULL
    GROUP BY "academicGroupId", "rollNumber" HAVING COUNT(*) > 1
    ORDER BY c DESC LIMIT 30`;

  console.log(`Found ${dupes.length} duplicate (academicGroup, rollNumber) pair(s).\n`);

  for (const d of dupes) {
    const group = await prisma.academicGroup.findUnique({
      where: { id: d.academicGroupId },
      select: { batch: true, section: true, department: { select: { name: true } }, institute: { select: { name: true } } },
    });
    const users = await prisma.user.findMany({
      where: { academicGroupId: d.academicGroupId, rollNumber: d.rollNumber },
      select: { id: true, name: true, email: true, registrationNumber: true, isActive: true, createdAt: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`Roll "${d.rollNumber}" x${Number(d.c)} in ${group?.institute?.name || "?"} / ${group?.department?.name || "?"} / ${group?.section || "?"} (${group?.batch || "?"}):`);
    for (const u of users) {
      console.log(`   - ${u.name} <${u.email}> PRN=${u.registrationNumber || "—"} role=${u.role} active=${u.isActive} created=${u.createdAt.toISOString().slice(0, 10)} id=${u.id}`);
    }
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
