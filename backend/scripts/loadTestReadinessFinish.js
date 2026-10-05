// Synthetic "whole class finishes at once" load test against the live API on this host: N disposable
// students each start a DSA COMPLETE-mode readiness attempt, save answers (a correct Python solution
// for Array Sum when asked, MCQ picks otherwise), then ALL call finalize simultaneously. Measures
// latency percentiles and error counts, and -- the point of the test -- checks that no answered
// coding draft is left ungraded or mis-scored because the judge queue was saturated.
// Usage: N=40 node scripts/loadTestReadinessFinish.js     (disposable data only; fully cleaned up)
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
const N = Number(process.env.N || 40);

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const SOLUTIONS = {
  "Array Sum and Average Classifier": "n=int(input())\narr=list(map(int,input().split())) if n>0 else []\nif n==0: print('EMPTY')\nelse:\n    s=sum(arr); print(s); print(int(s/n))\n",
  "Reverse an Array": "n=int(input())\nprint(' '.join(reversed(input().split())))\n",
  "Maximum and Minimum of an Array": "n=int(input())\na=list(map(int,input().split()))\nprint(max(a),min(a))\n",
  "Palindrome String Check": "s=input().strip()\nprint('YES' if s==s[::-1] else 'NO')\n",
  "Factorial of N": "def f(n): return 1 if n<=1 else n*f(n-1)\nprint(f(int(input())))\n",
  "Nth Fibonacci Number": "n=int(input())\na,b=0,1\nfor _ in range(n): a,b=b,a+b\nprint(a)\n",
  "Count Distinct Elements": "n=int(input())\nprint(len(set(input().split())))\n",
  "Sort an Array in Ascending Order": "n=int(input())\nprint(' '.join(map(str,sorted(map(int,input().split())))))\n",
  "Count Even and Odd Numbers": "n=int(input())\na=list(map(int,input().split()))\ne=sum(1 for x in a if x%2==0)\nprint(e,n-e)\n",
};

