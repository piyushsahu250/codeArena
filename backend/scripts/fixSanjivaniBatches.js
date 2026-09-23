/**
 * One-time (idempotent) data correction for Sanjivani University's "Integrated M.Tech" cohort,
 * requested directly (2026-09-23): the admin dashboard should show exactly 2 batches --
 * "2025-2030" and "2026-2031" -- with every student visible under one of them. Instead there were
 * 5 AcademicGroup rows, because resolveAcademicGroup() (backend/src/routes/users.js) matches the
 * `batch` field by exact string equality with no formatting normalization, so every slightly
 * different way a batch got typed during bulk upload / manual registration ("2025-2030" vs
 * "2025-30" vs bare "2030", "2026 - 2031" with stray spaces vs "2031" bare) spawned a brand-new
 * group instead of reusing the real one. This is the SAME bug class backend/scripts/
 * fixIntegratedMTechAcademicGroup.js fixed once before for a different stray ("Unassigned ·
 * Section A · 2030") -- it has recurred with new variants since. See users.js's own
 * resolveAcademicGroup for the accompanying root-cause fix (batch string normalization) that
 * should stop this from recurring a third time.
 *
 * Safety: exactly the same approach as fixIntegratedMTechAcademicGroup.js -- students are only
 * ever re-pointed (academicGroupId updated), never deleted. Source groups are deleted only after
 * being confirmed empty (either had 0 students, or all of them were just moved out). Idempotent:
 * once applied, the stray groups no longer exist, so a re-run's lookups find nothing and no-op.
 */
const prisma = require("../src/prisma");

const INSTITUTE_NAME = "Sanjivani University";
const DEPARTMENT_NAME = "Integrated M.Tech";

// { canonical batch label -> [stray group lookup keys to merge into it] }
// A lookup key is { batch, departmentName, section } -- departmentName defaults to "Integrated
// M.Tech" but the old "2030"-under-"Unassigned" bug pattern is included explicitly in case it
// ever recurs again under a fresh label.
const PLAN = [
  {
    canonicalBatch: "2025-2030",
    strays: [
      { batch: "2025-30", section: "A" },
      { batch: "2030", section: "A" },
      { batch: "2030", departmentName: "Unassigned", section: "Section A" },
    ],
  },
  {
    canonicalBatch: "2026-2031",
    strays: [
      { batch: "2026 - 2031", section: "A" }, // relabel-in-place case: this IS the canonical group's real row, just mislabeled
      { batch: "2031", section: "A" },
      { batch: "2031", departmentName: "Unassigned", section: "Section A" },
    ],
  },
];

async function run() {
  const institute = await prisma.institute.findFirst({ where: { name: { equals: INSTITUTE_NAME, mode: "insensitive" } } });
  if (!institute) {
    console.log(`Institute "${INSTITUTE_NAME}" not found — nothing to do.`);
    return;
  }
  const dept = await prisma.department.findFirst({ where: { instituteId: institute.id, name: { equals: DEPARTMENT_NAME, mode: "insensitive" } } });
  if (!dept) {
    console.log(`Department "${DEPARTMENT_NAME}" not found — nothing to do.`);
    return;
  }

  for (const { canonicalBatch, strays } of PLAN) {
    console.log(`\n--- Consolidating into batch "${canonicalBatch}" ---`);

    // Find (or, for the relabel case, adopt) the canonical group: prefer an EXISTING group whose
    // batch is already exactly the clean canonical string; if none exists yet, the largest stray
    // (by student count) becomes the canonical row via relabel-in-place, same technique as
    // fixIntegratedMTechAcademicGroup.js's "relabeled" path.
    let canonical = await prisma.academicGroup.findFirst({
      where: { instituteId: institute.id, departmentId: dept.id, batch: canonicalBatch },
    });

    for (const stray of strays) {
      const strayDept = stray.departmentName
        ? await prisma.department.findFirst({ where: { instituteId: institute.id, name: { equals: stray.departmentName, mode: "insensitive" } } })
        : dept;
      if (!strayDept) continue; // e.g. "Unassigned" dept doesn't exist (already cleaned up) — fine, skip

      const strayGroup = await prisma.academicGroup.findFirst({
        where: { instituteId: institute.id, departmentId: strayDept.id, batch: stray.batch, section: { equals: stray.section, mode: "insensitive" } },
      });
      if (!strayGroup) {
        console.log(`  (no stray group for batch="${stray.batch}" dept="${stray.departmentName || DEPARTMENT_NAME}" section="${stray.section}" — already applied or never existed)`);
        continue;
      }

      const studentCount = await prisma.user.count({ where: { academicGroupId: strayGroup.id } });

      if (!canonical) {
        // No clean canonical row exists yet — relabel this stray in place instead of moving data.
        canonical = await prisma.academicGroup.update({ where: { id: strayGroup.id }, data: { departmentId: dept.id, batch: canonicalBatch } });
        console.log(`  Relabeled group ${strayGroup.id} in place -> batch="${canonicalBatch}" (${studentCount} student(s), untouched).`);
        continue;
      }

      if (strayGroup.id === canonical.id) continue; // already the canonical row itself

      if (studentCount > 0) {
        const { count: moved } = await prisma.user.updateMany({ where: { academicGroupId: strayGroup.id }, data: { academicGroupId: canonical.id } });
        console.log(`  Moved ${moved} student(s) from ${strayGroup.id} (batch="${stray.batch}") into canonical group ${canonical.id}.`);
      }
      await prisma.academicGroup.delete({ where: { id: strayGroup.id } });
      console.log(`  Deleted now-empty stray group ${strayGroup.id} (batch="${stray.batch}", section="${stray.section}").`);
    }

    if (canonical) {
      const finalCount = await prisma.user.count({ where: { academicGroupId: canonical.id } });
      console.log(`  Canonical group for "${canonicalBatch}": ${canonical.id}, now ${finalCount} student(s).`);
    } else {
      console.log(`  No group at all found for batch "${canonicalBatch}" — nothing to consolidate.`);
    }
  }

  const remaining = await prisma.academicGroup.findMany({
    where: { instituteId: institute.id, departmentId: dept.id },
    select: { id: true, batch: true, section: true, _count: { select: { users: true } } },
  });
  console.log("\n=== Final Integrated M.Tech groups for Sanjivani University ===");
  for (const g of remaining) console.log(`${g.id} | batch="${g.batch}" | section="${g.section}" | students=${g._count.users}`);
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
