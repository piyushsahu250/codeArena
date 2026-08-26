const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const institute = await prisma.institute.findFirst();
  const email = `underline-check-${Date.now()}@example.invalid`;
  const password = "BrowserVerify1234!";
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: "Underline Check", email, passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id } });
  console.log(JSON.stringify({ id: user.id, email, password }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
