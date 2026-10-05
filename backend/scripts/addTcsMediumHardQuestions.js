// One-off: close the TCS Company Round content gap for the Medium ("Intermediate") and Hard
// ("Advanced") difficulty tiers — the Easy/Fresher tier was already closed (addTcsInterviewQuestions.js
// + fixTcsQuestionMetadata.js). Same HR:2/TECHNICAL:3/CODING:2/MANAGERIAL:2 composition per tier,
// experienceLevel: "FRESHER" set directly at creation (matching InterviewHub.jsx's form default,
// which is what a student sees unless they explicitly pick "Experienced"). Creates one disposable
// INSTITUTE_ADMIN actor to drive the real HTTP calls (same validation the route enforces for
// everyone); deletes it afterward. The questions themselves are NOT cleaned up.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const EXPERIENCE_LEVEL = "FRESHER";

const NEW_QUESTIONS = [
  // ===== MEDIUM =====
  {
    category: "HR", company: "TCS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "Describe a situation where you disagreed with a teammate's approach. How did you resolve it?",
    expectedKeywords: ["disagreement", "communication", "compromise", "resolution"],
  },
  {
    category: "HR", company: "TCS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "Where do you see yourself in the next five years, and how does TCS fit into that plan?",
    expectedKeywords: ["career goals", "growth", "tcs", "long-term"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "DBMS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "What is the difference between a primary key and a foreign key? Explain with an example.",
    expectedKeywords: ["primary key", "foreign key", "unique", "reference"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "Networking", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "Explain the difference between TCP and UDP, and when you would use each.",
    expectedKeywords: ["tcp", "udp", "reliable", "connectionless"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "Java", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "What is exception handling in Java? Explain try-catch-finally with an example.",
    expectedKeywords: ["exception", "try", "catch", "finally"],
  },
  {
    category: "MANAGERIAL", company: "TCS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "How would you motivate a team member who has lost interest in a long-running project?",
    expectedKeywords: ["motivation", "engagement", "communication", "goals"],
  },
  {
    category: "MANAGERIAL", company: "TCS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "If two of your team members have a conflict that is affecting delivery, how would you step in?",
    expectedKeywords: ["conflict resolution", "mediation", "team", "delivery"],
  },
  {
    category: "CODING", company: "TCS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL, title: "Longest Word in a Sentence",
    prompt: "Read a line of space-separated words. Print the longest word. If multiple words tie for longest, print the first one that appears.",
    constraints: "1 <= number of words <= 1000",
    inputFormat: "A single line containing space-separated words.",
    outputFormat: "Print the longest word.",
    testCases: [
      { input: "the quick brown fox", expected: "quick", isHidden: false },
      { input: "a bb ccc dd", expected: "ccc", isHidden: false },
      { input: "hello world", expected: "hello", isHidden: true },
      { input: "TCS is a great company", expected: "company", isHidden: true },
      { input: "x", expected: "x", isHidden: true },
      { input: "cat cat cat", expected: "cat", isHidden: true },
      { input: "one two three four five", expected: "three", isHidden: true },
    ],
  },
  {
    category: "CODING", company: "TCS", difficulty: "MEDIUM", experienceLevel: EXPERIENCE_LEVEL, title: "Matrix Row Sum Maximum",
    prompt: "Read an N x M matrix of integers. Print the 0-based index of the row with the maximum sum. If there's a tie, print the smallest index.",
    constraints: "1 <= N, M <= 100",
    inputFormat: "First line: N and M. Next N lines: M space-separated integers each.",
    outputFormat: "Print a single integer: the 0-based row index with maximum sum.",
    testCases: [
      { input: "2 3\n1 2 3\n4 5 6", expected: "1", isHidden: false },
      { input: "3 2\n5 5\n1 1\n10 0", expected: "0", isHidden: false },
      { input: "1 1\n42", expected: "0", isHidden: true },
      { input: "4 1\n3\n7\n7\n2", expected: "1", isHidden: true },
      { input: "2 3\n-1 -2 -3\n-1 -1 -1", expected: "1", isHidden: true },
      { input: "3 3\n1 1 1\n1 1 1\n1 1 1", expected: "0", isHidden: true },
      { input: "2 2\n0 0\n0 1", expected: "1", isHidden: true },
    ],
  },

  // ===== HARD =====
  {
    category: "HR", company: "TCS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "Tell us about the most difficult professional decision you've had to make and its outcome.",
    expectedKeywords: ["difficult decision", "outcome", "responsibility", "reflection"],
  },
  {
    category: "HR", company: "TCS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "How do you handle receiving critical feedback about your work in front of others?",
    expectedKeywords: ["feedback", "professionalism", "improvement", "composure"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "System Design", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "How would you design a URL shortening service like bit.ly? Discuss the key components.",
    expectedKeywords: ["hashing", "database", "scalability", "redirect"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "DBMS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "Explain ACID properties in database transactions with a real-world example.",
    expectedKeywords: ["atomicity", "consistency", "isolation", "durability"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "Algorithms", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "Explain the difference between greedy algorithms and dynamic programming with an example of each.",
    expectedKeywords: ["greedy", "dynamic programming", "optimal substructure", "overlapping subproblems"],
  },
  {
    category: "MANAGERIAL", company: "TCS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "You're leading a project that is falling behind schedule due to unclear requirements from the client. What steps would you take?",
    expectedKeywords: ["requirements", "client communication", "scope", "timeline"],
  },
  {
    category: "MANAGERIAL", company: "TCS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL,
    prompt: "How would you handle a situation where senior management asks you to cut corners on quality to meet a deadline?",
    expectedKeywords: ["quality", "escalate", "risk", "stakeholders"],
  },
  {
    category: "CODING", company: "TCS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL, title: "Longest Increasing Subsequence Length",
    prompt: "Read N integers. Print the length of the longest strictly increasing subsequence.",
    constraints: "1 <= N <= 1000",
    inputFormat: "First line: N. Second line: N space-separated integers.",
    outputFormat: "Print a single integer.",
    testCases: [
      { input: "8\n10 9 2 5 3 7 101 18", expected: "4", isHidden: false },
      { input: "4\n0 1 0 3", expected: "3", isHidden: false },
      { input: "1\n5", expected: "1", isHidden: true },
      { input: "5\n5 4 3 2 1", expected: "1", isHidden: true },
      { input: "5\n1 2 3 4 5", expected: "5", isHidden: true },
      { input: "7\n7 7 7 7 7 7 7", expected: "1", isHidden: true },
      { input: "9\n2 2 3 1 4 5 3 6 1", expected: "5", isHidden: true },
    ],
  },
  {
    category: "CODING", company: "TCS", difficulty: "HARD", experienceLevel: EXPERIENCE_LEVEL, title: "Minimum Coins for Amount",
    prompt: "Given N coin denominations and a target amount, print the minimum number of coins needed to make that amount using an unlimited supply of each denomination. If it's not possible, print -1.",
    constraints: "1 <= N <= 20\n0 <= amount <= 10000",
    inputFormat: "First line: N and amount. Second line: N space-separated denominations.",
    outputFormat: "Print a single integer: the minimum number of coins, or -1.",
    testCases: [
      { input: "3 11\n1 2 5", expected: "3", isHidden: false },
      { input: "1 3\n2", expected: "-1", isHidden: false },
      { input: "4 0\n1 2 5 10", expected: "0", isHidden: true },
      { input: "1 5\n1", expected: "5", isHidden: true },
      { input: "3 6\n1 3 4", expected: "2", isHidden: true },
      { input: "2 7\n2 5", expected: "2", isHidden: true },
      { input: "3 27\n1 5 10", expected: "5", isHidden: true },
    ],
  },
];

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: { contains: "Sanjivani", mode: "insensitive" } }, orderBy: { createdAt: "asc" } })
    || await prisma.institute.findFirst({ where: { isActive: true } });
  const email = `add-tcs-med-hard-q-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const actor = await prisma.user.create({
    data: { name: "Add TCS Medium/Hard Questions", email, passwordHash: await bcrypt.hash(password, 10), role: "INSTITUTE_ADMIN", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp actor:", actor.id);

  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };
    console.log("Login OK\n");

    for (const q of NEW_QUESTIONS) {
      const res = await fetch(`${BASE}/interview/admin/questions`, { method: "POST", headers: auth, body: JSON.stringify(q) });
      const body = await res.json();
      if (!res.ok) throw new Error(`create failed for [${q.category}/${q.difficulty}] "${(q.prompt || q.title || "").slice(0, 40)}...": HTTP ${res.status} ${JSON.stringify(body)}`);
      console.log(`Created [${q.difficulty}/${q.category}]${q.title ? ` "${q.title}"` : ""}: ${body.id}`);
    }

    console.log("\n=== DONE ===");
  } finally {
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
    console.log("Cleaned up temp actor account (questions were left in place).");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
