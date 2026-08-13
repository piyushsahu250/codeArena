const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { instituteWhere } = require("../utils/questionVisibility");
const { buildAssessmentBlueprint } = require("../utils/readinessBlueprint");
const { gradeReadinessAnswer, buildReadinessReport } = require("../utils/readinessScoring");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const logger = require("../utils/logger");

const router = express.Router();

const DEFAULT_QUESTION_COUNT = 15;
const MAX_QUESTION_COUNT = 50;

function sanitizeQuestionForStudent(q) {
  return {
    id: q.id, title: q.title, description: q.description, subject: q.subject, topic: q.topic,
    subtopic: q.subtopic, questionType: q.questionType, difficulty: q.difficulty, points: q.points,
    btlLevel: q.btlLevel, options: q.options, starterCode: q.starterCode,
    starterCodeByLanguage: q.starterCodeByLanguage, language: q.language, tags: q.tags,
    evaluationType: q.evaluationType, functionSignature: q.functionSignature,
    estimatedTimeMin: q.estimatedTimeMin, realWorldScenario: q.realWorldScenario, constraints: q.constraints,
    inputFormat: q.inputFormat, outputFormat: q.outputFormat, notes: q.notes, edgeCases: q.edgeCases,
    problemExplanation: q.problemExplanation,
    // Sample cases only — hidden ones (used for real scoring) never leave the server, same
    // convention as every other coding surface on this platform.
    testCases: Array.isArray(q.testCases) ? q.testCases.filter((tc) => !tc.isHidden) : undefined,
  };
}

// =========================== Admin/Staff: Subject configuration ===========================

router.get("/admin/subjects", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subjects = await prisma.readinessSubject.findMany({
      where: instituteWhere(req.requesterInstituteId),
      orderBy: { name: "asc" },
    });
    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load subjects" });
  }
});

router.get("/admin/subjects/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    res.json(subject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load subject" });
  }
});

function validateSubjectPayload(body) {
  if (!body.name || !String(body.name).trim()) return "Subject name is required";
  if (!Array.isArray(body.topics) || body.topics.length === 0) return "At least one topic is required";
  if (!Array.isArray(body.questionTypesAllowed) || body.questionTypesAllowed.length === 0) return "At least one question type must be allowed";
  if (!body.defaultBtlDistribution || typeof body.defaultBtlDistribution !== "object") return "A default BTL distribution is required";
  if (!Array.isArray(body.assessmentModes) || body.assessmentModes.length === 0) return "At least one assessment mode is required";
  for (const m of body.assessmentModes) {
    if (!m.key || !m.label || !(m.btlMin >= 1) || !(m.btlMax <= 6) || m.btlMin > m.btlMax) {
      return `Assessment mode "${m.key || "?"}" has an invalid BTL range`;
    }
  }
  if (!Array.isArray(body.readinessThresholds) || body.readinessThresholds.length === 0) return "At least one readiness threshold is required";
  const distSum = Object.values(body.defaultBtlDistribution).reduce((s, v) => s + (Number(v) || 0), 0);
  if (distSum < 50 || distSum > 150) {
    // Not a hard block (subjects legitimately vary), but the spec explicitly asks the system to
    // warn when a distribution looks unrealistic — a sum this far from 100% almost always means a
    // typo rather than an intentional design choice.
    return { warning: `BTL distribution sums to ${distSum}%, expected roughly 100% — double-check before saving.` };
  }
  return null;
}

const SUBJECT_FIELDS = ["name", "code", "department", "program", "description", "topics", "questionTypesAllowed", "defaultBtlDistribution", "assessmentModes", "employabilityIndicators", "defaultDurationMin", "passingPercent", "readinessThresholds", "isActive"];

router.post("/admin/subjects", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const validation = validateSubjectPayload(req.body);
    if (validation && !validation.warning) return res.status(400).json({ error: validation });

    const data = {};
    for (const f of SUBJECT_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f];
    data.instituteId = req.requesterInstituteId || req.body.instituteId || null;
    data.createdById = req.user.id;

    const subject = await prisma.readinessSubject.create({ data });
    await logAudit({ req, action: AUDIT_ACTIONS.READINESS_SUBJECT_SAVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: data.instituteId, details: { subjectId: subject.id, name: subject.name, created: true } });

    res.status(201).json({ subject, warning: validation?.warning || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create subject" });
  }
});

