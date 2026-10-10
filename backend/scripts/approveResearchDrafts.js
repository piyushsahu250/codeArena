// Approves research-imported PENDING drafts that are NOT coding questions, through the same promotion function the review screen uses
// (approveDraftQuestion). Coding drafts are never touched (they need 5 hidden test cases first). DRY RUN by default.
//   node scripts/approveResearchDrafts.js                                   list what would be approved
//   node scripts/approveResearchDrafts.js --apply --confirm=APPROVE-NON-CODING-RESEARCH-DRAFTS
// Approved questions are platform-owned (instituteId null); frequency/package labels stay empty (a human sets those).
const prisma = require("../src/prisma");
const { approveDraftQuestion } = require("../src/routes/interviewDrafts");

(async () => {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--confirm=APPROVE-NON-CODING-RESEARCH-DRAFTS")) { console.error("--apply needs --confirm=APPROVE-NON-CODING-RESEARCH-DRAFTS"); process.exit(2); }
  const owner = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true, name: true } });
  const drafts = await prisma.interviewQuestionDraft.findMany({ where: { status: "PENDING", importKey: { not: null }, category: { not: "CODING" } }, orderBy: { importKey: "asc" } });
  const byCat = {};
  for (const d of drafts) byCat[d.category] = (byCat[d.category] || 0) + 1;
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${drafts.length} non-coding research drafts, reviewer ${owner.name}`, byCat);
  if (!apply) { await prisma.$disconnect(); return; }
  const req = { user: { id: owner.id, name: owner.name }, requesterInstituteId: null };
  let ok = 0; const failed = [];
  for (const d of drafts) {
    try { await approveDraftQuestion(d, { req }); ok++; } catch (e) { failed.push(`${d.importKey}: ${e.message}`); }
  }
  console.log(`Approved ${ok}; failed ${failed.length}`);
  failed.slice(0, 20).forEach((f) => console.log("  " + f));
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
