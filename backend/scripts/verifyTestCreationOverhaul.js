// Real-HTTP verification for the Test Creation System Overhaul — exercises the live server
// against real temporary users/questions/tests it creates, matching the spec's own test matrix
// (Staff A/B, Institute Admin A/B, direct cross-institute API attempts expecting 403). Cleans up
// every row it creates by exact ID in a finally block. Never touches any other institute's real
// data or any pre-existing row.
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

let regNoCounter = 0;
async function mkUser(role, instituteId) {
  const email = `testcreate-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  regNoCounter++;
  const registrationNumber = role === "STUDENT" ? `T${Date.now().toString(36)}${regNoCounter}`.slice(0, 12) : undefined;
  const user = await prisma.user.create({ data: { name: `TC Check ${role}`, email, passwordHash, role, instituteId, registrationNumber } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function j(res) { try { return await res.json(); } catch { return null; } }

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) { console.log("Need 2 institutes"); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name}\nInstitute B: ${instB.name}\n`);

  const groupA = await prisma.academicGroup.findFirst({ where: { instituteId: instA.id }, select: { id: true } });
  const groupB = await prisma.academicGroup.findFirst({ where: { instituteId: instB.id }, select: { id: true } });

  const cleanup = [];
  const questionIds = [];
  const testIds = [];
  try {
    const staffA = await mkUser("STAFF", instA.id);
    const staffB = await mkUser("STAFF", instB.id);
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    cleanup.push(staffA, staffB, adminA, adminB);

    // A deliberately "broken" MCQ (no marks, no correct answer) to exercise the new per-question
    // publish validation, plus a valid one to fix it with afterward.
    const badMcq = await prisma.question.create({
      data: { title: "Broken Q", description: "2+2=?", questionType: "MCQ", points: 0, options: ["3", "4", "5"], correctAnswer: [], createdById: staffA.user.id },
    });
    const goodMcq = await prisma.question.create({
      data: { title: "Good Q", description: "2+2=?", questionType: "MCQ", points: 10, options: ["3", "4", "5"], correctAnswer: [1], createdById: staffA.user.id },
    });
    questionIds.push(badMcq.id, goodMcq.id);

    const start = new Date(Date.now() + 3600_000).toISOString();
    const end = new Date(Date.now() + 7200_000).toISOString();

    // ---- 1. Staff A creates a test (broken question) ----
    console.log("=== Create test (Staff A) ===");
    const createRes = await fetch(`${API_BASE}/tests`, {
      method: "POST", headers: staffA.headers,
      body: JSON.stringify({ title: "TC Verify Test", durationMin: 30, startTime: start, endTime: end, questionIds: [badMcq.id] }),
    });
    const test = await j(createRes);
    check("Test created (200)", createRes.status === 200, `got ${createRes.status}: ${JSON.stringify(test)}`);
    testIds.push(test.id);
    check("New test has version 0", test.version === 0, `version=${test.version}`);

    const createdAudit = await prisma.auditLog.findFirst({ where: { action: "TEST_CREATED", details: { path: ["testId"], equals: test.id } } });
    check("TEST_CREATED audit log written", !!createdAudit);

    // ---- 2. Publish validation blocks the broken question ----
    console.log("\n=== Publish validation blocks a question with no marks / no correct answer ===");
    const badPublish = await fetch(`${API_BASE}/tests/${test.id}/publish`, { method: "PATCH", headers: staffA.headers, body: JSON.stringify({ isPublished: true }) });
    const badPublishBody = await j(badPublish);
    check("Publish rejected (400)", badPublish.status === 400, `got ${badPublish.status}`);
    check("Problems mention missing marks", (badPublishBody?.problems || []).some((p) => /no marks set/i.test(p)), JSON.stringify(badPublishBody?.problems));
    check("Problems mention missing correct answer", (badPublishBody?.problems || []).some((p) => /no correct answer/i.test(p)), JSON.stringify(badPublishBody?.problems));

    // ---- 3. Fix the test (swap in the good question) — exercises version/concurrency + audit ----
    console.log("\n=== Edit test to fix the question (version increments, audit logged) ===");
    const fixRes = await fetch(`${API_BASE}/tests/${test.id}`, {
      method: "PATCH", headers: staffA.headers,
      body: JSON.stringify({ questionIds: [goodMcq.id], version: test.version }),
    });
    const fixed = await j(fixRes);
    check("Edit accepted (200)", fixRes.status === 200, `got ${fixRes.status}: ${JSON.stringify(fixed)}`);
    check("Version incremented to 1", fixed?.version === 1, `version=${fixed?.version}`);
    const updatedAudit = await prisma.auditLog.findFirst({ where: { action: "TEST_UPDATED", details: { path: ["testId"], equals: test.id } } });
    check("TEST_UPDATED audit log written", !!updatedAudit);

    // ---- 4. Stale version is rejected (409) ----
    console.log("\n=== Concurrency: stale version is rejected ===");
    const staleRes = await fetch(`${API_BASE}/tests/${test.id}`, {
      method: "PATCH", headers: staffA.headers,
      body: JSON.stringify({ title: "Stale write attempt", version: 0 }),
    });
    const staleBody = await j(staleRes);
    check("Stale version update rejected (409)", staleRes.status === 409, `got ${staleRes.status}`);
    check("409 response flags conflict:true", staleBody?.conflict === true, JSON.stringify(staleBody));

    // ---- 5. Publish now succeeds ----
    console.log("\n=== Publish succeeds once the question is fixed ===");
    const goodPublish = await fetch(`${API_BASE}/tests/${test.id}/publish`, { method: "PATCH", headers: staffA.headers, body: JSON.stringify({ isPublished: true }) });
    check("Publish accepted (200)", goodPublish.status === 200, `got ${goodPublish.status}: ${JSON.stringify(await j(goodPublish))}`);
    const publishedAudit = await prisma.auditLog.findFirst({ where: { action: "TEST_PUBLISHED", details: { path: ["testId"], equals: test.id } } });
    check("TEST_PUBLISHED audit log written", !!publishedAudit);

    // ---- 6. Unpublish is logged too ----
    console.log("\n=== Unpublish is audit-logged ===");
    const unpublishRes = await fetch(`${API_BASE}/tests/${test.id}/publish`, { method: "PATCH", headers: staffA.headers, body: JSON.stringify({ isPublished: false }) });
    check("Unpublish accepted (200)", unpublishRes.status === 200, `got ${unpublishRes.status}`);
    const unpublishedAudit = await prisma.auditLog.findFirst({ where: { action: "TEST_UNPUBLISHED", details: { path: ["testId"], equals: test.id } } });
    check("TEST_UNPUBLISHED audit log written", !!unpublishedAudit);

    // ---- 7. Duplicate never carries over publish state, and is audit-logged ----
    console.log("\n=== Duplicate test (never published, audit logged) ===");
    // Re-publish first so we can confirm the duplicate does NOT inherit isPublished:true.
    await fetch(`${API_BASE}/tests/${test.id}/publish`, { method: "PATCH", headers: staffA.headers, body: JSON.stringify({ isPublished: true }) });
    const dupRes = await fetch(`${API_BASE}/tests/${test.id}/duplicate`, { method: "POST", headers: staffA.headers });
    const dup = await j(dupRes);
    check("Duplicate created (200)", dupRes.status === 200, `got ${dupRes.status}: ${JSON.stringify(dup)}`);
    testIds.push(dup?.id);
    check("Duplicate starts unpublished", dup?.isPublished === false, `isPublished=${dup?.isPublished}`);
    const dupAudit = await prisma.auditLog.findFirst({ where: { action: "TEST_DUPLICATED", details: { path: ["newTestId"], equals: dup?.id } } });
    check("TEST_DUPLICATED audit log written", !!dupAudit);

    // ---- 8. Institute isolation: Staff B (Institute B) cannot touch Institute A's test ----
    console.log("\n=== Institute isolation: Staff B blocked from Institute A's test ===");
    const crossPatch = await fetch(`${API_BASE}/tests/${test.id}`, { method: "PATCH", headers: staffB.headers, body: JSON.stringify({ title: "hijack attempt" }) });
    check("Staff B PATCH blocked (403)", crossPatch.status === 403, `got ${crossPatch.status}`);
    const crossPublish = await fetch(`${API_BASE}/tests/${test.id}/publish`, { method: "PATCH", headers: staffB.headers, body: JSON.stringify({ isPublished: false }) });
    check("Staff B publish blocked (403)", crossPublish.status === 403, `got ${crossPublish.status}`);
    const crossDup = await fetch(`${API_BASE}/tests/${test.id}/duplicate`, { method: "POST", headers: staffB.headers });
    check("Staff B duplicate blocked (403)", crossDup.status === 403, `got ${crossDup.status}`);
    const crossGet = await fetch(`${API_BASE}/tests/${test.id}`, { headers: staffB.headers });
    check("Staff B direct GET blocked (403)", crossGet.status === 403, `got ${crossGet.status}`);

    // ---- 9. Institute isolation: cross-institute academic group assignment rejected ----
    if (groupB) {
      console.log("\n=== Institute isolation: Staff A cannot assign a test to Institute B's academic group ===");
      const crossAssign = await fetch(`${API_BASE}/tests`, {
        method: "POST", headers: staffA.headers,
        body: JSON.stringify({ title: "TC Cross-Assign Attempt", durationMin: 30, startTime: start, endTime: end, questionIds: [goodMcq.id], academicGroupIds: [groupB.id] }),
      });
      check("Cross-institute group assignment rejected (403)", crossAssign.status === 403, `got ${crossAssign.status}: ${JSON.stringify(await j(crossAssign))}`);
    } else {
      console.log("\n(Institute B has no academic group to test with — skipped, not counted)");
    }

    // ---- 10. Institute Admin B cannot delete Institute A's test ----
    console.log("\n=== Institute isolation: Institute Admin B blocked from deleting Institute A's test ===");
    const crossDelete = await fetch(`${API_BASE}/tests/${test.id}`, { method: "DELETE", headers: adminB.headers });
    check("Admin B delete blocked (403)", crossDelete.status === 403, `got ${crossDelete.status}`);

    // ---- 11. Affected-student-count data is present for the frontend to use ----
    if (groupA) {
      console.log("\n=== Academic group response includes _count.users (affected-student preview) ===");
      const groupsRes = await fetch(`${API_BASE}/academic-groups`, { headers: adminA.headers });
      const groups = await j(groupsRes);
      const found = Array.isArray(groups) ? groups.find((g) => g.id === groupA.id) : null;
      check("Academic group carries _count.users", typeof found?._count?.users === "number", JSON.stringify(found?._count));
    }

    // ---- 12. Institute Admin A (same institute) CAN manage Staff A's test ----
    console.log("\n=== Institute Admin A can manage Staff A's own-institute test ===");
    const adminGetRes = await fetch(`${API_BASE}/tests/${test.id}`, { headers: adminA.headers });
    check("Institute Admin A can view Staff A's test (200)", adminGetRes.status === 200, `got ${adminGetRes.status}`);
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    // Staff cannot DELETE tests (by design — see tests.js DELETE /:id role list), so cleanup goes
    // straight to Prisma rather than the API, same as every other verify script's teardown.
    for (const id of testIds) { if (id) await prisma.test.delete({ where: { id } }).catch(() => {}); }
    for (const id of questionIds) await prisma.question.delete({ where: { id } }).catch(() => {});
    for (const c of cleanup) {
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
