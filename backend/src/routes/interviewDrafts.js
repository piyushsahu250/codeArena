const express = require("express");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { resolveCodingFields } = require("../utils/functionHarness");
const { generateQuestionDrafts, generateCompanyPatternNote } = require("../utils/interviewDraftGenerator");
const { COMPANIES } = require("../utils/companies");
const { safeErrorMessage } = require("../utils/errors");
const { ownsInterviewQuestionRow } = require("../utils/interviewQuestionVisibility");

const router = express.Router();

// Real, billed Claude API calls — same tighter-than-global rate-limit pattern as interview.js's
// own aiInsightsLimiter, resume.js's aiReviewLimiter, learning.js's hintLimiter.
const draftGenLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });

const VALID_CATEGORIES = ["HR", "TECHNICAL", "CODING", "APTITUDE", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];

// =========================== Admin/Staff: question drafts ===========================
// Everything under /admin/drafts/* is ADMIN/STAFF only. Generation and editing are open to both;
// approve/reject/delete (the actions that decide what a student ultimately sees) match the
// platform-wide convention of write-heavy content decisions being ADMIN-only elsewhere would be
// inconsistent here — Interview Prep's existing /admin/questions routes allow STAFF to create/edit
// too, so this mirrors that, not the ADMIN-only pattern used for challenges.js.

router.post("/admin/drafts/questions/generate", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("ai_draftview"), draftGenLimiter, async (req, res) => {
  try {
    const { category, company, count, difficulty, packageBand, experienceLevel, topicHint } = req.body;
    if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category" });
    const rows = await generateQuestionDrafts({ category, company: company || null, count, difficulty, packageBand, experienceLevel, topicHint: topicHint || undefined });
    res.json({ created: rows.length, drafts: rows });
  } catch (err) {
    console.error(err);
    if (err.notConfigured) return res.status(503).json({ error: err.message });
    res.status(400).json({ error: safeErrorMessage(err, "Failed to generate drafts") });
  }
});

