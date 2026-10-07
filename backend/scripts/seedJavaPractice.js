// Idempotent seed for the "JAVA Practice" track (Course.kind = PRACTICE, slug java-practice). Safe to re-run: every row is
// found by a stable key (course slug, module title, chapter title, level title, question title) and only created if absent;
// existing rows are never modified or deleted, so admin edits survive a re-seed.
//
//   Course JAVA Practice (global, Published, NOT assigned to any institute -> invisible to students until an admin assigns it)
//     7 sections; "Basic Java" has the 11 topics, each with 4 levels (Level 0..3).
//     Levels start as DRAFT (hidden) so students never receive an empty assessment; the one exception is
//     Basic I/P & O/P - Level 0, which ships with 3 real Java problems so the whole flow can be exercised end to end.
//     Defaults: 1 attempt, 90 minutes, pass mark 60%, each level unlocks after passing the previous one, topics are sequential.
const prisma = require("../src/prisma");

const SLUG = "java-practice";
const SECTIONS = [
  ["Basic Java", "Core Java problem solving: I/O, control flow, loops, patterns, arrays, strings, bits and functions."],
  ["OOPS & Advanced Java", "Object-oriented design and advanced language features."],
  ["Advanced Programming Using Java", "Larger programs: collections, streams, concurrency and APIs."],
  ["Basic Data Structures", "Stacks, queues, linked lists and hashing."],
  ["Advanced Data Structures", "Trees, heaps, graphs and tries."],
  ["Algorithms", "Sorting, searching, recursion, greedy and dynamic programming."],
  ["Advanced Arrays", "Two pointers, sliding window, prefix sums and matrix techniques."],
];
const TOPICS = [
  ["Basic I/P & O/P", "13:48 hrs", ["Introduction to Programming", "Data Types", "Variables", "Operators", "Expressions", "Precedence"]],
  ["Conditional Statement", "14:46 hrs", ["Conditional Statements", "Switch Statements"]],
  ["Looping", "12:31 hrs", ["Looping"]],
  ["Number Based Problems", "8:00 hrs", ["Number Problems"]],
  ["Number Crunching", "6:30 hrs", ["Digit Manipulation", "Nested Loops"]],
  ["Patterns", "7:00 hrs", ["Patterns"]],
  ["Arrays", "9:00 hrs", ["Array Basics", "Array Operations"]],
  ["Strings", "11:43 hrs", ["Strings"]],
  ["Bit Manipulation", "7:00 hrs", ["Bit Manipulation"]],
  ["2D Array", "6:00 hrs", ["2D Array"]],
  ["Functions", "7:30 hrs", ["Functions"]],
];
const LEVELS = [
  ["Level 0", "Beginner", "Basic understanding: read the problem, use the core syntax correctly."],
  ["Level 1", "Application", "Basic application of the topic to small, direct problems."],
  ["Level 2", "Intermediate", "Intermediate problem solving that combines ideas."],
  ["Level 3", "Advanced", "Advanced problem solving: edge cases and efficiency matter."],
];
const INSTRUCTIONS = [
  "Attempt this test once. A second attempt is only granted for a genuine technical problem, and you will need to show evidence of it.",
  "Work on your own. Do not ask for, or give, help to anyone else during the test.",
  "Do not take screenshots, record the screen or copy the questions or answers out of the test.",
  "Do not post requests for clarification of the questions anywhere.",
  "Answer every question as well as you can. There is no negative marking.",
  "Breaking the portal rules can lead to disciplinary action.",
].map((l, i) => `${i + 1}. ${l}`).join("\n");