(async () => {
  const subject = await prisma.readinessSubject.findFirst({ where: { name: "DSA" }, include: { academicGroupAssignments: { include: { academicGroup: true } } } });
  const as = subject.academicGroupAssignments[0];
  const instituteId = as ? as.academicGroup.instituteId : (await prisma.institute.findFirst({ where: { isActive: true } })).id;
  const origMax = subject.maxAttempts;
  await prisma.readinessSubject.update({ where: { id: subject.id }, data: { maxAttempts: null } });
  const stamp = Date.now();
  const pw = crypto.randomBytes(18).toString("base64url");
  const hash = await bcrypt.hash(pw, 4); // low cost: this is a throwaway load-test credential, and login latency isn't what's being measured
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-load-" } } }).catch(() => {});
  const ids = [];
  try {
    await prisma.user.createMany({ data: Array.from({ length: N }, (_, i) => ({ name: `Load ${i}`, email: `verify-load-${stamp}-${i}@example.invalid`, passwordHash: hash, role: "STUDENT", instituteId, mustChangePassword: false, academicGroupId: as?.academicGroupId || null, program: as?.program || null })) });
    const users = await prisma.user.findMany({ where: { email: { startsWith: `verify-load-${stamp}-` } }, select: { id: true, email: true } });
    ids.push(...users.map((u) => u.id));

    const timed = async (fn) => { const t = Date.now(); let r; try { r = await fn(); } catch (e) { r = { status: 0, err: e.message }; } return { ...r, ms: Date.now() - t }; };
    const call = async (h, method, path, body) => {
      const res = await fetch(`${BASE}${path}`, { method, headers: { ...h, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch {}
      return { status: res.status, body: json };
    };

    // 1. concurrent login
    const logins = await Promise.all(users.map((u) => timed(async () => {
      const r = await call({}, "POST", "/auth/login", { email: u.email, password: pw });
      return { status: r.status, token: r.body?.token };
    })));
    console.log(`login   : ok=${logins.filter((l) => l.status === 200).length}/${N}  p50=${pct(logins.map((l) => l.ms), 50)}ms p95=${pct(logins.map((l) => l.ms), 95)}ms`);
    const sessions = users.map((u, i) => ({ u, h: { Authorization: `Bearer ${logins[i].token}` } })).filter((s, i) => logins[i].status === 200);

    // 2. concurrent start + answer
    const attempts = [];
    const starts = await Promise.all(sessions.map((s) => timed(async () => {
      const r = await call(s.h, "POST", "/readiness/assessments", { subjectId: subject.id, assessmentMode: "COMPLETE", questionCount: 8 });
      if (r.status === 200) attempts.push({ s, id: r.body.assessment.id, questions: r.body.questions });
      return { status: r.status };
    })));
    console.log(`start   : ok=${starts.filter((x) => x.status === 200).length}/${sessions.length}  p50=${pct(starts.map((x) => x.ms), 50)}ms p95=${pct(starts.map((x) => x.ms), 95)}ms`);

    let codingAnswered = 0, expectCorrect = 0;
    const answerTimes = [];
    await Promise.all(attempts.map(async (a) => {
      for (const q of a.questions) {
        const sol = SOLUTIONS[q.title];
        const payload = q.questionType === "CODING" ? { questionId: q.id, code: sol || "print(0)", language: "python", skipped: false } : { questionId: q.id, selectedOptions: [0], skipped: false };
        const r = await timed(() => call(a.s.h, "POST", `/readiness/assessments/${a.id}/answer`, payload).then((x) => ({ status: x.status })));
        answerTimes.push(r.ms);
        if (q.questionType === "CODING") { codingAnswered++; if (sol) expectCorrect++; }
      }
    }));
    console.log(`answers : count=${answerTimes.length}  p50=${pct(answerTimes, 50)}ms p95=${pct(answerTimes, 95)}ms (coding answered=${codingAnswered}, with a known-correct solution=${expectCorrect})`);

    // 3. everyone submits at the same instant -- the deadline stampede
    const t0 = Date.now();
    const fins = await Promise.all(attempts.map((a) => timed(async () => {
      const r = await call(a.s.h, "POST", `/readiness/assessments/${a.id}/finalize`);
      return { status: r.status, st: r.body?.assessment?.status };
    })));
    console.log(`finalize: ok=${fins.filter((x) => x.status === 200 && x.st === "COMPLETED").length}/${attempts.length}  p50=${pct(fins.map((x) => x.ms), 50)}ms p95=${pct(fins.map((x) => x.ms), 95)}ms max=${Math.max(...fins.map((x) => x.ms))}ms wall=${Date.now() - t0}ms`);
    const non200 = fins.filter((x) => x.status !== 200);
    if (non200.length) console.log("  finalize non-200 sample:", JSON.stringify(non200.slice(0, 3)));

    // 4. correctness under stampede
    const rows = await prisma.readinessAnswer.findMany({ where: { assessmentId: { in: attempts.map((a) => a.id) }, skipped: false }, include: { question: { select: { title: true, questionType: true } } } });
    const ungraded = rows.filter((r) => r.isCorrect === null).length;
    const knownWrong = rows.filter((r) => r.question.questionType === "CODING" && SOLUTIONS[r.question.title] && r.isCorrect !== true);
    console.log(`grading : answered rows=${rows.length}, UNGRADED=${ungraded}, known-correct coding solutions NOT scored correct=${knownWrong.length}`);
    if (knownWrong.length) console.log("  sample:", JSON.stringify(knownWrong.slice(0, 3).map((r) => [r.question.title, r.isCorrect, r.score])));
    const verdict = ungraded === 0 && knownWrong.length === 0 && fins.every((x) => x.status === 200);
    console.log(verdict ? "\nLOAD TEST PASSED" : "\nLOAD TEST FOUND PROBLEMS");
    process.exitCode = verdict ? 0 : 1;
  } finally {
    await prisma.readinessAssessment.deleteMany({ where: { studentId: { in: ids } } }).catch((e) => console.log("cleanup assessments:", e.message));
    await prisma.certificate.deleteMany({ where: { studentId: { in: ids } } }).catch(() => {});
    await prisma.loginSession.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => console.log("cleanup users:", e.message));
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { maxAttempts: origMax } });
    console.log(`Cleaned up ${ids.length} students; maxAttempts restored to ${origMax}.`);
    process.exit(process.exitCode || 0);
  }
})().catch((e) => { console.error("FAILED:", e.stack || e); process.exit(1); });
