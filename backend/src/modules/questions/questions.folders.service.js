// Question-bank folders: list, create, rename and move, delete preview, recursive delete, sharing, merge and clear. No req/res: the controller passes an `actor`
// { req, user, requesterInstituteId }; `req` is used where the shared visibility helpers and the audit entry need it. Folders nest through parentId
// ("Fox Solutions" > "Aptitude" > "Percentages"); the frontend builds the tree from the flat list.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/question-folders-contract.json).
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { ownsQuestionRow } = require("../../utils/questionVisibility");
const d = require("./questions.domain");
const repo = require("./questions.repository");

async function requireFolder(actor, id, notFound, refused, load = repo.findFolderWithShares) {
  const folder = await load(id);
  if (!folder) throw new ServiceError(404, notFound);
  if (!ownsQuestionRow(actor.req, folder)) throw new ServiceError(403, refused);
  return folder;
}
const asOwnFolder = (actor, id) => requireFolder(actor, id, "Folder not found", "Not your institute's folder");
const PARENT_REFUSED = "That parent folder isn't in your institute's question bank";

const listFolders = (actor) => repo.listFolders(actor.req);

async function createFolder(actor, body) {
  const name = String(body.name || "").trim();
  if (!name) throw new ServiceError(400, "Folder name is required");
  const { category, description, parentId } = body;
  if (parentId) {
    const parent = await repo.findFolder(parentId);
    if (!parent || !ownsQuestionRow(actor.req, parent)) throw new ServiceError(403, PARENT_REFUSED);
  }
  return repo.createFolder({ name, category: category || null, description: description || null, parentId: parentId || null, instituteId: actor.requesterInstituteId, createdById: actor.user.id });
}

async function editFolder(actor, id, body) {
  const folder = await asOwnFolder(actor, id);
  const data = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new ServiceError(400, "Folder name is required");
    data.name = name;
  }
  if (body.category !== undefined) data.category = body.category || null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.parentId !== undefined) {
    if (body.parentId === folder.id) throw new ServiceError(400, "A folder can't be its own parent");
    // Declared change: the new parent was stored without any check, so a folder could be moved under another institute's folder, or under one of its own
    // sub-banks. The second makes a loop, which the recursive delete and the delete preview then walk forever.
    if (body.parentId) {
      const parent = await repo.findFolder(body.parentId);
      if (!parent || !ownsQuestionRow(actor.req, parent)) throw new ServiceError(403, PARENT_REFUSED);
      if (await d.wouldCreateFolderLoop(folder.id, body.parentId, repo.parentOfFolder)) throw new ServiceError(400, "A folder can't be moved inside itself or one of its own sub-banks");
    }
    data.parentId = body.parentId || null;
  }
  return repo.updateFolder(folder.id, data);
}

// BFS-orders a folder's full descendant tree, root first, used by both the delete preview and the recursive delete so their notion of "everything inside" matches.
async function collectDescendantFolders(rootId) {
  const order = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const childIds = (await repo.childFolderIds(frontier)).map((c) => c.id);
    if (childIds.length === 0) break;
    order.push(...childIds);
    frontier = childIds;
  }
  return order;
}

// The exact counts the confirmation dialog needs: how many questions and sub-banks exist, and how many of those questions cannot be deleted because a test uses
// them or they carry real student history.
async function deletePreview(actor, id) {
  const folder = await asOwnFolder(actor, id);
  const folderIds = await collectDescendantFolders(folder.id);
  const questions = await repo.questionsInFolders(folderIds, { idsOnly: true });
  const questionIds = questions.map((q) => q.id);
  const [testBlocked, historyBlockedIds] = await Promise.all([repo.testAttachedQuestionIds(questionIds), repo.questionIdsWithSubmissionHistory(questionIds)]);
  const blockedIds = new Set([...testBlocked.map((b) => b.questionId), ...historyBlockedIds]);
  return { questionCount: questions.length, subBankCount: folderIds.length - 1, blockedCount: blockedIds.size };
}

