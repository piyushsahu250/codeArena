// Adds hidden test cases to PENDING research-imported CODING drafts. Expected outputs come from verified reference solutions
// (see src/utils/researchHiddenTests.js); the visible samples are kept untouched. A draft whose samples the reference cannot reproduce is skipped
// and reported. DRY RUN by default; idempotent (hidden tests are rebuilt, never appended).
//   node scripts/addHiddenTestsToResearchDrafts.js
//   node scripts/addHiddenTestsToResearchDrafts.js --apply --confirm=ADD-HIDDEN-TESTS
const prisma = require("../src/prisma");
const { buildHiddenTests, checkSamples, problemFor } = require("../src/utils/researchHiddenTests");

(async () => {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--confirm=ADD-HIDDEN-TESTS")) { console.error("--apply needs --confirm=ADD-HIDDEN-TESTS"); process.exit(2); }
  const drafts = await prisma.interviewQuestionDraft.findMany({ where: { status: "PENDING", category: "CODING", importKey: { not: null } }, orderBy: { importKey: "asc" } });
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${drafts.length} pending research coding drafts`);
  let ok = 0; const problems = [];
  for (const d of drafts) {
    const qid = d.researchMeta && d.researchMeta.questionId;
    if (!problemFor(qid)) { problems.push(`${qid}: no generator`); continue; }
    const visible = (Array.isArray(d.testCases) ? d.testCases : []).filter((t) => !t.isHidden);
    if (visible.length < 2) { problems.push(`${qid}: fewer than 2 visible samples`); continue; }
    const bad = checkSamples(qid, visible);
    if (bad.length) { problems.push(`${qid}: reference does not reproduce sample ${JSON.stringify(bad[0])}`); continue; }
    let built;
    try { built = buildHiddenTests(qid); } catch (e) { problems.push(`${qid}: ${e.message}`); continue; }
    if (built.tests.length < 5) { problems.push(`${qid}: only ${built.tests.length} hidden tests`); continue; }
    const bytes = JSON.stringify(built.tests).length;
    console.log(`  ${qid.padEnd(22)} ${built.key.padEnd(24)} visible=${visible.length} hidden=${built.tests.length} (${Math.round(bytes / 1024)} KB)`);
    if (apply) await prisma.interviewQuestionDraft.update({ where: { id: d.id }, data: { testCases: [...visible, ...built.tests] } });
    ok++;
  }
  console.log(`${apply ? "Updated" : "Ready"}: ${ok}; skipped: ${problems.length}`);
  problems.forEach((p) => console.log("  SKIPPED " + p));
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
