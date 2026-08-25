// One-off: real HTTP-level verification of the audit-log role-gate fix and Institute Admin
// appearing in staff-clerk management with peer-protection on status changes.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function mkUser(role, institute) {
  const email = `verify-audit-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: `Verify Audit ${role}`, email, passwordHash, role, instituteId: institute.id } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, token, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  const instAdminA = await mkUser("INSTITUTE_ADMIN", institute);
  const instAdminB = await mkUser("INSTITUTE_ADMIN", institute); // peer, same institute
  const cleanup = { users: [instAdminA.user.id, instAdminB.user.id], jtis: [instAdminA.jti, instAdminB.jti] };

  try {
    // 1. INSTITUTE_ADMIN can now reach the audit log (was 403 before the fix for SUPER_ADMIN/INSTITUTE_ADMIN)
    const auditRes = await fetch("http://127.0.0.1:4000/api/users/audit-log", { headers: instAdminA.headers });
    console.log("INSTITUTE_ADMIN GET /audit-log status:", auditRes.status);

    // 2. Institute Admin B shows up in staff-clerk directory (role=INSTITUTE_ADMIN filter)
    const dirRes = await fetch("http://127.0.0.1:4000/api/staff-clerk?role=INSTITUTE_ADMIN", { headers: instAdminA.headers });
    const dirBody = await dirRes.json();
    const foundB = dirBody.rows?.some((r) => r.id === instAdminB.user.id);
    console.log("Directory status:", dirRes.status, "| Institute Admin B listed:", foundB);

    // 3. Peer Institute Admin A tries to deactivate Institute Admin B -> must be 403
    const statusRes = await fetch(`http://127.0.0.1:4000/api/staff-clerk/${instAdminB.user.id}/status`, {
      method: "PATCH", headers: instAdminA.headers, body: JSON.stringify({ status: "INACTIVE" }),
    });
    const statusBody = await statusRes.json();
    console.log("Peer INSTITUTE_ADMIN deactivation attempt status:", statusRes.status, "| body:", JSON.stringify(statusBody));

    // 4. Confirm B is still ACTIVE (the blocked attempt had no effect)
    const bAfter = await prisma.user.findUnique({ where: { id: instAdminB.user.id }, select: { accountStatus: true } });
    console.log("Institute Admin B accountStatus after blocked attempt:", bAfter.accountStatus);
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: { in: cleanup.jtis } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.users } } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
