const prisma = require("../src/prisma");
const ID = "bb8d3b95-324d-4cd3-bc4c-06b585192c3b";

async function main() {
  await prisma.loginSession.deleteMany({ where: { userId: ID } });
  const result = await prisma.user.deleteMany({ where: { id: ID } });
  console.log(`Deleted ${result.count} temp account.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
