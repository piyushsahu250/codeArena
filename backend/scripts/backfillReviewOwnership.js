// Idempotent backfill for audit item T-3 (ownership of the shared AI-review queues and the company catalogue). Only fills rows whose
// owner is still null and only from evidence already in the database; never overwrites an owner and never deletes anything. Rows with no
// recoverable owner stay null = platform-owned (visible to platform-level reviewers only).
const prisma = require("../src/prisma");

async function main() {
  const instituteOf = new Map();
  async function institute(userId) {
    if (!userId) return null;
    if (!instituteOf.has(userId)) instituteOf.set(userId, (await prisma.user.findUnique({ where: { id: userId }, select: { instituteId: true } }))?.instituteId || null);
    return instituteOf.get(userId);
  }
  const out = { companies: 0, jobs: 0, draftsFromJob: 0, draftsFromReport: 0, draftsFromReviewer: 0, notes: 0 };

  for (const c of await prisma.company.findMany({ where: { instituteId: null }, select: { id: true, createdByUserId: true } })) {
    const inst = await institute(c.createdByUserId);
    if (inst) { await prisma.company.update({ where: { id: c.id }, data: { instituteId: inst } }); out.companies++; }
  }
  for (const j of await prisma.questionGenerationJob.findMany({ where: { instituteId: null }, select: { id: true, requestedByAdminId: true } })) {
    const inst = await institute(j.requestedByAdminId);
    if (inst) { await prisma.questionGenerationJob.update({ where: { id: j.id }, data: { instituteId: inst } }); out.jobs++; }
  }
  const jobs = new Map((await prisma.questionGenerationJob.findMany({ select: { id: true, instituteId: true, requestedByAdminId: true } })).map((j) => [j.id, j]));
  for (const d of await prisma.interviewQuestionDraft.findMany({ where: { instituteId: null }, select: { id: true, sourceRun: true, candidateReportId: true, reviewedByAdminId: true } })) {
    let inst = null, by = null, kind = null;
    const job = d.sourceRun ? jobs.get(d.sourceRun) : null;
    if (job?.instituteId) { inst = job.instituteId; by = job.requestedByAdminId; kind = "draftsFromJob"; }
    if (!inst && d.candidateReportId) {
      const r = await prisma.candidateQuestionReport.findUnique({ where: { id: d.candidateReportId }, select: { student: { select: { instituteId: true } } } });
      if (r?.student?.instituteId) { inst = r.student.instituteId; kind = "draftsFromReport"; }
    }
    if (!inst && d.reviewedByAdminId) { inst = await institute(d.reviewedByAdminId); by = d.reviewedByAdminId; if (inst) kind = "draftsFromReviewer"; }
    if (inst) { await prisma.interviewQuestionDraft.update({ where: { id: d.id }, data: { instituteId: inst, ...(by ? { createdById: by } : {}) } }); out[kind]++; }
  }
  for (const n of await prisma.companyPatternNote.findMany({ where: { instituteId: null, reviewedByAdminId: { not: null } }, select: { id: true, reviewedByAdminId: true } })) {
    const inst = await institute(n.reviewedByAdminId);
    if (inst) { await prisma.companyPatternNote.update({ where: { id: n.id }, data: { instituteId: inst } }); out.notes++; }
  }
  console.log("[backfillReviewOwnership]", JSON.stringify(out));
}
main().then(() => process.exit(0)).catch((e) => { console.error("[backfillReviewOwnership] failed:", e.message); process.exit(0); });
