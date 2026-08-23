const express = require("express");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { instituteWhere, questionVisibilityWhere } = require("../utils/questionVisibility");
const { buildAssessmentBlueprint, subjectQuestionWhere } = require("../utils/readinessBlueprint");
const { gradeReadinessAnswer, buildReadinessReport, READINESS_LEVEL_RANK, computeAssessmentCoverage } = require("../utils/readinessScoring");
const { issueCertificate } = require("../utils/certificates");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const logger = require("../utils/logger");
const { cached, invalidate } = require("../utils/cache");
const { GRADABLE_QUESTION_TYPES } = require("../utils/readinessBlueprint");
const { generateReadinessReportPdf } = require("../utils/readinessReportPdf");
const { readinessSubjectEligibilityWhere, studentCanAccessReadinessSubject } = require("../utils/readinessEligibility");

const router = express.Router();

const DEFAULT_QUESTION_COUNT = 15;
const MAX_QUESTION_COUNT = 50;

// STAFF is restricted to only the AcademicGroups they've been assigned via StaffClassAssignment —
// same inline query shape attendance.js already uses at 3 call sites (no shared util exists on
// this platform for this lookup, confirmed before writing this). Returns null for ADMIN (and the
// unscoped platform admin) so call sites can treat null as "unrestricted" without a separate branch.
async function staffAcademicGroupIds(req) {
  if (req.user.role !== "STAFF") return null;
  const rows = await prisma.staffClassAssignment.findMany({ where: { staffId: req.user.id }, select: { academicGroupId: true } });
  return rows.map((r) => r.academicGroupId).filter(Boolean);
}

// Ownership check for mutating a ReadinessSubject (edit/delete/reassign groups) — mirrors
// questionVisibility.js's ownsQuestionRow() convention: ADMIN is unrestricted, a STAFF requester
// may only mutate a subject they created, or a legacy row with no recorded creator
// (createdById: null). This is deliberately stricter than list-visibility below — being able to
// SEE a subject because it's assigned to one of your classes does not make you authorized to
// edit or delete another staff member's subject.
function isSubjectOwner(req, subject) {
  if (req.user.role !== "STAFF") return true;
  return !subject.createdById || subject.createdById === req.user.id;
}

// Institute to scope a list/analytics query to — a scoped Admin/Staff's own institute always
// wins (never overridable by a client-supplied query param); an unscoped Platform Admin may
// optionally narrow to one institute via ?instituteId=, mirroring academicGroups.js's identical
// GET / pattern (spec: an Admin institute filter for the multi-institute view).
function resolvedInstituteId(req) {
  return req.requesterInstituteId || req.query.instituteId || null;
}

// Rejects any academicGroupId outside a scoped Admin/Staff's own institute — mirrors courses.js's
// assertAssignmentScope for CourseAcademicGroupAssignment. Unscoped Platform Admin
// (req.requesterInstituteId === null) is unrestricted, same convention as every other
// attachRequesterInstitute-guarded route.
async function assertReadinessAssignmentScope(req, res, academicGroupIds) {
  if (!req.requesterInstituteId || !academicGroupIds?.length) return true;
  const groups = await prisma.academicGroup.findMany({ where: { id: { in: academicGroupIds } }, select: { id: true, instituteId: true } });
  if (groups.length !== academicGroupIds.length || groups.some((g) => g.instituteId !== req.requesterInstituteId)) {
    res.status(403).json({ error: "You can only assign this subject to academic groups within your own institute" });
    return false;
  }
  return true;
}