// Recursively deletes every question in the folder's sub-tree (skipping any a test uses or that carry student history), then the folders themselves bottom-up. A
// folder is only removed once it has no remaining question and no remaining child folder, so a branch holding a protected question survives with every ancestor
// (QuestionFolder.parent cascades at the database level, which this per-row approach deliberately never triggers on a folder that still holds real content).
async function deleteFolderTree(actor, id) {
  const folder = await asOwnFolder(actor, id);
  const folderIds = await collectDescendantFolders(folder.id); // root first, deepest last
  const questions = await repo.questionsInFolders(folderIds);
  const withHistory = await repo.questionIdsWithSubmissionHistory(questions.map((q) => q.id));

  let deletedQuestionCount = 0;
  const remainingByFolder = new Map();
  const keep = (q) => remainingByFolder.set(q.folderId, (remainingByFolder.get(q.folderId) || 0) + 1);
  for (const q of questions) {
    // A STAFF requester's recursive delete never touches another staff member's private questions, and a question with student history is never hard-deleted
    // just because it sat inside a folder someone deleted: both are skipped and counted.
    if (!ownsQuestionRow(actor.req, q) || withHistory.has(q.id)) { keep(q); continue; }
    try {
      await repo.deleteQuestion(q.id);
      deletedQuestionCount++;
    } catch (err) {
      // Declared change: a question a test uses is restricted by the database, which Prisma reports with no error code, so the check for it never matched and
      // the whole delete failed with a 500 after deleting only some questions. It is now skipped and counted, as intended.
      if (d.isReferencedByRestrict(err)) keep(q);
      else throw err;
    }
  }

  const folderRows = await repo.foldersByIds(folderIds);
  const folderById = new Map(folderRows.map((f) => [f.id, f]));
  const parentOf = new Map(folderRows.map((f) => [f.id, f.parentId]));
  const hasRemainingChild = new Map();
  let deletedFolderCount = 0;
  // Reversed order = deepest first, so a folder's children are resolved before the folder is considered.
  for (const folderId of [...folderIds].reverse()) {
    // A sub-folder another staff member created, nested under a shared parent the requester can delete, stays even if now empty.
    const notOwned = !ownsQuestionRow(actor.req, folderById.get(folderId));
    const deletable = !notOwned && !(remainingByFolder.get(folderId) > 0) && !hasRemainingChild.get(folderId);
    if (deletable) {
      await repo.deleteFolder(folderId);
      deletedFolderCount++;
    } else {
      const parentId = parentOf.get(folderId);
      if (parentId) hasRemainingChild.set(parentId, true);
    }
  }

  if (deletedQuestionCount > 0) {
    await logAudit({
      req: actor.req, action: AUDIT_ACTIONS.QUESTION_DELETED, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role,
      instituteId: actor.requesterInstituteId, details: { bulk: true, count: deletedQuestionCount, folderId: folder.id },
    });
  }
  return { deletedFolderCount, deletedQuestionCount, skippedQuestionCount: questions.length - deletedQuestionCount, fullyDeleted: deletedFolderCount === folderIds.length };
}

// Deletes every DIRECT question of the folder (not sub-banks, matching the folder detail view, whose list and Select All only ever show direct children); the
// folder itself stays.
async function clearFolder(actor, id) {
  const folder = await repo.findFolder(id);
  if (!folder || !ownsQuestionRow(actor.req, folder)) throw new ServiceError(404, "Question bank not found");

  const questions = await repo.questionsInFolder(folder.id);
  const withHistory = await repo.questionIdsWithSubmissionHistory(questions.map((q) => q.id));
  const blocked = [];
  let clearedCount = 0;
  for (const q of questions) {
    if (!ownsQuestionRow(actor.req, q)) continue;
    if (withHistory.has(q.id)) { blocked.push(d.blockedEntry(q, d.BLOCKED_BY_HISTORY)); continue; }
    try {
      await repo.deleteQuestion(q.id);
      clearedCount++;
    } catch (err) {
      if (d.isReferencedByRestrict(err)) blocked.push(d.blockedEntry(q, d.BLOCKED_BY_TEST));
      else throw err;
    }
  }
  return { clearedCount, skippedCount: questions.length - clearedCount - blocked.length, blocked };
}

