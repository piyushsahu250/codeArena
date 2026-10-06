// Restructures the existing Java course into Course > Module > Chapter > { Reference Material, Coding Level }.
//
// Today every module has ONE generic "General" chapter holding all its lessons. This splits each module into real
// topic chapters and puts the practice test + module coding assessment in a final "Practice & Assessment" chapter.
//
// Zero data loss by construction:
//   - no lesson / question / attempt / progress row is created or deleted; lessons are only re-pointed at a chapter
//     (LessonProgress is keyed by lessonId, so student progress is untouched) and given a new display `order`
//   - the existing "General" chapter is RENAMED into the first chapter (keeps its id and any Level under it)
//   - each module's existing coding test keeps its moduleId (so it still gates the next module exactly as before)
//     and additionally gets chapterId = the module's final chapter, which is what makes it appear as that chapter's Level
//   - every chapter created here is Published, so students see the same content as before
//   - aborts (rolls back) if any lesson cannot be placed, or if row counts differ afterwards
// Dry run by default; pass --apply to write.
const prisma = require("../src/prisma");

const PRACTICE = "Practice & Assessment";
const PLAN = {
  "Introduction to Java": [["Getting Started with Java", ["What is Java?", "Features of Java", "History of Java"]], ["Java Platform & Architecture", ["JDK, JRE, JVM", "Java Architecture"]], ["Setup & Your First Program", ["Installing Java", "Setting up the IDE", "First Java Program", "Compilation Process"]]],
  "Java Basics": [["Variables & Data Types", ["Variables", "Data Types", "Type Casting"]], ["Operators & Input", ["Operators", "User Input"]], ["Syntax Elements", ["Comments", "Keywords", "Identifiers"]]],
  "Control Statements": [["Conditional Statements", ["if", "if-else", "Nested if", "switch"]], ["Loops", ["for loop", "while loop", "do-while"]], ["Jump Statements", ["break", "continue"]]],
  "Methods": [["Defining Methods", ["Methods", "Parameters", "Return Types"]], ["Overloading, Recursion & Scope", ["Method Overloading", "Recursion", "Variable Scope"]]],
  "Arrays": [["Working with Arrays", ["1D Arrays", "2D Arrays", "Array Operations"]], ["Searching & Sorting", ["Searching", "Sorting"]]],
  "Strings": [["String Basics", ["String", "StringBuilder", "StringBuffer"]], ["String Methods & Regular Expressions", ["String Methods", "Regular Expressions"]]],
  "Object-Oriented Programming (OOP)": [["Classes & Objects", ["Classes", "Objects", "Constructors"]], ["Inheritance & Polymorphism", ["Inheritance", "Polymorphism"]], ["Abstraction, Encapsulation & Interfaces", ["Abstraction", "Encapsulation", "Interfaces"]]],
  "Exception Handling": [["try, catch & finally", ["try", "catch", "finally"]], ["throw, throws & Custom Exceptions", ["throw", "throws", "Custom Exceptions"]]],
  "Collections Framework": [["Lists", ["ArrayList", "LinkedList"]], ["Maps", ["HashMap", "TreeMap", "LinkedHashMap"]], ["Sets", ["HashSet", "LinkedHashSet", "TreeSet"]], ["Queues & Stacks", ["Queue", "Stack", "PriorityQueue"]]],
  "File Handling": [["Reading Files", ["Reading Files", "BufferedReader", "Scanner"]], ["Writing Files", ["Writing Files", "FileWriter"]]],
  "Multithreading": [["Thread Basics", ["Threads", "Runnable", "Thread Lifecycle", "Process vs Thread"]], ["Synchronization & Locks", ["Synchronization", "Locks & Atomic Classes", "Concurrent Collections"]], ["Executors & Asynchronous Programming", ["Callable, ExecutorService & Thread Pools", "Future & CompletableFuture", "Fork/Join & Virtual Threads"]]],
  "Java 8 Features": [["Lambdas & Functional Interfaces", ["Lambda Expressions", "Functional Interfaces", "Method References"]], ["Streams & Optional", ["Stream API", "Optional"]], ["Modern Java Features", ["Date and Time API", "Records", "Sealed Classes", "Pattern Matching", "Text Blocks"]]],
  "JDBC": [["Connecting & CRUD", ["Database Connectivity", "CRUD Operations"]], ["Statements & ResultSet", ["PreparedStatement", "ResultSet", "CallableStatement"]], ["Batch Processing & DAO", ["Batch Processing", "DAO Pattern"]]],
  "Advanced Java": [["Generics, Reflection & Annotations", ["Generics", "Reflection", "Annotations"]], ["Serialization & Networking", ["Serialization", "Networking"]], ["JVM Internals", ["JVM Architecture & Class Loading", "Memory Areas: Heap, Stack & Metaspace", "Garbage Collection & the JIT Compiler"]], ["Design Patterns & Modules", ["Design Patterns in Java", "Java Platform Module System (JPMS)"]]],
  "Data Structures & Algorithms in Java": [["Complexity & Hashing", ["Big-O Notation & Complexity Analysis", "Hashing & Hash Tables"]], ["Linear Data Structures", ["Arrays", "Linked Lists", "Stack", "Queue"]], ["Trees & Graphs", ["Trees", "Graphs"]], ["Sorting & Searching", ["Sorting", "Searching"]], ["Problem-Solving Techniques", ["Two Pointers & Sliding Window", "Greedy Algorithms", "Backtracking", "Dynamic Programming"]]],
  "Interview Preparation": [["Core Interview Questions", ["Frequently Asked Java Interview Questions", "Interview Questions by Topic", "MCQs"]], ["Coding & Company Preparation", ["Coding Questions", "Company-based Questions", "Previous Placement Questions"]]],
  "Spring & Spring Boot": [["Spring Core & Boot Basics", ["Introduction to Spring & Inversion of Control", "Spring Boot Basics: Starters & Auto-Configuration", "Core Annotations: @Component, @Service, @Repository, @Autowired"]], ["REST APIs & Data Access", ["Building REST APIs with @RestController", "Spring Data JPA: Entities & Repositories"]], ["Configuration, Validation & Security", ["Application Properties & Profiles", "Exception Handling: @ControllerAdvice & @ExceptionHandler", "Validation with Bean Validation (@Valid)", "Spring Security Basics"]]],
  "Testing & Build Tools": [["Testing Fundamentals", ["Why Automated Testing Matters", "JUnit 5 Basics: @Test and Assertions", "Parameterized Tests & Test Organization", "Mockito: Mocking Dependencies"]], ["Build Tools", ["Maven Fundamentals", "Gradle Fundamentals"]], ["Integration Testing & CI", ["Integration Testing with @SpringBootTest", "Code Coverage & Continuous Integration"]]],
};

