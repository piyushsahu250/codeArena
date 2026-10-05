// One-off: close the TCS Company Round content gap that was triggering the "we don't have enough
// TCS-specific questions" fallback banner. The flat (no CompanyInterviewProfile) Company Round
// composition is HR:2 + TECHNICAL:3 + CODING:2 + MANAGERIAL:2 (see interview.js POST /sessions'
// isCompanyRound else-branch) — production had HR:1, TECHNICAL:2, CODING:0, MANAGERIAL:0 tagged
// company="TCS", so every one of those four categories fell back to the general pool. Adds exactly
// enough real questions to close each gap, via the real admin route (POST /interview/admin/
// questions) so the same validation (2 visible + 5 hidden test cases for CODING) that route
// enforces for everyone else applies here too. Creates one disposable INSTITUTE_ADMIN actor to
// drive the HTTP calls; deletes it afterward (InterviewQuestion.createdById is nullable/no
// cascade-relevant FK risk). The questions themselves are NOT cleaned up -- real, permanent content.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

const NEW_QUESTIONS = [
  {
    category: "HR", company: "TCS", difficulty: "EASY",
    prompt: "Tell us about a time you had to work under a tight deadline. How did you manage it?",
    expectedKeywords: ["deadline", "prioritize", "time management", "plan"],
  },
  {
    category: "TECHNICAL", company: "TCS", subject: "Operating Systems", difficulty: "MEDIUM",
    prompt: "What is the difference between a process and a thread, and why does it matter for performance?",
    expectedKeywords: ["process", "thread", "memory", "lightweight", "context switch"],
  },
  {
    category: "MANAGERIAL", company: "TCS", difficulty: "MEDIUM",
    prompt: "How would you handle a situation where a team member consistently misses deadlines?",
    expectedKeywords: ["communication", "feedback", "support", "accountability"],
  },
  {
    category: "MANAGERIAL", company: "TCS", difficulty: "MEDIUM",
    prompt: "Describe how you would prioritize multiple project deadlines given to you by different stakeholders.",
    expectedKeywords: ["prioritize", "stakeholders", "communication", "planning"],
  },
  {
    category: "CODING", company: "TCS", difficulty: "EASY", title: "Palindrome Check",
    prompt: "Read a single line string. Print \"YES\" if it reads the same forwards and backwards (case-insensitive), otherwise print \"NO\".",
    constraints: "1 <= length of string <= 1000\nString contains only letters",
    inputFormat: "A single line containing the string.",
    outputFormat: "Print YES or NO.",
    testCases: [
      { input: "madam", expected: "YES", isHidden: false },
      { input: "hello", expected: "NO", isHidden: false },
      { input: "Level", expected: "YES", isHidden: true },
      { input: "TCS", expected: "NO", isHidden: true },
      { input: "racecar", expected: "YES", isHidden: true },
      { input: "A", expected: "YES", isHidden: true },
      { input: "OpenAI", expected: "NO", isHidden: true },
    ],
  },
  {
    category: "CODING", company: "TCS", difficulty: "MEDIUM", title: "Second Largest Element",
    prompt: "Read N integers. Print the second largest DISTINCT value. If no second distinct value exists, print -1.",
    constraints: "1 <= N <= 1000\n-10^6 <= each element <= 10^6",
    inputFormat: "First line: N. Second line: N space-separated integers.",
    outputFormat: "Print a single integer: the second largest distinct value, or -1.",
    testCases: [
      { input: "5\n10 20 4 45 99", expected: "45", isHidden: false },
      { input: "4\n7 7 8 8", expected: "7", isHidden: false },
      { input: "3\n1 1 1", expected: "-1", isHidden: true },
      { input: "6\n1 2 3 4 5 6", expected: "5", isHidden: true },
      { input: "2\n10 20", expected: "10", isHidden: true },
      { input: "5\n-1 -2 -3 -4 -5", expected: "-2", isHidden: true },
      { input: "4\n100 100 100 99", expected: "99", isHidden: true },
    ],
  },
];

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: { contains: "Sanjivani", mode: "insensitive" } }, orderBy: { createdAt: "asc" } })
    || await prisma.institute.findFirst({ where: { isActive: true } });
  const email = `add-tcs-interview-q-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const actor = await prisma.user.create({
    data: { name: "Add TCS Interview Questions", email, passwordHash: await bcrypt.hash(password, 10), role: "INSTITUTE_ADMIN", instituteId: institute.id, mustChangePassword: false },
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
      if (!res.ok) throw new Error(`create failed for [${q.category}] "${(q.prompt || "").slice(0, 40)}...": HTTP ${res.status} ${JSON.stringify(body)}`);
      console.log(`Created [${q.category}]${q.title ? ` "${q.title}"` : ""}: ${body.id}`);
    }

    console.log("\n=== DONE ===");
  } finally {
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
    console.log("Cleaned up temp actor account (questions were left in place).");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
