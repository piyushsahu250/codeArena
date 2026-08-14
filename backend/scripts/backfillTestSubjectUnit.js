/**
 * One-time (idempotent) backfill for Test.subject, introduced alongside the staff test-ownership/
 * sharing feature (see backend/src/utils/testOwnership.js). Every existing Test already has a
 * real, correct createdById — nothing to recover there — but predates the Subject/Unit fields
 * added for the "Java Unit 1 Test" vs "DBMS Unit 1 Test" isolation requirement, so subject/unit
 * start out null on every pre-existing row.
 *
 * Inference, not a guess dressed up as fact: for each Test with subject IS NULL, look at the
 * Question.subject values of its linked TestQuestion rows. If one non-null subject accounts for
 * >= 80% of the linked questions, set Test.subject to it. Otherwise (no questions, or no clear
 * majority) leave subject null — the Admin UI (StaffDashboard.jsx) already treats a null subject
 * as "Needs review" rather than silently mis-tagging it. Test.unit is never auto-set: there's no
 * per-question signal reliable enough to infer it from, so it's left for manual entry.
 *
 * Only ever touches rows where subject IS NULL, so re-running this on every deploy (see Dockerfile)
 * is always safe and never overwrites a subject an admin/staff has since set explicitly.
 */
const prisma = require("../src/prisma");

const MAJORITY_THRESHOLD = 0.8;

async function backfillTestSubjectUnit() {
  const candidates = await prisma.test.findMany({
    where: { subject: null },
    select: {
      id: true,
      title: true,
      questions: { select: { question: { select: { subject: true } } } },
    },
  });

  let updatedCount = 0;
  for (const test of candidates) {
    const subjects = test.questions.map((tq) => tq.question?.subject).filter(Boolean);
    if (subjects.length === 0) continue;

    const counts = new Map();
    for (const s of subjects) counts.set(s, (counts.get(s) || 0) + 1);
    let topSubject = null;
    let topCount = 0;
    for (const [s, c] of counts) {
      if (c > topCount) {
        topSubject = s;
        topCount = c;
      }
    }
    if (topSubject && topCount / subjects.length >= MAJORITY_THRESHOLD) {
      await prisma.test.update({ where: { id: test.id }, data: { subject: topSubject } });
      updatedCount++;
      console.log(`[backfillTestSubjectUnit] Set subject="${topSubject}" on "${test.title}" (${test.id}) — ${topCount}/${subjects.length} linked questions agreed.`);
    }
  }

  const stillUnset = await prisma.test.count({ where: { subject: null } });
  return { updatedCount, candidateTotal: candidates.length, stillUnset };
}

async function main() {
  const { updatedCount, candidateTotal, stillUnset } = await backfillTestSubjectUnit();
  console.log(
    `[backfillTestSubjectUnit] Done. Inferred subject for ${updatedCount} of ${candidateTotal} candidate test(s) this run. ` +
    `${stillUnset} test(s) still have no subject set — these need manual review (no clear majority, or no linked questions).`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillTestSubjectUnit] failed:", err);
  process.exit(1);
});
