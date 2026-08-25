const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { safeErrorMessage } = require("../utils/errors");
const { sendAiError } = require("../utils/aiErrors");
const aiService = require("../services/ai/aiService");
const {
  findLikelyDuplicates, assignConfidenceLevel, computeRecencyBucket,
} = require("../utils/companyQuestionIntelligence");

const router = express.Router();

// Same tighter-than-global budget as every other AI-generate route on this platform — a company
// question "update" is a real, billed Gemini call, just like draftGenLimiter/hintLimiter/etc.
const generateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });

const VALID_ROUNDS = ["HR", "TECHNICAL", "CODING", "APTITUDE", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];
const STALE_AFTER_DAYS = 180;

// ============================================================
// Admin: "UPDATE QUESTIONS" — the core generation pipeline
// ============================================================
//
// 1. Load existing InterviewQuestion + PENDING InterviewQuestionDraft rows for this
//    company/role/round (+level when given) — this is both the "existing questions" review list
//    and the corpus new AI drafts get deduplicated against.
// 2. Classify each existing row as stale (no lastSeenAt/lastVerifiedAt within STALE_AFTER_DAYS,
//    and not itself an AI-generated variant — an AI variant has no "recency" to go stale from)
//    vs. recent.
// 3. If the admin asked for new questions (count > 0), call aiService.generateInterviewQuestions()
//    — the SAME method built for the AI Mock Interview / AI Draft system, not a separate prompt
//    pipeline — with company/role/level/round as context. Every generated question is checked
//    against the existing corpus via findLikelyDuplicates(); a likely duplicate is skipped and
//    counted, never silently added as a new row.
// 4. Every surviving generated question becomes an InterviewQuestionDraft — PENDING, never
//    auto-published — with sourceType=AI_GENERATED_VARIANT and confidenceLevel=LOW (assigned by
//    the deterministic rule, not the model), tagged companyId/role/experienceLevel/category so the
//    review UI can filter to exactly this run's output.
// Shared by POST /generate and POST /jobs/:id/retry, so a retry is a real re-run of the exact
// same pipeline rather than a hand-maintained second copy of it.
async function runGenerationJob({ companyId, role, experienceLevel, round, technology, count, req }) {
  const n = Math.min(10, Math.max(0, Number(count) || 3));
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) { const err = new Error("Company not found"); err.status = 404; throw err; }

  const job = await prisma.questionGenerationJob.create({
    data: {
      companyId, role: role.trim(), experienceLevel: experienceLevel || null, round, technology: technology || null,
      status: "PROCESSING", startedAt: new Date(),
      requestedByAdminId: req.user.id, requestedByName: req.user.name,
    },
  });

  try {
    const matchWhere = { companyId, role: role.trim(), category: round, ...(experienceLevel ? { experienceLevel } : {}) };
    const [existingQuestions, existingDrafts] = await Promise.all([
      prisma.interviewQuestion.findMany({ where: matchWhere, select: { id: true, prompt: true, title: true, lastSeenAt: true, lastVerifiedAt: true, sourceType: true, confidenceLevel: true, verificationCount: true, createdAt: true } }),
      prisma.interviewQuestionDraft.findMany({ where: { ...matchWhere, status: "PENDING" }, select: { id: true, prompt: true, title: true } }),
    ]);

    const staleCutoff = Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const staleFound = existingQuestions.filter((q) => {
      if (q.sourceType === "AI_GENERATED_VARIANT") return false; // no recency concept for a variant that was never "seen" anywhere
      const lastSignal = q.lastVerifiedAt || q.lastSeenAt || q.createdAt;
      return new Date(lastSignal).getTime() < staleCutoff;
    }).length;

    let aiGenerated = 0;
    let duplicatesSkipped = 0;
    const createdDrafts = [];

    if (n > 0) {
      const dedupCorpus = [...existingQuestions, ...existingDrafts];
      const generated = await aiService.generateInterviewQuestions({
        userId: req.user.id, instituteId: req.requesterInstituteId,
        category: round, count: n, company: company.name, experienceLevel: experienceLevel || undefined,
        jobRole: role.trim(), topicHint: technology || undefined,
      });
      const questions = Array.isArray(generated?.questions) ? generated.questions : [];

      for (const q of questions.slice(0, n)) {
        const text = q.prompt || q.title || "";
        if (!text.trim()) continue;
        const dupes = findLikelyDuplicates(text, dedupCorpus);
        if (dupes.length > 0) { duplicatesSkipped++; continue; }

        const confidenceLevel = assignConfidenceLevel({ sourceType: "AI_GENERATED_VARIANT" });
        const draft = await prisma.interviewQuestionDraft.create({
          data: {
            category: round, subject: q.subject || technology || null, company: company.name,
            difficulty: q.difficulty || "MEDIUM", title: q.title || null, prompt: text,
            testCases: q.testCases ?? undefined, options: q.options ?? undefined, correctAnswer: q.correctAnswer ?? undefined,
            explanation: q.explanation || null, expectedKeywords: q.expectedKeywords ?? undefined, modelAnswer: q.modelAnswer || null,
            companyId, role: role.trim(), experienceLevel: experienceLevel || null,
            sourceType: "AI_GENERATED_VARIANT", confidenceLevel, verificationCount: 0,
            sourceRun: job.id,
          },
        });
        dedupCorpus.push({ prompt: draft.prompt, title: draft.title });
        createdDrafts.push(draft);
        aiGenerated++;
      }
    }

    const resultSummary = {
      existingReviewed: existingQuestions.length, existingPendingDrafts: existingDrafts.length,
      staleFound, duplicatesSkipped, aiGenerated,
    };
    await prisma.questionGenerationJob.update({
      where: { id: job.id },
      data: { status: aiGenerated < n ? "PARTIAL" : "COMPLETED", resultSummary, completedAt: new Date() },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.COMPANY_INTERVIEW_PROFILE_SAVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { feature: "company_question_generation", jobId: job.id, company: company.name, role, round, ...resultSummary },
    });

    return { job: { ...job, status: resultSummary.aiGenerated < n ? "PARTIAL" : "COMPLETED", resultSummary }, drafts: createdDrafts };
  } catch (err) {
    const isAiError = err.notConfigured || err.quotaExceeded || err.queueBusy || err.timedOut || err.blocked || err.invalidResponse || err.status === 429;
    await prisma.questionGenerationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: isAiError ? err.message : safeErrorMessage(err, "Generation failed"), completedAt: new Date() },
    });
    err.jobId = job.id;
    err.isAiError = isAiError;
    throw err;
  }
}