// ---------------------------------------------------------------- sharing
// Grants named STAFF accounts full view and manage access to a folder (and every question filed in it) without opening it to the whole institute. Only the
// folder's creator or an admin may grant or revoke; this mirrors the test-sharing routes.
async function loadForSharing(actor, id, select, staffMessage) {
  const folder = await repo.foldersForSharing(id, select);
  if (!folder) throw new ServiceError(404, "Question bank not found");
  const refusal = d.sharingRefusal(actor, folder, staffMessage);
  if (refusal) throw new ServiceError(403, refusal);
  return folder;
}

async function listShares(actor, id) {
  const folder = await loadForSharing(actor, id, { id: true, createdById: true, instituteId: true }, "Only the question bank's creator can view its sharing");
  return repo.listShares(folder.id);
}

async function shareFolder(actor, id, body) {
  const { staffIds = [] } = body;
  const folder = await loadForSharing(actor, id, { id: true, name: true, createdById: true, instituteId: true }, "Only the question bank's creator can share it");
  if (staffIds.length > 0) {
    // The client's ids are never trusted as they are: every target must be a real STAFF account in the requester's own institute.
    const staffRows = await repo.staffInInstitute(staffIds, actor.requesterInstituteId);
    if (staffRows.length !== staffIds.length) throw new ServiceError(400, "One or more selected staff members are not valid for this institute");
    await repo.createShares(staffIds.map((staffId) => ({ folderId: folder.id, staffId, sharedByUserId: actor.user.id, sharedByName: actor.user.name })));
    await logAudit({
      req: actor.req, action: AUDIT_ACTIONS.QUESTION_BANK_SHARED, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role,
      instituteId: folder.instituteId, details: { folderId: folder.id, folderName: folder.name, sharedWithCount: staffIds.length },
    });
  }
  return { success: true };
}

async function revokeShare(actor, id, staffId) {
  const folder = await loadForSharing(actor, id, { id: true, name: true, createdById: true, instituteId: true }, "Only the question bank's creator can revoke sharing");
  await repo.deleteShare(folder.id, staffId);
  return { success: true };
}

// ---------------------------------------------------------------- merge
// Reassigns all of the source's questions and direct child folders to the target, then deletes the source: for consolidating near-duplicate banks.
async function mergeFolder(actor, sourceId, targetId) {
  if (!targetId || targetId === sourceId) throw new ServiceError(400, "Choose a different target folder to merge into");
  const [source, target] = await Promise.all([repo.findFolder(sourceId), repo.findFolder(targetId)]);
  if (!source || !target) throw new ServiceError(404, "Folder not found");
  if (!ownsQuestionRow(actor.req, source) || !ownsQuestionRow(actor.req, target)) throw new ServiceError(403, "Not your institute's folder");
  // The source is deleted afterwards, so a partial merge is impossible: anything left out would be dumped into Uncategorized or lose its organisation without its
  // owner's consent. The whole operation is blocked instead when the source is not entirely the requester's own (plus legacy and shared) content.
  const [questions, childFolders] = await Promise.all([repo.questionsInFolder(sourceId), repo.foldersByParent(sourceId)]);
  if (questions.some((q) => !ownsQuestionRow(actor.req, q)) || childFolders.some((f) => !ownsQuestionRow(actor.req, f))) {
    throw new ServiceError(403, "This question bank contains another staff member's questions or sub-banks and can't be merged");
  }
  await repo.mergeFolders(sourceId, targetId);
  return { success: true };
}

module.exports = { listFolders, createFolder, editFolder, deletePreview, deleteFolderTree, clearFolder, listShares, shareFolder, revokeShare, mergeFolder };
