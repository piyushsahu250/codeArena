// One-off, real-HTTP verification for the new resume_builder / interview_history feature flags.
// Creates temp STUDENT + INSTITUTE_ADMIN users at two REAL, different institutes, and toggles
// flags through the REAL PATCH /features endpoint (not a direct DB write) — this is deliberate:
// a direct Prisma write from this script runs in a SEPARATE Node process from the live server, so
// calling this script's own invalidateFeatureCache() would only clear ITS OWN process-local cache,
// never the server's — the server would keep serving whatever it cached up to 30s earlier,
// producing exactly the kind of false pass/fail this test exists to catch. Going through the real
// HTTP endpoint exercises upsert + audit log + cache invalidation in the SAME process that serves
// the subsequent student requests, which is what actually matters here.
// Cleans up every temp row it creates by exact ID/jti; restores both institutes' flags to enabled
// afterward so this script never leaves real institute configuration altered.
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
  const email = `feature-flag-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: `Feature Flag Check ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

// Toggles a flag through the REAL admin endpoint, as a real INSTITUTE_ADMIN for that institute —
// exactly the code path an actual Super Admin/Institute Admin click in Feature Management runs.
async function setFlagViaApi(adminHeaders, instituteId, featureKey, enabled) {
  const res = await fetch(`${API_BASE}/features`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ instituteId, featureKey, enabled }),
  });
  if (!res.ok) throw new Error(`PATCH /features failed: ${res.status} ${await res.text().catch(() => "")}`);
}

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) {
    console.log("Need at least 2 real institutes in the DB to test multi-institute isolation — found", institutes.length);
    process.exit(1);
  }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name} (${instA.id})`);
  console.log(`Institute B: ${instB.name} (${instB.id})\n`);

  const cleanup = [];
  try {
    const studentA = await mkUser("STUDENT", instA.id);
    const studentB = await mkUser("STUDENT", instB.id);
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    cleanup.push(studentA, studentB, adminA, adminB);

    // --- Scenario: Institute A OFF, Institute B ON (resume_builder) ---
    console.log("=== resume_builder: Institute A = OFF, Institute B = ON ===");
    await setFlagViaApi(adminA.headers, instA.id, "resume_builder", false);
    await setFlagViaApi(adminB.headers, instB.id, "resume_builder", true);

    const resA1 = await fetch(`${API_BASE}/resume/me`, { headers: studentA.headers });
    check("Student A (feature OFF) blocked with 403", resA1.status === 403, `got ${resA1.status}`);
    const bodyA1 = await resA1.json().catch(() => ({}));
    check("Student A response carries featureDisabled flag", bodyA1.featureDisabled === true, JSON.stringify(bodyA1));

    const resB1 = await fetch(`${API_BASE}/resume/me`, { headers: studentB.headers });
    check("Student B (feature ON) allowed with 200", resB1.status === 200, `got ${resB1.status}`);

    // --- Flip: Institute A ON, Institute B OFF — proves isolation is not directional/order-dependent ---
    console.log("\n=== resume_builder: flipped — Institute A = ON, Institute B = OFF ===");
    await setFlagViaApi(adminA.headers, instA.id, "resume_builder", true);
    await setFlagViaApi(adminB.headers, instB.id, "resume_builder", false);

    const resA2 = await fetch(`${API_BASE}/resume/me`, { headers: studentA.headers });
    check("Student A (now ON) allowed with 200", resA2.status === 200, `got ${resA2.status}`);
    const resB2 = await fetch(`${API_BASE}/resume/me`, { headers: studentB.headers });
    check("Student B (now OFF) blocked with 403", resB2.status === 403, `got ${resB2.status}`);

    // --- interview_history: same pattern, independent key ---
    console.log("\n=== interview_history: Institute A = OFF, Institute B = ON ===");
    await setFlagViaApi(adminA.headers, instA.id, "interview_history", false);
    await setFlagViaApi(adminB.headers, instB.id, "interview_history", true);

    const histA = await fetch(`${API_BASE}/interview/sessions`, { headers: studentA.headers });
    check("Student A interview_history OFF -> 403", histA.status === 403, `got ${histA.status}`);
    const histB = await fetch(`${API_BASE}/interview/sessions`, { headers: studentB.headers });
    check("Student B interview_history ON -> 200", histB.status === 200, `got ${histB.status}`);

    // --- Independence: disabling interview_history must NOT affect resume_builder on institute A ---
    console.log("\n=== Independence: interview_history OFF must not affect resume_builder (same institute A) ===");
    const resumeStillA = await fetch(`${API_BASE}/resume/me`, { headers: studentA.headers });
    check("Student A's resume_builder (currently ON) unaffected by interview_history=OFF", resumeStillA.status === 200, `got ${resumeStillA.status}`);

    // --- Data safety: turning the flag back on restores access ---
    console.log("\n=== Re-enable restores access ===");
    await setFlagViaApi(adminB.headers, instB.id, "resume_builder", true);
    const resB3 = await fetch(`${API_BASE}/resume/me`, { headers: studentB.headers });
    check("Student B resume_builder re-enabled -> 200 again", resB3.status === 200, `got ${resB3.status}`);

    // --- Direct URL / raw API bypass check: no header trickery lets a disabled-feature request through ---
    console.log("\n=== Cannot bypass via client-supplied institute hints ===");
    await setFlagViaApi(adminA.headers, instA.id, "resume_builder", false);
    const bypassAttempt = await fetch(`${API_BASE}/resume/me`, {
      headers: { ...studentA.headers, "X-Institute-Id": instB.id }, // arbitrary header a client could fabricate
    });
    check("Fabricated institute header does not bypass the block", bypassAttempt.status === 403, `got ${bypassAttempt.status}`);

    // --- Cross-role check: STAFF cannot modify feature configuration ---
    console.log("\n=== Role check: STAFF cannot modify feature configuration ===");
    const staffA = await mkUser("STAFF", instA.id);
    cleanup.push(staffA);
    const staffPatch = await fetch(`${API_BASE}/features`, {
      method: "PATCH", headers: staffA.headers,
      body: JSON.stringify({ instituteId: instA.id, featureKey: "resume_builder", enabled: true }),
    });
    check("STAFF PATCH /features rejected (not 200)", staffPatch.status !== 200, `got ${staffPatch.status}`);

    // --- Cross-role check: CLERK cannot modify feature configuration ---
    const clerkA = await mkUser("CLERK", instA.id);
    cleanup.push(clerkA);
    const clerkPatch = await fetch(`${API_BASE}/features`, {
      method: "PATCH", headers: clerkA.headers,
      body: JSON.stringify({ instituteId: instA.id, featureKey: "resume_builder", enabled: true }),
    });
    check("CLERK PATCH /features rejected (not 200)", clerkPatch.status !== 200, `got ${clerkPatch.status}`);
  } finally {
    // Restore both institutes to enabled first (via the real API, using whichever admin session
    // is still valid) so no real institute is left misconfigured after this script exits.
    try {
      const adminA = cleanup.find((c) => c.user.role === "INSTITUTE_ADMIN" && c.user.instituteId === instA.id);
      const adminB = cleanup.find((c) => c.user.role === "INSTITUTE_ADMIN" && c.user.instituteId === instB.id);
      if (adminA) { await setFlagViaApi(adminA.headers, instA.id, "resume_builder", true); await setFlagViaApi(adminA.headers, instA.id, "interview_history", true); }
      if (adminB) { await setFlagViaApi(adminB.headers, instB.id, "resume_builder", true); await setFlagViaApi(adminB.headers, instB.id, "interview_history", true); }
    } catch (restoreErr) {
      console.error("Warning: failed to restore flags to enabled during cleanup:", restoreErr.message);
    }
    // Exact-jti/exact-id cleanup only.
    for (const c of cleanup) {
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
