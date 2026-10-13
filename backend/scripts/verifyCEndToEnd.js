// End-to-end verification of C through the real HTTP API, database and judge: an admin-style coding question (full-program and function-based) is attached to a
// published test; a student starts the attempt, runs C against the visible cases, submits against the hidden ones, finalizes, and the persisted rows are checked.
// Also checks what must NOT happen: hidden tests or reference solutions in any student response, a language the judge does not know, and another institute running
// this institute's question. Disposable data only (@example.invalid users, a throwaway institute, tagged questions and test), all removed at the end.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const H = require("../src/utils/functionHarness");

const BASE = process.env.VERIFY_API_BASE || "http://localhost:4000/api";
const TAG = `verify-c-${Date.now()}`;
const HIDDEN_IN = "7654321 1234567", HIDDEN_OUT = "8888888"; // a hidden case whose text cannot appear anywhere by accident
const HIDDEN_FN_IN = "9000001 9000002 9000003", HIDDEN_FN_OUT = "27000006";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const rand = () => crypto.randomBytes(18).toString("base64url");

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, text };
}

(async () => {
  const ids = {};
  const pw = rand();
  try {
    const instA = await prisma.institute.create({ data: { name: `ZZ ${TAG} A` } });
    const instB = await prisma.institute.create({ data: { name: `ZZ ${TAG} B` } });
    ids.institutes = [instA.id, instB.id];
    const mk = async (name, role, instituteId) => prisma.user.create({ data: { name, email: `${TAG}-${name.toLowerCase().replace(/\W+/g, "")}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } });
    const admin = await mk("Admin", "ADMIN", null), studentA = await mk("StudentA", "STUDENT", instA.id), studentB = await mk("StudentB", "STUDENT", instB.id);
    ids.users = [admin.id, studentA.id, studentB.id];

    // Question 1: full program (STDIO). Question 2: function-based with an int[] parameter (C pointer + length convention).
    const q1 = await prisma.question.create({ data: {
      title: `${TAG} add`, description: "Read two integers and print their sum.", questionType: "CODING", difficulty: "EASY", points: 10, instituteId: instA.id, createdById: admin.id,
      evaluationType: "STDIO", comparisonMode: "TRIM", timeLimitMs: 3000,
      testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }, { input: HIDDEN_IN, expected: HIDDEN_OUT, isHidden: true }] },
    } });
    const signature = { methodName: "sumArr", returnType: "int", params: [{ name: "nums", type: "int[]" }] };
    const fields = H.resolveCodingFields({ evaluationType: "FUNCTION", functionSignature: signature });
    check("an array-typed function question offers a C starter", !!fields.starterCodeByLanguage.c && /int sumArr\(int\* nums, int numsSize\)/.test(fields.starterCodeByLanguage.c));
    const q2 = await prisma.question.create({ data: {
      title: `${TAG} sumArr`, description: "Return the sum of the array.", questionType: "CODING", difficulty: "EASY", points: 10, instituteId: instA.id, createdById: admin.id,
      evaluationType: "FUNCTION", functionSignature: signature, starterCodeByLanguage: fields.starterCodeByLanguage, comparisonMode: "TRIM", timeLimitMs: 3000,
      testCases: { create: [{ input: "1 2 3", expected: "6", isHidden: false }, { input: HIDDEN_FN_IN, expected: HIDDEN_FN_OUT, isHidden: true }] },
    } });
    ids.questions = [q1.id, q2.id];
    const now = Date.now();
    const test = await prisma.test.create({ data: {
      title: `${TAG} test`, durationMin: 30, passingMarks: 0, showResults: true, startTime: new Date(now - 60000), endTime: new Date(now + 3600000), isPublished: true, requireFullscreen: false,
      createdById: admin.id, instituteId: null, questions: { create: [{ questionId: q1.id, order: 0 }, { questionId: q2.id, order: 1 }] },
    } });
    ids.test = test.id;

    const login = async (u) => (await call("POST", "/auth/login", null, { email: u.email, password: pw })).body?.token;
    const TA = await login(studentA), TB = await login(studentB);
    check("students can sign in", !!TA && !!TB);

    const start = await call("POST", `/tests/${test.id}/start`, TA, {});
    const attemptId = start.body?.id;
    check("the student starts the attempt", start.status === 200 && !!attemptId, `${start.status}`);
    const view = await call("GET", `/tests/${test.id}`, TA);
    const leaked = (t) => t.includes(HIDDEN_IN) || t.includes(HIDDEN_OUT) || t.includes(HIDDEN_FN_IN) || t.includes(HIDDEN_FN_OUT) || /referenceSolution|reference_solution/i.test(t);
    check("the test view shows C as a language option and never contains hidden tests or reference solutions", !leaked(start.text) && !leaked(view.text), `${view.status}`);

    // Run (visible cases only)
    const goodC = '#include <stdio.h>\nint main(void){int a,b; if(scanf("%d %d",&a,&b)!=2) return 1; printf("%d\\n",a+b); return 0;}\n';
    const run1 = await call("POST", "/submissions/run", TA, { questionId: q1.id, language: "c", code: goodC });
    check("Run: C compiles and passes the visible sample", run1.status === 200 && run1.body?.verdict === "ACCEPTED" && run1.body.totalCases === 1, `${run1.status} ${run1.body?.verdict}`);
    check("Run: the response carries no hidden case", !leaked(run1.text));
    const bad = await call("POST", "/submissions/run", TA, { questionId: q1.id, language: "c", code: "#include <stdio.h>\nint main(void){\n  int x = ;\n  return 0;\n}\n" });
    check("Run: a compile error is reported with its line and without a server path", bad.body?.verdict === "COMPILE_ERROR" && bad.body.errorSummary?.line === 3 && !/\/tmp\/|judge-|sol_bin/.test(bad.text), `${bad.body?.verdict} line ${bad.body?.errorSummary?.line}`);
    const wrong = await call("POST", "/submissions/run", TA, { questionId: q1.id, language: "c", code: '#include <stdio.h>\nint main(void){puts("0");return 0;}\n' });
    check("Run: a wrong answer is WRONG_ANSWER", wrong.body?.verdict === "WRONG_ANSWER");
    const evil = await call("POST", "/submissions/run", TA, { questionId: q1.id, language: "c; rm -rf /", code: goodC });
    check("the server refuses a language the judge does not know (the browser selector is not trusted)", evil.body?.verdict === "COMPILE_ERROR" && /Unsupported/i.test(evil.text), `${evil.status} ${evil.body?.verdict}`);
    const other = await call("POST", "/submissions/run", TB, { questionId: q1.id, language: "c", code: goodC });
    check("another institute cannot run this institute's question (403)", other.status === 403, `${other.status}`);
    const anon = await call("POST", "/submissions/run", null, { questionId: q1.id, language: "c", code: goodC });
    check("an anonymous caller cannot run code (401)", anon.status === 401, `${anon.status}`);

    // Submit (hidden cases decide)
    const sub1 = await call("POST", "/submissions/submit-code", TA, { attemptId, questionId: q1.id, language: "c", code: goodC });
    check("Submit: the full-program C solution is ACCEPTED against the hidden cases", sub1.status === 200 && sub1.body?.verdict === "ACCEPTED", `${sub1.status} ${sub1.body?.verdict} ${sub1.body?.passedCases}/${sub1.body?.totalCases}`);
    check("Submit: the response does not leak any test case", !leaked(sub1.text));
    const fnCode = "int sumArr(int* nums, int numsSize) {\n    long s = 0;\n    for (int i = 0; i < numsSize; i++) s += nums[i];\n    return (int)s;\n}\n";
    const sub2 = await call("POST", "/submissions/submit-code", TA, { attemptId, questionId: q2.id, language: "c", code: fnCode });
    check("Submit: the function-based C solution (array in) is ACCEPTED", sub2.status === 200 && sub2.body?.verdict === "ACCEPTED", `${sub2.status} ${sub2.body?.verdict}`);
    check("Submit: nothing leaked for the function question either", !leaked(sub2.text));

    const fin = await call("POST", `/submissions/finalize/${attemptId}`, TA, {});
    check("the attempt finalizes", fin.status === 200, `${fin.status}`);
    const rows = await prisma.submission.findMany({ where: { attemptId }, select: { language: true, verdict: true, passedCases: true, totalCases: true, score: true } });
    check("persisted: both submissions are stored as language c, ACCEPTED, with all graded (hidden) cases passed", rows.length === 2 && rows.every((r) => r.language === "c" && r.verdict === "ACCEPTED" && r.passedCases === r.totalCases && r.totalCases >= 1), JSON.stringify(rows));
    const attempt = await prisma.testAttempt.findUnique({ where: { id: attemptId }, select: { status: true, totalScore: true } });
    check("the attempt score reflects both C questions", attempt && attempt.totalScore >= 20, JSON.stringify(attempt));
  } catch (e) {
    failures++; console.log("FAIL  unexpected error:", e.message);
  } finally {
    await prisma.submission.deleteMany({ where: { studentId: { in: ids.users || [] } } }).catch(() => {});
    await prisma.testAttempt.deleteMany({ where: { studentId: { in: ids.users || [] } } }).catch(() => {});
    if (ids.test) { await prisma.testQuestion.deleteMany({ where: { testId: ids.test } }).catch(() => {}); await prisma.test.deleteMany({ where: { id: ids.test } }).catch(() => {}); }
    await prisma.testCase.deleteMany({ where: { questionId: { in: ids.questions || [] } } }).catch(() => {});
    await prisma.question.deleteMany({ where: { id: { in: ids.questions || [] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids.users || [] } } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: { in: ids.institutes || [] } } }).catch(() => {});
  }
  console.log(failures === 0 ? "\nC END-TO-END VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})();