// [title, statement, [[input, expected]...] visible, hidden]
const LEVEL0_QUESTIONS = [
  ["Hello, Java", "Print exactly the text Hello, Java! on a single line.\n\nInput: none.\nOutput: Hello, Java!",
    [["", "Hello, Java!"], ["", "Hello, Java!"]], [["", "Hello, Java!"], ["", "Hello, Java!"], ["", "Hello, Java!"], ["", "Hello, Java!"], ["", "Hello, Java!"]]],
  ["Sum of Two Numbers", "Read two integers a and b and print their sum.\n\nInput: two integers separated by a space.\nOutput: a + b.",
    [["2 3", "5"], ["10 -4", "6"]], [["0 0", "0"], ["-5 -7", "-12"], ["100000 200000", "300000"], ["7 0", "7"], ["-1 1", "0"]]],
  ["Rectangle Area and Perimeter", "Read the length and breadth of a rectangle (integers) and print its area and perimeter on one line separated by a space.\n\nInput: length breadth.\nOutput: area perimeter.",
    [["4 5", "20 18"], ["1 1", "1 4"]], [["10 10", "100 40"], ["3 8", "24 22"], ["100 1", "100 202"], ["7 2", "14 18"], ["12 12", "144 48"]]],
];

(async () => {
  const stats = { created: 0, existing: 0 };
  const take = async (found, make) => { if (found) { stats.existing++; return found; } stats.created++; return make(); };

  const course = await take(await prisma.course.findUnique({ where: { slug: SLUG } }), () => prisma.course.create({ data: {
    slug: SLUG, name: "JAVA Practice", kind: "PRACTICE", status: "PUBLISHED", isActive: true, instituteId: null, order: 50,
    description: "Level-based Java practice: pick a topic, work through Level 0 to Level 3, and unlock the next level by passing.",
  } }));

  let basicJavaSection = null;
  for (let si = 0; si < SECTIONS.length; si++) {
    const [title, description] = SECTIONS[si];
    const sec = await take(await prisma.courseModule.findUnique({ where: { courseId_title: { courseId: course.id, title } } }), () => prisma.courseModule.create({ data: {
      courseId: course.id, title, description, order: si, isActive: true, publishedAt: new Date(), unlockRule: "NONE",
    } }));
    if (si === 0) basicJavaSection = sec;
  }

  for (let ti = 0; ti < TOPICS.length; ti++) {
    const [title, durationLabel, outline] = TOPICS[ti];
    const chapter = await take(await prisma.chapter.findUnique({ where: { moduleId_title: { moduleId: basicJavaSection.id, title } } }), () => prisma.chapter.create({ data: {
      moduleId: basicJavaSection.id, title, order: ti, durationLabel, outline, isActive: true, publishedAt: new Date(), unlockRule: ti === 0 ? "NONE" : "SEQUENTIAL",
    } }));
    for (let li = 0; li < LEVELS.length; li++) {
      const [lname, difficulty, description] = LEVELS[li];
      const levelTitle = `${title} - ${lname}`;
      const level = await take(await prisma.moduleCodingTest.findFirst({ where: { chapterId: chapter.id, title: levelTitle } }), () => prisma.moduleCodingTest.create({ data: {
        chapterId: chapter.id, title: levelTitle, order: li, description, difficulty, instructions: INSTRUCTIONS,
        allowedLanguages: ["java"], questionCount: 3, randomizeQuestions: false, passingPercent: 60, timeLimitMin: 90, maxAttempts: 1,
        cooldownMinutes: 0, maxViolations: 3, requireFullscreen: false, allowResume: true,
        unlockRule: li === 0 ? "NONE" : "PASS_PREVIOUS", isActive: ti === 0 && li === 0, publishedAt: ti === 0 && li === 0 ? new Date() : null, // Draft until an admin publishes (only the demo level ships live)
      } }));
      if (ti === 0 && li === 0) {
        for (const [qt, statement, visible, hidden] of LEVEL0_QUESTIONS) {
          await take(await prisma.question.findFirst({ where: { moduleCodingTestId: level.id, title: qt } }), () => prisma.question.create({ data: {
            title: qt, description: statement, difficulty: "EASY", questionType: "CODING", timeLimitMs: 2000, moduleCodingTestId: level.id, questionStatus: "PUBLISHED",
            testCases: { create: [...visible.map(([i, e]) => ({ input: i, expected: e, isHidden: false })), ...hidden.map(([i, e]) => ({ input: i, expected: e, isHidden: true }))] },
          } }));
        }
      }
    }
  }
  console.log(`JAVA Practice seed: created ${stats.created} rows, ${stats.existing} already existed.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
