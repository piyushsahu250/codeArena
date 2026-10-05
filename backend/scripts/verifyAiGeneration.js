// Live check: AI question generation success after the answer-index normalization fix. Makes a small
// number of real Gemini calls (5/min route limit) as a disposable ADMIN, then cleans up.
const crypto = require("crypto"), bcrypt = require("bcryptjs"), prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
(async () => {
  const pw = crypto.randomBytes(18).toString("base64url");
  const email = `verify-ai-${Date.now()}@example.invalid`;
  const u = await prisma.user.create({ data: { name: "Verify AI", email, passwordHash: await bcrypt.hash(pw, 6), role: "ADMIN", mustChangePassword: false } });
  let ok = 0, fail = 0; const notes = [];
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json();
    const h = { Authorization: `Bearer ${l.token}`, "Content-Type": "application/json" };
    const jobs = [["MCQ", "Data Structures", "Stacks"], ["MCQ", "Data Structures", "Hashing"], ["MULTISELECT", "Algorithms", "Sorting"], ["TRUE_FALSE", "Data Structures", "Queues"], ["MCQ", "Algorithms", "Recursion"]];
    for (const [questionType, subject, topic] of jobs) {
      const t = Date.now();
      const r = await fetch(`${BASE}/ai/questions/generate-question`, { method: "POST", headers: h, body: JSON.stringify({ questionType, subject, topic, difficulty: "EASY", btlLevel: 2 }) });
      const b = await r.json().catch(() => ({}));
      const good = r.status === 200 && Array.isArray(b.options) && Array.isArray(b.correctAnswer) && b.correctAnswer.length > 0;
      good ? ok++ : fail++;
      notes.push(`${questionType}/${topic}: HTTP ${r.status} ${good ? `verification=${b.verificationStatus}` : (b.error || "").slice(0, 80)} (${Date.now() - t}ms)`);
    }
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
  notes.forEach((n) => console.log(n));
  console.log(`generation success ${ok}/${ok + fail}`);
  process.exit(0);
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
