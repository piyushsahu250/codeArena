// One-off: creates a temp INSTITUTE_ADMIN account (Testing Institute) for a manual browser login
// check of the new dashboard UI. Prints credentials. Delete afterward with
// deleteTempVisualCheckUser.js — this is a brand-new user with no pre-existing sessions, so
// cleanup by userId is safe here (unlike the earlier incidents, which wiped a REAL account's
// unrelated active sessions).
const prisma = require("../src/prisma");
const bcrypt = require("bcryptjs");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  if (!institute) throw new Error("Testing Institute not found");

  const email = "visual-check-institute-admin@example.invalid";
  const password = "TempVisual1234!";
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id, isActive: true },
    create: { name: "Visual Check Institute Admin", email, passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id },
  });

  console.log("EMAIL", email);
  console.log("PASSWORD", password);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
