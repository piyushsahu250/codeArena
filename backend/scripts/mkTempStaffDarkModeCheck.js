// One-off: temp STAFF account for a live dark-mode visual check of the Phase 2 badge fixes on
// /staff/learning. Deleted immediately after use.
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const institute = await prisma.institute.findFirst();
  const email = `darkmode-check-staff-${Date.now()}@example.invalid`;
  const password = "BrowserVerify1234!";
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: "Dark Mode Check", email, passwordHash, role: "STAFF", instituteId: institute.id } });
  console.log(JSON.stringify({ id: user.id, email, password }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
