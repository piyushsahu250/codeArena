// All database access for the user directory, a user's own account and sessions, and the audit views. No rules here: the services decide what is allowed.
const prisma = require("../../prisma");
const { SELECT_FIELDS } = require("./users.domain");

// ---- own account and sessions ----
const findUser = (id) => prisma.user.findUnique({ where: { id } });
const findUserByEmail = (email) => prisma.user.findUnique({ where: { email } });
const findInstitute = (id) => prisma.institute.findUnique({ where: { id } });
const selectUser = (id) => prisma.user.findUnique({ where: { id }, select: SELECT_FIELDS });
const updateUser = (id, data) => prisma.user.update({ where: { id }, data, select: SELECT_FIELDS });
const setPendingEmailToken = (id, tokenHash, expiry) => prisma.user.update({ where: { id }, data: { pendingEmailTokenHash: tokenHash, pendingEmailTokenExpiry: expiry } });

// The new hash and its history/expiry stamp succeed or fail together.
function changePassword(id, data, recordChange) {
  let updated;
  return prisma.$transaction(async (tx) => {
    updated = await tx.user.update({ where: { id }, data, select: SELECT_FIELDS });
    await recordChange(tx);
  }).then(() => updated);
}

const listSessions = (userId) => prisma.loginSession.findMany({
  where: { userId },
  orderBy: { loginAt: "desc" },
  take: 50,
  select: { id: true, ip: true, device: true, browser: true, os: true, isActive: true, loginAt: true, logoutAt: true, token: true },
});
const findSession = (id) => prisma.loginSession.findUnique({ where: { id } });
const endSession = (id) => prisma.loginSession.update({ where: { id }, data: { isActive: false, logoutAt: new Date() } });

// ---- directory ----
function listUsers(where, page, pageSize) {
  return Promise.all([
    prisma.user.findMany({ where, select: SELECT_FIELDS, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);
}

const lookupStudent = (where) => prisma.user.findFirst({
  where,
  select: {
    id: true, name: true, email: true, rollNumber: true, registrationNumber: true,
    attempts: {
      select: { status: true, totalScore: true, startedAt: true, submittedAt: true, tabSwitchCount: true, test: { select: { id: true, title: true, isPublished: true } } },
      orderBy: { startedAt: "desc" },
    },
  },
});

function searchUsers(where, page, pageSize) {
  return Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, rollNumber: true, registrationNumber: true,
        employeeId: true, mobile: true, isActive: true, accountStatus: true,
        institute: { select: { name: true } },
        class: { select: { name: true, batchYear: true } },
        academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);
}

const groupIdsFor = (instituteId, departmentId, section, batch) => prisma.academicGroup.findMany({
  where: { instituteId, departmentId, section, ...(batch ? { batch } : {}) },
  select: { id: true },
});
const matchingStudents = (where) => prisma.user.findMany({ where, select: { id: true, name: true, rollNumber: true } });
const hydrateStudents = (ids) => prisma.user.findMany({
  where: { id: { in: ids } },
  select: {
    id: true, name: true, email: true, rollNumber: true, registrationNumber: true, isActive: true,
    institute: { select: { name: true } },
    class: { select: { name: true, batchYear: true } },
    academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
  },
});
const groupsWithInstitute = (ids) => prisma.academicGroup.findMany({
  where: { id: { in: ids } },
  select: { id: true, batch: true, section: true, institute: { select: { id: true, name: true } }, department: { select: { name: true } } },
});

// ---- audit trail ----
const passwordResetLogs = (instituteId) => prisma.auditLog.findMany({ where: { action: "PASSWORD_RESET", ...(instituteId ? { instituteId } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
const auditLogsForExport = (where) => prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000 });
const auditLogPage = (where, page, pageSize) => Promise.all([
  prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  prisma.auditLog.count({ where }),
]);
const distinctAuditActions = (instituteId) => prisma.auditLog.findMany({ where: instituteId ? { instituteId } : {}, select: { action: true }, distinct: ["action"] });

// ---- academic-group migration counters (cheap aggregate counts, kept permanently) ----
async function migrationCounts() {
  const [classesTotal, academicGroupsTotal, studentsWithClassId, studentsWithGroupId, studentsUnlinked] = await Promise.all([
    prisma.class.count(),
    prisma.academicGroup.count(),
    prisma.user.count({ where: { role: "STUDENT", classId: { not: null } } }),
    prisma.user.count({ where: { role: "STUDENT", academicGroupId: { not: null } } }),
    prisma.user.count({ where: { role: "STUDENT", classId: { not: null }, academicGroupId: null } }),
  ]);
  return { classesTotal, academicGroupsTotal, studentsWithClassId, studentsWithGroupId, studentsUnlinked };
}

// ---- performance access ----
const findStudentTarget = (id) => prisma.user.findUnique({ where: { id }, select: { id: true, role: true, instituteId: true } });
const findInstituteOf = (id) => prisma.user.findUnique({ where: { id }, select: { instituteId: true } });

module.exports = {
  findUser, findUserByEmail, findInstitute, selectUser, updateUser, setPendingEmailToken, changePassword, listSessions, findSession, endSession,
  listUsers, lookupStudent, searchUsers, groupIdsFor, matchingStudents, hydrateStudents, groupsWithInstitute,
  passwordResetLogs, auditLogsForExport, auditLogPage, distinctAuditActions, migrationCounts, findStudentTarget, findInstituteOf,
};
