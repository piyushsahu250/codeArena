const prisma = require("../prisma");

// Called after any write that can reduce a group's membership to zero (a student's batch/
// department/section/institute edited, or a student deleted) — see users.js's PATCH /:id and
// DELETE /:id. Never called on a group a human is actively trying to populate, so there's no risk
// of racing a legitimate concurrent enrollment: the only way membership reaches zero is that the
// last remaining student was just moved or removed, which is exactly what should trigger cleanup.
//
// Departments are just as auto-derived as groups (see resolveAcademicGroup() in users.js) — a
// Department with no groups left under it is exactly as stale as a group with no students left in
// it, so removing the group's last-standing empty parent here (rather than leaving it to linger
// forever with no route that ever revisits it) keeps the admin's Departments list free of phantom
// entries nobody actually created.
async function deleteAcademicGroupIfEmpty(academicGroupId) {
  if (!academicGroupId) return false;
  const remaining = await prisma.user.count({ where: { academicGroupId } });
  if (remaining > 0) return false;
  let departmentId;
  try {
    const deleted = await prisma.academicGroup.delete({ where: { id: academicGroupId } });
    departmentId = deleted.departmentId;
  } catch (err) {
    // Already gone (e.g. a concurrent request got there first) — not an error worth surfacing.
    if (err.code === "P2025") return false;
    throw err;
  }
  await deleteDepartmentIfEmpty(departmentId);
  return true;
}

// Best-effort, non-fatal companion to the above: a Department left with zero AcademicGroups is a
// dangling row with nothing pointing to it, so it's removed the same way. Failure here (e.g. a
// concurrent request repopulated it, or already deleted it) must never fail the caller's request.
async function deleteDepartmentIfEmpty(departmentId) {
  if (!departmentId) return false;
  try {
    const remainingGroups = await prisma.academicGroup.count({ where: { departmentId } });
    if (remainingGroups > 0) return false;
    await prisma.department.delete({ where: { id: departmentId } });
    return true;
  } catch (err) {
    if (err.code === "P2025") return false;
    console.error("Failed to auto-delete empty department:", err);
    return false;
  }
}

module.exports = { deleteAcademicGroupIfEmpty, deleteDepartmentIfEmpty };