// Builds the "Institute · Batch · Department · Section · Program" line every generated readiness
// report/export must carry (spec section 16) — resolved live off the student's current
// institute/academicGroup/program rather than a stored snapshot, per ResultEntry's own documented
// convention (never denormalize, always read live at render time).
function formatAcademicContext(student) {
  const parts = [
    student?.institute?.name,
    student?.academicGroup?.batch,
    student?.academicGroup?.department?.name,
    student?.academicGroup?.section ? `Section ${student.academicGroup.section}` : null,
    student?.program,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

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

// Query params batch/departmentId/section are a display filter for the admin's cascading picker
// (spec section 13) — narrows to subjects explicitly assigned to a matching academic group. This
// is a display refinement on top of scopeWhere below, not a security boundary on its own (GET
// /subjects and POST /assessments are the actual student-facing enforcement points).
//
// STAFF visibility (scopeWhere below) is creator-based, not institute-wide: subjects they
// created, legacy rows with no recorded creator, or any subject assigned to one of their own
// StaffClassAssignment academic groups. ADMIN sees every subject in the institute.
router.get("/admin/subjects", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { batch, departmentId, section } = req.query;
    const hasDisplayFilter = !!(batch || departmentId || section);
    const groupMatch = { ...(batch ? { batch } : {}), ...(departmentId ? { departmentId } : {}), ...(section ? { section } : {}) };

    // STAFF sees: subjects they created (or legacy rows with no recorded creator), PLUS any
    // subject — regardless of creator — assigned to one of their own classes (they need to see
    // what's running for students they teach). Previously an unassigned ("open to entire
    // institute") subject was visible to every STAFF member by default, which is exactly the
    // "Staff A's test automatically visible to Staff B" leak the privacy model is meant to close.
    const myGroupIds = await staffAcademicGroupIds(req);
    const scopeWhere = myGroupIds !== null
      ? { OR: [{ createdById: req.user.id }, { createdById: null }, { academicGroupAssignments: { some: { academicGroupId: { in: myGroupIds } } } }] }
      : {};
    const filterWhere = hasDisplayFilter ? { academicGroupAssignments: { some: { academicGroup: groupMatch } } } : {};

    const subjects = await prisma.readinessSubject.findMany({
      where: { ...instituteWhere(resolvedInstituteId(req)), ...scopeWhere, ...filterWhere },
      include: { _count: { select: { academicGroupAssignments: true } } },
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
    const subject = await prisma.readinessSubject.findUnique({
      where: { id: req.params.id },
      include: { academicGroupAssignments: { include: { academicGroup: { include: { department: true, institute: true } } } } },
    });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    // Read access matches the list rule: owner/legacy, or assigned to one of the staff member's
    // own classes. Edit/delete (below) is intentionally narrower — see isSubjectOwner().
    if (!isSubjectOwner(req, subject)) {
      const myGroupIds = await staffAcademicGroupIds(req);
      const assignedToMe = subject.academicGroupAssignments.some((a) => myGroupIds.includes(a.academicGroupId));
      if (!assignedToMe) return res.status(404).json({ error: "Subject not found" });
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

const SUBJECT_FIELDS = ["name", "code", "department", "program", "description", "topics", "questionTypesAllowed", "defaultBtlDistribution", "assessmentModes", "employabilityIndicators", "defaultDurationMin", "passingPercent", "readinessThresholds", "isActive", "certificateEnabled", "certificateMinLevel", "maxAttempts"];

router.post("/admin/subjects", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const validation = validateSubjectPayload(req.body);
    if (validation && !validation.warning) return res.status(400).json({ error: validation });

    const data = {};
    for (const f of SUBJECT_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f];
    data.instituteId = req.requesterInstituteId || req.body.instituteId || null;
    data.createdById = req.user.id;

    // Case-insensitive duplicate-name guard, scoped to the institute — nothing on this model
    // enforces uniqueness at the DB level (no @@unique, unlike Subject/Unit added for the Question
    // Bank feature), so without this check the same institute could silently end up with two
    // subjects both named "DSA". A platform-wide subject (instituteId: null) sharing a name with an
    // institute-scoped one isn't a real collision, so this only runs when instituteId is set.
    if (data.instituteId) {
      const dup = await prisma.readinessSubject.findFirst({
        where: { name: { equals: data.name, mode: "insensitive" }, instituteId: data.instituteId },
        select: { id: true },
      });
      if (dup) return res.status(409).json({ error: `A subject named "${data.name}" already exists for this institute.` });
    }

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
    if (!isSubjectOwner(req, existing)) {
      return res.status(403).json({ error: "You can only edit readiness tests you created" });
    }

    const merged = { ...existing, ...req.body };
    const validation = validateSubjectPayload(merged);
    if (validation && !validation.warning) return res.status(400).json({ error: validation });

    const data = {};
    for (const f of SUBJECT_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f];

    // Same duplicate-name guard as POST above, only when the name is actually being changed —
    // instituteId can't move via PATCH (not in SUBJECT_FIELDS), so `existing.instituteId` is
    // always the correct scope to check against.
    if (data.name !== undefined && existing.instituteId) {
      const dup = await prisma.readinessSubject.findFirst({
        where: { name: { equals: data.name, mode: "insensitive" }, instituteId: existing.instituteId, id: { not: req.params.id } },
        select: { id: true },
      });
      if (dup) return res.status(409).json({ error: `A subject named "${data.name}" already exists for this institute.` });
    }

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
    if (!isSubjectOwner(req, existing)) {
      return res.status(403).json({ error: "You can only delete readiness tests you created" });
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

// ADMIN/STAFF: assign a subject to specific academic groups (Institute+Batch+Department+Section),
// optionally narrowed further to one free-text program per group — the actual "who can see/start
// this assessment" gate that GET /subjects and POST /assessments enforce (see
// utils/readinessEligibility.js). Mirrors courses.js's POST/DELETE /courses/:id/assignments
// pattern exactly (createMany+skipDuplicates / deleteMany, not a full-replace).
router.post("/admin/subjects/:id/assignments", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    if (!isSubjectOwner(req, subject)) {
      return res.status(403).json({ error: "You can only assign academic groups to readiness tests you created" });
    }

    const assignments = (Array.isArray(req.body.assignments) ? req.body.assignments : []).filter((a) => a?.academicGroupId);
    if (!assignments.length) return res.status(400).json({ error: "No academic groups provided" });
    if (!(await assertReadinessAssignmentScope(req, res, assignments.map((a) => a.academicGroupId)))) return;

    await prisma.readinessSubjectAcademicGroup.createMany({
      data: assignments.map((a) => ({
        subjectId: subject.id, academicGroupId: a.academicGroupId, program: (a.program || "").trim() || null,
        assignedByUserId: req.user.id, assignedByName: req.user.name,
      })),
      skipDuplicates: true,
    });
    await logAudit({ req, action: AUDIT_ACTIONS.READINESS_TEST_ASSIGNED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: subject.instituteId, details: { subjectId: subject.id, name: subject.name, assignedCount: assignments.length } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign academic groups" });
  }
});

router.delete("/admin/subjects/:id/assignments", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    if (!isSubjectOwner(req, subject)) {
      return res.status(403).json({ error: "You can only unassign academic groups from readiness tests you created" });
    }

    const academicGroupIds = Array.isArray(req.body.academicGroupIds) ? req.body.academicGroupIds : [];
    if (!academicGroupIds.length) return res.status(400).json({ error: "No academic groups provided" });
    if (!(await assertReadinessAssignmentScope(req, res, academicGroupIds))) return;

    await prisma.readinessSubjectAcademicGroup.deleteMany({ where: { subjectId: subject.id, academicGroupId: { in: academicGroupIds } } });
    await logAudit({ req, action: AUDIT_ACTIONS.READINESS_TEST_ASSIGNED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: subject.instituteId, details: { subjectId: subject.id, name: subject.name, unassignedCount: academicGroupIds.length } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to unassign academic groups" });
  }
});

// =========================== Student: browse subjects ===========================

router.get("/subjects", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("readiness_test"), async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true, program: true } });
    const subjects = await prisma.readinessSubject.findMany({
      where: { isActive: true, ...readinessSubjectEligibilityWhere(student?.academicGroupId, student?.program, student?.instituteId) },
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
router.post("/assessments", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("readiness_test"), async (req, res) => {
  try {
    const { subjectId, assessmentMode, questionCount } = req.body;
    if (!subjectId || !assessmentMode) return res.status(400).json({ error: "subjectId and assessmentMode are required" });

    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true, program: true } });
    const subject = await prisma.readinessSubject.findUnique({ where: { id: subjectId } });
    if (!subject || !subject.isActive) return res.status(404).json({ error: "This subject is not available" });
    const eligible = await studentCanAccessReadinessSubject(prisma, subjectId, student?.academicGroupId, student?.program, student?.instituteId);
    if (!eligible) return res.status(403).json({ error: "This subject is not assigned to your academic group" });

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

    // Server-side attempt cap — a resumed in-progress attempt (handled above) never counts against
    // this, only genuinely COMPLETED ones do, so a student can always finish an attempt already in
    // progress even after hitting the limit. Counted fresh from the DB on every call, never trusted
    // from any client-supplied attempt number.
    if (subject.maxAttempts != null) {
      const completedCount = await prisma.readinessAssessment.count({
        where: { studentId: req.user.id, subjectId, assessmentMode, status: "COMPLETED" },
      });
      if (completedCount >= subject.maxAttempts) {
        return res.status(403).json({ error: `You've used all ${subject.maxAttempts} attempt${subject.maxAttempts === 1 ? "" : "s"} for this assessment.`, maxAttemptsReached: true, maxAttempts: subject.maxAttempts, attemptsUsed: completedCount });
      }
    }

    const count = Math.min(MAX_QUESTION_COUNT, Math.max(1, Number(questionCount) || DEFAULT_QUESTION_COUNT));
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
      include: {
        answers: { orderBy: { createdAt: "asc" } }, report: true, subject: true,
        student: { select: { program: true, institute: { select: { name: true } }, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } } },
      },
    });
    if (!assessment || assessment.studentId !== req.user.id) return res.status(404).json({ error: "Assessment not found" });
    const questions = await prisma.question.findMany({ where: { id: { in: assessment.answers.map((a) => a.questionId) } }, include: { testCases: true } });
    const ordered = assessment.answers.map((a) => ({ ...sanitizeQuestionForStudent(questions.find((q) => q.id === a.questionId) || {}), answer: a }));
    res.json({
      assessment: { ...assessment, academicContext: formatAcademicContext(assessment.student), coverage: computeAssessmentCoverage(assessment.blueprint) },
      questions: ordered,
    });
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
    const assessment = await prisma.readinessAssessment.findUnique({
      where: { id: req.params.id },
      include: { report: true, subject: true, student: { include: { institute: true } } },
    });
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

    // Every filter combination admin/staff have ever queried gets its own cache key (see
    // GET /admin/analytics's filterKey), so a plain single-key invalidate can't target them all —
    // invalidate() already supports prefix-matching for exactly this "whole family of cached reads"
    // case (see its own comment in cache.js). Without this, a just-submitted assessment could stay
    // invisible on the faculty dashboard for up to the 60s TTL.
    invalidate("readinessAnalytics");
    invalidate("readinessAnalyticsCompare");
    invalidate("readinessPlacementOverview");

    // Certificate-on-completion: opt-in per subject (CRITICAL RULE — never auto-issue unless the
    // admin has explicitly enabled it and set a minimum level). One cert per student per subject —
    // idempotency is the studentId+readinessSubjectId+type DB unique constraint, so a student
    // re-attempting after already qualifying is a no-op here, and per this platform's "no
    // downgrade on retake" convention a cert already earned is never revoked by a later, weaker
    // attempt. Runs fire-and-forget (like the CODING_ASSESSMENT issuance in
    // gradeModuleCodingAttempt.js) so a certificate failure never blocks the student's report.
    const subject = assessment.subject;
    if (subject.certificateEnabled && subject.certificateMinLevel) {
      const requiredRank = READINESS_LEVEL_RANK[subject.certificateMinLevel] ?? 0;
      const earnedRank = READINESS_LEVEL_RANK[report.readinessLevel] ?? 0;
      if (earnedRank >= requiredRank) {
        const already = await prisma.certificate.findUnique({
          where: { studentId_readinessSubjectId_type: { studentId: assessment.studentId, readinessSubjectId: subject.id, type: "READINESS" } },
        });
        if (!already) {
          issueCertificate({
            type: "READINESS",
            studentId: assessment.studentId,
            readinessSubjectId: subject.id,
            readinessLevel: report.readinessLevel,
            title: `${subject.name} Employability Readiness`,
            instituteCode: assessment.student.institute?.code,
            programCode: subject.code,
          }).catch((err) => console.error("Readiness certificate issuance failed:", err));
        }
      }
    }

    res.json({ assessment: updatedAssessment, report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to finalize assessment" });
  }
});

// STUDENT: download their own completed report as a PDF — same self-scoping as every other
// readiness route (studentId must match the requester), reusing the platform's shared PDF
// branding helper like every other report generator.
router.get("/assessments/:id/report.pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const assessment = await prisma.readinessAssessment.findUnique({ where: { id: req.params.id }, include: { report: true, subject: true } });
    if (!assessment || assessment.studentId !== req.user.id) return res.status(404).json({ error: "Assessment not found" });
    if (!assessment.report) return res.status(400).json({ error: "This assessment hasn't been submitted yet" });

    const student = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { name: true, program: true, institute: { select: { name: true } }, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="readiness-report-${assessment.id.slice(0, 8)}.pdf"`);
    generateReadinessReportPdf({
      studentName: student.name, subjectName: assessment.subject.name, assessmentMode: assessment.assessmentMode,
      submittedAt: assessment.submittedAt, report: assessment.report, academicContext: formatAcademicContext(student),
      coverage: computeAssessmentCoverage(assessment.blueprint),
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate PDF report" });
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

    // Progress-over-time trend (spec section 18) — only computed on page 1, since it's a
    // one-time summary for the hub, not part of the paginated list itself. Scoped to this one
    // student's own completed assessments, so (unlike the admin analytics queries elsewhere in
    // this file) an unbounded read here can't grow with institute size.
    let trend = null;
    if (page === 1) {
      const all = await prisma.readinessAssessment.findMany({
        where: { studentId: req.user.id, status: "COMPLETED" },
        select: { submittedAt: true, subject: { select: { name: true } }, report: { select: { overallScore: true } } },
        orderBy: { submittedAt: "asc" },
      });
      const withScores = all.filter((a) => a.report);
      const bySubject = new Map();
      for (const a of withScores) {
        const name = a.subject.name;
        if (!bySubject.has(name)) bySubject.set(name, []);
        bySubject.get(name).push({ submittedAt: a.submittedAt, score: a.report.overallScore });
      }
      trend = {
        overall: withScores.map((a) => ({ submittedAt: a.submittedAt, score: a.report.overallScore })),
        bySubject: [...bySubject.entries()]
          .filter(([, points]) => points.length >= 2)
          .map(([subject, points]) => ({ subject, first: points[0].score, latest: points[points.length - 1].score, attempts: points.length })),
      };
    }

    res.json({ assessments, page, pageSize, total, totalPages: Math.ceil(total / pageSize), trend });
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
    const baseWhere = await subjectQuestionWhere(subject, {
      ...instituteWhere(req.requesterInstituteId),
      questionStatus: { in: ["VERIFIED", "PUBLISHED"] },
      questionType: { in: allowedTypes },
    });

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

// =========================== Admin/Staff: curated question pool ===========================
// The explicit, staff-picked question set a subject draws from once curated (see
// readinessBlueprint.js's subjectQuestionWhere) — reuses the existing Question Bank rather than a
// parallel question system. Managed only by the subject's owner or an Admin, same isSubjectOwner
// gate as PATCH/DELETE /admin/subjects/:id above.

router.get("/admin/subjects/:id/pool", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    if (!isSubjectOwner(req, subject)) {
      return res.status(403).json({ error: "You can only manage the question pool for tests you created" });
    }
    const pool = await prisma.readinessQuestionPool.findMany({
      where: { subjectId: subject.id },
      include: { question: { select: { id: true, title: true, description: true, questionType: true, difficulty: true, btlLevel: true, topic: true, questionStatus: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(pool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load question pool" });
  }
});

// Adds one or more questions to a subject's pool. Every questionId is independently checked
// against questionVisibilityWhere — a staff member can only pool a question they own, that's
// legacy/shared, or that's in a folder explicitly shared with them; never another staff member's
// untouched private question, even if they somehow know its id.
router.post("/admin/subjects/:id/pool", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    if (!isSubjectOwner(req, subject)) {
      return res.status(403).json({ error: "You can only manage the question pool for tests you created" });
    }
    const questionIds = Array.isArray(req.body.questionIds) ? [...new Set(req.body.questionIds.filter(Boolean))] : [];
    if (questionIds.length === 0) return res.status(400).json({ error: "No questions provided" });

    const visible = await prisma.question.findMany({
      where: { id: { in: questionIds }, ...questionVisibilityWhere(req) },
      select: { id: true },
    });
    if (visible.length === 0) return res.status(403).json({ error: "None of the selected questions are in your question bank" });

    await prisma.readinessQuestionPool.createMany({
      data: visible.map((q) => ({ subjectId: subject.id, questionId: q.id, addedByUserId: req.user.id, addedByName: req.user.name })),
      skipDuplicates: true,
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.READINESS_SUBJECT_SAVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: subject.instituteId, details: { subjectId: subject.id, name: subject.name, pooledCount: visible.length },
    });
    res.json({ success: true, addedCount: visible.length, skippedCount: questionIds.length - visible.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add questions to pool" });
  }
});

router.delete("/admin/subjects/:id/pool/:questionId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const subject = await prisma.readinessSubject.findUnique({ where: { id: req.params.id } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Subject not found" });
    }
    if (!isSubjectOwner(req, subject)) {
      return res.status(403).json({ error: "You can only manage the question pool for tests you created" });
    }
    await prisma.readinessQuestionPool.deleteMany({ where: { subjectId: subject.id, questionId: req.params.questionId } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove question from pool" });
  }
});

// Shared by the admin analytics route below — institute/subject/department/batch/section/mode
// scoped ReadinessReport rows, joined through their assessment+student+academicGroup for the
// breakdown groupings. Institute scoping is on the STUDENT's own institute (not the subject's,
// which may be platform-wide and attempted by students across many institutes) — an institute-
// scoped Admin/Staff must only ever see their own institute's results.
//
// `academicGroupOverride` (an AcademicGroup where-clause, e.g. {batch,departmentId,section} or
// {id: oneGroupId}) lets computeReadinessAnalyticsComparison() reuse this same function per-group
// instead of duplicating the query — when omitted, it's built from req.query's batch/departmentId/
// section params (the normal single-view dashboard filter). STAFF is always intersected against
// their own StaffClassAssignment academic groups, same restriction as the subject-list routes.
const READINESS_REPORT_CAP = 10000;

async function loadFilteredReports(req, academicGroupOverride) {
  const scopedInstituteId = resolvedInstituteId(req);
  const studentWhere = scopedInstituteId ? { instituteId: scopedInstituteId } : {};
  const { batch, departmentId, section } = req.query;
  const academicGroupFilter = academicGroupOverride || { ...(batch ? { batch } : {}), ...(departmentId ? { departmentId } : {}), ...(section ? { section } : {}) };
  if (Object.keys(academicGroupFilter).length) studentWhere.academicGroup = academicGroupFilter;

  const myGroupIds = await staffAcademicGroupIds(req);
  if (myGroupIds !== null) studentWhere.academicGroupId = { in: myGroupIds };

  const assessmentWhere = {
    ...(req.query.subjectId ? { subjectId: req.query.subjectId } : {}),
    ...(req.query.assessmentMode ? { assessmentMode: req.query.assessmentMode } : {}),
  };
  return prisma.readinessReport.findMany({
    where: { assessment: assessmentWhere, student: studentWhere },
    include: {
      assessment: { select: { subjectId: true, assessmentMode: true, subject: { select: { name: true } } } },
      student: { select: { id: true, name: true, registrationNumber: true, rollNumber: true, program: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } } },
    },
    // Same hard ceiling resultManagement.js's/attendance.js's exports use on an otherwise-unbounded
    // filtered load — this function feeds both the dashboard and the Excel export, and neither had
    // any cap at all before this. A runaway/unfiltered request (no institute scope, e.g. the
    // platform-level admin) could otherwise load every ReadinessReport row ever created into memory.
    take: READINESS_REPORT_CAP,
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

// Shared by both the cached JSON analytics route and the on-demand Excel export below, so the
// two never drift — one computation, two renderings. academicGroupOverride passes straight through
// to loadFilteredReports (see its own comment) — used by computeReadinessAnalyticsComparison below.
async function computeReadinessAnalytics(req, academicGroupOverride) {
  const reports = await loadFilteredReports(req, academicGroupOverride);
  if (reports.length === 0) {
    return {
      totalAssessments: 0, studentsAssessed: 0, averageReadiness: 0, readinessLevelDistribution: {},
      btlAverages: {}, topicWeaknesses: [], atRiskStudents: [], topPerformers: [], departmentWise: [], batchWise: [], sectionWise: [], subjectWise: [],
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
    .map((r) => ({ studentId: r.studentId, name: r.student.name, registrationNumber: r.student.registrationNumber, rollNumber: r.student.rollNumber, subject: r.assessment.subject.name, overallScore: r.overallScore, readinessLevel: r.readinessLevel }))
    .sort((a, b) => a.overallScore - b.overallScore)
    .slice(0, 50);

  // Symmetric to atRiskStudents above — the top two readiness levels, highest score first. Same
  // 50-row cap for the same reason (a runaway/unfiltered request shouldn't return an unbounded list).
  const topPerformers = reports
    .filter((r) => r.readinessLevel === "JOB_READY" || r.readinessLevel === "EXCELLENTLY_READY")
    .map((r) => ({ studentId: r.studentId, name: r.student.name, registrationNumber: r.student.registrationNumber, rollNumber: r.student.rollNumber, subject: r.assessment.subject.name, overallScore: r.overallScore, readinessLevel: r.readinessLevel }))
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 50);

  return {
    totalAssessments, studentsAssessed, averageReadiness, readinessLevelDistribution, btlAverages, topicWeaknesses, atRiskStudents, topPerformers,
    departmentWise: breakdownBy(reports, (r) => r.student.academicGroup?.department?.name),
    batchWise: breakdownBy(reports, (r) => r.student.academicGroup?.batch),
    sectionWise: breakdownBy(reports, (r) => r.student.academicGroup?.section),
    subjectWise: breakdownBy(reports, (r) => r.assessment.subject.name),
  };
}

// ADMIN/STAFF, explicit opt-in only (never automatic — spec: "the normal dashboard must NOT
// automatically combine [groups]"): one independently-computed, labeled analytics block per
// requested academicGroupId, reusing the exact same computeReadinessAnalytics()/
// loadFilteredReports() pipeline as the single-group view, so a compared group's numbers can never
// disagree with what that same group shows outside compare mode. A STAFF-requested or cross-
// institute group id outside the requester's own scope silently returns an empty block (never a
// leak) because loadFilteredReports still ANDs the requester's own institute/staff-group
// restriction on top of the requested academicGroupId.
async function computeReadinessAnalyticsComparison(req, academicGroupIds) {
  const groups = await prisma.academicGroup.findMany({ where: { id: { in: academicGroupIds } }, include: { department: true } });
  const blocks = await Promise.all(groups.map(async (g) => ({
    academicGroupId: g.id,
    label: `${g.batch} · ${g.department.name} · ${g.section}`,
    ...(await computeReadinessAnalytics(req, { id: g.id })),
  })));
  return { groups: blocks };
}

// ADMIN/STAFF: institute-wide (or filtered) readiness analytics — class/subject/department/
// batch comparison, BTL distribution, topic weaknesses, at-risk students. Mirrors
// resultManagement.js's admin/analytics template: one shared filtered-load function feeding a
// generic breakdown helper, wrapped in cached() with an institute+querystring cache key.
// CLERK is deliberately excluded — this is academic/cognitive-performance data, outside the
// placement/document workflow scope Clerk is otherwise limited to.
router.get("/admin/analytics", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const compareGroupIds = req.query.compareGroupIds ? String(req.query.compareGroupIds).split(",").map((s) => s.trim()).filter(Boolean) : [];
    const instituteKey = resolvedInstituteId(req) || "all";
    const filterKey = JSON.stringify(req.query);
    const analytics = compareGroupIds.length
      ? await cached(`readinessAnalyticsCompare:${instituteKey}:${filterKey}`, 60 * 1000, () => computeReadinessAnalyticsComparison(req, compareGroupIds))
      : await cached(`readinessAnalytics:${instituteKey}:${filterKey}`, 60 * 1000, () => computeReadinessAnalytics(req));
    res.json(analytics);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load readiness analytics" });
  }
});

// ADMIN/STAFF: Excel export of the same analytics the dashboard renders — one summary sheet plus
// an at-risk-students sheet, both sourced from computeReadinessAnalytics() so the export can
// never disagree with what's on screen. Same XLSX.utils/aoa_to_sheet convention as every other
// export on this platform (see routes/questions.js's /export).
router.get("/admin/analytics/export", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const analytics = await computeReadinessAnalytics(req);

    // Academic-context header (spec section 16: every export must carry it) — describes the scope
    // this export was actually filtered to, not one student's context (this is aggregate data).
    const scopedInstituteId = resolvedInstituteId(req);
    const [institute, department, subject] = await Promise.all([
      scopedInstituteId ? prisma.institute.findUnique({ where: { id: scopedInstituteId }, select: { name: true } }) : null,
      req.query.departmentId ? prisma.department.findUnique({ where: { id: req.query.departmentId }, select: { name: true } }) : null,
      req.query.subjectId ? prisma.readinessSubject.findUnique({ where: { id: req.query.subjectId }, select: { name: true } }) : null,
    ]);
    const contextParts = [
      institute?.name || "All institutes", req.query.batch ? `Batch ${req.query.batch}` : null,
      department?.name, req.query.section ? `Section ${req.query.section}` : null, subject?.name,
    ].filter(Boolean);

    const summaryRows = [
      ["Academic Context", contextParts.join(" · ")],
      [],
      ["Total Assessments", analytics.totalAssessments],
      ["Students Assessed", analytics.studentsAssessed],
      ["Average Readiness", `${analytics.averageReadiness}%`],
      [],
      ["Readiness Level", "Count"],
      ...Object.entries(analytics.readinessLevelDistribution),
      [],
      ["BTL Level", "Average %"],
      ...Object.entries(analytics.btlAverages).map(([lvl, avg]) => [`BTL ${lvl}`, avg]),
      [],
      ["Weakest Topics", "Average Accuracy", "Students Assessed"],
      ...analytics.topicWeaknesses.map((t) => [t.topic, `${t.averageAccuracy}%`, t.studentsAssessed]),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);

    const atRiskRows = [
      ["Name", "Registration Number (PRN)", "Roll Number", "Subject", "Overall Score", "Readiness Level"],
      ...analytics.atRiskStudents.map((s) => [s.name, s.registrationNumber || "", s.rollNumber || "", s.subject, `${s.overallScore}%`, s.readinessLevel.replace(/_/g, " ")]),
    ];
    const atRiskSheet = XLSX.utils.aoa_to_sheet(atRiskRows);

    const topPerformerRows = [
      ["Name", "Registration Number (PRN)", "Roll Number", "Subject", "Overall Score", "Readiness Level"],
      ...analytics.topPerformers.map((s) => [s.name, s.registrationNumber || "", s.rollNumber || "", s.subject, `${s.overallScore}%`, s.readinessLevel.replace(/_/g, " ")]),
    ];
    const topPerformerSheet = XLSX.utils.aoa_to_sheet(topPerformerRows);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, atRiskSheet, "At-Risk Students");
    XLSX.utils.book_append_sheet(workbook, topPerformerSheet, "Top Performers");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=readiness-analytics.xlsx");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export readiness analytics" });
  }
});

// ADMIN/STAFF/CLERK: a separate, deliberately reduced-detail placement view (spec section 23 —
// "do not expose unnecessary academic data" — same reasoning /admin/analytics above excludes CLERK
// from entirely, since that route's BTL/topic breakdowns are academic diagnostic detail a placement
// role has no need for). Reuses computeReadinessAnalytics() so the underlying numbers can never
// disagree with the full dashboard, but reshapes the response down to exactly what a placement
// team needs: how many students are ready vs. need more preparation, and who they are — never the
// per-topic/per-BTL breakdown. Same requireRole("ADMIN","STAFF","CLERK") convention already
// established by this platform's other placement-facing analytics (placementOffers.js).
router.get("/placement/overview", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const analytics = await cached(
      `readinessPlacementOverview:${resolvedInstituteId(req) || "all"}:${JSON.stringify(req.query)}`,
      60 * 1000,
      () => computeReadinessAnalytics(req)
    );
    res.json({
      totalAssessments: analytics.totalAssessments,
      studentsAssessed: analytics.studentsAssessed,
      averageReadiness: analytics.averageReadiness,
      readinessLevelDistribution: analytics.readinessLevelDistribution,
      readyStudents: analytics.topPerformers,
      needsPreparationStudents: analytics.atRiskStudents,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load placement readiness overview" });
  }
});

module.exports = router;
