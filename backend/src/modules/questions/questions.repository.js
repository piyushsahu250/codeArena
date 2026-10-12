// All database access for the question bank's authoring side. No rules here: the services decide what is allowed.
const prisma = require("../../prisma");
const { questionVisibilityWhere } = require("../../utils/questionVisibility");

const WITH_SHARES = { folder: { include: { shares: { select: { staffId: true } } } } };

const findFolder = (id) => prisma.questionFolder.findUnique({ where: { id } });
const findFolderWithShares = (id) => prisma.questionFolder.findUnique({ where: { id }, include: { shares: { select: { staffId: true } } } });
const findQuestionForAccess = (id) => prisma.question.findUnique({ where: { id }, include: WITH_SHARES });
const findQuestionForDuplicate = (id) => prisma.question.findUnique({ where: { id }, include: { testCases: true } });
const findQuestionDetail = (id) => prisma.question.findUnique({ where: { id }, include: { testCases: true, ...WITH_SHARES } });
const testCasesOf = (questionId) => prisma.testCase.findMany({ where: { questionId } });

const findDuplicate = (req, { folderId, subjectId, unitId, description }) => prisma.question.findFirst({
  where: { ...questionVisibilityWhere(req), folderId: folderId || null, subjectId, unitId, description: { equals: description.trim(), mode: "insensitive" } },
});

const createQuestion = (data) => prisma.question.create({ data, include: { testCases: true } });
const updateQuestion = (id, data) => prisma.question.update({ where: { id }, data, include: { testCases: true } });
const deleteQuestion = (id) => prisma.question.delete({ where: { id } });

function listPage(where, page, pageSize) {
  return Promise.all([
    prisma.question.findMany({
      where,
      include: {
        _count: { select: { testCases: true } },
        createdBy: { select: { id: true, name: true } },
        subjectRef: { select: { id: true, name: true } },
        unitRef: { select: { id: true, name: true } },
        topicRef: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.question.count({ where }),
  ]);
}

// ---- the filter dropdowns ----
async function filterLists(visible, includeCreators) {
  const [subjects, topics, creatorIds] = await Promise.all([
    prisma.question.findMany({ where: { ...visible, subject: { not: null } }, select: { subject: true }, distinct: ["subject"] }),
    prisma.question.findMany({ where: { ...visible, topic: { not: null } }, select: { topic: true }, distinct: ["topic"] }),
    includeCreators
      ? prisma.question.findMany({ where: { ...visible, createdById: { not: null } }, select: { createdById: true }, distinct: ["createdById"] })
      : Promise.resolve([]),
  ]);
  const creators = creatorIds.length ? await prisma.user.findMany({ where: { id: { in: creatorIds.map((c) => c.createdById) } }, select: { id: true, name: true } }) : [];
  return { subjects, topics, creators };
}
const classificationCounts = (visible) => Promise.all([
  prisma.question.count({ where: { ...visible, OR: [{ subjectId: null }, { unitId: null }] } }),
  prisma.question.count({ where: { ...visible, subjectId: null } }),
]);

// ---- analytics ----
function analyticsTotals(where) {
  return Promise.all([
    prisma.question.groupBy({ by: ["questionStatus"], where, _count: true }),
    prisma.question.groupBy({ by: ["questionType"], where, _count: true }),
    prisma.question.groupBy({ by: ["difficulty"], where, _count: true }),
    prisma.question.count({ where }),
  ]);
}
// Bounded to the 3000 most recently created coding and SQL questions in scope, the same cap the other institute-wide analytics use, so a platform admin viewing a
// huge bank never triggers an unbounded Submission scan.
const analyticsQuestions = (where) => prisma.question.findMany({
  where: { ...where, questionType: { in: ["CODING", "SQL"] } },
  select: { id: true, title: true, description: true, subject: true, topic: true },
  take: 3000,
  orderBy: { createdAt: "desc" },
});
const submissionStats = (ids) => (ids.length > 0
  ? prisma.submission.groupBy({ by: ["questionId"], where: { questionId: { in: ids } }, _count: true, _avg: { score: true, timeMs: true }, _sum: { passedCases: true, totalCases: true } })
  : Promise.resolve([]));

// A hard delete must never destroy the record of a question a student has already been graded on. Prisma's FK-restrict covers tests, but Submission.questionId and
// ModuleCodingSubmission.questionId are plain columns with no enforced foreign key (a hard delete would silently orphan them) and ModuleCodingAttemptQuestion
// cascades (a hard delete would wipe what a graded attempt was assigned). This flags any question with such history so the caller refuses the delete and points at
// Review Status "Archived" instead.
async function questionIdsWithSubmissionHistory(questionIds) {
  if (!questionIds || questionIds.length === 0) return new Set();
  const [submissions, moduleCodingSubmissions, moduleCodingAttemptQuestions, dailyChallenges, weeklyChallenges] = await Promise.all([
    prisma.submission.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] }),
    prisma.moduleCodingSubmission.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] }),
    prisma.moduleCodingAttemptQuestion.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] }),
    prisma.dailyChallenge.findMany({ where: { questionId: { in: questionIds }, submissions: { some: {} } }, select: { questionId: true } }),
    prisma.weeklyChallenge.findMany({ where: { questionId: { in: questionIds }, submissions: { some: {} } }, select: { questionId: true } }),
  ]);
  const ids = new Set();
  for (const row of [...submissions, ...moduleCodingSubmissions, ...moduleCodingAttemptQuestions, ...dailyChallenges, ...weeklyChallenges]) ids.add(row.questionId);
  return ids;
}

