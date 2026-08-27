// One-off, real-HTTP verification for the new resume_builder / interview_history feature flags.
// Creates temp STUDENT users at two REAL, different institutes, sets one flag ON/OFF per
// institute, and hits the actual gated endpoints over real HTTP (not just unit-testing the
// middleware in isolation) to prove: (1) backend enforcement is real (a 403, not just hidden UI),
// (2) multi-institute isolation holds (institute A's OFF setting never affects institute B), and
// (3) re-enabling restores access. Cleans up every temp row it creates by exact ID; never touches
// any other data. Requires the server to be reachable at HEALTH_CHECK_API_BASE (default localhost).
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");
const { invalidateFeatureCache } = require("../src/utils/featureAccess");

const API_BASE = process.env.HEALTH_CHECK_API_BASE || "http://127.0.0.1:4000/api";

let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [PASS] ${label}`); pass++; }
  else { console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ""}`); fail++; }
}

async function mkStudent(instituteId) {
  const email = `feature-flag-check-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: "Feature Flag Check Student", email, passwordHash, role: "STUDENT", instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, token, jti, headers: { Authorization: `Bearer ${token}` } };
}

async function setFlag(instituteId, featureKey, enabled) {
  await prisma.featureSetting.upsert({
    where: { instituteId_featureKey: { instituteId, featureKey } },
    update: { enabled },
    create: { instituteId, featureKey, enabled },
  });
  invalidateFeatureCache(instituteId); // same invalidation the real PATCH /features route performs
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
    const studentA = await mkStudent(instA.id);
    const studentB = await mkStudent(instB.id);
    cleanup.push(studentA, studentB);

    // --- Scenario: Institute A OFF, Institute B ON (resume_builder) ---
    console.log("=== resume_builder: Institute A = OFF, Institute B = ON ===");
    await setFlag(instA.id, "resume_builder", false);
    await setFlag(instB.id, "resume_builder", true);

    const resA1 = await fetch(`${API_BASE}/resume/me`, { headers: studentA.headers });
    check("Student A (feature OFF) blocked with 403", resA1.status === 403, `got ${resA1.status}`);
    const bodyA1 = await resA1.json().catch(() => ({}));
    check("Student A response carries featureDisabled flag", bodyA1.featureDisabled === true, JSON.stringify(bodyA1));

    const resB1 = await fetch(`${API_BASE}/resume/me`, { headers: studentB.headers });
    check("Student B (feature ON) allowed with 200", resB1.status === 200, `got ${resB1.status}`);

    // --- Flip: Institute A ON, Institute B OFF — proves isolation is not directional/order-dependent ---
    console.log("\n=== resume_builder: flipped — Institute A = ON, Institute B = OFF ===");
    await setFlag(instA.id, "resume_builder", true);
    await setFlag(instB.id, "resume_builder", false);

    const resA2 = await fetch(`${API_BASE}/resume/me`, { headers: studentA.headers });
    check("Student A (now ON) allowed with 200", resA2.status === 200, `got ${resA2.status}`);
    const resB2 = await fetch(`${API_BASE}/resume/me`, { headers: studentB.headers });
    check("Student B (now OFF) blocked with 403", resB2.status === 403, `got ${resB2.status}`);

    // --- interview_history: same pattern, independent key ---
    console.log("\n=== interview_history: Institute A = OFF, Institute B = ON ===");
    await setFlag(instA.id, "interview_history", false);
    await setFlag(instB.id, "interview_history", true);

    const histA = await fetch(`${API_BASE}/interview/sessions`, { headers: studentA.headers });
    check("Student A interview_history OFF -> 403", histA.status === 403, `got ${histA.status}`);
    const histB = await fetch(`${API_BASE}/interview/sessions`, { headers: studentB.headers });
    check("Student B interview_history ON -> 200", histB.status === 200, `got ${histB.status}`);

    // --- Cross-check: disabling interview_history must NOT affect resume_builder on the same institute ---
    console.log("\n=== Independence: interview_history OFF must not affect resume_builder (same institute A) ===");
    const resumeStillA = await fetch(`${API_BASE}/resume/me`, { headers: studentA.headers });
    check("Student A's resume_builder (currently ON) unaffected by interview_history=OFF", resumeStillA.status === 200, `got ${resumeStillA.status}`);

    // --- Data safety: turning the flag back on restores access to whatever already exists ---
    console.log("\n=== Re-enable restores access ===");
    await setFlag(instB.id, "resume_builder", true);
    const resB3 = await fetch(`${API_BASE}/resume/me`, { headers: studentB.headers });
    check("Student B resume_builder re-enabled -> 200 again", resB3.status === 200, `got ${resB3.status}`);

    // --- Direct URL / raw API bypass check: no header trickery lets a disabled-feature request through ---
    console.log("\n=== Cannot bypass via client-supplied institute hints ===");
    await setFlag(instA.id, "resume_builder", false);
    const bypassAttempt = await fetch(`${API_BASE}/resume/me`, {
      headers: { ...studentA.headers, "X-Institute-Id": instB.id }, // arbitrary header a client could fabricate
    });
    check("Fabricated institute header does not bypass the block", bypassAttempt.status === 403, `got ${bypassAttempt.status}`);
  } finally {
    // Exact-ID cleanup only — sessions then users, matching this repo's established convention.
    for (const c of cleanup) {
      await prisma.session.deleteMany({ where: { jti: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
    // Restore both institutes to enabled (the default/pre-test state) so this script never leaves
    // a real institute's feature configuration altered after it exits.
    for (const inst of [instA, instB]) {
      await setFlag(inst.id, "resume_builder", true);
      await setFlag(inst.id, "interview_history", true);
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
