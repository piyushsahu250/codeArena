// Real-HTTP verification for the Daily Challenge Remove flow — same fix, same code path as
// Weekly (see verifyWeeklyChallengeRemove.js), verified independently end-to-end per explicit
// request rather than assumed identical. Cleans up every row it creates by exact ID.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

const API_BASE = process.env.HEALTH_CHECK_API_BASE || "http://127.0.0.1:4000/api";
let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [PASS] ${label}`); pass++; }
  else { console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ""}`); fail++; }
}

async function mkUser(role, instituteId) {
  const email = `dcremove-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: `DC Check ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function j(res) { try { return await res.json(); } catch { return null; } }

// Dates far in the past so they never collide with "today" (what student-facing routes key off).
function daysAgo(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) { console.log("Need 2 institutes"); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name}\nInstitute B: ${instB.name}\n`);

  const cleanup = [];
  const questionIds = [];
  const dcIds = [];
  try {
    const superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    const staffA = await mkUser("STAFF", instA.id);
    const studentA = await mkUser("STUDENT", instA.id);
    cleanup.push(adminA, adminB, staffA, studentA);

    let superAdminHeaders = null;
    if (superAdmin) {
      const token = await createSession({ user: superAdmin, req: { headers: {} }, singleSessionOnly: false });
      const jti = jwt.decode(token).jti;
      superAdminHeaders = { "content-type": "application/json", Authorization: `Bearer ${token}` };
      cleanup.push({ user: superAdmin, jti, headers: superAdminHeaders, skipDelete: true });
    }

    const question = await prisma.question.create({
      data: {
        title: "DC Remove Check Question", description: "Return the product of two integers.",
        questionType: "CODING", difficulty: "EASY", points: 10,
        testCases: { create: [{ input: "2 3", expected: "6", isHidden: false }] },
      },
    });
    questionIds.push(question.id);

    // ---- 1. Create Daily Challenge (Institute Admin A) ----
    console.log("=== Create Daily Challenge (Institute Admin A) ===");
    const day1 = daysAgo(60);
    const createRes = await fetch(`${API_BASE}/challenges/admin/daily`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({ date: day1.toISOString(), questionId: question.id }),
    });
    const dc1 = await j(createRes);
    check("Daily Challenge created (200)", createRes.status === 200, `got ${createRes.status}: ${JSON.stringify(dc1)}`);
    dcIds.push(dc1.id);
    check("Created under Institute A", dc1.instituteId === instA.id, `instituteId=${dc1.instituteId}`);
    check("Appears in Institute A's admin list", (await j(await fetch(`${API_BASE}/challenges/admin/daily?pageSize=100`, { headers: adminA.headers }))).rows.some((r) => r.id === dc1.id));

    // ---- 2. Edit it (PATCH questionId) ----
    console.log("\n=== Edit Daily Challenge ===");
    const question2 = await prisma.question.create({
      data: { title: "DC Remove Check Question 2", description: "Return the max of two integers.", questionType: "CODING", difficulty: "EASY", points: 10, testCases: { create: [{ input: "2 3", expected: "3", isHidden: false }] } },
    });
    questionIds.push(question2.id);
    const editRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ questionId: question2.id }) });
    check("Edit accepted (200)", editRes.status === 200, `got ${editRes.status}`);
    const afterEdit = await j(editRes);
    check("questionId actually updated", afterEdit?.questionId === question2.id);

    // ---- 3. Unauthorized Staff cannot remove ----
    console.log("\n=== Staff cannot remove (role-level) ===");
    const staffRemoveRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "DELETE", headers: staffA.headers });
    check("Staff DELETE blocked (403)", staffRemoveRes.status === 403, `got ${staffRemoveRes.status}`);

    // ---- 4. Student cannot call the admin API at all ----
    console.log("\n=== Student cannot call the admin remove API ===");
    const studentRemoveRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "DELETE", headers: studentA.headers });
    check("Student DELETE blocked (403)", studentRemoveRes.status === 403, `got ${studentRemoveRes.status}`);

    // ---- 5. Cross-institute: Institute Admin B cannot remove Institute A's challenge ----
    console.log("\n=== Cross-institute removal blocked ===");
    const crossRemoveRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "DELETE", headers: adminB.headers });
    check("Institute Admin B blocked (403/404)", crossRemoveRes.status === 403 || crossRemoveRes.status === 404, `got ${crossRemoveRes.status}`);
    check("Also blocked from editing it (403/404)", (await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ questionId: question.id }) })).status !== 200);
    check("Challenge still exists after blocked cross-institute attempt", !!(await prisma.dailyChallenge.findUnique({ where: { id: dc1.id } })));

    // ---- 6. Remove with NO submissions -> hard delete, audit logged, question preserved ----
    console.log("\n=== Remove challenge with no submissions (hard delete) ===");
    const removeRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "DELETE", headers: adminA.headers });
    const removeBody = await j(removeRes);
    check("Institute Admin A removes own challenge (200)", removeRes.status === 200 && removeBody?.success === true, `got ${removeRes.status}: ${JSON.stringify(removeBody)}`);
    check("Row actually deleted from DB", !(await prisma.dailyChallenge.findUnique({ where: { id: dc1.id } })));
    const removedAudit = await prisma.auditLog.findFirst({ where: { action: "CHALLENGE_REMOVED", details: { path: ["id"], equals: dc1.id } } });
    check("CHALLENGE_REMOVED audit log written", !!removedAudit, JSON.stringify(removedAudit));
    check("Both underlying questions still exist (Question Bank untouched)",
      !!(await prisma.question.findUnique({ where: { id: question.id } })) && !!(await prisma.question.findUnique({ where: { id: question2.id } })));
    check("Removed challenge no longer appears in the admin list",
      !(await j(await fetch(`${API_BASE}/challenges/admin/daily?pageSize=100`, { headers: adminA.headers }))).rows.some((r) => r.id === dc1.id));

    // ---- 7. Duplicate/already-removed request handled safely ----
    console.log("\n=== Duplicate removal request handled safely ===");
    const doubleRemoveRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc1.id}`, { method: "DELETE", headers: adminA.headers });
    check("Second removal of the same id returns 404 (not a crash)", doubleRemoveRes.status === 404, `got ${doubleRemoveRes.status}`);

    // ---- 8. Remove a challenge WITH submissions -> archived, not hard-deleted, submission intact ----
    console.log("\n=== Remove challenge with submissions -> archived, not deleted ===");
    const day2 = daysAgo(61);
    const createRes2 = await fetch(`${API_BASE}/challenges/admin/daily`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ date: day2.toISOString(), questionId: question.id }) });
    const dc2 = await j(createRes2);
    dcIds.push(dc2.id);
    const submission = await prisma.dailyChallengeSubmission.create({
      data: { dailyChallengeId: dc2.id, studentId: studentA.user.id, language: "python", code: "print(6)", verdict: "ACCEPTED", passedCases: 1, totalCases: 1, solvedAt: new Date() },
    });
    const removeWithSubsRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc2.id}`, { method: "DELETE", headers: adminA.headers });
    const removeWithSubsBody = await j(removeWithSubsRes);
    check("Removal with submissions returns 409 (archived, not deleted)", removeWithSubsRes.status === 409 && removeWithSubsBody?.archived === true, `got ${removeWithSubsRes.status}: ${JSON.stringify(removeWithSubsBody)}`);
    const archivedRow = await prisma.dailyChallenge.findUnique({ where: { id: dc2.id } });
    check("Row still exists (not hard-deleted)", !!archivedRow);
    check("Row is deactivated (isActive:false)", archivedRow?.isActive === false);
    const survivingSubmission = await prisma.dailyChallengeSubmission.findUnique({ where: { id: submission.id } });
    check("Student submission preserved intact", !!survivingSubmission && survivingSubmission.verdict === "ACCEPTED");
    const archivedAudit = await prisma.auditLog.findFirst({ where: { action: "CHALLENGE_ARCHIVED", details: { path: ["id"], equals: dc2.id } } });
    check("CHALLENGE_ARCHIVED audit log written for the archive-instead-of-delete path", !!archivedAudit);

    // ---- 9. Student-visibility: archived/deleted challenges never resolve as "today's" challenge ----
    // (Both dc1/dc2 are far in the past, so /daily/today would never pick them up regardless —
    // this instead confirms the shared resolver's isActive filter directly against the DB, the
    // same function every student-facing route relies on.)
    console.log("\n=== Student-visibility resolver excludes archived/removed rows ===");
    const { resolveMostSpecificChallenge } = require("../src/utils/challengeScoping");
    const resolvedForDay2 = await resolveMostSpecificChallenge(prisma.dailyChallenge, "date", day2, { instituteId: instA.id, academicGroupId: null });
    check("Archived Day-2 challenge does not resolve for students", !resolvedForDay2 || resolvedForDay2.id !== dc2.id);

    // ---- 10. Super Admin can remove (if a real one exists) ----
    if (superAdminHeaders) {
      console.log("\n=== Super Admin can remove any institute's challenge ===");
      const day3 = daysAgo(62);
      const createRes3 = await fetch(`${API_BASE}/challenges/admin/daily`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ date: day3.toISOString(), questionId: question.id }) });
      const dc3 = await j(createRes3);
      dcIds.push(dc3.id);
      const saRemoveRes = await fetch(`${API_BASE}/challenges/admin/daily/${dc3.id}`, { method: "DELETE", headers: superAdminHeaders });
      check("Super Admin removes Institute B's challenge (200)", saRemoveRes.status === 200, `got ${saRemoveRes.status}`);
    } else {
      console.log("\n(No SUPER_ADMIN user found — skipped, not counted)");
    }
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    for (const id of dcIds) {
      await prisma.dailyChallengeSubmission.deleteMany({ where: { dailyChallengeId: id } }).catch(() => {});
      await prisma.dailyChallenge.delete({ where: { id } }).catch(() => {});
    }
    for (const id of questionIds) {
      await prisma.testCase.deleteMany({ where: { questionId: id } }).catch(() => {});
      await prisma.question.delete({ where: { id } }).catch(() => {});
    }
    for (const c of cleanup) {
      if (c.skipDelete) continue;
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
