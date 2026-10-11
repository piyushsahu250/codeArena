// All database access for test authoring and management. No rules here: the service decides what is allowed; this only reads and writes.
const prisma = require("../../prisma");
const { TEST_PUBLISH_VALIDATION_INCLUDE } = require("../../utils/testPublishValidation");

const FULL_INCLUDE = { questions: true, classes: true, academicGroups: true };
const SHARES = { shares: { select: { staffId: true } } };

const findWithShares = (id) => prisma.test.findUnique({ where: { id }, include: SHARES });
const findForDuplicate = (id) => prisma.test.findUnique({ where: { id }, include: { questions: true, classes: true, academicGroups: true, ...SHARES } });
const findForPublish = (id) => prisma.test.findUnique({ where: { id }, include: { ...SHARES, ...TEST_PUBLISH_VALIDATION_INCLUDE } });
const findForNotify = (id, select) => prisma.test.findUnique({ where: { id }, select: { id: true, title: true, instituteId: true, createdById: true, ...select, ...SHARES } });
const findOwnership = (id) => prisma.test.findUnique({ where: { id }, select: { id: true, createdById: true, instituteId: true } });
const findInstituteAndTitle = (id) => prisma.test.findUnique({ where: { id }, select: { instituteId: true, title: true } });
const findFull = (id) => prisma.test.findUnique({ where: { id }, include: FULL_INCLUDE });

const findSameTitle = (userId, subject, unit, title) => prisma.test.findFirst({
  where: {
    createdById: userId,
    subject: { equals: subject, mode: "insensitive" },
    unit: unit ? { equals: unit, mode: "insensitive" } : null,
    title: { equals: title, mode: "insensitive" },
  },
});

const instituteExists = (id) => prisma.institute.findUnique({ where: { id }, select: { id: true } });
const groupsByIds = (ids) => prisma.academicGroup.findMany({ where: { id: { in: ids } }, select: { id: true, instituteId: true } });
const bankCodingQuestionIds = (folderId) => prisma.question.findMany({ where: { folderId, questionType: "CODING" }, select: { id: true } });

const createTest = (data) => prisma.test.create({ data, include: FULL_INCLUDE });
const deleteTest = (id) => prisma.test.delete({ where: { id } });
const setPublished = (id, isPublished) => prisma.test.update({ where: { id }, data: { isPublished, scheduledPublishAt: null } });

// Edit: the test row plus (when sent) a full replacement of its questions and group assignments, in one transaction.
function updateTest(id, data, questionRows, groupIds) {
  return prisma.$transaction(async (tx) => {
    await tx.test.update({ where: { id }, data });
    if (questionRows) {
      await tx.testQuestion.deleteMany({ where: { testId: id } });
      await tx.testQuestion.createMany({ data: questionRows.map((q) => ({ ...q, testId: id })) });
    }
    if (groupIds) {
      await tx.testAcademicGroup.deleteMany({ where: { testId: id } });
      if (groupIds.length > 0) await tx.testAcademicGroup.createMany({ data: groupIds.map((academicGroupId) => ({ testId: id, academicGroupId })) });
    }
  });
}

async function groupCountsForStudents(studentIds) {
  if (studentIds.length === 0) return { counts: [], info: new Map() };
  const counts = await prisma.user.groupBy({ by: ["academicGroupId"], where: { id: { in: studentIds } }, _count: true });
  const groupIds = counts.map((g) => g.academicGroupId).filter(Boolean);
  const groups = groupIds.length > 0
    ? await prisma.academicGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, batch: true, section: true, department: { select: { name: true } }, institute: { select: { name: true } } } })
    : [];
  return { counts, info: new Map(groups.map((g) => [g.id, g])) };
}

const createNotificationSend = (data) => prisma.testNotificationSend.create({ data });
const findNotificationSendByKey = (idempotencyKey) => prisma.testNotificationSend.findUnique({ where: { idempotencyKey } });
const listNotificationSends = (testId) => prisma.testNotificationSend.findMany({ where: { testId }, orderBy: { createdAt: "desc" } });
const emailLogsForBatch = (batchId) => prisma.emailLog.findMany({ where: { batchId }, select: { status: true, recipientEmail: true, errorMessage: true } });

const listStaff = (excludeUserId, instituteId) => prisma.user.findMany({
  where: { role: "STAFF", id: { not: excludeUserId }, ...(instituteId ? { instituteId } : {}) },
  select: { id: true, name: true },
  orderBy: { name: "asc" },
});
const staffInScope = (ids, instituteId) => prisma.user.findMany({ where: { id: { in: ids }, role: "STAFF", ...(instituteId ? { instituteId } : {}) }, select: { id: true } });
const addShares = (rows) => prisma.testShare.createMany({ data: rows, skipDuplicates: true });
const removeShare = (testId, staffId) => prisma.testShare.deleteMany({ where: { testId, staffId } });

module.exports = {
  findWithShares, findForDuplicate, findForPublish, findForNotify, findOwnership, findInstituteAndTitle, findFull, findSameTitle, instituteExists, groupsByIds,
  bankCodingQuestionIds, createTest, deleteTest, setPublished, updateTest, groupCountsForStudents, createNotificationSend, findNotificationSendByKey,
  listNotificationSends, emailLogsForBatch, listStaff, staffInScope, addShares, removeShare,
};
