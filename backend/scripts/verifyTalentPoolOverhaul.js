// Real-HTTP verification for the Talent Pool audit/fix pass — exercises the live server against
// real temporary users/pools it creates, matching the spec's own multi-institute test matrix.
// Cleans up every row it creates by exact ID in a finally block. Never touches any other
// institute's real data.
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
  const email = `talentpool-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  regNoCounter++;
  const registrationNumber = role === "STUDENT" ? `P${Date.now().toString(36)}${regNoCounter}`.slice(0, 12) : undefined;
  const user = await prisma.user.create({ data: { name: `TP Check ${role}`, email, passwordHash, role, instituteId, registrationNumber } });
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

  const cleanup = [];
  const poolIds = [];
  try {
    const staffA = await mkUser("STAFF", instA.id);
    const staffB = await mkUser("STAFF", instB.id);
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    const studentA1 = await mkUser("STUDENT", instA.id);
    const studentA2 = await mkUser("STUDENT", instA.id);
    const studentB1 = await mkUser("STUDENT", instB.id);
    cleanup.push(staffA, staffB, adminA, adminB, studentA1, studentA2, studentB1);

    // ---- 1. Staff cannot create a Talent Pool (spec §1/§4) ----
    console.log("=== Staff cannot create a Talent Pool ===");
    const staffCreateRes = await fetch(`${API_BASE}/talent-pools`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ name: "Staff Attempt Pool" }) });
    check("Staff create blocked (403 role-level)", staffCreateRes.status === 403, `got ${staffCreateRes.status}`);

    // ---- 2. Institute Admin A creates Talent Pool A (auto-scoped to their own institute) ----
    console.log("\n=== Institute Admin A creates Talent Pool A ===");
    const createRes = await fetch(`${API_BASE}/talent-pools`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ name: "TP Verify Pool A", instituteIds: [instB.id] }) });
    const poolA = await j(createRes);
    check("Pool A created (200)", createRes.status === 200, `got ${createRes.status}: ${JSON.stringify(poolA)}`);
    poolIds.push(poolA.id);
    check("Institute Admin A cannot smuggle Institute B into instituteIds (auto-scoped to own institute)",
      poolA.institutes.length === 1 && poolA.institutes[0].institute.id === instA.id,
      JSON.stringify(poolA.institutes));

    // ---- 3. Institute Admin B creates Talent Pool B ----
    const createBRes = await fetch(`${API_BASE}/talent-pools`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ name: "TP Verify Pool B" }) });
    const poolB = await j(createBRes);
    poolIds.push(poolB.id);
    check("Pool B created (200)", createBRes.status === 200, `got ${createBRes.status}`);

    // ---- 4. Institute isolation: Staff A sees only Pool A, not Pool B ----
    console.log("\n=== Institute isolation: list visibility ===");
    const listA = await j(await fetch(`${API_BASE}/talent-pools`, { headers: staffA.headers }));
    check("Staff A sees Pool A", listA.some((p) => p.id === poolA.id));
    check("Staff A does NOT see Pool B", !listA.some((p) => p.id === poolB.id));
    const listAdminB = await j(await fetch(`${API_BASE}/talent-pools`, { headers: adminB.headers }));
    check("Institute Admin B does NOT see Pool A", !listAdminB.some((p) => p.id === poolA.id));

    // ---- 5. Institute isolation: direct GET/PATCH/DELETE cross-institute blocked ----
    console.log("\n=== Institute isolation: direct API access blocked ===");
    const crossGet = await fetch(`${API_BASE}/talent-pools/${poolB.id}`, { headers: staffA.headers });
    check("Staff A GET Pool B blocked (403/404)", crossGet.status === 403 || crossGet.status === 404, `got ${crossGet.status}`);
    const crossPatch = await fetch(`${API_BASE}/talent-pools/${poolB.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ name: "hijacked" }) });
    check("Institute Admin A PATCH Pool B blocked (403/404)", crossPatch.status === 403 || crossPatch.status === 404, `got ${crossPatch.status}`);

    // ---- 6. Staff A can add Institute A students; cannot add Institute B students ----
    console.log("\n=== Staff A can add own-institute students, blocked on cross-institute ===");
    const addOwnRes = await fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ studentIds: [studentA1.user.id] }) });
    const addOwnBody = await j(addOwnRes);
    check("Staff A adds Institute A student (200, addedCount 1)", addOwnRes.status === 200 && addOwnBody?.addedCount === 1, `got ${addOwnRes.status}: ${JSON.stringify(addOwnBody)}`);
    const addForeignRes = await fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ studentIds: [studentB1.user.id] }) });
    check("Staff A blocked adding Institute B student (403)", addForeignRes.status === 403, `got ${addForeignRes.status}`);

    // ---- 7. Duplicate prevention ----
    console.log("\n=== Duplicate prevention ===");
    const dupRes = await fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ studentIds: [studentA1.user.id] }) });
    const dupBody = await j(dupRes);
    check("Re-adding same student: addedCount 0, skippedCount 1", dupBody?.addedCount === 0 && dupBody?.skippedCount === 1, JSON.stringify(dupBody));
    const memberRows = await prisma.talentPoolMember.count({ where: { poolId: poolA.id, studentId: studentA1.user.id } });
    check("Exactly one membership row exists in DB", memberRows === 1, `count=${memberRows}`);

    // ---- 8. Concurrency: two simultaneous adds of the same new student -> one membership ----
    console.log("\n=== Concurrency: simultaneous add of the same student ===");
    const [c1, c2] = await Promise.all([
      fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ studentIds: [studentA2.user.id] }) }),
      fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ studentIds: [studentA2.user.id] }) }),
    ]);
    check("Both concurrent requests succeeded (200)", c1.status === 200 && c2.status === 200, `${c1.status}, ${c2.status}`);
    const concurrentCount = await prisma.talentPoolMember.count({ where: { poolId: poolA.id, studentId: studentA2.user.id } });
    check("Exactly one membership row after concurrent adds", concurrentCount === 1, `count=${concurrentCount}`);

    // ---- 9. Remove student does not delete the student account ----
    console.log("\n=== Remove student leaves the account intact ===");
    const removeRes = await fetch(`${API_BASE}/talent-pools/${poolA.id}/members/${studentA1.user.id}`, { method: "DELETE", headers: staffA.headers });
    check("Remove succeeded (200)", removeRes.status === 200, `got ${removeRes.status}`);
    const stillExists = await prisma.user.findUnique({ where: { id: studentA1.user.id }, select: { id: true } });
    check("Student account still exists after removal", !!stillExists);
    const membershipGone = await prisma.talentPoolMember.count({ where: { poolId: poolA.id, studentId: studentA1.user.id } });
    check("Membership row actually removed", membershipGone === 0, `count=${membershipGone}`);

    // ---- 10. isActive enforcement: deactivate Pool A, Staff blocked from adding, Admin still can ----
    console.log("\n=== Inactive pool: Staff blocked from adding, Admin still can ===");
    const deactivateRes = await fetch(`${API_BASE}/talent-pools/${poolA.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ isActive: false }) });
    check("Institute Admin A deactivates Pool A (200)", deactivateRes.status === 200, `got ${deactivateRes.status}`);
    const staffAddToInactive = await fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: staffA.headers, body: JSON.stringify({ studentIds: [studentA1.user.id] }) });
    check("Staff A blocked from adding to inactive pool (403)", staffAddToInactive.status === 403, `got ${staffAddToInactive.status}`);
    const adminAddToInactive = await fetch(`${API_BASE}/talent-pools/${poolA.id}/members`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ studentIds: [studentA1.user.id] }) });
    check("Institute Admin A can still add to inactive pool (200)", adminAddToInactive.status === 200, `got ${adminAddToInactive.status}: ${JSON.stringify(await j(adminAddToInactive))}`);

    // ---- 11. isActive enforcement: Staff list no longer includes the now-inactive pool ----
    console.log("\n=== Inactive pool disappears from Staff's list, stays visible to Admin ===");
    const listAfterDeactivate = await j(await fetch(`${API_BASE}/talent-pools`, { headers: staffA.headers }));
    check("Staff A no longer sees the now-inactive Pool A", !listAfterDeactivate.some((p) => p.id === poolA.id));
    const adminListAfterDeactivate = await j(await fetch(`${API_BASE}/talent-pools`, { headers: adminA.headers }));
    check("Institute Admin A still sees the inactive Pool A (for management)", adminListAfterDeactivate.some((p) => p.id === poolA.id));

    // ---- 12. isActive enforcement: student membership in an inactive pool is hidden from /my-pools ----
    console.log("\n=== Student's /my-pools hides membership in an inactive pool ===");
    const studentA1Session = await mkUser("STUDENT", instA.id); // fresh session isn't needed but keeps pattern consistent
    cleanup.push(studentA1Session);
    const myPoolsRes = await fetch(`${API_BASE}/talent-pools/my-pools`, { headers: studentA1.headers });
    const myPoolsBody = await j(myPoolsRes);
    check("my-pools succeeds (200)", myPoolsRes.status === 200, `got ${myPoolsRes.status}`);
    check("Inactive Pool A is NOT in student's my-pools list", !((myPoolsBody || []).some((e) => e.pool.id === poolA.id)), JSON.stringify(myPoolsBody?.map((e) => e.pool.id)));

    // Reactivate so the reused staffA/adminA sessions aren't left mid-scenario for later checks.
    await fetch(`${API_BASE}/talent-pools/${poolA.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ isActive: true }) });
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    for (const id of poolIds) {
      await prisma.talentPoolMember.deleteMany({ where: { poolId: id } }).catch(() => {});
      await prisma.talentPool.delete({ where: { id } }).catch(() => {});
    }
    for (const c of cleanup) {
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
