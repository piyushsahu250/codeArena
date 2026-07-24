/**
 * One-time (idempotent) backfill for a genuine data gap confirmed live in production: every
 * Module Coding Test question seeded by seedModuleCoding.js originally shipped with only 3 test
 * cases (1 visible + 2 hidden) — well below the 2-visible/10-hidden minimum enforced on every
 * other coding-question creation surface on the platform. A student could pass "Sum of Two
 * Integers" (Module 1) with only 2 hidden cases actually checked, confirmed via a live screenshot
 * showing "Accepted — 2/2 hidden test cases passed."
 *
 * Because seedModuleCoding.js's own seeding loop skips a module entirely once it already has any
 * questions (`existingCount === 0` guard — see seedModuleCoding()), simply editing that file's
 * source data does NOT touch already-seeded production rows. This script does the one-time reset
 * for whichever questions the source data has been backfilled for (marked with a `visibleCount`
 * field — see seedModuleCoding.js's Module 1 questions) — anything without that marker is left
 * untouched, so this is safe to run repeatedly as more modules get backfilled over time.
 *
 * Reuses MODULE_TESTS (the exact same object seedModuleCoding.js seeds new databases from) as the
 * single source of truth, so this script can never drift from what a fresh seed would produce.
 */
const prisma = require("../src/prisma");
const { MODULE_TESTS } = require("../prisma/seedModuleCoding");

async function backfillModuleCodingTestCases() {
  const course = await prisma.course.findUnique({ where: { slug: "java" } });
  if (!course) return 0;

  let updatedQuestions = 0;
  for (const [moduleTitle, spec] of Object.entries(MODULE_TESTS)) {
    const mod = await prisma.courseModule.findUnique({
      where: { courseId_title: { courseId: course.id, title: moduleTitle } },
    });
    if (!mod) continue;
    const test = await prisma.moduleCodingTest.findUnique({ where: { moduleId: mod.id } });
    if (!test) continue;

    for (const q of spec.questions) {
      if (q.visibleCount == null) continue; // not yet backfilled in source data — leave untouched

      const existing = await prisma.question.findFirst({
        where: { moduleCodingTestId: test.id, title: q.title, questionType: "CODING" },
        include: { testCases: true },
      });
      if (!existing) continue; // question doesn't exist yet — the normal seed path will create it

      const currentCases = existing.testCases.map((tc) => `${tc.input}|${tc.expected}|${tc.isHidden}`).sort().join("\n");
      const targetCases = q.testCases
        .map((tc, i) => `${tc.input}|${tc.expected}|${i >= q.visibleCount}`)
        .sort()
        .join("\n");
      if (currentCases === targetCases) continue; // already matches — no-op

      await prisma.testCase.deleteMany({ where: { questionId: existing.id } });
      await prisma.question.update({
        where: { id: existing.id },
        data: {
          testCases: {
            create: q.testCases.map((tc, i) => ({ input: tc.input, expected: tc.expected, isHidden: i >= q.visibleCount })),
          },
        },
      });
      const visible = q.testCases.filter((_, i) => i < q.visibleCount).length;
      const hidden = q.testCases.length - visible;
      console.log(`[backfillModuleCodingTestCases] "${moduleTitle}" / "${q.title}": reset to ${visible} visible + ${hidden} hidden test cases.`);
      updatedQuestions++;
    }
  }
  return updatedQuestions;
}

async function main() {
  const count = await backfillModuleCodingTestCases();
  console.log(`[backfillModuleCodingTestCases] Done. Updated ${count} question(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillModuleCodingTestCases] failed:", err);
  process.exit(1);
});
