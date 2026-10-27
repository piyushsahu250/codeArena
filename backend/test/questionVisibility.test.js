// Question Bank visibility. REGRESSION (2026-10 audit): a staff member's folder showed N questions (the count ignores who may see them) but opened empty of the questions an institute admin
// had filed in it, because the list scoped staff to questions they authored. Folder ownership now grants VIEW of the questions inside it, and only view.
const test = require("node:test");
const assert = require("node:assert/strict");
const { questionVisibilityWhere, questionFolderVisibilityWhere, ownsQuestionRow, canViewQuestionRow } = require("../src/utils/questionVisibility");

const staff = (id, inst = "A") => ({ requesterInstituteId: inst, user: { id, role: "STAFF" } });
const admin = (inst = "A") => ({ requesterInstituteId: inst, user: { id: "adm", role: "INSTITUTE_ADMIN" } });
const platform = { requesterInstituteId: null, user: { id: "root", role: "ADMIN" } };
const adminQuestionInStaffFolder = { id: "q", instituteId: "A", createdById: "adm", folderId: "f", folder: { id: "f", createdById: "s1", shares: [] } };

test("a staff member's visibility includes questions filed in a folder they created, whoever wrote them", () => {
  const w = questionVisibilityWhere(staff("s1"));
  const branches = w.AND[1].OR;
  assert.ok(branches.some((b) => b.folder && b.folder.createdById === "s1"), JSON.stringify(branches));
  assert.ok(branches.some((b) => b.createdById === "s1"), "their own questions are still visible");
  assert.ok(branches.some((b) => b.createdById === null), "legacy questions are still visible");
  assert.ok(branches.some((b) => b.folder && b.folder.shares), "explicitly shared folders are still visible");
  assert.deepEqual(w.AND[0], { OR: [{ instituteId: "A" }, { instituteId: null }] }, "the institute boundary is untouched");
});

test("admins and the platform admin keep their scope; the folder list rule is unchanged", () => {
  assert.deepEqual(questionVisibilityWhere(admin()), { OR: [{ instituteId: "A" }, { instituteId: null }] });
  assert.deepEqual(questionVisibilityWhere(platform), {});
  assert.deepEqual(questionFolderVisibilityWhere(staff("s1")).AND[1].OR, [{ createdById: null }, { createdById: "s1" }, { shares: { some: { staffId: "s1" } } }]);
});

test("viewing: the folder owner may read an admin's question; others may not", () => {
  assert.equal(canViewQuestionRow(staff("s1"), adminQuestionInStaffFolder), true);
  assert.equal(canViewQuestionRow(staff("s2"), adminQuestionInStaffFolder), false, "another staff member of the same institute");
  assert.equal(canViewQuestionRow(staff("s1", "B"), adminQuestionInStaffFolder), false, "a staff member of another institute, even with the same user id");
  assert.equal(canViewQuestionRow(admin(), adminQuestionInStaffFolder), true);
  assert.equal(canViewQuestionRow(admin("B"), adminQuestionInStaffFolder), false);
  assert.equal(canViewQuestionRow(platform, adminQuestionInStaffFolder), true);
  assert.equal(canViewQuestionRow(staff("s1"), { ...adminQuestionInStaffFolder, folder: null, folderId: null }), false, "an admin's unfiled question stays private to the admin");
  assert.equal(canViewQuestionRow(staff("s1"), { ...adminQuestionInStaffFolder, folder: { id: "g", createdById: "adm", shares: [] } }), false, "a folder the staff member did not create gives nothing");
});

test("managing is unchanged: owning the folder does not allow editing or deleting an admin's question", () => {
  assert.equal(ownsQuestionRow(staff("s1"), adminQuestionInStaffFolder), false);
  assert.equal(ownsQuestionRow(staff("s1"), { ...adminQuestionInStaffFolder, createdById: "s1" }), true, "their own question");
  assert.equal(ownsQuestionRow(admin(), adminQuestionInStaffFolder), true);
});
