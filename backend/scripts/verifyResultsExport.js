// Live check of the results exports: formal-test results (xlsx + csv + roll filter), module-coding
// attempts export, formula-injection guard, numeric typing, auth scoping. Disposable data only.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
let fails = 0;
const check = (l, ok, x = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  -> " + x : ""}`); };

(async () => {
  const withAttempts = await prisma.testAttempt.groupBy({ by: ["testId"], _count: true, orderBy: { _count: { testId: "desc" } }, take: 1 });
  if (!withAttempts.length) throw new Error("No test with attempts on this instance");
  const testId = withAttempts[0].testId;
  const test = await prisma.test.findUnique({ where: { id: testId }, select: { title: true, instituteId: true } });
  console.log(`Using test "${test.title}" (${withAttempts[0]._count} attempts)`);

  // A hostile-looking student name on a disposable student attempt row would need writes to real
  // data; instead assert the guard directly through the shared util below.
  const { safeCell } = require("../src/utils/spreadsheetSafe");
  check("safeCell neutralises =, +, -, @", ["=1+1", "+1", "-1", "@SUM(1)"].every((s) => safeCell(s).startsWith("'")));
  check("safeCell leaves normal text and numbers alone", safeCell("Asha") === "Asha" && safeCell(5) === 5);

  const mk = async (role, instituteId) => {
    const email = `verify-export-${role.toLowerCase()}-${Date.now()}@example.invalid`;
    const password = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name: `Verify ${role}`, email, passwordHash: await bcrypt.hash(password, 10), role, instituteId, mustChangePassword: false } });
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
    return { u, h: { Authorization: `Bearer ${l.token}` } };
  };
  const made = [];
  try {
    const admin = await mk("ADMIN", null);
    const a = admin; made.push(a.u.id);
    const student = await mk("STUDENT", test.instituteId); made.push(student.u.id);

    const res = await fetch(`${BASE}/tests/${testId}/results/export`, { headers: a.h });
    const buf = Buffer.from(await res.arrayBuffer());
    check("xlsx export 200 with spreadsheet content-type + attachment", res.status === 200 && /spreadsheetml/.test(res.headers.get("content-type")) && /attachment; filename=".*\.xlsx"/.test(res.headers.get("content-disposition")), `${res.status} ${res.headers.get("content-disposition")}`);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    check("xlsx parses with rows matching attempt count", rows.length === withAttempts[0]._count, `${rows.length} rows`);
    const r0 = rows[0] || {};
    check("numeric columns are real numbers", typeof r0["Score"] === "number" && typeof r0["Max Score"] === "number" && typeof r0["Rank"] === "number", JSON.stringify([typeof r0.Score, typeof r0["Max Score"]]));
    check("expected columns present", ["Rank", "Roll No.", "Student", "Registration No. (PRN)", "Email", "Score", "Max Score", "Percentage (%)", "Result", "Attempted", "Total Questions", "Status", "Submitted At"].every((c) => c in r0 || rows.some((r) => c in r)), Object.keys(r0).join("|"));
    check("rows ordered by score desc, rank 1..n", rows.every((r, i) => r.Rank === i + 1) && rows.every((r, i) => i === 0 || rows[i - 1].Score >= r.Score));

    const csvRes = await fetch(`${BASE}/tests/${testId}/results/export?format=csv`, { headers: a.h });
    const csvText = await csvRes.text();
    check("csv export has BOM and header", csvRes.status === 200 && csvText.charCodeAt(0) === 0xfeff && csvText.includes("Registration No. (PRN)"), csvText.split("\n")[0].slice(0, 70));

    const roll = rows.find((r) => r["Roll No."])?.["Roll No."];
    if (roll) {
      const fr = await fetch(`${BASE}/tests/${testId}/results/export?roll=${encodeURIComponent(String(roll))}`, { headers: a.h });
      const fRows = XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(await fr.arrayBuffer()), { type: "buffer" }).Sheets.Results);
      check("roll filter narrows rows but keeps leaderboard rank", fRows.length >= 1 && fRows.length <= rows.length && fRows.every((r) => String(r["Roll No."]).toLowerCase().includes(String(roll).toLowerCase())) && fRows.every((r) => rows.find((x) => x.Email === r.Email)?.Rank === r.Rank));
    }

    const noAuth = await fetch(`${BASE}/tests/${testId}/results/export`);
    check("unauthenticated rejected", noAuth.status === 401, String(noAuth.status));
    const asStudent = await fetch(`${BASE}/tests/${testId}/results/export`, { headers: student.h });
    check("student role rejected", asStudent.status === 403, String(asStudent.status));
    const missing = await fetch(`${BASE}/tests/${crypto.randomUUID()}/results/export`, { headers: a.h });
    check("unknown test -> 404 JSON error", missing.status === 404 && (await missing.json()).error, String(missing.status));

    const mct = await prisma.moduleCodingAttempt.groupBy({ by: ["moduleCodingTestId"], _count: true, take: 1 });
    if (mct.length) {
      const m1 = await fetch(`${BASE}/module-coding/admin/tests/${mct[0].moduleCodingTestId}/export`, { headers: a.h });
      const t1 = await m1.text();
      check("module-coding csv export OK with BOM", m1.status === 200 && t1.charCodeAt(0) === 0xfeff && t1.includes("Student"), String(m1.status));
      const m2 = await fetch(`${BASE}/module-coding/admin/tests/${mct[0].moduleCodingTestId}/export?format=xlsx`, { headers: a.h });
      const w2 = XLSX.read(Buffer.from(await m2.arrayBuffer()), { type: "buffer" });
      check("module-coding xlsx export parses", m2.status === 200 && XLSX.utils.sheet_to_json(w2.Sheets.Attempts).length === mct[0]._count, `${m2.status}`);
    }
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: { in: made } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made } } }).catch((e) => console.log("cleanup:", e.message));
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL EXPORT CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
