/**
 * Idempotent (upsert-by-code) seed for the Employability & Readiness module's initial subject
 * configuration — DSA, Java, and DBMS, matching the module spec's own worked examples for topic
 * taxonomy, BTL distribution, assessment modes, and readiness thresholds. These are standard,
 * well-established computer-science curriculum facts (not fabricated question content or
 * interview claims), and Java's topic list follows this platform's own existing Java course
 * structure (see prisma/seedLearning.js) for consistency.
 *
 * Deliberately does NOT touch the Question table or assign any btlLevel to existing questions —
 * per the module's "never fabricate a BTL classification" rule, that requires actually reading
 * each question's content, which only an admin/staff member (via the CreateQuestion.jsx tagging
 * UI shipped in RA5) or a reviewer with real visibility into the live question bank can do
 * correctly. Coverage for these subjects is intentionally allowed to start at zero and grow as
 * content is tagged — see routes/readiness.js's GET /admin/subjects/:id/coverage for how gaps
 * are surfaced to admins rather than hidden.
 *
 * instituteId/createdById are left null — these are platform-wide subjects visible to every
 * institute (see instituteWhere()'s null-means-global convention), same as how a legacy/global
 * Question row with no instituteId is visible everywhere.
 */
const prisma = require("../src/prisma");

const DEFAULT_BTL_DISTRIBUTION = { 1: 10, 2: 15, 3: 25, 4: 25, 5: 15, 6: 10 };

const ASSESSMENT_MODES = [
  { key: "FOUNDATION", label: "Foundation Readiness", btlMin: 1, btlMax: 2 },
  { key: "APPLICATION", label: "Application Readiness", btlMin: 3, btlMax: 3 },
  { key: "PROBLEM_SOLVING", label: "Problem-Solving Readiness", btlMin: 3, btlMax: 4 },
  { key: "INTERVIEW", label: "Interview Readiness", btlMin: 2, btlMax: 5 },
  { key: "ADVANCED", label: "Advanced Employability Readiness", btlMin: 4, btlMax: 6 },
  { key: "COMPLETE", label: "Complete Subject Employability Assessment", btlMin: 1, btlMax: 6 },
];

const READINESS_THRESHOLDS = [
  { label: "EXCELLENTLY_READY", min: 90 },
  { label: "JOB_READY", min: 75 },
  { label: "NEARLY_READY", min: 60 },
  { label: "DEVELOPING", min: 45 },
  { label: "NEEDS_IMPROVEMENT", min: 25 },
  { label: "FOUNDATION_REQUIRED", min: 0 },
];