router.post("/admin/company-questions/generate", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("ai_draftview"), generateLimiter, async (req, res) => {
  const { companyId, role, experienceLevel, round, technology, count } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  if (!role || !String(role).trim()) return res.status(400).json({ error: "role is required" });
  if (!VALID_ROUNDS.includes(round)) return res.status(400).json({ error: `round must be one of: ${VALID_ROUNDS.join(", ")}` });

  try {
    const result = await runGenerationJob({ companyId, role, experienceLevel, round, technology, count, req });
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    if (err.isAiError) return sendAiError(res, err);
    console.error(err);
    res.status(500).json({ error: "Failed to update company questions", jobId: err.jobId });
  }
});

router.post("/admin/company-questions/jobs/:id/retry", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("ai_draftview"), generateLimiter, async (req, res) => {
  const original = await prisma.questionGenerationJob.findUnique({ where: { id: req.params.id } });
  if (!original) return res.status(404).json({ error: "Job not found" });
  if (original.status !== "FAILED") return res.status(400).json({ error: "Only a failed job can be retried" });
  try {
    const result = await runGenerationJob({
      companyId: original.companyId, role: original.role, experienceLevel: original.experienceLevel,
      round: original.round, technology: original.technology, count: 3, req,
    });
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    if (err.isAiError) return sendAiError(res, err);
    console.error(err);
    res.status(500).json({ error: "Retry failed", jobId: err.jobId });
  }
});

