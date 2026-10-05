// One-off: retroactively fix the 18 Medium/Hard TCS questions created before interview.js's
// POST /admin/questions was fixed to actually persist experienceLevel — every one of them was
// silently saved with experienceLevel: null despite the request explicitly setting it.
const prisma = require("../src/prisma");

async function main() {
  const result = await prisma.interviewQuestion.updateMany({
    where: { company: { equals: "TCS", mode: "insensitive" }, difficulty: { in: ["MEDIUM", "HARD"] }, experienceLevel: null },
    data: { experienceLevel: "FRESHER" },
  });
  console.log(`Updated ${result.count} TCS question(s) to experienceLevel=FRESHER`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
