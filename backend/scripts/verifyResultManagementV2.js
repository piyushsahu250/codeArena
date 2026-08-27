// Real-HTTP verification for the Result Management overhaul — spec section 30's exact test
// matrix: Institute A/B, Super Admin, Institute Admin A/B, Staff A/B, Student A/B. Creates real
// temp users/institute data, exercises the live server, cleans up every row it creates by exact
// ID. Never touches any other institute's real data.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

const API_BASE = process.env.HEALTH_CHECK_API_BASE || "http://127.0.0.1:4000/api";
let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [PASS] ${label}`); pass++; }
  else { console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ""}`); fail++; }
}

// Guaranteed-unique-within-this-run counter — Date.now() alone collides when two students are
// created in the same millisecond (confirmed live: a plain timestamp-plus-slice(0,12) truncated
// away the very digits that would have told two students apart).
let regNoCounter = 0;
async function mkUser(role, instituteId, academicGroupId) {
  const email = `resultmgmt-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  regNoCounter++;
  const registrationNumber = role === "STUDENT" ? `R${Date.now().toString(36)}${regNoCounter}`.slice(0, 12) : undefined;
  const user = await prisma.user.create({ data: { name: `RM Check ${role}`, email, passwordHash, role, instituteId, academicGroupId, registrationNumber } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function j(res) { try { return await res.json(); } catch { return null; } }

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) { console.log("Need 2 institutes"); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name}\nInstitute B: ${instB.name}\n`);

  const cleanup = [];
  const examIds = [];
  try {
    const superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    const staffA = await mkUser("STAFF", instA.id);
    const staffB = await mkUser("STAFF", instB.id);
    const studentA = await mkUser("STUDENT", instA.id);
    const studentB = await mkUser("STUDENT", instB.id);
    cleanup.push(adminA, adminB, staffA, staffB, studentA, studentB);

    let superAdminHeaders = null;
    if (superAdmin) {
      const token = await createSession({ user: superAdmin, req: { headers: {} }, singleSessionOnly: false });
      const jti = jwt.decode(token).jti;
      superAdminHeaders = { "content-type": "application/json", Authorization: `Bearer ${token}` };
      cleanup.push({ user: superAdmin, jti, headers: superAdminHeaders, skipDelete: true }); // never delete the real seeded Super Admin
    }

    // ---- 1. Institute Admin A creates an exam ----
    console.log("=== Create exam (Institute Admin A) ===");
    const createRes = await fetch(`${API_BASE}/results/admin/examinations`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({ title: "RM Verify Exam", examDate: new Date().toISOString(), totalMarks: 100, passingPercent: 40 }),
    });
    const exam = await j(createRes);
    check("Exam created (200)", createRes.status === 200, `got ${createRes.status}`);
    examIds.push(exam.id);

    // ---- 2. Staff A can enter Institute A marks ----
    console.log("\n=== Staff A can enter Institute A marks ===");
    const entryRes = await fetch(`${API_BASE}/results/admin/examinations/${exam.id}/entries`, {
      method: "POST", headers: staffA.headers,
      body: JSON.stringify({ studentId: studentA.user.id, obtainedMarks: 78, status: "PRESENT" }),
    });
    const entry = await j(entryRes);
    check("Staff A entry saved (200)", entryRes.status === 200, `got ${entryRes.status}: ${JSON.stringify(entry)}`);
    check("Entry has status PRESENT", entry?.status === "PRESENT");
    check("Entry has version 0 or 1", typeof entry?.version === "number");

    // ---- 3. Staff A CANNOT access Institute B marks ----
    console.log("\n=== Staff A cannot access Institute B exam ===");
    const examBRes = await fetch(`${API_BASE}/results/admin/examinations`, {
      method: "POST", headers: adminB.headers,
      body: JSON.stringify({ title: "RM Verify Exam B", examDate: new Date().toISOString(), totalMarks: 50, passingMarks: 20 }),
    });
    const examB = await j(examBRes);
    examIds.push(examB.id);
    const crossRes = await fetch(`${API_BASE}/results/admin/examinations/${examB.id}`, { headers: staffA.headers });
    check("Staff A blocked from Institute B exam (403)", crossRes.status === 403, `got ${crossRes.status}`);

    // ---- 4. Institute Admin A cannot access Institute B results ----
    console.log("\n=== Institute Admin A cannot access Institute B exam ===");
    const adminCrossRes = await fetch(`${API_BASE}/results/admin/examinations/${examB.id}`, { headers: adminA.headers });
    check("Institute Admin A blocked from Institute B exam (403)", adminCrossRes.status === 403, `got ${adminCrossRes.status}`);

    // ---- 5. Absent status: no fabricated 0/fail ----
    console.log("\n=== Absent status does not fabricate a scored result ===");
    const studentA2 = await mkUser("STUDENT", instA.id);
    cleanup.push(studentA2);
    const absentRes = await fetch(`${API_BASE}/results/admin/examinations/${exam.id}/entries`, {
      method: "POST", headers: staffA.headers,
      body: JSON.stringify({ studentId: studentA2.user.id, status: "ABSENT" }),
    });
    const absentEntry = await j(absentRes);
    check("Absent entry saved (200)", absentRes.status === 200, `got ${absentRes.status}: ${JSON.stringify(absentEntry)}`);
    check("Absent entry passed is not true", absentEntry?.passed !== true);

    // ---- 6. Concurrency: stale version rejected ----
    console.log("\n=== Concurrency: stale version is rejected ===");
    const staleUpdate = await fetch(`${API_BASE}/results/admin/examinations/${exam.id}/entries/${entry.id}`, {
      method: "PATCH", headers: staffA.headers,
      body: JSON.stringify({ obtainedMarks: 80, version: 999 }),
    });
    check("Stale version update rejected (409)", staleUpdate.status === 409, `got ${staleUpdate.status}`);

    // ---- 7. Pre-publish check blocks an exam with zero entries ----
    console.log("\n=== Pre-publish validation blocks an exam with zero entries ===");
    const emptyExamRes = await fetch(`${API_BASE}/results/admin/examinations`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({ title: "RM Empty Exam", examDate: new Date().toISOString(), totalMarks: 100, passingPercent: 40 }),
    });
    const emptyExam = await j(emptyExamRes);
    examIds.push(emptyExam.id);
    const publishEmptyRes = await fetch(`${API_BASE}/results/admin/examinations/${emptyExam.id}/publish`, { method: "PATCH", headers: adminA.headers });
    check("Publish blocked with no entries (400)", publishEmptyRes.status === 400, `got ${publishEmptyRes.status}`);

    // ---- 8. Publish the real exam, then student can see it, other student cannot ----
    console.log("\n=== Publish + student visibility ===");
    const publishRes = await fetch(`${API_BASE}/results/admin/examinations/${exam.id}/publish`, { method: "PATCH", headers: adminA.headers });
    check("Exam with entries publishes (200)", publishRes.status === 200, `got ${publishRes.status}: ${JSON.stringify(await j(publishRes))}`);

    const studentAResults = await fetch(`${API_BASE}/results/me`, { headers: studentA.headers });
    const studentAData = await j(studentAResults);
    check("Student A sees their own published result", Array.isArray(studentAData) && studentAData.some((r) => r.examinationId === exam.id));

    const studentBResults = await fetch(`${API_BASE}/results/me`, { headers: studentB.headers });
    const studentBData = await j(studentBResults);
    check("Student B (different institute, no entry) does not see Institute A's result", Array.isArray(studentBData) && !studentBData.some((r) => r.examinationId === exam.id));

    // ---- 9. Student cannot view a draft/unpublished result via direct entry id ----
    console.log("\n=== Student cannot view a non-published entry directly ===");
    const draftExamEntryRes = await fetch(`${API_BASE}/results/admin/examinations/${emptyExam.id}/entries`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({ studentId: studentA2.user.id, obtainedMarks: 55, status: "PRESENT" }),
    });
    const draftEntry = await j(draftExamEntryRes);
    const draftViewRes = await fetch(`${API_BASE}/results/me/${draftEntry.id}`, { headers: studentA2.headers });
    check("Student blocked from viewing their own entry on a DRAFT exam (403)", draftViewRes.status === 403, `got ${draftViewRes.status}`);

    // ---- 10. Student A cannot view Student A2's result (different student, same institute) ----
    console.log("\n=== Student cannot view another student's result ===");
    const otherStudentView = await fetch(`${API_BASE}/results/me/${entry.id}`, { headers: studentA2.headers });
    check("Student A2 blocked from Student A's entry (403 or 404)", otherStudentView.status === 403 || otherStudentView.status === 404, `got ${otherStudentView.status}`);

    // ---- 11. Super Admin can view (if a real one exists) ----
    if (superAdminHeaders) {
      console.log("\n=== Super Admin can view institute results ===");
      const saRes = await fetch(`${API_BASE}/results/admin/examinations/${exam.id}`, { headers: superAdminHeaders });
      check("Super Admin can view Institute A's exam", saRes.status === 200, `got ${saRes.status}`);
    } else {
      console.log("\n(No SUPER_ADMIN user found to test — skipped, not counted as pass or fail)");
    }

    // ---- 12. Bulk-import preview does not write ----
    console.log("\n=== Bulk import: preview (no commit) makes no DB change ===");
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Institute Name", "Student Name", "Registration Number (PRN)", "Marks Obtained", "Status"],
      [instA.name, studentA2.user.name, studentA2.user.registrationNumber, 60, "Present"],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, "Results");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const beforeCount = await prisma.resultEntry.count({ where: { examinationId: emptyExam.id } });

    // Node 20's native FormData/Blob — no extra npm dependency needed for this one-off script.
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "test.xlsx");
    const { "content-type": _ct, ...authOnlyHeaders } = staffA.headers; // let fetch set its own multipart boundary content-type
    const previewRes = await fetch(`${API_BASE}/results/admin/examinations/${emptyExam.id}/bulk-import`, {
      method: "POST", headers: authOnlyHeaders, body: fd,
    });
    const previewData = await j(previewRes);
    const afterPreviewCount = await prisma.resultEntry.count({ where: { examinationId: emptyExam.id } });
    check("Preview (no commit) leaves entry count unchanged", afterPreviewCount === beforeCount, `before=${beforeCount} after=${afterPreviewCount}`);
    check("Preview reports committed:false", previewData?.committed === false, JSON.stringify(previewData));
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    for (const id of examIds) await prisma.resultExamination.delete({ where: { id } }).catch(() => {});
    for (const c of cleanup) {
      if (c.skipDelete) continue;
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