router.patch("/admin/subjects/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && existing.instituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }

    const merged = { ...existing, ...req.body };
    const validation = validateSubjectPayload(merged);
    if (validation && !validation.warning) return res.status(400).json({ error: validation });

    const data = {};
    for (const f of SUBJECT_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f];

    const subject = await prisma.readinessSubject.update({ where: { id: req.params.id }, data });
    await logAudit({ req, action: AUDIT_ACTIONS.READINESS_SUBJECT_SAVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: subject.instituteId, details: { subjectId: subject.id, name: subject.name, updated: true } });

    res.json({ subject, warning: validation?.warning || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update subject" });
  }
});

router.delete("/admin/subjects/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && existing.instituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    const attemptCount = await prisma.readinessAssessment.count({ where: { subjectId: req.params.id } });
    if (attemptCount > 0) {
      return res.status(400).json({ error: `Cannot delete — ${attemptCount} student assessment(s) already reference this subject. Deactivate it instead.` });
    }
    await prisma.readinessSubject.delete({ where: { id: req.params.id } });
    await logAudit({ req, action: AUDIT_ACTIONS.READINESS_SUBJECT_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: existing.instituteId, details: { subjectId: existing.id, name: existing.name } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete subject" });
  }
});

// =========================== Student: browse subjects ===========================

router.get("/subjects", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
    const subjects = await prisma.readinessSubject.findMany({
      where: { ...instituteWhere(student?.instituteId), isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load subjects" });
  }
});

// =========================== Student: assessment lifecycle ===========================

// STUDENT: start (or resume, if one's already in progress for the same subject+mode) an
// assessment — same resume convention as the Mock Interview module's POST /sessions.
router.post("/assessments", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { subjectId, assessmentMode, questionCount } = req.body;
    if (!subjectId || !assessmentMode) return res.status(400).json({ error: "subjectId and assessmentMode are required" });

    const subject = await prisma.readinessSubject.findUnique({ where: { id: subjectId } });
    if (!subject || !subject.isActive) return res.status(404).json({ error: "This subject is not available" });

    const existing = await prisma.readinessAssessment.findFirst({
      where: { studentId: req.user.id, subjectId, assessmentMode, status: "IN_PROGRESS" },
      include: { answers: { orderBy: { createdAt: "asc" } } },
    });
    if (existing) {
      const questions = await prisma.question.findMany({ where: { id: { in: existing.answers.map((a) => a.questionId) } }, include: { testCases: true } });
      const ordered = existing.answers.map((a) => questions.find((q) => q.id === a.questionId)).filter(Boolean);
      logger.info("READINESS_ASSESSMENT_RESUMED", { assessmentId: existing.id, studentId: req.user.id, subjectId, questionCount: ordered.length });
      return res.json({ assessment: existing, questions: ordered.map(sanitizeQuestionForStudent), resumed: true });
    }

    const count = Math.min(MAX_QUESTION_COUNT, Math.max(1, Number(questionCount) || DEFAULT_QUESTION_COUNT));
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
    const { items, blueprint, usedFallback, shortfallLevels } = await buildAssessmentBlueprint({
      subject, assessmentMode, questionCount: count, studentInstituteId: student?.instituteId, excludeStudentId: req.user.id,
    });
    if (items.length === 0) {
      return res.status(400).json({ error: "No verified questions are available for this subject/mode yet — ask an admin to add and verify some." });
    }

    const assessment = await prisma.readinessAssessment.create({
      data: {
        studentId: req.user.id, subjectId, assessmentMode, blueprint, durationMin: subject.defaultDurationMin,
        config: { usedFallback, shortfallLevels },
      },
    });
    await prisma.readinessAnswer.createMany({ data: items.map((q) => ({ assessmentId: assessment.id, questionId: q.id, skipped: true })) });

    logger.info("READINESS_ASSESSMENT_CREATED", { assessmentId: assessment.id, studentId: req.user.id, subjectId, assessmentMode, questionCount: items.length, usedFallback });

    res.json({ assessment, questions: items.map(sanitizeQuestionForStudent), resumed: false, usedFallback, shortfallLevels });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Failed to start assessment" });
  }
});

