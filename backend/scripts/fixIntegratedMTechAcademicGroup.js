/**
 * One-time (idempotent) admin data correction, requested directly: the 109 students currently
 * grouped under Sanjivani University's auto-derived "Unassigned · Section A" group (batch "2030")
 * actually belong to "Integrated M.Tech · Section A", batch "2025-2030" — a bulk upload / manual
 * registration presumably left Department and/or Batch blank or mis-typed for that cohort.
 *
 * Safety: this UPDATES the existing AcademicGroup row's departmentId/batch fields in place rather
 * than deleting+recreating it, so every student's `academicGroupId` foreign key is untouched — no
 * data loss, no effect on any student's submissions/attempts/certificates/progress, since none of
 * that data is keyed by department/batch, only by the (unchanged) academicGroupId. If a group
 * already exists at the target (Integrated M.Tech · Section A · 2025-2030) — e.g. from other
 * students already registered directly under that name — students are moved into it instead
 * (again, only re-pointing academicGroupId) and the now-empty source group is deleted.
 *
 * Idempotent: once applied, the source group (Unassigned · Section A · 2030) no longer exists
 * under that name, so a re-run's lookup naturally finds nothing and no-ops.
 */
const prisma = require("../src/prisma");

const INSTITUTE_NAME = "Sanjivani University";
const SOURCE_DEPARTMENT_NAME = "Unassigned";
const SOURCE_SECTION = "Section A";
const SOURCE_BATCH = "2030";
const TARGET_DEPARTMENT_NAME = "Integrated M.Tech";
const TARGET_BATCH = "2025-2030";

async function fixIntegratedMTechAcademicGroup() {
  const institute = await prisma.institute.findFirst({ where: { name: { equals: INSTITUTE_NAME, mode: "insensitive" } } });
  if (!institute) {
    console.log(`[fixIntegratedMTechAcademicGroup] Institute "${INSTITUTE_NAME}" not found — nothing to do.`);
    return { applied: false };
  }

  const sourceDept = await prisma.department.findFirst({
    where: { instituteId: institute.id, name: { equals: SOURCE_DEPARTMENT_NAME, mode: "insensitive" } },
  });
  if (!sourceDept) {
    console.log(`[fixIntegratedMTechAcademicGroup] Department "${SOURCE_DEPARTMENT_NAME}" not found — already applied or nothing to do.`);
    return { applied: false };
  }

  const sourceGroup = await prisma.academicGroup.findFirst({
    where: {
      instituteId: institute.id, departmentId: sourceDept.id,
      section: { equals: SOURCE_SECTION, mode: "insensitive" }, batch: SOURCE_BATCH,
    },
  });
  if (!sourceGroup) {
    console.log(`[fixIntegratedMTechAcademicGroup] Source group (${SOURCE_DEPARTMENT_NAME} · ${SOURCE_SECTION} · ${SOURCE_BATCH}) not found — already applied or nothing to do.`);
    return { applied: false };
  }

  const studentCount = await prisma.user.count({ where: { academicGroupId: sourceGroup.id } });

  let targetDept = await prisma.department.findFirst({
    where: { instituteId: institute.id, name: { equals: TARGET_DEPARTMENT_NAME, mode: "insensitive" } },
  });
  if (!targetDept) {
    targetDept = await prisma.department.create({ data: { instituteId: institute.id, name: TARGET_DEPARTMENT_NAME } });
    console.log(`[fixIntegratedMTechAcademicGroup] Created department "${TARGET_DEPARTMENT_NAME}" (${targetDept.id}).`);
  }

  const conflictingTargetGroup = await prisma.academicGroup.findFirst({
    where: { instituteId: institute.id, departmentId: targetDept.id, section: { equals: SOURCE_SECTION, mode: "insensitive" }, batch: TARGET_BATCH },
  });

  if (!conflictingTargetGroup) {
    // No existing group at the target — simplest and safest path: relabel this exact row in
    // place. academicGroupId never changes, so every student's data stays exactly where it is.
    await prisma.academicGroup.update({
      where: { id: sourceGroup.id },
      data: { departmentId: targetDept.id, batch: TARGET_BATCH },
    });
    console.log(
      `[fixIntegratedMTechAcademicGroup] Relabeled group ${sourceGroup.id} in place: ` +
      `${SOURCE_DEPARTMENT_NAME} · ${SOURCE_SECTION} · ${SOURCE_BATCH} -> ${TARGET_DEPARTMENT_NAME} · ${SOURCE_SECTION} · ${TARGET_BATCH} ` +
      `(${studentCount} student(s), unaffected).`
    );
    return { applied: true, mode: "relabeled", studentCount };
  }

  // A target group already exists (e.g. other students already registered directly under
  // Integrated M.Tech) — move students into it instead of overwriting a distinct existing group,
  // then remove the now-empty source group.
  const { count: movedCount } = await prisma.user.updateMany({
    where: { academicGroupId: sourceGroup.id },
    data: { academicGroupId: conflictingTargetGroup.id },
  });
  await prisma.academicGroup.delete({ where: { id: sourceGroup.id } });
  console.log(
    `[fixIntegratedMTechAcademicGroup] Merged ${movedCount} student(s) from group ${sourceGroup.id} into existing ` +
    `target group ${conflictingTargetGroup.id} (${TARGET_DEPARTMENT_NAME} · ${SOURCE_SECTION} · ${TARGET_BATCH}); removed empty source group.`
  );
  return { applied: true, mode: "merged", studentCount: movedCount };
}

async function main() {
  const result = await fixIntegratedMTechAcademicGroup();
  console.log(`[fixIntegratedMTechAcademicGroup] Done.`, result);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fixIntegratedMTechAcademicGroup] failed:", err);
  process.exit(1);
});
