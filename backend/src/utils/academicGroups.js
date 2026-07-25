const prisma = require("../prisma");

// Called after any write that can reduce a group's membership to zero (a student's batch/
// department/section/institute edited, or a student deleted) — see users.js's PATCH /:id and
// DELETE /:id. Never called on a group a human is actively trying to populate, so there's no risk
// of racing a legitimate concurrent enrollment: the only way membership reaches zero is that the
// last remaining student was just moved or removed, which is exactly what should trigger cleanup.
async function deleteAcademicGroupIfEmpty(academicGroupId) {
  if (!academicGroupId) return false;
  const remaining = await prisma.user.count({ where: { academicGroupId } });
  if (remaining > 0) return false;
  try {
    await prisma.academicGroup.delete({ where: { id: academicGroupId } });
    return true;
  } catch (err) {
    // Already gone (e.g. a concurrent request got there first) — not an error worth surfacing.
    if (err.code === "P2025") return false;
    throw err;
  }
}

module.exports = { deleteAcademicGroupIfEmpty };
