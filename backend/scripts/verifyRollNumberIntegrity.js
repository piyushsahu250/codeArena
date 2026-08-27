// Real-HTTP verification for Roll Number Data Integrity — spec sections 10 (concurrent-request
// protection), 17 (search/institute scoping), 20 (cross-institute security), 22 (conflict
// dashboard). Creates real temp users/academic groups, exercises the live server, cleans up every
// row it creates by exact ID. Never touches any other institute's real data.
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
async function j(res) { try { return await res.json(); } catch { return null; } }

let counter = 0;
function freshRegNo() {
  counter++;
  const seq = String(counter).padStart(3, "0");
  return (`R${Date.now().toString(36)}`.slice(0, 9) + seq).slice(0, 12);
}

async function mkUser(role, instituteId) {
  const email = `rollintegrity-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: `Roll Integrity Check ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) { console.log("Need 2 institutes"); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name}\nInstitute B: ${instB.name}\n`);

  const cleanup = [];
  const studentIds = [];
  let groupA = null;
  try {
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    cleanup.push(adminA, adminB);

    // A real, dedicated academic group for this test — a batch/department/section combo that
    // definitely doesn't already exist, so this test starts from a guaranteed-empty roll-number
    // space and any conflict it finds is unambiguously caused by the requests it made itself.
    const testBatch = `RollIntegrityCheck-${Date.now()}`;

    // ---- 1. Concurrent creation race: two requests, same target Roll Number, same new group ----
    console.log("=== Concurrent student creation targeting the same Roll Number ===");
    const regA = freshRegNo();
    const regB = freshRegNo();
    const emailA = `rollintegrity-race-a-${Date.now()}@example.invalid`;
    const emailB = `rollintegrity-race-b-${Date.now()}@example.invalid`;
    const bodyA = { name: "Race Student A", email: emailA, role: "STUDENT", registrationNumber: regA, rollNumber: "555", mobile: "9876500001", batchYear: testBatch, department: "RollCheckDept", section: "A", instituteId: instA.id };
    const bodyB = { name: "Race Student B", email: emailB, role: "STUDENT", registrationNumber: regB, rollNumber: "555", mobile: "9876500002", batchYear: testBatch, department: "RollCheckDept", section: "A", instituteId: instA.id };
    const [raceResA, raceResB] = await Promise.all([
      fetch(`${API_BASE}/users`, { method: "POST", headers: adminA.headers, body: JSON.stringify(bodyA) }),
      fetch(`${API_BASE}/users`, { method: "POST", headers: adminA.headers, body: JSON.stringify(bodyB) }),
    ]);
    const [raceBodyA, raceBodyB] = await Promise.all([j(raceResA), j(raceResB)]);
    const statuses = [raceResA.status, raceResB.status].sort();
    check("Exactly one request succeeded (200) and one was rejected (409) — not both 200", JSON.stringify(statuses) === JSON.stringify([200, 409]), `got ${JSON.stringify([raceResA.status, raceResB.status])}: ${JSON.stringify({ raceBodyA, raceBodyB })}`);
    if (raceResA.status === 200) studentIds.push(raceBodyA.id);
    if (raceResB.status === 200) studentIds.push(raceBodyB.id);

    // Find the academic group these landed in, to verify the DB directly.
    const winner = raceResA.status === 200 ? raceBodyA : raceBodyB;
    const winnerRow = await prisma.user.findUnique({ where: { id: winner.id }, select: { academicGroupId: true } });
    groupA = winnerRow.academicGroupId;
    const rollCount555 = await prisma.user.count({ where: { academicGroupId: groupA, rollNumber: "555", role: "STUDENT" } });
    check("Database has exactly ONE student with Roll Number 555 in this group (no duplicate created)", rollCount555 === 1, `count=${rollCount555}`);

    // ---- 2. Auto-derive race: two students, no explicit roll number, same PRN-derived suffix ----
    console.log("\n=== Concurrent auto-derive race (both PRNs end in the same 3 digits) ===");
    const sharedSuffix = "777";
    const regC = `${freshRegNo().slice(0, 9)}${sharedSuffix}`;
    const regD = `${freshRegNo().slice(0, 9)}${sharedSuffix}`;
    const bodyC = { name: "Race Student C", email: `rollintegrity-race-c-${Date.now()}@example.invalid`, role: "STUDENT", registrationNumber: regC, mobile: "9876500003", batchYear: testBatch, department: "RollCheckDept", section: "A", instituteId: instA.id };
    const bodyD = { name: "Race Student D", email: `rollintegrity-race-d-${Date.now()}@example.invalid`, role: "STUDENT", registrationNumber: regD, mobile: "9876500004", batchYear: testBatch, department: "RollCheckDept", section: "A", instituteId: instA.id };
    const [raceResC, raceResD] = await Promise.all([
      fetch(`${API_BASE}/users`, { method: "POST", headers: adminA.headers, body: JSON.stringify(bodyC) }),
      fetch(`${API_BASE}/users`, { method: "POST", headers: adminA.headers, body: JSON.stringify(bodyD) }),
    ]);
    const [raceBodyC, raceBodyD] = await Promise.all([j(raceResC), j(raceResD)]);
    check("Both auto-derive creations succeed (200)", raceResC.status === 200 && raceResD.status === 200, `got ${raceResC.status}, ${raceResD.status}`);
    if (raceResC.status === 200) studentIds.push(raceBodyC.id);
    if (raceResD.status === 200) studentIds.push(raceBodyD.id);
    check("Auto-derived Roll Numbers are different from each other (collision avoided, not just rejected)", raceResC.status === 200 && raceResD.status === 200 && raceBodyC.rollNumber !== raceBodyD.rollNumber, `C=${raceBodyC?.rollNumber} D=${raceBodyD?.rollNumber}`);
    const rollCount777Area = await prisma.user.count({ where: { academicGroupId: groupA, role: "STUDENT", rollNumber: { in: [raceBodyC?.rollNumber, raceBodyD?.rollNumber].filter(Boolean) } } });
    check("No duplicate Roll Numbers exist for these two students", rollCount777Area === 2);

    // ---- 3. Roll Number Conflicts dashboard: institute scoping ----
    console.log("\n=== Roll Number Conflicts dashboard respects institute boundaries ===");
    // Force a real conflict to verify against: edit student D's roll number to collide with C's — expected to be rejected (still validated), so instead directly create a genuine conflict via prisma (simulating a legacy/pre-existing conflict, same shape as the 46 real ones) to test the READ side of the dashboard without fighting the now-working write-side protection.
    const conflictStudent = await mkUser("STUDENT", instA.id);
    await prisma.user.update({ where: { id: conflictStudent.user.id }, data: { academicGroupId: groupA, rollNumber: raceBodyC?.rollNumber, registrationNumber: freshRegNo() } });
    studentIds.push(conflictStudent.user.id);

    const dashA = await j(await fetch(`${API_BASE}/users/roll-number-conflicts?pageSize=50`, { headers: adminA.headers }));
    const foundInA = dashA.conflicts?.some((c) => c.academicGroupId === groupA && c.rollNumber === raceBodyC?.rollNumber);
    check("Institute Admin A sees the conflict in their own institute's dashboard", foundInA, JSON.stringify(dashA.conflicts?.map((c) => c.rollNumber)));

    const dashB = await j(await fetch(`${API_BASE}/users/roll-number-conflicts?pageSize=50`, { headers: adminB.headers }));
    const leakedToB = dashB.conflicts?.some((c) => c.academicGroupId === groupA);
    check("Institute Admin B does NOT see Institute A's conflict", !leakedToB, JSON.stringify(dashB.conflicts?.map((c) => c.academicGroupId)));

    // ---- 4. Cross-institute security: Institute Admin B cannot resolve Institute A's conflict ----
    console.log("\n=== Cross-institute: Institute Admin B blocked from editing Institute A's student ===");
    const crossEditRes = await fetch(`${API_BASE}/users/${conflictStudent.user.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ rollNumber: "999" }) });
    check("Institute Admin B blocked from resolving Institute A's conflict (403)", crossEditRes.status === 403, `got ${crossEditRes.status}`);

    // ---- 5. Legitimate resolution: Institute Admin A CAN resolve their own conflict ----
    console.log("\n=== Institute Admin A resolves the conflict via the normal edit flow ===");
    const resolveRes = await fetch(`${API_BASE}/users/${conflictStudent.user.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ rollNumber: "556" }) });
    const resolveBody = await j(resolveRes);
    check("Resolution succeeds (200)", resolveRes.status === 200, `got ${resolveRes.status}: ${JSON.stringify(resolveBody)}`);
    check("Roll Number actually changed", resolveBody?.rollNumber === "556");
    const dashAfter = await j(await fetch(`${API_BASE}/users/roll-number-conflicts?pageSize=50`, { headers: adminA.headers }));
    const stillConflicted = dashAfter.conflicts?.some((c) => c.academicGroupId === groupA && c.rollNumber === raceBodyC?.rollNumber);
    check("Conflict no longer appears in the dashboard after resolution", !stillConflicted);

    // ---- 6. Leading-zero / format consistency ----
    console.log("\n=== Roll Number format: exactly 3 digits, single representation ===");
    const badFormatRes = await fetch(`${API_BASE}/users/${conflictStudent.user.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ rollNumber: "7" }) });
    check("Single-digit Roll Number rejected (400) — not silently zero-padded or accepted as a different value", badFormatRes.status === 400, `got ${badFormatRes.status}`);
    const zeroPadRes = await fetch(`${API_BASE}/users/${conflictStudent.user.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ rollNumber: "007" }) });
    check("Correctly-padded 3-digit Roll Number accepted (200)", zeroPadRes.status === 200, `got ${zeroPadRes.status}`);
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    for (const id of studentIds) {
      await prisma.auditLog.deleteMany({ where: { studentId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch((e) => console.error("student cleanup failed", id, e.message));
    }
    if (groupA) {
      const remaining = await prisma.user.count({ where: { academicGroupId: groupA } });
      if (remaining === 0) await prisma.academicGroup.delete({ where: { id: groupA } }).catch(() => {});
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
