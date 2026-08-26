const prisma = require("../src/prisma");
const ID = "7a9a3e9a-60bc-4e7a-b8f2-20d7e6faa32e";

async function main() {
  await prisma.loginSession.deleteMany({ where: { userId: ID } });
  const result = await prisma.user.deleteMany({ where: { id: ID } });
  console.log(`Deleted ${result.count} temp account.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
