const prisma = require("../src/prisma");
const ID = "9e7d4e89-24da-45b6-9df0-a7d51a095d68";

async function main() {
  await prisma.loginSession.deleteMany({ where: { userId: ID } });
  const result = await prisma.user.deleteMany({ where: { id: ID } });
  console.log(`Deleted ${result.count} temp account.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
