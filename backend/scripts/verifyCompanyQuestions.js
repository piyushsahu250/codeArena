// One-off: real HTTP-level verification of the Company-Specific Interview Question Intelligence
// System's core flow — a temp STAFF session generates company questions, confirms a real Gemini
// call produced drafts with source=AI_GENERATED_VARIANT/confidence=LOW, bulk-approves them,
// confirms they land as real InterviewQuestion rows with companyId/role set, then a temp STUDENT
// submits + a temp STAFF verifies a candidate report, confirming the corroboration path. Cleans up
// everything it creates.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function mkUser(role, institute) {
  const email = `verify-cqi-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: `Verify CQI ${role}`, email, passwordHash, role, instituteId: institute.id } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, token, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  if (!institute) throw new Error("Testing Institute not found");

  // ADMIN (not STAFF) — companies.js's POST /companies only allows ADMIN/SUPER_ADMIN/CLERK, and
  // this same actor also needs draft-generation/report-verification rights, so ADMIN covers both.
  const staff = await mkUser("ADMIN", institute);
  const student = await mkUser("STUDENT", institute);
  const companyName = `VerifyCQI-${Date.now()}`;
  const cleanupIds = { users: [staff.user.id, student.user.id], jtis: [staff.jti, student.jti], company: null, questions: [], reports: [] };

  try {
    // 1. Create a real company
    const companyRes = await fetch("http://127.0.0.1:4000/api/companies", {
      method: "POST", headers: staff.headers, body: JSON.stringify({ name: companyName }),
    });
    const company = await companyRes.json();
    console.log("CREATE COMPANY", companyRes.status, company.id);
    cleanupIds.company = company.id;

    // 2. Generate company questions
    const genRes = await fetch("http://127.0.0.1:4000/api/interview/admin/company-questions/generate", {
      method: "POST", headers: staff.headers,
      body: JSON.stringify({ companyId: company.id, role: "Software Engineer", experienceLevel: "FRESHER", round: "TECHNICAL", count: 2 }),
    });
    const genBody = await genRes.json();
    console.log("GENERATE STATUS", genRes.status);
    console.log("GENERATE job:", JSON.stringify(genBody.job?.resultSummary));
    console.log("GENERATE drafts:", genBody.drafts?.length, genBody.drafts?.map((d) => ({ sourceType: d.sourceType, confidenceLevel: d.confidenceLevel, role: d.role })));

    // 3. Bulk-approve
    const draftIds = (genBody.drafts || []).map((d) => d.id);
    let bulkBody = { approved: 0 };
    if (draftIds.length) {
      const bulkRes = await fetch("http://127.0.0.1:4000/api/interview/admin/drafts/questions/bulk-approve", {
        method: "POST", headers: staff.headers, body: JSON.stringify({ ids: draftIds }),
      });
      bulkBody = await bulkRes.json();
      console.log("BULK APPROVE STATUS", bulkRes.status, JSON.stringify(bulkBody));
      cleanupIds.questions.push(...bulkBody.results.filter((r) => r.success).map((r) => r.questionId));
    }

    // 4. Confirm the promoted InterviewQuestion carries the right metadata
    if (cleanupIds.questions.length) {
      const q = await prisma.interviewQuestion.findUnique({ where: { id: cleanupIds.questions[0] } });
      console.log("PROMOTED QUESTION", { companyId: q.companyId, role: q.role, sourceType: q.sourceType, confidenceLevel: q.confidenceLevel, experienceLevel: q.experienceLevel });
    }

    // 5. Health dashboard
    const healthRes = await fetch(`http://127.0.0.1:4000/api/interview/admin/company-questions/health?companyId=${company.id}`, { headers: staff.headers });
    console.log("HEALTH STATUS", healthRes.status, JSON.stringify(await healthRes.json()));

    // 6. Student submits a candidate report
    const reportRes = await fetch("http://127.0.0.1:4000/api/interview/company-questions/reports", {
      method: "POST", headers: student.headers,
      body: JSON.stringify({ companyId: company.id, role: "Software Engineer", round: "TECHNICAL", questionText: "Explain how a hash map handles collisions.", experienceLevel: "FRESHER" }),
    });
    const report = await reportRes.json();
    console.log("STUDENT REPORT STATUS", reportRes.status, report.id, report.status);
    cleanupIds.reports.push(report.id);

    // 7. Staff verifies it (new, non-duplicate question -> should create a CANDIDATE_REPORTED draft)
    const verifyRes = await fetch(`http://127.0.0.1:4000/api/interview/admin/company-questions/reports/${report.id}/verify`, {
      method: "PATCH", headers: staff.headers, body: JSON.stringify({ status: "VERIFIED" }),
    });
    const verified = await verifyRes.json();
    console.log("VERIFY REPORT STATUS", verifyRes.status, "promotedDraftId:", verified.promotedDraftId);
    if (verified.promotedDraftId) {
      const d = await prisma.interviewQuestionDraft.findUnique({ where: { id: verified.promotedDraftId } });
      console.log("PROMOTED-FROM-REPORT DRAFT", { sourceType: d.sourceType, confidenceLevel: d.confidenceLevel, verificationCount: d.verificationCount });
      await prisma.interviewQuestionDraft.delete({ where: { id: verified.promotedDraftId } });
    }
  } finally {
    // Cleanup — exact-id deletes only, real accounts/data never touched.
    if (cleanupIds.questions.length) await prisma.interviewQuestion.deleteMany({ where: { id: { in: cleanupIds.questions } } });
    if (cleanupIds.reports.length) await prisma.candidateQuestionReport.deleteMany({ where: { id: { in: cleanupIds.reports } } });
    await prisma.interviewQuestionDraft.deleteMany({ where: { sourceRun: { not: null }, companyId: cleanupIds.company || "___none___" } }).catch(() => {});
    if (cleanupIds.company) await prisma.company.delete({ where: { id: cleanupIds.company } }).catch(() => {});
    await prisma.loginSession.deleteMany({ where: { token: { in: cleanupIds.jtis } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupIds.users } } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
