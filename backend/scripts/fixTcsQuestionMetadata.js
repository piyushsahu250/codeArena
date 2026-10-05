// One-off: the count-based fix (addTcsInterviewQuestions.js) wasn't enough — pickQuestions()'s
// SOFT_FILTER_FIELDS (company/role/packageBand/experienceLevel/difficulty) are matched as hard
// exact-match AND conditions, and InterviewHub.jsx's Company Round form always sends
// experienceLevel: "FRESHER" (its default) and difficulty from a dropdown defaulting to "EASY".
// None of the 9 TCS questions (3 pre-existing + 6 just added) had experienceLevel set at all, so
// every one was excluded regardless of company match, and the fallback banner persisted. Aligns
// every TCS question to the form's actual defaults so the default flow (no dropdowns touched)
// reliably surfaces real content.
const prisma = require("../src/prisma");

async function main() {
  const result = await prisma.interviewQuestion.updateMany({
    where: { company: { equals: "TCS", mode: "insensitive" } },
    data: { experienceLevel: "FRESHER", difficulty: "EASY" },
  });
  console.log(`Updated ${result.count} TCS question(s) to experienceLevel=FRESHER, difficulty=EASY`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
