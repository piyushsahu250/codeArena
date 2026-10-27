// Live check (audit batch 17): a STAFF member who created a Question Bank folder can open it and see EVERY question filed in it, including questions an institute admin added, while still
// being unable to edit or delete the admin's questions, and nobody else gains access. REGRESSION: the folder count (_count.questions) counted every question in the folder, but the list
// route scoped a staff requester to questions they authored (plus legacy and explicitly shared folders), so an admin's question was counted and then missing when the owner opened the folder.
// Throwaway institutes, users, folders and questions; cleans up after itself. Needs the API on localhost:4000 (or VERIFY_API) and a database.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ FOV";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
let ipSeq = 0;
const nextIp = () => `203.0.113.${100 + ++ipSeq}`;
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-fov-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-fov-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-fov-" } }] } });
  await prisma.question.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { description: { startsWith: TAG } }] } });
  await prisma.questionFolder.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { name: { startsWith: TAG } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZVA" } });
    const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZVB" } });
    const pw = {};
    const mk = async (key, role, instituteId) => {
      pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
      return prisma.user.create({ data: { name: `ZZ FOV ${key}`, email: `zz-fov-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false } });
    };
    const U = { platform: await mk("platform", "ADMIN", null), adminA: await mk("adminA", "INSTITUTE_ADMIN", A.id), adminB: await mk("adminB", "INSTITUTE_ADMIN", B.id), staffA: await mk("staffA", "STAFF", A.id), staffA2: await mk("staffA2", "STAFF", A.id), staffB: await mk("staffB", "STAFF", B.id) };
    const T = {};
    for (const [k, u] of Object.entries(U)) T[k] = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
    check("test users could sign in", Object.values(T).every(Boolean));

    // Staff A creates a folder through the API (Test 1): the owner is recorded as Staff A.
    const made = await call("POST", "/questions/folders", T.staffA, { name: `${TAG} staff folder` });
    const folderId = made.json && made.json.id;
    check("Staff A creates a folder", made.status === 200 || made.status === 201, `status ${made.status}`);
    check("the folder's owner is Staff A", (await prisma.questionFolder.findUnique({ where: { id: folderId } })).createdById === U.staffA.id);
    const q = (n, createdById, extra = {}) => prisma.question.create({ data: { description: `${TAG} q ${n} ${ts}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById, folderId, ...extra } });

    // Staff A adds 2 questions (Test 2); the institute admin adds 3 (Test 3), one of them restricted by the lifecycle (Test 9 uses questionStatus below).
    const own = [await q(1, U.staffA.id), await q(2, U.staffA.id)];
    const added = [await q(3, U.adminA.id), await q(4, U.adminA.id), await q(5, U.adminA.id)];
    // Questions that must NEVER appear in this folder's list: another folder, another institute, and no folder at all.
    const otherFolder = await prisma.questionFolder.create({ data: { name: `${TAG} admin folder ${ts}`, instituteId: A.id, createdById: U.adminA.id } });
    const noise = [
      await prisma.question.create({ data: { description: `${TAG} q admin-folder ${ts}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: U.adminA.id, folderId: otherFolder.id } }),
      await prisma.question.create({ data: { description: `${TAG} q unfiled ${ts}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: U.adminA.id } }),
    ];
    const all = [...own, ...added].map((x) => x.id).sort();

    const list = (token, extra = "") => call("GET", `/questions?folderId=${folderId}&pageSize=100${extra}`, token);
    const ids = (r) => ((r.json && r.json.rows) || []).map((x) => x.id).sort();

    // ---- the reported bug
    const owner = await list(T.staffA);
    check("the owner sees all 5 questions (own and admin-added)", JSON.stringify(ids(owner)) === JSON.stringify(all), `got ${ids(owner).length}, total ${owner.json && owner.json.total}`);
    const folders = await call("GET", "/questions/folders", T.staffA);
    const mine = (folders.json || []).find((f) => f.id === folderId);
    check("the folder's count equals the owner's list", mine && mine._count.questions === (owner.json && owner.json.total), `count ${mine && mine._count.questions}, list ${owner.json && owner.json.total}`);
    check("no question of another folder or without a folder leaks into the list", !ids(owner).includes(noise[0].id) && !ids(owner).includes(noise[1].id));
    check("the admin-added questions did not change the folder's owner", (await prisma.questionFolder.findUnique({ where: { id: folderId } })).createdById === U.staffA.id);
    check("the admin-added questions keep their author", (await prisma.question.findUnique({ where: { id: added[0].id } })).createdById === U.adminA.id);

    // ---- the owner can open one, search and page through them
    const one = await call("GET", `/questions/${added[0].id}`, T.staffA);
    check("the owner can open an admin-added question", one.status === 200 && one.json && one.json.id === added[0].id, `status ${one.status}`);
    const search = await list(T.staffA, `&q=${encodeURIComponent(`q 4 ${ts}`)}`);
    check("search finds an admin-added question", ids(search).length === 1 && ids(search)[0] === added[1].id, `found ${ids(search).length}`);
    const paged = (n) => call("GET", `/questions?folderId=${folderId}&pageSize=2&page=${n}`, T.staffA);
    const page1 = await paged(1); const page3 = await paged(3);
    check("pagination totals include the admin-added questions", page1.json.total === 5 && page1.json.totalPages === 3 && ids(page3).length === 1, `total ${page1.json.total}, pages ${page1.json.totalPages}`);
    const filtered = await list(T.staffA, `&createdById=${U.adminA.id}`);
    check("the creator filter returns the admin's 3", ids(filtered).length === 3, `got ${ids(filtered).length}`);

    // ---- view only: no extra permission from owning the folder
    const edit = await call("PATCH", `/questions/${added[0].id}`, T.staffA, { description: `${TAG} edited by staff ${ts}` });
    check("the owner cannot edit an admin's question", edit.status === 404 || edit.status === 403, `status ${edit.status}`);
    const del = await call("DELETE", `/questions/${added[0].id}`, T.staffA);
    check("the owner cannot delete an admin's question", del.status === 404 || del.status === 403, `status ${del.status}`);
    const still = await prisma.question.findUnique({ where: { id: added[0].id } });
    check("the admin's question is unchanged", still && still.description === `${TAG} q 3 ${ts}`);
    const bulk = await call("POST", "/questions/bulk-delete", T.staffA, { questionIds: [added[1].id] });
    check("a bulk delete does not touch the admin's question", !!(await prisma.question.findUnique({ where: { id: added[1].id } })), `status ${bulk.status}`);
    const ownEdit = await call("PATCH", `/questions/${own[0].id}`, T.staffA, { description: `${TAG} q 1 ${ts}` });
    check("the owner can still edit their own question", ownEdit.status === 200, `status ${ownEdit.status}`);

    // ---- everyone else
    check("the institute admin sees all 5", JSON.stringify(ids(await list(T.adminA))) === JSON.stringify(all));
    check("the platform admin sees all 5", JSON.stringify(ids(await list(T.platform))) === JSON.stringify(all));
    check("another staff member of the same institute sees none of them", ids(await list(T.staffA2)).length === 0);
    check("another staff member cannot open one by id", (await call("GET", `/questions/${added[0].id}`, T.staffA2)).status === 404);
    check("an admin of another institute sees none of them", ids(await list(T.adminB)).length === 0);
    check("a staff member of another institute sees none of them", ids(await list(T.staffB)).length === 0);
    check("a staff member of another institute cannot open one by id", (await call("GET", `/questions/${added[0].id}`, T.staffB)).status === 404);
    check("an anonymous request is refused", (await call("GET", `/questions?folderId=${folderId}`, null)).status === 401);
    check("another staff member does not see the folder", !((await call("GET", "/questions/folders", T.staffA2)).json || []).some((f) => f.id === folderId));
    const forged = await call("GET", `/questions?folderId=${folderId}&createdById=${U.staffA.id}`, T.staffA2);
    check("a guessed folder id with a forged creator filter returns nothing to another staff member", ids(forged).length === 0);

    // ---- an admin's own folder keeps its policy: the staff member does not get it
    check("a staff member does not see questions of an admin-created folder", !ids(await call("GET", `/questions?folderId=${otherFolder.id}&pageSize=100`, T.staffA)).includes(noise[0].id));

    // ---- lifecycle: the existing status rules are unchanged (a question under review is still listed for its folder's owner like any other)
    await prisma.question.update({ where: { id: added[2].id }, data: { questionStatus: "DRAFT" } }).catch(() => {});
    const afterStatus = await list(T.staffA);
    check("the count and the list still agree after a status change", ((await call("GET", "/questions/folders", T.staffA)).json.find((f) => f.id === folderId)._count.questions) === afterStatus.json.total, `list ${afterStatus.json.total}`);
  } finally {
    await cleanup();
  }
  console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.log("SCRIPT CRASHED", e.stack || e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
