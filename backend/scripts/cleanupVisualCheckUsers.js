// One-off: removes the temp INSTITUTE_ADMIN accounts created for manual verification of the
// dashboard build (visual-check + two stale TEMP rows left from earlier this rollout). These are
// brand-new dummy accounts with no other activity, so a straightforward userId-scoped delete is
// safe here — the earlier session-wipe incidents were about deleting a REAL account's unrelated
// active sessions, not about deleting a temp account outright.
const prisma = require("../src/prisma");

async function main() {
  const emails = [
    "visual-check-institute-admin@example.invalid",
    "test-institute-admin-1787626588634@example.com",
    "test-institute-admin-1787595924911@example.com",
  ];
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { console.log("SKIP (not found)", email); continue; }
    await prisma.loginSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("DELETED", email);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
