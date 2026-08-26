// One-off: create one temp STUDENT, STAFF, ADMIN(institute-scoped), and CLERK account with a known
// password, for a real browser-login visual check of the Phase 1 dashboard redesign across roles.
// Deleted immediately after use in the same session. Skips SUPER_ADMIN (DB enforces exactly one
// row for that role — see memory project_single_super_admin_constraint).
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const institute = await prisma.institute.findFirst();
  const password = "BrowserVerify1234!";
  const passwordHash = await bcrypt.hash(password, 10);
  const roles = ["STUDENT", "STAFF", "INSTITUTE_ADMIN", "CLERK"];
  const created = [];
  for (const role of roles) {
    const email = `dash-verify-${role.toLowerCase()}-${Date.now()}@example.invalid`;
    const user = await prisma.user.create({ data: { name: `Dash Verify ${role}`, email, passwordHash, role, instituteId: institute.id } });
    created.push({ id: user.id, role, email, password });
  }
  console.log(JSON.stringify(created, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
