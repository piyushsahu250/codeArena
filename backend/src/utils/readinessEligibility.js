// Shared readiness-subject-eligibility logic, mirroring testEligibility.js's shape exactly.
//
// A subject is visible to a student if it has NO academic-group assignment at all (open to
// everyone — the platform's long-standing "empty assignment = unscoped" convention, see
// TestAcademicGroup/CourseAcademicGroupAssignment), OR the student's current academic group is
// one of the assigned groups AND (that assignment row's program is unset, or it case-insensitively
// matches the student's own free-text User.program).
//
// The "open to everyone" branch is bounded by ReadinessSubject.instituteId exactly the way
// testEligibilityWhere bounds it by Test.instituteId: a platform-wide subject (instituteId null)
// really is open to every student at every institute, but an institute-scoped subject with zero
// group assignments is only open within that SAME institute.

function readinessSubjectEligibilityWhere(academicGroupId, program, studentInstituteId) {
  return {
    OR: [
      {
        academicGroupAssignments: { none: {} },
        OR: studentInstituteId ? [{ instituteId: null }, { instituteId: studentInstituteId }] : [{ instituteId: null }],
      },
      ...(academicGroupId
        ? [{
            academicGroupAssignments: {
              some: {
                academicGroupId,
                OR: [{ program: null }, ...(program ? [{ program: { equals: program, mode: "insensitive" } }] : [])],
              },
            },
          }]
        : []),
    ],
  };
}

// For an already-loaded subject that includes `academicGroupAssignments: {select:{academicGroupId:true, program:true}}`
// and `instituteId` — synchronous, no extra query.
function isReadinessSubjectVisible(subject, academicGroupId, program, studentInstituteId) {
  const assignments = subject.academicGroupAssignments || [];
  if (assignments.length === 0) {
    return subject.instituteId == null || subject.instituteId === studentInstituteId;
  }
  if (!academicGroupId) return false;
  return assignments.some((a) => {
    if (a.academicGroupId !== academicGroupId) return false;
    if (!a.program) return true;
    return !!program && a.program.toLowerCase() === program.toLowerCase();
  });
}

// DB-authoritative check for call sites that only have the subject id, not a preloaded relation —
// used by POST /assessments, the actual enforcement point that starting an assessment is gated on.
async function studentCanAccessReadinessSubject(prisma, subjectId, academicGroupId, program, studentInstituteId) {
  const subject = await prisma.readinessSubject.findUnique({
    where: { id: subjectId },
    select: {
      instituteId: true,
      academicGroupAssignments: { select: { academicGroupId: true, program: true } },
    },
  });
  if (!subject) return false;
  return isReadinessSubjectVisible(subject, academicGroupId, program, studentInstituteId);
}

module.exports = { readinessSubjectEligibilityWhere, isReadinessSubjectVisible, studentCanAccessReadinessSubject };