router.get("/assessments/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const assessment = await prisma.readinessAssessment.findUnique({
      where: { id: req.params.id },
      include: { answers: { orderBy: { createdAt: "asc" } }, report: true, subject: true },
    });
    if (!assessment || assessment.studentId !== req.user.id) return res.status(404).json({ error: "Assessment not found" });
    const questions = await prisma.question.findMany({ where: { id: { in: assessment.answers.map((a) => a.questionId) } }, include: { testCases: true } });
    const ordered = assessment.answers.map((a) => ({ ...sanitizeQuestionForStudent(questions.find((q) => q.id === a.questionId) || {}), answer: a }));
    res.json({ assessment, questions: ordered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load assessment" });
  }
});

router.post("/assessments/:id/answer", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const assessment = await prisma.readinessAssessment.findUnique({ where: { id: req.params.id } });
    if (!assessment || assessment.studentId !== req.user.id) return res.status(403).json({ error: "Invalid assessment" });
    if (assessment.status !== "IN_PROGRESS") return res.status(400).json({ error: "This assessment is already finalized" });

    const { questionId, answerText, code, language, selectedOptions, skipped, timeTakenSec } = req.body;
    const question = await prisma.question.findUnique({ where: { id: questionId }, include: { testCases: true } });
    if (!question) return res.status(404).json({ error: "Question not found" });

    const { score, isCorrect } = await gradeReadinessAnswer(question, { answerText, code, language, selectedOptions, skipped });

    const answer = await prisma.readinessAnswer.upsert({
      where: { assessmentId_questionId: { assessmentId: assessment.id, questionId } },
      update: { answerText: answerText ?? null, code: code ?? null, language: language ?? null, skipped: !!skipped, score, isCorrect, timeTakenSec: timeTakenSec ?? null },
      create: { assessmentId: assessment.id, questionId, answerText: answerText ?? null, code: code ?? null, language: language ?? null, skipped: !!skipped, score, isCorrect, timeTakenSec: timeTakenSec ?? null },
    });
    logger.info("READINESS_ANSWER_SAVED", { assessmentId: assessment.id, questionId, questionType: question.questionType, skipped: !!skipped, score });

    res.json({ saved: true, answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save answer" });
  }
});

router.post("/assessments/:id/finalize", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const assessment = await prisma.readinessAssessment.findUnique({ where: { id: req.params.id }, include: { report: true, subject: true } });
    if (!assessment || assessment.studentId !== req.user.id) return res.status(403).json({ error: "Invalid assessment" });
    if (assessment.status !== "IN_PROGRESS") return res.json({ assessment, report: assessment.report });

    const answers = await prisma.readinessAnswer.findMany({ where: { assessmentId: assessment.id } });
    const questions = await prisma.question.findMany({ where: { id: { in: answers.map((a) => a.questionId) } } });
    const answersWithQuestions = answers.map((a) => ({ ...a, question: questions.find((q) => q.id === a.questionId) || {} }));

    const built = buildReadinessReport(answersWithQuestions, assessment.subject);

    const [updatedAssessment, report] = await prisma.$transaction([
      prisma.readinessAssessment.update({ where: { id: assessment.id }, data: { status: "COMPLETED", submittedAt: new Date() } }),
      prisma.readinessReport.upsert({
        where: { assessmentId: assessment.id },
        update: built,
        create: { assessmentId: assessment.id, studentId: assessment.studentId, ...built },
      }),
    ]);

    logger.info("READINESS_ASSESSMENT_COMPLETED", { assessmentId: assessment.id, studentId: assessment.studentId, subjectId: assessment.subjectId, overallScore: report.overallScore, readinessLevel: report.readinessLevel });

    res.json({ assessment: updatedAssessment, report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to finalize assessment" });
  }
});

// STUDENT: assessment history for one subject (or all subjects if none specified) — trend over
// time, per spec's "readiness action history" requirement.
router.get("/history", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 10;
    const where = { studentId: req.user.id, status: "COMPLETED", ...(req.query.subjectId ? { subjectId: req.query.subjectId } : {}) };
    const [assessments, total] = await Promise.all([
      prisma.readinessAssessment.findMany({
        where, include: { report: true, subject: { select: { id: true, name: true } } },
        orderBy: { submittedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.readinessAssessment.count({ where }),
    ]);
    res.json({ assessments, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load assessment history" });
  }
});

module.exports = router;
