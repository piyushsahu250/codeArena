// One-off: real end-to-end verification of the Attendance flow (staff marks attendance for a
// lecture -> student sees it in their own records) and the Certificate flow (admin/staff issues a
// certificate -> student sees + downloads its PDF -> public verify-by-code works) against the live
// API on this instance, post-migration. Neither flow touches the judge, but both exercise real DB
// writes, PDF generation, and public/unauthenticated routes that the earlier rounds didn't cover.
// Creates disposable STUDENT + STAFF users and disposable StaffClassAssignment/LecturePlan/
// AttendanceSession/Certificate rows (random passwords, @example.invalid emails), all deleted
// afterward. Reuses a real, existing AcademicGroup (read-only) so the roster-matching logic has
// something real to resolve against.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

function randPassword() { return crypto.randomBytes(18).toString("base64url"); }

async function main() {
  const candidateGroups = await prisma.academicGroup.findMany({ where: { isActive: true }, include: { institute: true } });
  if (candidateGroups.length === 0) throw new Error("No AcademicGroup exists on this instance to attach the temp roster to");
  const disabledByInstitute = await prisma.featureSetting.findMany({ where: { featureKey: { in: ["attendance", "certificates"] }, enabled: false } });
  const disabledInstituteIds = new Set(disabledByInstitute.map((f) => f.instituteId));
  const group = candidateGroups.find((g) => !disabledInstituteIds.has(g.instituteId));
  if (!group) throw new Error("Every institute with an AcademicGroup has attendance or certificates disabled");
  const instituteId = group.instituteId;
  console.log(`Using AcademicGroup ${group.id} (institute ${instituteId})`);

  const now = Date.now();
  const studentEmail = `verify-attendance-cert-student-${now}@example.invalid`;
  const staffEmail = `verify-attendance-cert-staff-${now}@example.invalid`;
  const studentPassword = randPassword();
  const staffPassword = randPassword();
  const student = await prisma.user.create({
    data: { name: "Verify Attendance Cert Student", email: studentEmail, passwordHash: await bcrypt.hash(studentPassword, 10), role: "STUDENT", instituteId, academicGroupId: group.id, mustChangePassword: false },
  });
  const staff = await prisma.user.create({
    data: { name: "Verify Attendance Cert Staff", email: staffEmail, passwordHash: await bcrypt.hash(staffPassword, 10), role: "STAFF", instituteId, mustChangePassword: false },
  });
  console.log("Created temp student:", student.id, "and temp staff:", staff.id);

  const assignment = await prisma.staffClassAssignment.create({
    data: { staffId: staff.id, academicGroupId: group.id, subject: "Verification Subject" },
  });
  const plan = await prisma.lecturePlan.create({
    data: {
      assignmentId: assignment.id, lectureNumber: 1, subject: "Verification Subject", topic: "Verification Lecture",
      scheduleDate: new Date(), slotLabel: "Slot 1", startTime: "09:00", endTime: "10:00", lectureType: "REGULAR", createdById: staff.id,
    },
  });
  console.log("Created temp StaffClassAssignment:", assignment.id, "and LecturePlan:", plan.id);

  let certId = null;
  try {
    const staffLoginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: staffEmail, password: staffPassword }) });
    const staffLoginBody = await staffLoginRes.json();
    if (!staffLoginRes.ok) throw new Error(`staff login failed: HTTP ${staffLoginRes.status} ${JSON.stringify(staffLoginBody)}`);
    const staffAuth = { Authorization: `Bearer ${staffLoginBody.token}`, "Content-Type": "application/json" };

    const studentLoginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: studentEmail, password: studentPassword }) });
    const studentLoginBody = await studentLoginRes.json();
    if (!studentLoginRes.ok) throw new Error(`student login failed: HTTP ${studentLoginRes.status} ${JSON.stringify(studentLoginBody)}`);
    const studentAuth = { Authorization: `Bearer ${studentLoginBody.token}`, "Content-Type": "application/json" };
    console.log("Both logins OK\n");

    // --- Attendance ---
    console.log("=== ATTENDANCE ===");
    const markRes = await fetch(`${BASE}/attendance/assignments/${assignment.id}/plans/${plan.id}/attendance`, {
      method: "POST", headers: staffAuth, body: JSON.stringify({ records: [{ studentId: student.id, status: "PRESENT" }] }),
    });
    const markBody = await markRes.json();
    if (!markRes.ok) throw new Error(`mark attendance failed: HTTP ${markRes.status} ${JSON.stringify(markBody)}`);
    console.log(`Attendance marked — session ${markBody.id}, records: ${markBody.records.length}`);

    const myRecordsRes = await fetch(`${BASE}/attendance/my-records`, { headers: studentAuth });
    const myRecordsBody = await myRecordsRes.json();
    if (!myRecordsRes.ok) throw new Error(`GET /attendance/my-records failed: HTTP ${myRecordsRes.status} ${JSON.stringify(myRecordsBody)}`);
    const found = myRecordsBody.records.find((r) => r.subject === "Verification Subject" && r.status === "PRESENT");
    console.log(`Student's own records: ${myRecordsBody.records.length} row(s), verification lecture ${found ? "IS" : "is NOT"} present (expected: IS)`);
    if (!found) throw new Error("Marked attendance record did not appear in student's own /my-records");

    // --- Certificates ---
    console.log("\n=== CERTIFICATES ===");
    const issueRes = await fetch(`${BASE}/certificates/manual`, {
      method: "POST", headers: staffAuth, body: JSON.stringify({ studentId: student.id, programName: "Verification Program", title: "Verification Certificate" }),
    });
    const issueBody = await issueRes.json();
    if (!issueRes.ok) throw new Error(`issue certificate failed: HTTP ${issueRes.status} ${JSON.stringify(issueBody)}`);
    certId = issueBody.id;
    console.log(`Certificate issued: ${certId}, code: ${issueBody.certificateCode}, status: ${issueBody.status}`);

    const meRes = await fetch(`${BASE}/certificates/me`, { headers: studentAuth });
    const meBody = await meRes.json();
    if (!meRes.ok) throw new Error(`GET /certificates/me failed: HTTP ${meRes.status} ${JSON.stringify(meBody)}`);
    const listed = meBody.some((c) => c.id === certId);
    console.log(`Certificate ${listed ? "IS" : "is NOT"} listed under student's /certificates/me (expected: IS)`);
    if (!listed) throw new Error("Issued certificate not visible under student's own /certificates/me");

    const downloadRes = await fetch(`${BASE}/certificates/${certId}/download`, { headers: studentAuth });
    if (!downloadRes.ok) throw new Error(`certificate PDF download failed: HTTP ${downloadRes.status}`);
    const contentType = downloadRes.headers.get("content-type");
    const buf = Buffer.from(await downloadRes.arrayBuffer());
    console.log(`Certificate PDF downloaded — content-type: ${contentType}, size: ${buf.length} bytes`);
    if (!contentType?.includes("pdf") || buf.length < 500) throw new Error(`Certificate PDF looks wrong — content-type=${contentType}, size=${buf.length}`);

    const verifyRes = await fetch(`${BASE}/certificates/verify/${issueBody.certificateCode}`);
    const verifyBody = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(`public verify failed: HTTP ${verifyRes.status} ${JSON.stringify(verifyBody)}`);
    console.log(`Public verify (no auth) — valid: ${verifyBody.valid}, studentName: ${verifyBody.studentName}, programName: ${verifyBody.programName}`);
    if (!verifyBody.valid) throw new Error("Public certificate verification returned valid:false for a freshly-issued certificate");

    console.log("\n=== ATTENDANCE + CERTIFICATE FLOWS: PASS ===");
  } finally {
    if (certId) await prisma.certificate.delete({ where: { id: certId } }).catch(() => {});
    await prisma.attendanceRecord.deleteMany({ where: { session: { planId: plan.id } } }).catch(() => {});
    await prisma.attendanceSession.deleteMany({ where: { planId: plan.id } }).catch(() => {});
    await prisma.lecturePlan.delete({ where: { id: plan.id } }).catch(() => {});
    await prisma.staffClassAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: student.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: staff.id } }).catch(() => {});
    console.log("Cleaned up temp student, staff, assignment/plan, and certificate.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
