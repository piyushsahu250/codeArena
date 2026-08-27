// Real-HTTP verification for the Weekly/Daily Challenge Remove fix — exercises the live server
// against real temporary users/questions/challenges it creates, matching the spec's own test
// matrix (Super Admin, Institute Admin A/B, Staff, Student, cross-institute API attempts). Cleans
// up every row it creates by exact ID in a finally block.
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
  const email = `wcremove-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: `WC Check ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function j(res) { try { return await res.json(); } catch { return null; } }

// A week far in the past so it never collides with "this week" (which student-facing routes and
// the scheduler both key off) and never shows as the live current-week challenge.
function pastMonday(weeksAgo) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day) - weeksAgo * 7);
  return d;
}

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) { console.log("Need 2 institutes"); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name}\nInstitute B: ${instB.name}\n`);

  const cleanup = [];
  const questionIds = [];
  const wcIds = [];
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

    // A real gradable coding question so the challenge is valid to schedule (readiness check
    // requires at least one test case).
    const question = await prisma.question.create({
      data: {
        title: "WC Remove Check Question", description: "Return the sum of two integers.",
        questionType: "CODING", difficulty: "MEDIUM", points: 10,
        testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }] },
      },
    });
    questionIds.push(question.id);

    // ---- 1. Create Weekly Challenge (Institute Admin A) ----
    console.log("=== Create Weekly Challenge (Institute Admin A) ===");
    const week1 = pastMonday(10);
    const createRes = await fetch(`${API_BASE}/challenges/admin/weekly`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({ weekStart: week1.toISOString(), questionId: question.id }),
    });
    const wc1 = await j(createRes);
    check("Weekly Challenge created (200)", createRes.status === 200, `got ${createRes.status}: ${JSON.stringify(wc1)}`);
    wcIds.push(wc1.id);
    check("Created under Institute A", wc1.instituteId === instA.id, `instituteId=${wc1.instituteId}`);

    // ---- 2. Unauthorized Staff cannot remove ----
    console.log("\n=== Staff cannot remove (role-level) ===");
    const staffRemoveRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc1.id}`, { method: "DELETE", headers: staffA.headers });
    check("Staff DELETE blocked (403)", staffRemoveRes.status === 403, `got ${staffRemoveRes.status}`);

    // ---- 3. Student cannot call the admin API at all ----
    console.log("\n=== Student cannot call the admin remove API ===");
    const studentRemoveRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc1.id}`, { method: "DELETE", headers: studentA.headers });
    check("Student DELETE blocked (403)", studentRemoveRes.status === 403, `got ${studentRemoveRes.status}`);

    // ---- 4. Cross-institute: Institute Admin B cannot remove Institute A's challenge ----
    console.log("\n=== Cross-institute removal blocked ===");
    const crossRemoveRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc1.id}`, { method: "DELETE", headers: adminB.headers });
    check("Institute Admin B blocked from removing Institute A's challenge (403/404)", crossRemoveRes.status === 403 || crossRemoveRes.status === 404, `got ${crossRemoveRes.status}`);
    const stillThere = await prisma.weeklyChallenge.findUnique({ where: { id: wc1.id } });
    check("Challenge still exists after blocked cross-institute attempt", !!stillThere);

    // ---- 5. Remove a challenge with NO submissions -> hard delete, audit logged ----
    console.log("\n=== Remove challenge with no submissions (hard delete) ===");
    const removeRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc1.id}`, { method: "DELETE", headers: adminA.headers });
    const removeBody = await j(removeRes);
    check("Institute Admin A removes own challenge (200)", removeRes.status === 200 && removeBody?.success === true, `got ${removeRes.status}: ${JSON.stringify(removeBody)}`);
    const gone = await prisma.weeklyChallenge.findUnique({ where: { id: wc1.id } });
    check("Row actually deleted from DB", !gone);
    const removedAudit = await prisma.auditLog.findFirst({ where: { action: "CHALLENGE_REMOVED", details: { path: ["id"], equals: wc1.id } } });
    check("CHALLENGE_REMOVED audit log written", !!removedAudit, JSON.stringify(removedAudit));
    check("Question was NOT deleted", !!(await prisma.question.findUnique({ where: { id: question.id } })));

    // ---- 6. Duplicate/already-removed request handled safely ----
    console.log("\n=== Duplicate removal request handled safely ===");
    const doubleRemoveRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc1.id}`, { method: "DELETE", headers: adminA.headers });
    check("Second removal of the same id returns 404 (not a crash)", doubleRemoveRes.status === 404, `got ${doubleRemoveRes.status}`);

    // ---- 7. Remove a challenge WITH submissions -> archived, not hard-deleted, submissions intact ----
    console.log("\n=== Remove challenge with submissions -> archived, not deleted ===");
    const week2 = pastMonday(11);
    const createRes2 = await fetch(`${API_BASE}/challenges/admin/weekly`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({ weekStart: week2.toISOString(), questionId: question.id }),
    });
    const wc2 = await j(createRes2);
    wcIds.push(wc2.id);
    // Real submission row, written directly (submitting through the judge is out of scope here —
    // this test is about the remove route's own submissionCount branch, not the judge pipeline).
    const submission = await prisma.weeklyChallengeSubmission.create({
      data: { weeklyChallengeId: wc2.id, studentId: studentA.user.id, language: "python", code: "print(5)", verdict: "ACCEPTED", passedCases: 1, totalCases: 1, solvedAt: new Date() },
    });
    const removeWithSubsRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc2.id}`, { method: "DELETE", headers: adminA.headers });
    const removeWithSubsBody = await j(removeWithSubsRes);
    check("Removal with submissions returns 409 (archived, not deleted)", removeWithSubsRes.status === 409 && removeWithSubsBody?.archived === true, `got ${removeWithSubsRes.status}: ${JSON.stringify(removeWithSubsBody)}`);
    const archivedRow = await prisma.weeklyChallenge.findUnique({ where: { id: wc2.id } });
    check("Row still exists (not hard-deleted)", !!archivedRow);
    check("Row is deactivated (isActive:false)", archivedRow?.isActive === false);
    const survivingSubmission = await prisma.weeklyChallengeSubmission.findUnique({ where: { id: submission.id } });
    check("Student submission preserved intact", !!survivingSubmission && survivingSubmission.verdict === "ACCEPTED");

    // ---- 8. Super Admin can remove (if a real one exists) ----
    if (superAdminHeaders) {
      console.log("\n=== Super Admin can remove any institute's challenge ===");
      const week3 = pastMonday(12);
      const createRes3 = await fetch(`${API_BASE}/challenges/admin/weekly`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ weekStart: week3.toISOString(), questionId: question.id }) });
      const wc3 = await j(createRes3);
      wcIds.push(wc3.id);
      const saRemoveRes = await fetch(`${API_BASE}/challenges/admin/weekly/${wc3.id}`, { method: "DELETE", headers: superAdminHeaders });
      check("Super Admin removes Institute B's challenge (200)", saRemoveRes.status === 200, `got ${saRemoveRes.status}`);
    } else {
      console.log("\n(No SUPER_ADMIN user found — skipped, not counted)");
    }
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    for (const id of wcIds) {
      await prisma.weeklyChallengeSubmission.deleteMany({ where: { weeklyChallengeId: id } }).catch(() => {});
      await prisma.weeklyChallenge.delete({ where: { id } }).catch(() => {});
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
