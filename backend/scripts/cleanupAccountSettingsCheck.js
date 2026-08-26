const prisma = require("../src/prisma");
const ID = "45130ca9-ddae-4ff1-9bc3-3c0de4cb480c";

async function main() {
  await prisma.loginSession.deleteMany({ where: { userId: ID } });
  const result = await prisma.user.deleteMany({ where: { id: ID } });
  console.log(`Deleted ${result.count} temp account.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