router.get("/admin/company-questions/jobs", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const where = {};
  if (req.query.companyId) where.companyId = req.query.companyId;
  if (req.query.status) where.status = req.query.status;
  const rows = await prisma.questionGenerationJob.findMany({
    where, orderBy: { createdAt: "desc" }, take: Math.min(100, Number(req.query.pageSize) || 25),
    include: { companyRef: { select: { id: true, name: true } } },
  });
  res.json(rows);
});

router.get("/admin/company-questions/jobs/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const job = await prisma.questionGenerationJob.findUnique({ where: { id: req.params.id }, include: { companyRef: { select: { id: true, name: true } } } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// ============================================================
// "Company Question Health" dashboard (spec §23)
// ============================================================
router.get("/admin/company-questions/health", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const companies = req.query.companyId
    ? await prisma.company.findMany({ where: { id: req.query.companyId }, select: { id: true, name: true } })
    : await prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, take: 50 });

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const health = await Promise.all(companies.map(async (c) => {
    const baseWhere = { companyId: c.id };
    const [total, recent, stale, high, medium, low, aiGenerated, needsReview] = await Promise.all([
      prisma.interviewQuestion.count({ where: baseWhere }),
      prisma.interviewQuestion.count({ where: { ...baseWhere, OR: [{ lastVerifiedAt: { gte: recentCutoff } }, { lastSeenAt: { gte: recentCutoff } }] } }),
      prisma.interviewQuestion.count({ where: { ...baseWhere, sourceType: { not: "AI_GENERATED_VARIANT" }, lastVerifiedAt: { lt: staleCutoff }, OR: [{ lastSeenAt: { lt: staleCutoff } }, { lastSeenAt: null }] } }),
      prisma.interviewQuestion.count({ where: { ...baseWhere, confidenceLevel: "HIGH" } }),
      prisma.interviewQuestion.count({ where: { ...baseWhere, confidenceLevel: "MEDIUM" } }),
      prisma.interviewQuestion.count({ where: { ...baseWhere, confidenceLevel: "LOW" } }),
      prisma.interviewQuestion.count({ where: { ...baseWhere, sourceType: "AI_GENERATED_VARIANT" } }),
      prisma.interviewQuestionDraft.count({ where: { ...baseWhere, status: "PENDING" } }),
    ]);
    return { companyId: c.id, companyName: c.name, total, recent, stale, high, medium, low, aiGenerated, needsReview };
  }));

  res.json(health);
});

// ============================================================
// Candidate-submitted questions (spec §26) — student self-service
// ============================================================
const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: (req) => req.user.id });

