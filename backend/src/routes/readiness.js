const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { instituteWhere } = require("../utils/questionVisibility");
const { buildAssessmentBlueprint } = require("../utils/readinessBlueprint");
const { gradeReadinessAnswer, buildReadinessReport } = require("../utils/readinessScoring");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const logger = require("../utils/logger");
const { cached } = require("../utils/cache");
const { GRADABLE_QUESTION_TYPES } = require("../utils/readinessBlueprint");

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

    const normalizedOptions = Array.isArray(selectedOptions) ? selectedOptions : null;
    const answer = await prisma.readinessAnswer.upsert({
      where: { assessmentId_questionId: { assessmentId: assessment.id, questionId } },
      update: { answerText: answerText ?? null, code: code ?? null, language: language ?? null, selectedOptions: normalizedOptions, skipped: !!skipped, score, isCorrect, timeTakenSec: timeTakenSec ?? null },
      create: { assessmentId: assessment.id, questionId, answerText: answerText ?? null, code: code ?? null, language: language ?? null, selectedOptions: normalizedOptions, skipped: !!skipped, score, isCorrect, timeTakenSec: timeTakenSec ?? null },
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

// =========================== Admin/Staff: validation gate + analytics ===========================

// ADMIN/STAFF: per-subject coverage check — for every configured assessment mode, how many
// VERIFIED/PUBLISHED questions actually exist at each BTL level in that mode's range. This is the
// spec's "validate before publishing" gate made visible rather than a hard block: a subject can
// still be saved/activated with gaps (content grows incrementally), but the admin sees exactly
// which BTL levels/modes have zero coverage before students hit them at assessment time.
router.get("/admin/subjects/:id/coverage", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }

    const allowedTypes = (Array.isArray(subject.questionTypesAllowed) ? subject.questionTypesAllowed : []).filter((t) => GRADABLE_QUESTION_TYPES.includes(t));
    const baseWhere = {
      ...instituteWhere(req.requesterInstituteId),
      questionStatus: { in: ["VERIFIED", "PUBLISHED"] },
      questionType: { in: allowedTypes },
      subject: { equals: subject.name, mode: "insensitive" },
    };

    // One count query per BTL level (1-6), reused across every assessment mode below rather than
    // re-querying per mode — same batched-query discipline as talentPoolAutoSelect.js.
    const countsByLevel = {};
    await Promise.all([1, 2, 3, 4, 5, 6].map(async (level) => {
      countsByLevel[level] = await prisma.question.count({ where: { ...baseWhere, btlLevel: level } });
    }));

    const modes = Array.isArray(subject.assessmentModes) ? subject.assessmentModes : [];
    const modeCoverage = modes.map((m) => {
      const levels = [];
      for (let lvl = m.btlMin; lvl <= m.btlMax; lvl++) levels.push({ level: lvl, availableQuestions: countsByLevel[lvl] || 0 });
      const zeroLevels = levels.filter((l) => l.availableQuestions === 0).map((l) => l.level);
      return { key: m.key, label: m.label, btlMin: m.btlMin, btlMax: m.btlMax, levels, totalAvailable: levels.reduce((s, l) => s + l.availableQuestions, 0), zeroCoverageLevels: zeroLevels, ready: zeroLevels.length === 0 };
    });

    const topicsCovered = await prisma.question.findMany({ where: baseWhere, select: { topic: true }, distinct: ["topic"] });
    const configuredTopics = Array.isArray(subject.topics) ? subject.topics.map((t) => t.name) : [];
    const topicsWithNoQuestions = configuredTopics.filter((t) => !topicsCovered.some((q) => (q.topic || "").toLowerCase() === t.toLowerCase()));

    res.json({ subjectId: subject.id, allowedTypes, countsByLevel, modeCoverage, configuredTopics, topicsWithNoQuestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute subject coverage" });
  }
});

// Shared by the admin analytics route below — institute/subject/department/batch/section/mode
// scoped ReadinessReport rows, joined through their assessment+student+academicGroup for the
// breakdown groupings. Institute scoping is on the STUDENT's own institute (not the subject's,
// which may be platform-wide and attempted by students across many institutes) — an institute-
// scoped Admin/Staff must only ever see their own institute's students' results.
async function loadFilteredReports(req) {
  const studentWhere = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
  const assessmentWhere = {
    ...(req.query.subjectId ? { subjectId: req.query.subjectId } : {}),
    ...(req.query.assessmentMode ? { assessmentMode: req.query.assessmentMode } : {}),
  };
  return prisma.readinessReport.findMany({
    where: { assessment: assessmentWhere, student: studentWhere },
    include: {
      assessment: { select: { subjectId: true, assessmentMode: true, subject: { select: { name: true } } } },
      student: { select: { id: true, name: true, registrationNumber: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } } },
    },
  });
}

