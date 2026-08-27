// One-off, read-only: before deciding how invasive a Result Management schema change can safely
// be, check whether real production data already exists in this module (published examinations
// with real student entries) versus it being essentially unused so far.
const prisma = require("../src/prisma");

async function main() {
  const examCount = await prisma.resultExamination.count();
  const publishedCount = await prisma.resultExamination.count({ where: { status: "PUBLISHED" } });
  const entryCount = await prisma.resultEntry.count();
  const bulkEntryCount = await prisma.resultEntry.count({ where: { source: "BULK_IMPORT" } });

  console.log(`Total examinations: ${examCount}`);
  console.log(`Published examinations: ${publishedCount}`);
  console.log(`Total result entries (marks rows): ${entryCount}`);
  console.log(`  of which via bulk import: ${bulkEntryCount}`);

  const examples = await prisma.resultExamination.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    select: { title: true, status: true, totalMarks: true, examDate: true, institute: { select: { name: true } }, _count: { select: { entries: true } } },
  });
  console.log("\nMost recent examinations:");
  for (const e of examples) {
    console.log(`  "${e.title}" [${e.status}] institute=${e.institute?.name || "?"} totalMarks=${e.totalMarks} entries=${e._count.entries} examDate=${e.examDate.toISOString().slice(0, 10)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
