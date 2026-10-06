// Read-only: prints the Java course structure (modules, chapters, lessons, coding tests/levels, question counts).
const prisma = require("../src/prisma");
(async () => {
  const course = await prisma.course.findFirst({ where: { slug: "java" }, include: { modules: { orderBy: { order: "asc" }, include: {
    chapters: { orderBy: { order: "asc" }, include: { levels: { include: { _count: { select: { questions: true, attempts: true } } } }, _count: { select: { topics: true } } } },
    lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, order: true, chapterId: true, isModuleTest: true } },
    codingTest: { include: { _count: { select: { questions: true, attempts: true } } } },
  } } } });
  for (const m of course.modules) {
    console.log(`\nM${m.order} ${m.title} [${m.id.slice(0,6)}] lessons=${m.lessons.length} codingTest=${m.codingTest ? `${m.codingTest.title} q=${m.codingTest._count.questions} att=${m.codingTest._count.attempts} active=${m.codingTest.isActive}` : "-"}`);
    for (const c of m.chapters) console.log(`   CH${c.order} "${c.title}" topics=${c._count.topics} levels=${c.levels.map(l=>`${l.title}(q${l._count.questions},a${l._count.attempts},${l.isActive})`).join("|")}`);
    console.log("   lessons: " + m.lessons.map(l => `${l.order}:${l.title}${l.isModuleTest?"[TEST]":""}${l.chapterId?"":"(noch)"}`).join(" ; "));
  }
  process.exit(0);
})();