module.exports = {
  findFolder, findFolderWithShares, findQuestionForAccess, findQuestionForDuplicate, findQuestionDetail, testCasesOf, findDuplicate, createQuestion, updateQuestion, deleteQuestion,
  listPage, filterLists, classificationCounts, analyticsTotals, analyticsQuestions, submissionStats, questionIdsWithSubmissionHistory,
};

// ================= folders and bulk operations =================
const { questionFolderVisibilityWhere } = require("../../utils/questionVisibility");

const listFolders = (req) => prisma.questionFolder.findMany({
  where: questionFolderVisibilityWhere(req),
  include: { _count: { select: { questions: true, children: true } } },
  orderBy: { name: "asc" },
});
const createFolder = (data) => prisma.questionFolder.create({ data });
const updateFolder = (id, data) => prisma.questionFolder.update({ where: { id }, data });
const deleteFolder = (id) => prisma.questionFolder.delete({ where: { id } });
const parentOfFolder = async (id) => (await prisma.questionFolder.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ?? null;
const childFolderIds = (parentIds) => prisma.questionFolder.findMany({ where: { parentId: { in: parentIds } }, select: { id: true } });
const foldersByIds = (ids) => prisma.questionFolder.findMany({ where: { id: { in: ids } } });
const foldersByParent = (parentId) => prisma.questionFolder.findMany({ where: { parentId } });
const foldersForSharing = (id, select) => prisma.questionFolder.findUnique({ where: { id }, select });

const questionsInFolders = (folderIds, { idsOnly = false } = {}) => prisma.question.findMany({
  where: { folderId: { in: folderIds } },
  ...(idsOnly ? { select: { id: true } } : {}),
  orderBy: { createdAt: "asc" },
});
const questionsInFolder = (folderId) => prisma.question.findMany({ where: { folderId }, orderBy: { createdAt: "asc" } });
const questionsByIds = (ids, { withTests = false } = {}) => prisma.question.findMany({ where: { id: { in: ids } }, ...(withTests ? { include: { testCases: true } } : {}) });
const testAttachedQuestionIds = (questionIds) => (questionIds.length > 0
  ? prisma.testQuestion.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] })
  : []);
const testCasesForQuestions = (ids) => prisma.testCase.findMany({ where: { questionId: { in: ids } } });
const moveQuestions = (ids, folderId) => prisma.question.updateMany({ where: { id: { in: ids } }, data: { folderId } });
const classifyQuestions = (ids, data) => prisma.question.updateMany({ where: { id: { in: ids } }, data });
const setQuestionStatus = (ids, questionStatus, updatedById) => prisma.question.updateMany({ where: { id: { in: ids } }, data: { questionStatus, updatedById } });
const copyQuestion = (data) => prisma.question.create({ data });
const mergeFolders = (sourceId, targetId) => prisma.$transaction([
  prisma.question.updateMany({ where: { folderId: sourceId }, data: { folderId: targetId } }),
  prisma.questionFolder.updateMany({ where: { parentId: sourceId }, data: { parentId: targetId } }),
  prisma.questionFolder.delete({ where: { id: sourceId } }),
]);

const listShares = (folderId) => prisma.questionFolderShare.findMany({ where: { folderId }, include: { staff: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
const staffInInstitute = (ids, instituteId) => prisma.user.findMany({ where: { id: { in: ids }, role: "STAFF", ...(instituteId ? { instituteId } : {}) }, select: { id: true } });
const createShares = (rows) => prisma.questionFolderShare.createMany({ data: rows, skipDuplicates: true });
const deleteShare = (folderId, staffId) => prisma.questionFolderShare.deleteMany({ where: { folderId, staffId } });

Object.assign(module.exports, {
  listFolders, createFolder, updateFolder, deleteFolder, parentOfFolder, childFolderIds, foldersByIds, foldersByParent, foldersForSharing,
  questionsInFolders, questionsInFolder, questionsByIds, testAttachedQuestionIds, testCasesForQuestions, moveQuestions, classifyQuestions, setQuestionStatus, copyQuestion, mergeFolders,
  listShares, staffInInstitute, createShares, deleteShare,
});