router.post("/company-questions/reports", authenticate, requireRole("STUDENT"), reportLimiter, async (req, res) => {
  try {
    const { companyId, role, experienceLevel, round, interviewDate, questionText, technology, difficulty } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    if (!role || !String(role).trim()) return res.status(400).json({ error: "role is required" });
    if (!VALID_ROUNDS.includes(round)) return res.status(400).json({ error: `round must be one of: ${VALID_ROUNDS.join(", ")}` });
    if (!questionText || !String(questionText).trim()) return res.status(400).json({ error: "questionText is required" });

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ error: "Company not found" });

    const report = await prisma.candidateQuestionReport.create({
      data: {
        studentId: req.user.id, companyId, role: role.trim(), experienceLevel: experienceLevel || null, round,
        interviewDate: interviewDate ? new Date(interviewDate) : null, questionText: questionText.trim(),
        technology: technology || null, difficulty: difficulty || null,
      },
    });
    res.json({ id: report.id, status: report.status, message: "Thanks — an admin will review this before it's added to any question pool." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

router.get("/company-questions/reports/mine", authenticate, requireRole("STUDENT"), async (req, res) => {
  const rows = await prisma.candidateQuestionReport.findMany({
    where: { studentId: req.user.id }, orderBy: { createdAt: "desc" }, take: 100,
    include: { companyRef: { select: { id: true, name: true } } },
  });
  res.json(rows);
});

router.get("/admin/company-questions/reports", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.companyId) where.companyId = req.query.companyId;
  const rows = await prisma.candidateQuestionReport.findMany({
    where, orderBy: { createdAt: "desc" }, take: Math.min(200, Number(req.query.pageSize) || 50),
    include: { companyRef: { select: { id: true, name: true } }, student: { select: { id: true, name: true, email: true } } },
  });
  res.json(rows);
});

// Verifying a report either (a) corroborates an existing similar question — bumping its
// verificationCount and re-running the deterministic confidence rule, which is exactly the
// mechanism that lets a question earn its way to HIGH confidence over time — or (b) creates a new
// InterviewQuestionDraft (sourceType=CANDIDATE_REPORTED, confidenceLevel=MEDIUM) for the normal
// PENDING review/approve pipeline. Either way, nothing reaches a student without a separate
// explicit approval — verifying a report is not the same action as publishing a question.
router.patch("/admin/company-questions/reports/:id/verify", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const { status, rejectionReason, convertToDraft } = req.body;
    if (!["VERIFIED", "REJECTED"].includes(status)) return res.status(400).json({ error: "status must be VERIFIED or REJECTED" });
    if (status === "REJECTED" && !rejectionReason?.trim()) return res.status(400).json({ error: "A reason is required when rejecting" });

    const report = await prisma.candidateQuestionReport.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status !== "PENDING") return res.status(400).json({ error: "This report has already been reviewed" });

    let promotedDraftId = null;
    if (status === "VERIFIED" && convertToDraft !== false) {
      const existing = await prisma.interviewQuestion.findMany({
        where: { companyId: report.companyId, role: report.role, category: report.round },
        select: { id: true, prompt: true, title: true, verificationCount: true, sourceType: true },
      });
      const dupes = findLikelyDuplicates(report.questionText, existing);
      if (dupes.length > 0) {
        const match = dupes[0].question;
        const newCount = (match.verificationCount || 0) + 1;
        await prisma.interviewQuestion.update({
          where: { id: match.id },
          data: {
            verificationCount: newCount, lastSeenAt: report.interviewDate || new Date(), lastVerifiedAt: new Date(),
            confidenceLevel: assignConfidenceLevel({ sourceType: match.sourceType || "CANDIDATE_REPORTED", verificationCount: newCount }),
          },
        });
      } else {
        const draft = await prisma.interviewQuestionDraft.create({
          data: {
            category: report.round, company: (await prisma.company.findUnique({ where: { id: report.companyId }, select: { name: true } }))?.name || "",
            prompt: report.questionText, difficulty: report.difficulty || "MEDIUM",
            companyId: report.companyId, role: report.role, experienceLevel: report.experienceLevel,
            sourceType: "CANDIDATE_REPORTED", confidenceLevel: assignConfidenceLevel({ sourceType: "CANDIDATE_REPORTED", verificationCount: 1 }),
            verificationCount: 1, firstSeenAt: report.interviewDate || report.createdAt, lastSeenAt: report.interviewDate || report.createdAt,
            candidateReportId: report.id,
          },
        });
        promotedDraftId = draft.id;
      }
    }

    const updated = await prisma.candidateQuestionReport.update({
      where: { id: report.id },
      data: { status, reviewedByAdminId: req.user.id, reviewedByName: req.user.name, reviewedAt: new Date(), rejectionReason: status === "REJECTED" ? rejectionReason.trim() : null, promotedDraftId },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify report" });
  }
});

module.exports = router;
