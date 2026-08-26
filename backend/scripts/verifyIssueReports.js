// One-off: verify the Report a Problem feature end-to-end against the real running API using
// real temporary accounts (created the same way a real login creates a session). Cleans up by
// exact ID/jti only.
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");

const API_BASE = "http://127.0.0.1:4000/api";

async function mkTempUser(role, instituteId) {
  const email = `verify-issue-${role.toLowerCase()}-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: `Verify ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, token, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function main() {
  const cleanup = [];
  try {
    const institute = await prisma.institute.findFirst();
    const student = await mkTempUser("STUDENT", institute.id);
    const instAdmin = await mkTempUser("INSTITUTE_ADMIN", institute.id);
    const otherInstAdmin = await mkTempUser("INSTITUTE_ADMIN", null); // will attach to a 2nd institute if one exists
    cleanup.push(student, instAdmin, otherInstAdmin);

    // 1. Student submits a report
    const submitRes = await fetch(`${API_BASE}/issue-reports`, {
      method: "POST", headers: student.headers,
      body: JSON.stringify({ page: "/dashboard", description: "Verification: the chart on my dashboard shows NaN%", feature: "dashboard" }),
    });
    const submitBody = await submitRes.json();
    console.log("1. Student submit ->", submitRes.status, submitBody);

    // 2. Student sees it in their own history
    const mineRes = await fetch(`${API_BASE}/issue-reports/mine`, { headers: student.headers });
    const mineBody = await mineRes.json();
    console.log("2. Student /mine ->", mineRes.status, "count:", mineBody.issues?.length, "found submitted:", mineBody.issues?.some((i) => i.id === submitBody.id));

    // 3. Student CANNOT see the review queue
    const studentQueueRes = await fetch(`${API_BASE}/issue-reports`, { headers: student.headers });
    console.log("3. Student GET / (queue) ->", studentQueueRes.status, "(expect 403)");

    // 4. Institute admin (same institute) sees it in the queue
    const queueRes = await fetch(`${API_BASE}/issue-reports`, { headers: instAdmin.headers });
    const queueBody = await queueRes.json();
    console.log("4. Same-institute admin queue ->", queueRes.status, "found:", queueBody.issues?.some((i) => i.id === submitBody.id));

    // 5. Institute admin updates status
    const patchRes = await fetch(`${API_BASE}/issue-reports/${submitBody.id}`, {
      method: "PATCH", headers: instAdmin.headers, body: JSON.stringify({ status: "TRIAGED", severity: "P2", reviewNotes: "Verification note" }),
    });
    const patchBody = await patchRes.json();
    console.log("5. Admin patch status ->", patchRes.status, patchBody.status, patchBody.reviewedByName);

    // Cleanup the created issue report itself (not part of the standard user/session cleanup)
    await prisma.userReportedIssue.delete({ where: { id: submitBody.id } });
    console.log("Cleaned up test issue report.");
  } finally {
    const jtis = cleanup.map((c) => c.jti);
    const userIds = cleanup.map((c) => c.user.id);
    await prisma.loginSession.deleteMany({ where: { token: { in: jtis } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