const APPLY = process.argv.includes("--apply");

async function counts() {
  return {
    lessons: await prisma.lesson.count(), progress: await prisma.lessonProgress.count(), practice: await prisma.practiceQuestion.count(),
    tests: await prisma.moduleCodingTest.count(), questions: await prisma.question.count(), attempts: await prisma.moduleCodingAttempt.count(),
    subs: await prisma.moduleCodingSubmission.count(), chapters: await prisma.chapter.count(),
  };
}

(async () => {
  const course = await prisma.course.findFirst({ where: { slug: "java" }, include: { modules: { orderBy: { order: "asc" }, include: { chapters: { orderBy: { order: "asc" } }, lessons: true, codingTest: true } } } });
  if (!course) throw new Error("java course not found");
  const before = await counts();
  const actions = [];

  for (const mod of course.modules) {
    const plan = PLAN[mod.title];
    if (!plan) throw new Error(`no plan for module "${mod.title}"`);
    if (mod.chapters.length !== 1) throw new Error(`module "${mod.title}" has ${mod.chapters.length} chapters; expected exactly the one General chapter (already restructured?)`);
    const byTitle = new Map(mod.lessons.map((l) => [l.title, l]));
    const used = new Set();
    const chapters = plan.map(([title, lessonTitles]) => ({ title, lessons: lessonTitles.map((t) => { const l = byTitle.get(t); if (!l) throw new Error(`lesson "${t}" not found in "${mod.title}"`); if (used.has(l.id)) throw new Error(`lesson "${t}" listed twice`); used.add(l.id); return l; }) }));
    const rest = mod.lessons.filter((l) => !used.has(l.id)).sort((a, b) => a.order - b.order);
    for (const l of rest) if (!(l.isModuleTest || /^Practice/.test(l.title))) throw new Error(`unplaced lesson "${l.title}" in "${mod.title}" is not a practice/test lesson`);
    if (rest.length === 0) throw new Error(`module "${mod.title}" has no practice lesson`);
    chapters.push({ title: PRACTICE, lessons: rest, isPractice: true });
    actions.push({ mod, chapters });
  }

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} -- ${actions.length} modules, ${actions.reduce((n, a) => n + a.chapters.length, 0)} chapters`);
  for (const { mod, chapters } of actions) console.log(`  ${mod.title}: ${chapters.map((c) => `${c.title} (${c.lessons.length})`).join(" | ")}${mod.codingTest ? "  [+ coding assessment -> last chapter]" : ""}`);
  if (!APPLY) { console.log("before:", JSON.stringify(before)); process.exit(0); }

  await prisma.$transaction(async (tx) => {
    for (const { mod, chapters } of actions) {
      const general = mod.chapters[0];
      let seq = 0;
      let lastChapterId = null;
      for (let ci = 0; ci < chapters.length; ci++) {
        const c = chapters[ci];
        let chapterId;
        if (ci === 0) {
          // Rename the existing chapter in place: keeps its id, any Level on it, and its published state.
          await tx.chapter.update({ where: { id: general.id }, data: { title: c.title, order: 0, isActive: true, archivedAt: null, publishedAt: new Date() } });
          chapterId = general.id;
        } else {
          chapterId = (await tx.chapter.create({ data: { moduleId: mod.id, title: c.title, order: ci, isActive: true, publishedAt: new Date() } })).id;
        }
        for (const l of c.lessons) await tx.lesson.update({ where: { id: l.id }, data: { chapterId, order: seq++ } });
        lastChapterId = chapterId;
      }
      if (mod.codingTest) await tx.moduleCodingTest.update({ where: { id: mod.codingTest.id }, data: { chapterId: lastChapterId } });
    }
    const after = await (async () => ({ lessons: await tx.lesson.count(), progress: await tx.lessonProgress.count(), tests: await tx.moduleCodingTest.count(), questions: await tx.question.count(), attempts: await tx.moduleCodingAttempt.count(), subs: await tx.moduleCodingSubmission.count(), practice: await tx.practiceQuestion.count() }))();
    for (const k of Object.keys(after)) if (after[k] !== before[k]) throw new Error(`row count for ${k} changed ${before[k]} -> ${after[k]}; rolling back`);
    const orphan = await tx.lesson.count({ where: { module: { courseId: course.id }, chapterId: null } });
    if (orphan) throw new Error(`${orphan} lessons have no chapter; rolling back`);
  }, { timeout: 120000, maxWait: 20000 });

  console.log("after:", JSON.stringify(await counts()));
  console.log("JAVA COURSE RESTRUCTURED");
  process.exit(0);
})().catch((e) => { console.error("ABORTED:", e.message); process.exit(1); });
