// One-off: create a single temporary SUPER_ADMIN account with a known password so the UI can be
// visually verified through a real browser login (not just an API script). Prints the email so a
// matching cleanup script can delete it by exact email afterward. Never used for anything but this
// one immediate verification step within the same session.
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const email = `browser-verify-${Date.now()}@example.invalid`;
  const password = "BrowserVerify1234!";
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: "Browser Verify", email, passwordHash, role: "SUPER_ADMIN" } });
  console.log(JSON.stringify({ id: user.id, email, password }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
