// One-off: real HTTP verification of (1) the reported bug fix — SUPER_ADMIN/INSTITUTE_ADMIN can
// now load a student's performance page, and (2) the two real cross-institute security fixes
// found along the way — DELETE /users/:id and POST /users/bulk-regenerate-password now correctly
// reject cross-institute targets instead of silently acting on them.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function mkUser(role, instituteId, name) {
  const email = `verify-perf-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: name || `Verify ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, token, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function main() {
  const instituteA = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  const instituteB = await prisma.institute.findFirst({ where: { id: { not: instituteA.id } } });
  if (!instituteB) throw new Error("Need a second institute for cross-institute tests");

  const instAdminA = await mkUser("INSTITUTE_ADMIN", instituteA.id);
  const studentA = await mkUser("STUDENT", instituteA.id, "Student A (own institute)");
  const studentB = await mkUser("STUDENT", instituteB.id, "Student B (other institute)");
  const cleanupUsers = [instAdminA.user.id, studentA.user.id]; // studentB deleted separately below if delete-guard fails
  const cleanupJtis = [instAdminA.jti, studentA.jti, studentB.jti];

  try {
    // 1. The actual reported bug: INSTITUTE_ADMIN loading a student's performance page
    const perfRes = await fetch(`http://127.0.0.1:4000/api/users/${studentA.user.id}/performance`, { headers: instAdminA.headers });
    console.log("INSTITUTE_ADMIN GET own-institute student performance:", perfRes.status);

    // 2. Cross-institute DELETE attempt -> must be 403, student B must still exist after
    const delRes = await fetch(`http://127.0.0.1:4000/api/users/${studentB.user.id}`, { method: "DELETE", headers: instAdminA.headers });
    const delBody = await delRes.json();
    const stillExists = await prisma.user.findUnique({ where: { id: studentB.user.id } });
    console.log("Cross-institute DELETE attempt:", delRes.status, JSON.stringify(delBody), "| student B still exists:", !!stillExists);

    // 3. Cross-institute bulk-regenerate-password attempt -> studentB must be in failedIds, not results
    const bulkRes = await fetch("http://127.0.0.1:4000/api/users/bulk-regenerate-password", {
      method: "POST", headers: instAdminA.headers, body: JSON.stringify({ studentIds: [studentA.user.id, studentB.user.id] }),
    });
    const bulkBody = await bulkRes.json();
    console.log("Cross-institute bulk-regenerate-password:", bulkRes.status,
      "| succeeded for:", bulkBody.results?.map((r) => r.id), "| failed (should include student B):", bulkBody.failedIds);

    // Confirm student B's password hash was NOT touched (i.e. it's actually rejected, not just hidden from response)
    const bBefore = studentB.user.passwordHash;
    const bAfter = await prisma.user.findUnique({ where: { id: studentB.user.id }, select: { passwordHash: true } });
    console.log("Student B password hash unchanged:", bBefore === bAfter.passwordHash);
  } finally {
    if (await prisma.user.findUnique({ where: { id: studentB.user.id } })) cleanupUsers.push(studentB.user.id);
    await prisma.loginSession.deleteMany({ where: { token: { in: cleanupJtis } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUsers } } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