const SUBJECTS = [
  {
    code: "DSA",
    name: "Data Structures & Algorithms",
    department: "Computer Science",
    description: "Core data structures, algorithmic problem solving, and complexity analysis.",
    questionTypesAllowed: ["MCQ", "TRUE_FALSE", "MULTISELECT", "CODING"],
    employabilityIndicators: ["Problem Solving", "Complexity Analysis", "Algorithms", "Coding"],
    topics: [
      { name: "Arrays", subtopics: ["1D Arrays", "2D Arrays", "Sliding Window", "Two Pointers"] },
      { name: "Strings", subtopics: ["String Manipulation", "Pattern Matching"] },
      { name: "Linked Lists", subtopics: ["Singly Linked List", "Doubly Linked List", "Cycle Detection"] },
      { name: "Stacks", subtopics: ["Stack Operations", "Expression Evaluation"] },
      { name: "Queues", subtopics: ["Queue Operations", "Circular Queue", "Priority Queue"] },
      { name: "Trees", subtopics: ["Binary Trees", "Binary Search Trees", "Tree Traversals", "Balanced Trees"] },
      { name: "Graphs", subtopics: ["BFS/DFS", "Shortest Path", "Union-Find", "Topological Sort"] },
      { name: "Hashing", subtopics: ["Hash Maps", "Collision Handling"] },
      { name: "Sorting", subtopics: ["Comparison Sorts", "Non-Comparison Sorts"] },
      { name: "Searching", subtopics: ["Linear Search", "Binary Search"] },
      { name: "Recursion", subtopics: ["Backtracking", "Divide and Conquer"] },
      { name: "Dynamic Programming", subtopics: ["Memoization", "Tabulation", "Classic DP Problems"] },
      { name: "Greedy", subtopics: ["Greedy Choice Problems"] },
      { name: "Complexity Analysis", subtopics: ["Time Complexity", "Space Complexity", "Big-O Notation"] },
    ],
  },
  {
    code: "JAVA",
    name: "Java Programming",
    department: "Computer Science",
    description: "Core Java language, object-oriented programming, and application-level problem solving.",
    questionTypesAllowed: ["MCQ", "TRUE_FALSE", "MULTISELECT", "CODING"],
    employabilityIndicators: ["OOP Concepts", "Problem Solving", "Coding", "Debugging"],
    topics: [
      { name: "Java Basics", subtopics: ["JDK/JRE/JVM", "Variables", "Data Types", "Operators", "Type Casting"] },
      { name: "Control Statements", subtopics: ["if-else", "switch", "for/while/do-while loops", "break/continue"] },
      { name: "Methods", subtopics: ["Parameters", "Return Types", "Method Overloading"] },
      { name: "Arrays", subtopics: ["1D Arrays", "2D Arrays"] },
      { name: "Strings", subtopics: ["String Methods", "StringBuilder"] },
      { name: "Object-Oriented Programming", subtopics: ["Classes & Objects", "Inheritance", "Polymorphism", "Encapsulation", "Abstraction", "Interfaces"] },
      { name: "Exception Handling", subtopics: ["try-catch-finally", "Custom Exceptions"] },
      { name: "Collections Framework", subtopics: ["List", "Set", "Map", "Iterators"] },
    ],
  },
  {
    code: "DBMS",
    name: "Database Management Systems",
    department: "Computer Science",
    description: "Relational database fundamentals, design, querying, and transaction management.",
    questionTypesAllowed: ["MCQ", "TRUE_FALSE", "MULTISELECT", "SQL"],
    employabilityIndicators: ["SQL", "Database Design", "Transactions", "Query Optimization"],
    topics: [
      { name: "Fundamentals", subtopics: ["DBMS vs RDBMS", "Data Models"] },
      { name: "ER Model", subtopics: ["Entities", "Relationships", "ER Diagrams"] },
      { name: "Keys", subtopics: ["Primary Key", "Foreign Key", "Candidate Key", "Composite Key"] },
      { name: "Normalization", subtopics: ["1NF", "2NF", "3NF", "BCNF"] },
      { name: "SQL", subtopics: ["DDL", "DML", "Joins", "Aggregate Functions", "Subqueries"] },
      { name: "Transactions", subtopics: ["ACID Properties", "Transaction States"] },
      { name: "Concurrency", subtopics: ["Locking", "Deadlocks", "Isolation Levels"] },
      { name: "Indexing", subtopics: ["B-Tree Indexes", "Hash Indexes"] },
      { name: "Query Optimization", subtopics: ["Query Execution Plans", "Cost Estimation"] },
    ],
  },
];

async function seedReadinessSubjects() {
  let created = 0, updated = 0;
  for (const s of SUBJECTS) {
    const existing = await prisma.readinessSubject.findFirst({ where: { code: s.code, instituteId: null } });
    const data = {
      name: s.name,
      code: s.code,
      department: s.department,
      description: s.description,
      topics: s.topics,
      questionTypesAllowed: s.questionTypesAllowed,
      defaultBtlDistribution: DEFAULT_BTL_DISTRIBUTION,
      assessmentModes: ASSESSMENT_MODES,
      employabilityIndicators: s.employabilityIndicators,
      defaultDurationMin: 45,
      passingPercent: 50,
      readinessThresholds: READINESS_THRESHOLDS,
      isActive: true,
      instituteId: null,
      createdById: null,
    };
    if (existing) {
      await prisma.readinessSubject.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.readinessSubject.create({ data });
      created++;
    }
  }
  return { created, updated };
}

async function main() {
  const { created, updated } = await seedReadinessSubjects();
  console.log(`[seedReadinessSubjects] Done. Created ${created}, updated ${updated}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[seedReadinessSubjects] failed:", err);
  process.exit(1);
});
