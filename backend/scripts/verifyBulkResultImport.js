// Live check of the bounded-concurrency bulk result import: preview writes nothing, commit writes
// every valid row exactly once with unique verification codes, bad rows land in the right buckets,
// a re-upload updates instead of duplicating, oversize files are rejected, and the export guards.
// Disposable institute-attached students + a disposable DRAFT examination; all removed afterwards.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
let fails = 0;
const check = (l, ok, x = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  -> " + x : ""}`); };

function xlsxBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet([["Institute Name", "Student Name", "Registration Number (PRN)", "Marks Obtained", "Status (Present/Absent/Exempted/Not Appeared)", "Remarks (required if Exempted)"], ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Results");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

(async () => {
  // Sweep leftovers from any earlier aborted run of this script.
  await prisma.resultEntry.deleteMany({ where: { examination: { title: { startsWith: "Verify Bulk " } } } }).catch(() => {});
  await prisma.resultExamination.deleteMany({ where: { title: { startsWith: "Verify Bulk " } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { OR: [{ registrationNumber: { startsWith: "VBI" } }, { email: { startsWith: "verify-bulk-admin-" } }] } }).catch(() => {});
  const institute = await prisma.institute.findFirst({ where: { isActive: true } });
  const stamp = Date.now();
  const N = 60;
  const pw = crypto.randomBytes(18).toString("base64url");
  const adminEmail = `verify-bulk-admin-${stamp}@example.invalid`;
  const admin = await prisma.user.create({ data: { name: "Verify Bulk Admin", email: adminEmail, passwordHash: await bcrypt.hash(pw, 10), role: "ADMIN", mustChangePassword: false } });
  const prns = Array.from({ length: N }, (_, i) => `VBI${stamp}${String(i).padStart(3, "0")}`);
  await prisma.user.createMany({ data: prns.map((p, i) => ({ name: `Bulk Student ${i}`, email: `vbi-${stamp}-${i}@example.invalid`, passwordHash: "x", role: "STUDENT", instituteId: institute.id, registrationNumber: p })) });
  const exam = await prisma.resultExamination.create({ data: { title: `Verify Bulk ${stamp}`, createdByAdminId: admin.id, createdByName: admin.name, instituteId: institute.id, examDate: new Date(), totalMarks: 100, passingPercent: 40 } });
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: pw }) })).json();
    const h = { Authorization: `Bearer ${l.token}` };
    const post = async (buf, qs = "") => {
      const fd = new FormData(); fd.append("file", new Blob([buf]), "r.xlsx");
      const r = await fetch(`${BASE}/results/admin/examinations/${exam.id}/bulk-import${qs}`, { method: "POST", headers: h, body: fd });
      return { status: r.status, body: await r.json() };
    };
    const rows = prns.map((p, i) => [institute.name, `Bulk Student ${i}`, p, (i * 7) % 101, "Present", ""]);
    rows.push([institute.name, "Dup", prns[0], 50, "Present", ""]);               // duplicate in file
    rows.push([institute.name, "Bad marks", prns[1] + "x", 500, "Present", ""]);   // bad marks (fails before PRN lookup)
    rows.push(["No Such Institute", "X", "Z1", 10, "Present", ""]);                // unknown institute
    rows.push([institute.name, "Ghost", "NOPE" + stamp, 10, "Present", ""]);       // unknown PRN
    const buf = xlsxBuffer(rows);

    const preview = await post(buf);
    check("preview 200, not committed", preview.status === 200 && preview.body.committed === false, `${preview.status}`);
    check("preview buckets correct", preview.body.imported.length === N && preview.body.duplicate.length === 1 && preview.body.invalidInstitute.length === 1 && preview.body.invalidRegistrationNumber.length === 1 && preview.body.failed.length === 1, JSON.stringify(Object.fromEntries(["imported", "duplicate", "invalidInstitute", "invalidRegistrationNumber", "failed"].map((k) => [k, preview.body[k].length]))));
    check("preview wrote nothing", (await prisma.resultEntry.count({ where: { examinationId: exam.id } })) === 0);

    const t0 = Date.now();
    const commit = await post(buf, "?commit=true");
    const ms = Date.now() - t0;
    const dbCount = await prisma.resultEntry.count({ where: { examinationId: exam.id } });
    check("commit imported all valid rows", commit.status === 200 && commit.body.committed && commit.body.imported.length === N && commit.body.failed.length === 1, `${commit.status}, imported=${commit.body.imported?.length}, failed=${commit.body.failed?.length}, ${ms}ms`);
    check("DB has exactly N entries (no dupes, no losses)", dbCount === N, String(dbCount));
    const entries = await prisma.resultEntry.findMany({ where: { examinationId: exam.id }, select: { verificationCode: true, obtainedMarks: true, studentId: true, source: true, percentage: true, passed: true } });
    check("verification codes all unique", new Set(entries.map((e) => e.verificationCode)).size === N);
    check("source=BULK_IMPORT, percentage/passed computed", entries.every((e) => e.source === "BULK_IMPORT" && typeof e.percentage === "number") && entries.some((e) => e.passed) && entries.some((e) => !e.passed));

    const rows2 = prns.map((p, i) => [institute.name, `Bulk Student ${i}`, p, 99, "Present", ""]);
    const again = await post(xlsxBuffer(rows2), "?commit=true");
    const after = await prisma.resultEntry.findMany({ where: { examinationId: exam.id }, select: { obtainedMarks: true, version: true } });
    check("re-upload updates in place (marks changed, no new rows)", again.status === 200 && again.body.imported.every((x) => x.updated) && after.length === N && after.every((e) => e.obtainedMarks === 99 && e.version >= 1), `${after.length} rows`);

    const big = Array.from({ length: 5001 }, (_, i) => [institute.name, "n", `P${i}`, 1, "Present", ""]);
    const tooBig = await post(xlsxBuffer(big));
    check("over-limit file rejected with clear 400", tooBig.status === 400 && /limit/i.test(tooBig.body.error), tooBig.body.error);

    const list = await fetch(`${BASE}/results/admin/examinations/${exam.id}/entries`, { headers: h });
    check("entries list returns N rows", list.status === 200 && (await list.json()).length === N);

    // Export guard end-to-end through the shared sendExport (attendance format=csv would need data);
    // assert directly on the util.
    const { sendExport } = require("../src/utils/exportFile");
    let sent; const fake = { setHeader() {}, send(b) { sent = b; }, json() {} };
    sendExport(fake, { rows: [{ Name: "=HYPERLINK(\"http://x\")", Score: 5 }], filenameBase: "t", format: "csv" });
    check("sendExport csv: BOM + formula neutralised", sent.charCodeAt(0) === 0xfeff && sent.includes("'=HYPERLINK") , sent.slice(0, 60).replace(/\n/g, "\\n"));
  } finally {
    await prisma.resultEntry.deleteMany({ where: { examinationId: exam.id } }).catch(() => {});
    await prisma.resultExamination.delete({ where: { id: exam.id } }).catch((e) => console.log("cleanup exam:", e.message));
    await prisma.loginSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { OR: [{ id: admin.id }, { registrationNumber: { startsWith: `VBI${stamp}` } }] } }).catch((e) => console.log("cleanup users:", e.message));
    console.log("Cleaned up.");
  }
  console.log(fails ? `\n${fails} FAILED` : "\nALL BULK IMPORT CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.stack || e); process.exit(1); });
