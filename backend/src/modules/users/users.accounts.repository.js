// All database access for creating, editing, deleting and resetting accounts. No rules here: the services decide what is allowed.
const prisma = require("../../prisma");
const cache = require("../../utils/cache");
const { SELECT_FIELDS } = require("./users.domain");

const findUser = (id) => prisma.user.findUnique({ where: { id } });
const findUserByEmail = (email) => prisma.user.findUnique({ where: { email } });
const findUserNameById = (id) => prisma.user.findUnique({ where: { id }, select: { name: true } });
const findInstitute = (id) => prisma.institute.findUnique({ where: { id } });
const listInstitutes = () => prisma.institute.findMany();
const findByRegistrationNumber = (registrationNumber, exceptId) => prisma.user.findFirst({ where: { registrationNumber, ...(exceptId ? { id: { not: exceptId } } : {}) } });
const findByEmployeeId = (instituteId, employeeId, exceptId) => prisma.user.findFirst({ where: { instituteId, employeeId, ...(exceptId ? { id: { not: exceptId } } : {}) } });

// Institute -> Batch -> Department -> Section: find or create the academic group a student belongs to. Blank department and section fall back to
// "Unassigned" / "Section A", matched case-insensitively so trivial spelling differences do not fragment groups. `groupCache` is an optional per-request Map that
// saves repeated lookups when a bulk upload has many rows in the same group.
async function resolveAcademicGroup({ instituteId, batchYear, departmentName, section }, groupCache) {
  // Whitespace around the batch's dash ("2026 - 2031" vs "2026-2031") used to split one cohort into two groups (confirmed live 2026-09-23 for Sanjivani
  // University's Integrated M.Tech batches; see scripts/fixSanjivaniBatches.js). Only that whitespace is collapsed: genuinely different strings for the same
  // intended batch (a bare "2030" vs "2025-2030") cannot be reconciled safely for every institute's naming, so those still need a human decision.
  const batch = String(batchYear || "").trim().replace(/\s*-\s*/g, "-") || "Unassigned";
  const deptName = String(departmentName || "").trim() || "Unassigned";
  const sectionName = String(section || "").trim() || "Section A";
  const key = `${instituteId}::${batch.toLowerCase()}::${deptName.toLowerCase()}::${sectionName.toLowerCase()}`;
  if (groupCache && groupCache.has(key)) return groupCache.get(key);

  // findFirst stays case-insensitive so an existing "Computer Applications" is reused rather than duplicated in another case. Find-then-create alone leaves a race
  // (two concurrent requests for a brand-new department both create and the second hits the unique constraint), so creation is an upsert that turns the second
  // racer's create into a no-op update.
  let department = await prisma.department.findFirst({ where: { instituteId, name: { equals: deptName, mode: "insensitive" } } });
  if (!department) {
    department = await prisma.department.upsert({ where: { instituteId_name: { instituteId, name: deptName } }, update: {}, create: { instituteId, name: deptName } });
  }

  let group = await prisma.academicGroup.findFirst({
    where: { instituteId, batch, departmentId: department.id, section: { equals: sectionName, mode: "insensitive" } },
    include: { department: true },
  });
  if (!group) {
    group = await prisma.academicGroup.upsert({
      where: { instituteId_batch_departmentId_section: { instituteId, batch, departmentId: department.id, section: sectionName } },
      update: {},
      create: { instituteId, batch, departmentId: department.id, section: sectionName },
      include: { department: true },
    });
    // GET /academic-groups otherwise keeps serving a list without this brand-new group for up to its own 2-minute TTL.
    cache.invalidate("academic-groups:");
  }
  if (groupCache) groupCache.set(key, group);
  return group;
}

// ---- create / edit inside the roll-number advisory lock (`tx` is the locked transaction) ----
const createUserTx = (tx, data) => tx.user.create({ data, select: SELECT_FIELDS });
const updateUserTx = (tx, id, data) => tx.user.update({ where: { id }, data, select: SELECT_FIELDS });
const createAuditTx = (tx, data) => tx.auditLog.create({ data });
const createBulkStudentTx = (tx, data) => tx.user.create({ data });

// ---- bulk upload context: scoped to the emails and PRNs present in the rows, never every user on the platform ----
function findExistingForBulk(emails, regNumbers) {
  if (!emails.length && !regNumbers.length) return [];
  return prisma.user.findMany({
    where: { OR: [...(emails.length ? [{ email: { in: emails, mode: "insensitive" } }] : []), ...(regNumbers.length ? [{ registrationNumber: { in: regNumbers, mode: "insensitive" } }] : [])] },
    select: { email: true, registrationNumber: true },
  });
}

// ---- passwords ----
// The hash write and the passwordChangedAt/PasswordHistory write succeed or fail together.
function replacePassword(userId, passwordHash, recordChange) {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } });
    await recordChange(tx);
  });
}
const findUsersByIds = (ids, instituteId) => prisma.user.findMany({ where: { id: { in: ids }, ...(instituteId ? { instituteId } : {}) } });
const createAudit = (data) => prisma.auditLog.create({ data });

// ---- status ----
const findStudentsForStatus = (ids, instituteId) => prisma.user.findMany({
  where: { id: { in: ids }, role: "STUDENT", ...(instituteId ? { instituteId } : {}) },
  select: { id: true, name: true, isActive: true, instituteId: true },
});
const setActiveWithAudit = (id, isActive, auditData) => prisma.$transaction([prisma.user.update({ where: { id }, data: { isActive } }), prisma.auditLog.create({ data: auditData })]);

// ---- delete ----
const countTestsCreated = (userId) => prisma.test.count({ where: { createdById: userId } });
const countLecturePlans = (userId) => prisma.lecturePlan.count({ where: { createdById: userId } });
const countAttendanceSessionsMarked = (userId) => prisma.attendanceSession.count({ where: { markedById: userId } });
async function studentRecordCounts(studentId) {
  const [certificates, interviewCertificates, attempts, attendanceRecords, results] = await Promise.all([
    prisma.certificate.count({ where: { studentId } }),
    prisma.interviewCertificate.count({ where: { studentId } }),
    prisma.testAttempt.count({ where: { studentId } }),
    prisma.attendanceRecord.count({ where: { studentId } }),
    prisma.resultEntry.count({ where: { studentId } }),
  ]);
  return { certificates, interviewCertificates, attempts, attendanceRecords, results };
}
const deleteUser = (id) => prisma.user.delete({ where: { id } });

module.exports = {
  findUser, findUserByEmail, findUserNameById, findInstitute, listInstitutes, findByRegistrationNumber, findByEmployeeId, resolveAcademicGroup,
  createUserTx, updateUserTx, createAuditTx, createBulkStudentTx, findExistingForBulk, replacePassword, findUsersByIds, createAudit, findStudentsForStatus, setActiveWithAudit,
  countTestsCreated, countLecturePlans, countAttendanceSessionsMarked, studentRecordCounts, deleteUser,
};