function breakdownBy(reports, keyFn) {
  const groups = new Map();
  for (const r of reports) {
    const key = keyFn(r) || "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.overallScore);
  }
  return [...groups.entries()].map(([key, scores]) => ({
    key, count: scores.length, averageScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
  })).sort((a, b) => b.count - a.count);
}

// ADMIN/STAFF/CLERK: institute-wide (or filtered) readiness analytics — class/subject/department/
// batch comparison, BTL distribution, topic weaknesses, at-risk students. Mirrors
// resultManagement.js's admin/analytics template: one shared filtered-load function feeding a
// generic breakdown helper, wrapped in cached() with an institute+querystring cache key.
router.get("/admin/analytics", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteKey = req.requesterInstituteId || "all";
    const filterKey = JSON.stringify(req.query);
    const analytics = await cached(`readinessAnalytics:${instituteKey}:${filterKey}`, 60 * 1000, async () => {
      const reports = await loadFilteredReports(req);
      if (reports.length === 0) {
        return {
          totalAssessments: 0, studentsAssessed: 0, averageReadiness: 0, readinessLevelDistribution: {},
          btlAverages: {}, topicWeaknesses: [], atRiskStudents: [], departmentWise: [], batchWise: [], sectionWise: [], subjectWise: [],
        };
      }

      const totalAssessments = reports.length;
      const studentsAssessed = new Set(reports.map((r) => r.studentId)).size;
      const averageReadiness = Math.round(reports.reduce((s, r) => s + r.overallScore, 0) / totalAssessments);

      const readinessLevelDistribution = {};
      for (const r of reports) readinessLevelDistribution[r.readinessLevel] = (readinessLevelDistribution[r.readinessLevel] || 0) + 1;

      const btlSums = {}, btlCounts = {};
      for (const r of reports) {
        for (const [lvl, v] of Object.entries(r.btlScores || {})) {
          if (!v) continue;
          btlSums[lvl] = (btlSums[lvl] || 0) + v.percent;
          btlCounts[lvl] = (btlCounts[lvl] || 0) + 1;
        }
      }
      const btlAverages = {};
      for (const lvl of Object.keys(btlSums)) btlAverages[lvl] = Math.round(btlSums[lvl] / btlCounts[lvl]);

      const topicSums = new Map();
      for (const r of reports) {
        for (const t of r.topicScores || []) {
          const key = t.topic;
          if (!topicSums.has(key)) topicSums.set(key, []);
          topicSums.get(key).push(t.accuracy);
        }
      }
      const topicWeaknesses = [...topicSums.entries()]
        .map(([topic, accuracies]) => ({ topic, averageAccuracy: Math.round(accuracies.reduce((s, v) => s + v, 0) / accuracies.length), studentsAssessed: accuracies.length }))
        .sort((a, b) => a.averageAccuracy - b.averageAccuracy)
        .slice(0, 10);

      const atRiskStudents = reports
        .filter((r) => r.readinessLevel === "NEEDS_IMPROVEMENT" || r.readinessLevel === "FOUNDATION_REQUIRED")
        .map((r) => ({ studentId: r.studentId, name: r.student.name, registrationNumber: r.student.registrationNumber, subject: r.assessment.subject.name, overallScore: r.overallScore, readinessLevel: r.readinessLevel }))
        .sort((a, b) => a.overallScore - b.overallScore)
        .slice(0, 50);

      return {
        totalAssessments, studentsAssessed, averageReadiness, readinessLevelDistribution, btlAverages, topicWeaknesses, atRiskStudents,
        departmentWise: breakdownBy(reports, (r) => r.student.academicGroup?.department?.name),
        batchWise: breakdownBy(reports, (r) => r.student.academicGroup?.batch),
        sectionWise: breakdownBy(reports, (r) => r.student.academicGroup?.section),
        subjectWise: breakdownBy(reports, (r) => r.assessment.subject.name),
      };
    });
    res.json(analytics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load readiness analytics" });
  }
});

module.exports = router;