router.get("/admin/drafts/questions", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.company) where.company = req.query.company;
  if (req.query.category) where.category = req.query.category;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const [rows, total] = await Promise.all([
    prisma.interviewQuestionDraft.findMany({ where, orderBy: { generatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.interviewQuestionDraft.count({ where }),
  ]);
  res.json({ rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.patch("/admin/drafts/questions/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const existing = await prisma.interviewQuestionDraft.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Draft not found" });
    if (existing.status !== "PENDING") return res.status(400).json({ error: "Only a pending draft can be edited" });

    const fields = [
      "category", "subject", "company", "aptitudeCategory", "difficulty", "title", "prompt", "expectedKeywords",
      "modelAnswer", "options", "correctAnswer", "explanation", "starterCode", "testCases", "language", "tags",
      "estimatedTimeMin", "realWorldScenario", "constraints", "inputFormat", "outputFormat", "notes", "edgeCases", "problemExplanation",
    ];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    const updated = await prisma.interviewQuestionDraft.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update draft") });
  }
});

// The ONLY funnel from a draft into a real, student-visible InterviewQuestion. Re-runs the exact
// CODING 2-visible/10-hidden validation and resolveCodingFields() server-side resolution that
// /admin/questions's own create/update routes enforce — a draft's own generation prompt only
// requests that same minimum, but this is the real backstop, not the prompt.
router.post("/admin/drafts/questions/:id/approve", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const draft = await prisma.interviewQuestionDraft.findUnique({ where: { id: req.params.id } });
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (draft.status !== "PENDING") return res.status(400).json({ error: "Draft has already been reviewed" });

    let resolved = { evaluationType: "STDIO", functionSignature: null, starterCodeByLanguage: undefined };
    if (draft.category === "CODING") {
      const cases = Array.isArray(draft.testCases) ? draft.testCases : [];
      if (cases.filter((tc) => !tc.isHidden).length < 2) {
        return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases — edit the draft before approving" });
      }
      if (cases.filter((tc) => tc.isHidden).length < 10) {
        return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation — edit the draft before approving" });
      }
      resolved = resolveCodingFields({ evaluationType: draft.evaluationType, functionSignature: draft.functionSignature, starterCodeByLanguage: draft.starterCodeByLanguage });
    }

    const { frequencyTag, packageBand, experienceLevel } = req.body;

    const question = await prisma.$transaction(async (tx) => {
      const q = await tx.interviewQuestion.create({
        data: {
          category: draft.category, subject: draft.subject, company: draft.company, aptitudeCategory: draft.aptitudeCategory,
          difficulty: draft.difficulty, title: draft.title, prompt: draft.prompt, expectedKeywords: draft.expectedKeywords ?? undefined,
          modelAnswer: draft.modelAnswer, options: draft.options ?? undefined, correctAnswer: draft.correctAnswer ?? undefined,
          explanation: draft.explanation, starterCode: draft.starterCode, testCases: draft.testCases ?? undefined,
          language: draft.language, tags: draft.tags ?? undefined,
          estimatedTimeMin: draft.estimatedTimeMin, realWorldScenario: draft.realWorldScenario, constraints: draft.constraints,
          inputFormat: draft.inputFormat, outputFormat: draft.outputFormat, notes: draft.notes, edgeCases: draft.edgeCases,
          problemExplanation: draft.problemExplanation,
          evaluationType: resolved.evaluationType, functionSignature: resolved.functionSignature, starterCodeByLanguage: resolved.starterCodeByLanguage,
          // frequencyTag/packageBand/experienceLevel are set here, at approval, by the reviewing
          // human — never carried over automatically from the draft's own generation request, so
          // an AI-suggested "TRENDING" label can never reach a live question without a human
          // explicitly re-affirming it in this same request.
          frequencyTag: frequencyTag || null, packageBand: packageBand || null, experienceLevel: experienceLevel || null,
          instituteId: req.requesterInstituteId || null,
          createdById: req.user.id,
        },
      });
      await tx.interviewQuestionDraft.update({
        where: { id: draft.id },
        data: { status: "APPROVED", reviewedByAdminId: req.user.id, reviewedAt: new Date(), approvedQuestionId: q.id },
      });
      return q;
    });

    res.json(question);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to approve draft") });
  }
});

router.post("/admin/drafts/questions/:id/reject", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const draft = await prisma.interviewQuestionDraft.findUnique({ where: { id: req.params.id } });
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (draft.status !== "PENDING") return res.status(400).json({ error: "Draft has already been reviewed" });
    const updated = await prisma.interviewQuestionDraft.update({
      where: { id: req.params.id },
      data: { status: "REJECTED", reviewedByAdminId: req.user.id, reviewedAt: new Date(), rejectionReason: req.body.reason || null },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject draft" });
  }
});

router.delete("/admin/drafts/questions/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const draft = await prisma.interviewQuestionDraft.findUnique({ where: { id: req.params.id } });
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (draft.status === "APPROVED") return res.status(400).json({ error: "An approved draft's record can't be deleted — delete the live question via /admin/questions instead" });
    await prisma.interviewQuestionDraft.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete draft" });
  }
});

// =========================== Admin/Staff: company pattern drafts ===========================

router.post("/admin/drafts/patterns/generate", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("ai_draftview"), draftGenLimiter, async (req, res) => {
  try {
    const { company, category } = req.body;
    if (!company || !String(company).trim()) return res.status(400).json({ error: "company is required" });
    if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category" });
    const note = await generateCompanyPatternNote({ company: company.trim(), category });
    res.json(note);
  } catch (err) {
    console.error(err);
    if (err.notConfigured) return res.status(503).json({ error: err.message });
    res.status(400).json({ error: safeErrorMessage(err, "Failed to generate pattern note") });
  }
});

router.get("/admin/drafts/patterns", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.company) where.company = req.query.company;
  const rows = await prisma.companyPatternNote.findMany({ where, orderBy: { generatedAt: "desc" }, take: 200 });
  res.json(rows);
});

