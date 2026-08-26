// One-off cleanup for the 4 temp accounts created by mkTempDashboardVerifyUsers.js — exact-ID
// deletes only, never a broad filter.
const prisma = require("../src/prisma");

const IDS = [
  "4b1c7203-656b-4127-ba09-a6eade0ed982",
  "858eb630-0b50-4c85-8e0e-6b00ba3e5cd1",
  "9068e6e7-511f-4166-80a8-a30165023fb7",
  "09b3e45f-9a0c-48a8-8d12-04d167296e54",
];

async function main() {
  await prisma.loginSession.deleteMany({ where: { userId: { in: IDS } } });
  const result = await prisma.user.deleteMany({ where: { id: { in: IDS } } });
  console.log(`Deleted ${result.count} temp verification account(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
