// Shared course-visibility logic, mirroring testEligibility.js's shape but INVERTED: a Course
// with zero assignment rows anywhere is invisible to students, not open-to-all (product decision
// — unlike Tests, a newly-created Course must be explicitly published+assigned before any
// student sees it). Only checks assignment rows — callers combine this with a
// `status: "PUBLISHED"` filter themselves, same as tests.js combines isTestVisibleToStudent with
// its own isPublished check rather than folding that concern into this shared helper.

function courseEligibilityWhere(instituteId, academicGroupId) {
  const or = [
    ...(instituteId ? [{ instituteAssignments: { some: { instituteId } } }] : []),
    ...(academicGroupId ? [{ academicGroupAssignments: { some: { academicGroupId } } }] : []),
  ];
  // A student with neither an instituteId nor an academicGroupId must see zero courses — an
  // empty OR array is Prisma-version-sensitive, so callers must check this case explicitly
  // (see isEligibilityUnresolvable) rather than passing an empty `where` through.
  return { OR: or.length ? or : [{ id: "__none__" }] };
}

// True when neither id is available — callers should short-circuit to an empty result/404
// instead of relying on courseEligibilityWhere's fallback clause.
function isEligibilityUnresolvable(instituteId, academicGroupId) {
  return !instituteId && !academicGroupId;
}

// For an already-loaded course that includes `instituteAssignments: {select:{instituteId:true}}`
// and `academicGroupAssignments: {select:{academicGroupId:true}}` — synchronous, no extra query.
function isCourseVisibleToStudent(course, instituteId, academicGroupId) {
  const instituteGrants = course.instituteAssignments || [];
  const groupGrants = course.academicGroupAssignments || [];
  if (instituteId && instituteGrants.some((g) => g.instituteId === instituteId)) return true;
  if (academicGroupId && groupGrants.some((g) => g.academicGroupId === academicGroupId)) return true;
  return false;
}

// DB-authoritative check for call sites that only have the IDs, not a preloaded relation.
async function studentCanAccessCourse(prisma, courseId, instituteId, academicGroupId) {
  if (isEligibilityUnresolvable(instituteId, academicGroupId)) return false;
  if (instituteId) {
    const match = await prisma.courseInstituteAssignment.findUnique({
      where: { courseId_instituteId: { courseId, instituteId } },
    });
    if (match) return true;
  }
  if (academicGroupId) {
    const match = await prisma.courseAcademicGroupAssignment.findUnique({
      where: { courseId_academicGroupId: { courseId, academicGroupId } },
    });
    if (match) return true;
  }
  return false;
}

module.exports = { courseEligibilityWhere, isEligibilityUnresolvable, isCourseVisibleToStudent, studentCanAccessCourse };