router.patch("/admin/drafts/patterns/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const existing = await prisma.companyPatternNote.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Pattern note not found" });
    if (existing.status !== "PENDING") return res.status(400).json({ error: "Only a pending pattern note can be edited" });
    const checklistItems = Array.isArray(req.body.checklistItems) ? req.body.checklistItems.filter((s) => typeof s === "string" && s.trim()) : existing.checklistItems;
    const updated = await prisma.companyPatternNote.update({ where: { id: req.params.id }, data: { checklistItems } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update pattern note") });
  }
});

router.post("/admin/drafts/patterns/:id/approve", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const existing = await prisma.companyPatternNote.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Pattern note not found" });
    if (existing.status !== "PENDING") return res.status(400).json({ error: "Pattern note has already been reviewed" });
    if (!Array.isArray(existing.checklistItems) || existing.checklistItems.length === 0) {
      return res.status(400).json({ error: "Pattern note needs at least one checklist item before approval" });
    }
    const updated = await prisma.companyPatternNote.update({
      where: { id: req.params.id },
      data: { status: "APPROVED", reviewedByAdminId: req.user.id, reviewedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve pattern note" });
  }
});

router.post("/admin/drafts/patterns/:id/reject", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const existing = await prisma.companyPatternNote.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Pattern note not found" });
    if (existing.status !== "PENDING") return res.status(400).json({ error: "Pattern note has already been reviewed" });
    const updated = await prisma.companyPatternNote.update({
      where: { id: req.params.id },
      data: { status: "REJECTED", reviewedByAdminId: req.user.id, reviewedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject pattern note" });
  }
});

router.delete("/admin/drafts/patterns/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const existing = await prisma.companyPatternNote.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Pattern note not found" });
    if (existing.status === "APPROVED") return res.status(400).json({ error: "An approved pattern note can't be deleted — reject a new draft to supersede it instead" });
    await prisma.companyPatternNote.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete pattern note" });
  }
});

// =========================== Real usage analytics (never AI-authored text) ===========================
// Computed entirely from InterviewAnswer — every question served in a session gets a row
// pre-created at session start (see interview.js's session-creation routes), so a plain groupBy
// on questionId is a complete, honest "how many times has this actually been served on this
// platform" signal — no denormalized counter to drift out of sync, no AI involved anywhere in
// this response.

router.get("/admin/questions/:id/analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionId = req.params.id;
  // Previously had no institute/ownership check at all beyond role -- any Staff/Admin could pull
  // usage analytics for any InterviewQuestion id, including another institute's private question.
  const existing = await prisma.interviewQuestion.findUnique({ where: { id: questionId }, select: { instituteId: true, createdById: true } });
  if (!existing) return res.status(404).json({ error: "Question not found" });
  if (!ownsInterviewQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });
  const [timesServed, answered, skipped] = await Promise.all([
    prisma.interviewAnswer.count({ where: { questionId } }),
    prisma.interviewAnswer.aggregate({ where: { questionId, skipped: false }, _avg: { score: true }, _count: { _all: true } }),
    prisma.interviewAnswer.count({ where: { questionId, skipped: true } }),
  ]);
  res.json({
    questionId,
    realUsage: {
      timesServed,
      averageScore: answered._count._all > 0 ? Math.round((answered._avg.score || 0) * 10) / 10 : null,
      skipRate: timesServed > 0 ? Math.round((skipped / timesServed) * 1000) / 10 : null,
    },
  });
});

// =========================== Companies catalog + AI-estimated pattern ===========================

router.get("/companies/catalog", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const counts = await prisma.interviewQuestion.groupBy({ by: ["company"], where: { company: { not: null } }, _count: { _all: true } });
  const countByCompany = Object.fromEntries(counts.map((c) => [c.company, c._count._all]));
  res.json(COMPANIES.map((company) => ({ company, questionCount: countByCompany[company] || 0 })));
});

router.get("/companies/:company/pattern", authenticate, async (req, res) => {
  const notes = await prisma.companyPatternNote.findMany({
    where: { company: req.params.company, status: "APPROVED" },
    orderBy: { category: "asc" },
  });
  res.json(notes.map((n) => ({ aiEstimated: true, category: n.category, checklistItems: n.checklistItems, generatedAt: n.generatedAt })));
});

module.exports = router;
