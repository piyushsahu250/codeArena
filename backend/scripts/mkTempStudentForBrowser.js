// One-off: create a single temp STUDENT with a known password for a real browser-login visual
// check of the Report a Problem widget. Deleted immediately after use in the same session.
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const institute = await prisma.institute.findFirst();
  const email = `browser-verify-student-${Date.now()}@example.invalid`;
  const password = "BrowserVerify1234!";
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: "Browser Verify Student", email, passwordHash, role: "STUDENT", instituteId: institute.id, mustChangePassword: false } });
  console.log(JSON.stringify({ id: user.id, email, password }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
