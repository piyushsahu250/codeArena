const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { gradePendingCodingSubmissions } = require("../utils/gradeAttempt");
const { processGamification } = require("../utils/gamification");
const { isTestVisibleToStudent, testEligibilityWhere } = require("../utils/testEligibility");
const { getStudentPoolIds } = require("../utils/talentPoolEligibility");
const { safeErrorMessage } = require("../utils/errors");
const { staffTestAccessWhere, canStaffAccessTest } = require("../utils/testOwnership");
const { resolveSubjectUnitTopic, canStaffUseSubject } = require("../utils/subjectAccess");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { notifyTestAssigned } = require("../utils/notifications");

const router = express.Router();

// Test's Subject/Unit is looser than Question's mandatory pair: a Subject alone (no Unit) is a
// valid, common case here — e.g. a company placement round ("TNP" / Training & Placement) has no
// natural Unit 1/2/3 structure the way a Java or DBMS course does, so forcing staff to invent a
// Unit just to save the test (which resolveSubjectUnitTopic would otherwise require) was blocking
// real test creation. When a unitId IS supplied, it's still validated against the subject exactly
// like Question authoring; when omitted, only the Subject itself is authorization-checked.
async function resolveTestSubjectUnit(req, { subjectId, unitId }) {
  if (!subjectId) return { subjectId: null, unitId: null };
  if (unitId) return resolveSubjectUnitTopic(req, { subjectId, unitId });
  if (!(await canStaffUseSubject(req, subjectId))) return { error: "You aren't authorized to use this subject" };
  return { subjectId, unitId: null };
}

function questionCreateData(questionIds, questionTimeLimits) {
  return (questionIds || []).map((qId, idx) => ({
    questionId: qId,
    order: idx,
    timeLimitSec: Number(questionTimeLimits?.[qId]) || 900,
  }));
}

// Fisher-Yates — uniform, unbiased permutation in O(n), fine at exam scale.
function shuffledArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// RANDOM mode: draws randomQuestionsPerStudent TestQuestion rows out of the test's full bank
// (test.questions holds every question in the linked folder — see resolveQuestionIds). Honors
// difficultyDistribution when set by sampling each difficulty pool independently; any shortfall
// (a pool with fewer questions than requested) is topped up from whatever's left in the bank so
// the student still gets the promised count. Independent per-student sampling — no cross-student
// combination tracking, which is the standard, practical approach at real question-bank scale.
function pickRandomQuestions(bank, perStudent, distribution) {
  if (!distribution || (!distribution.easy && !distribution.medium && !distribution.hard)) {
    return shuffledArray(bank).slice(0, perStudent);
  }
  const byDifficulty = { EASY: [], MEDIUM: [], HARD: [] };
  for (const tq of bank) byDifficulty[tq.question.difficulty]?.push(tq);
  const picks = [
    ...shuffledArray(byDifficulty.EASY).slice(0, Number(distribution.easy) || 0),
    ...shuffledArray(byDifficulty.MEDIUM).slice(0, Number(distribution.medium) || 0),
    ...shuffledArray(byDifficulty.HARD).slice(0, Number(distribution.hard) || 0),
  ];
  if (picks.length < perStudent) {
    const pickedIds = new Set(picks.map((tq) => tq.questionId));
    const remaining = shuffledArray(bank.filter((tq) => !pickedIds.has(tq.questionId)));
    picks.push(...remaining.slice(0, perStudent - picks.length));
  }
  return picks.slice(0, perStudent);
}

// Builds this student's one-time question/option order for a fresh attempt. Runs once, at
// attempt creation, off the test's already-loaded question list — pure in-memory shuffling, no
// extra queries, so it adds no measurable latency to test start even under heavy concurrent load.
function buildAttemptOrder(test) {
  const bank = [...test.questions].sort((a, b) => a.order - b.order);
  const selected = test.questionSelectionMode === "RANDOM" && test.randomQuestionsPerStudent
    ? pickRandomQuestions(bank, test.randomQuestionsPerStudent, test.difficultyDistribution)
    : bank;

  const orderedIds = selected.map((tq) => tq.questionId);
  const questionOrder = test.shuffleQuestions ? shuffledArray(orderedIds) : orderedIds;

  let optionOrder = null;
  if (test.shuffleOptions) {
    optionOrder = {};
    for (const tq of selected) {
      const q = tq.question;
      if (q.questionType === "CODING" || !Array.isArray(q.options) || q.options.length === 0) continue;
      optionOrder[q.id] = shuffledArray(q.options.map((_, i) => i));
    }
  }
  return { questionOrder, optionOrder };
}

const SELECTION_MODES = ["FIXED", "RANDOM"];

// In RANDOM mode the "question list" is resolved server-side from the selected bank folder,
// never trusted from the client — the whole point is a fixed, admin-picked pool that
// buildAttemptOrder() then samples from per student, not an arbitrary client-supplied id list.
async function resolveQuestionIds(mode, questionIds, randomBankFolderId) {
  if (mode !== "RANDOM") return questionIds || [];
  if (!randomBankFolderId) throw new Error("Select a Question Bank folder for random question selection");
  const bankQuestions = await prisma.question.findMany({
    where: { folderId: randomBankFolderId, questionType: "CODING" },
    select: { id: true },
  });
  if (bankQuestions.length === 0) throw new Error("The selected Question Bank has no coding questions");
  return bankQuestions.map((q) => q.id);
}

function validateRandomConfig(mode, randomQuestionsPerStudent, difficultyDistribution, bankSize) {
  if (mode !== "RANDOM") return;
  const perStudent = Number(randomQuestionsPerStudent);
  if (!perStudent || perStudent < 1) throw new Error("Set how many questions each student should receive");
  if (bankSize != null && perStudent > bankSize) {
    throw new Error(`Questions per student (${perStudent}) can't exceed the bank size (${bankSize})`);
  }
  if (difficultyDistribution) {
    const { easy = 0, medium = 0, hard = 0 } = difficultyDistribution;
    const sum = Number(easy) + Number(medium) + Number(hard);
    if (sum !== perStudent) {
      throw new Error(`Difficulty distribution (${sum}) must add up to questions per student (${perStudent})`);
    }
  }
}

// --- ADMIN/STAFF: create a test ---
// questionIds: string[]  |  questionTimeLimits: { [questionId]: seconds } (optional, defaults to 900s/15min each)
// classIds: string[] (optional) — assign the test to specific classes; omitted/empty = open to all classes
// questionSelectionMode "RANDOM": randomBankFolderId + randomQuestionsPerStudent (+ optional
// difficultyDistribution) replace questionIds — see resolveQuestionIds/validateRandomConfig above.
// Every submitted academicGroupId must belong to the requester's own institute — mirrors the
// array-ownership-check convention already used by talentPools.js (instituteIds.every(...)).
// A no-op for the platform-level admin (req.requesterInstituteId falsy), who may target any group.
async function assertGroupsBelongToInstitute(academicGroupIds, requesterInstituteId) {
  if (!requesterInstituteId || !academicGroupIds || academicGroupIds.length === 0) return;
  const groups = await prisma.academicGroup.findMany({
    where: { id: { in: academicGroupIds } },
    select: { id: true, instituteId: true },
  });
  const foreign = groups.some((g) => g.instituteId !== requesterInstituteId);
  if (foreign || groups.length !== academicGroupIds.length) {
    const err = new Error("You can only assign a test to academic groups under your own institute");
    err.statusCode = 403;
    throw err;
  }
}

router.post("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      title, code, description, instructions, durationMin, passingMarks, showResults,
      startTime, endTime, questionIds, questionTimeLimits, academicGroupIds,
      requireFullscreen, requireWebcam, requireMicrophone, attendanceMandatory,
      shuffleQuestions, shuffleOptions,
      questionSelectionMode, randomBankFolderId, randomQuestionsPerStudent, difficultyDistribution,
      company, instituteId: bodyInstituteId,
      subject, unit, program, allowDuplicate,
      subjectId, unitId,
    } = req.body;

    // Subject/Unit FK — optional (mirrors the legacy free-text subject/unit's own "(optional)"
    // convention); Unit itself is also optional even when Subject is set (see
    // resolveTestSubjectUnit) — a Subject-only test (e.g. a company placement round with no Unit
    // structure) is valid, unlike Question authoring where the pair is mandatory.
    const resolvedSubject = await resolveTestSubjectUnit(req, { subjectId, unitId });
    if (resolvedSubject.error) return res.status(400).json({ error: resolvedSubject.error });

    // Create-only duplicate warning, same shape as questions.js's (~L192-206): only meaningful
    // when Subject is actually set (an unnamed/quick test isn't a "duplicate" of anything), scoped
    // to this staff member's own tests only — two different staff both naming a test "Unit 1 Test"
    // for their own different subjects is expected and never flagged (see section 16 of the spec:
    // "Java + Unit 1 + Unit 1 Test" and "DBMS + Unit 1 + Unit 1 Test" are valid separate tests).
    if (subject?.trim() && !allowDuplicate) {
      const duplicate = await prisma.test.findFirst({
        where: {
          createdById: req.user.id,
          subject: { equals: subject.trim(), mode: "insensitive" },
          unit: unit?.trim() ? { equals: unit.trim(), mode: "insensitive" } : null,
          title: { equals: (title || "").trim(), mode: "insensitive" },
        },
      });
      if (duplicate) {
        return res.status(409).json({
          duplicate: true,
          existing: { id: duplicate.id, title: duplicate.title, subject: duplicate.subject, unit: duplicate.unit },
        });
      }
    }

    // A platform-level creator (no own institute) may optionally scope the test to one specific
    // institute directly — previously the only options were fully platform-wide (leave everything
    // blank) or hand-picking every current academic group at that institute one by one, which
    // silently missed future groups and made it easy to end up with a test the admin believed was
    // institute-scoped but was actually visible platform-wide. Institute-scoped Staff/Admin can
    // never override their own institute here — unchanged from before.
    const effectiveInstituteId = req.requesterInstituteId || (bodyInstituteId || null);
    if (!req.requesterInstituteId && bodyInstituteId) {
      const institute = await prisma.institute.findUnique({ where: { id: bodyInstituteId }, select: { id: true } });
      if (!institute) return res.status(400).json({ error: "Selected institute was not found" });
    }

    await assertGroupsBelongToInstitute(academicGroupIds, effectiveInstituteId);

    const mode = SELECTION_MODES.includes(questionSelectionMode) ? questionSelectionMode : "FIXED";
    const resolvedQuestionIds = await resolveQuestionIds(mode, questionIds, randomBankFolderId);
    validateRandomConfig(mode, randomQuestionsPerStudent, difficultyDistribution, resolvedQuestionIds.length);

    const test = await prisma.test.create({
      data: {
        title,
        code: code?.trim() || null,
        description,
        instructions: instructions?.trim() || null,
        company: company?.trim() || null,
        durationMin: durationMin || 60,
        passingMarks: passingMarks !== undefined && passingMarks !== "" ? Number(passingMarks) : null,
        showResults: showResults === undefined ? true : !!showResults,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        requireFullscreen: requireFullscreen === undefined ? true : !!requireFullscreen,
        requireWebcam: !!requireWebcam,
        requireMicrophone: !!requireMicrophone,
        attendanceMandatory: !!attendanceMandatory,
        shuffleQuestions: shuffleQuestions === undefined ? true : !!shuffleQuestions,
        shuffleOptions: !!shuffleOptions,
        questionSelectionMode: mode,
        randomBankFolderId: mode === "RANDOM" ? randomBankFolderId : null,
        randomQuestionsPerStudent: mode === "RANDOM" ? Number(randomQuestionsPerStudent) : null,
        difficultyDistribution: mode === "RANDOM" ? difficultyDistribution || null : null,
        subject: subject?.trim() || null,
        unit: unit?.trim() || null,
        subjectId: resolvedSubject.subjectId,
        unitId: resolvedSubject.unitId,
        program: program?.trim() || null,
        createdById: req.user.id,
        instituteId: effectiveInstituteId,
        questions: { create: questionCreateData(resolvedQuestionIds, questionTimeLimits) },
        academicGroups: { create: (academicGroupIds || []).map((academicGroupId) => ({ academicGroupId })) },
      },
      include: { questions: true, classes: true, academicGroups: true },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.TEST_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: effectiveInstituteId, details: { testId: test.id, title: test.title, questionCount: test.questions.length },
    });
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 400).json({ error: safeErrorMessage(err, "Failed to create test") });
  }
});

// --- ADMIN/STAFF: edit an existing test (replaces questions + class assignment) ---
router.patch("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.test.findUnique({
      where: { id: req.params.id },
      include: { shares: { select: { staffId: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage tests under your own institute" });
    }
    if (!canStaffAccessTest(req, existing)) {
      return res.status(403).json({ error: "You can only edit tests you created or that were shared with you" });
    }

    // Optimistic-concurrency check (spec: two staff members editing the same test at once must
    // never silently overwrite each other) — `version` is omitted by callers that don't send one
    // (e.g. a future automated caller), so this only enforces the check when the client actually
    // read a version to compare against.
    if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
      return res.status(409).json({ error: "This test was modified by another user. Please refresh before saving.", conflict: true });
    }

    const {
      title, code, description, instructions, durationMin, passingMarks, showResults,
      startTime, endTime, questionIds, questionTimeLimits, academicGroupIds,
      requireFullscreen, requireWebcam, requireMicrophone, attendanceMandatory,
      shuffleQuestions, shuffleOptions,
      questionSelectionMode, randomBankFolderId, randomQuestionsPerStudent, difficultyDistribution,
      company, instituteId: bodyInstituteId, subject, unit, program,
      subjectId, unitId,
    } = req.body;

    let resolvedSubject = { subjectId: existing.subjectId, unitId: existing.unitId };
    if (subjectId !== undefined || unitId !== undefined) {
      if (subjectId) {
        resolvedSubject = await resolveTestSubjectUnit(req, {
          subjectId, unitId: unitId !== undefined ? unitId : existing.unitId,
        });
        if (resolvedSubject.error) return res.status(400).json({ error: resolvedSubject.error });
      } else {
        resolvedSubject = { subjectId: null, unitId: null };
      }
    }

    // Same platform-level-only institute scoping as POST / above — institute-scoped Staff/Admin
    // already can't reach this line for a test outside their own institute (checked above), and
    // can never change a test's institute.
    let effectiveInstituteId = existing.instituteId;
    if (!req.requesterInstituteId && bodyInstituteId !== undefined) {
      if (bodyInstituteId) {
        const institute = await prisma.institute.findUnique({ where: { id: bodyInstituteId }, select: { id: true } });
        if (!institute) return res.status(400).json({ error: "Selected institute was not found" });
      }
      effectiveInstituteId = bodyInstituteId || null;
    }

    await assertGroupsBelongToInstitute(academicGroupIds, effectiveInstituteId);

    const mode = questionSelectionMode !== undefined
      ? (SELECTION_MODES.includes(questionSelectionMode) ? questionSelectionMode : existing.questionSelectionMode)
      : existing.questionSelectionMode;
    const effectiveBankFolderId = mode === "RANDOM" ? (randomBankFolderId ?? existing.randomBankFolderId) : null;
    const effectivePerStudent = mode === "RANDOM" ? (randomQuestionsPerStudent ?? existing.randomQuestionsPerStudent) : null;
    const effectiveDistribution = mode === "RANDOM" ? (difficultyDistribution !== undefined ? difficultyDistribution : existing.difficultyDistribution) : null;

    // RANDOM mode always re-resolves from the bank folder on save (so the pool reflects the
    // folder's current contents), independent of whether questionIds was sent; FIXED mode only
    // replaces questions when questionIds is explicitly provided, same as before this feature.
    const resolvedQuestionIds = mode === "RANDOM"
      ? await resolveQuestionIds("RANDOM", null, effectiveBankFolderId)
      : questionIds;
    if (mode === "RANDOM") validateRandomConfig("RANDOM", effectivePerStudent, effectiveDistribution, resolvedQuestionIds.length);

    const data = {
      instituteId: effectiveInstituteId,
      title: title ?? existing.title,
      code: code !== undefined ? (code?.trim() || null) : existing.code,
      description: description ?? existing.description,
      instructions: instructions !== undefined ? (instructions?.trim() || null) : existing.instructions,
      company: company !== undefined ? (company?.trim() || null) : existing.company,
      subject: subject !== undefined ? (subject?.trim() || null) : existing.subject,
      unit: unit !== undefined ? (unit?.trim() || null) : existing.unit,
      subjectId: resolvedSubject.subjectId,
      unitId: resolvedSubject.unitId,
      program: program !== undefined ? (program?.trim() || null) : existing.program,
      durationMin: durationMin !== undefined ? Number(durationMin) : existing.durationMin,
      passingMarks: passingMarks !== undefined ? (passingMarks === "" ? null : Number(passingMarks)) : existing.passingMarks,
      showResults: showResults === undefined ? existing.showResults : !!showResults,
      startTime: startTime ? new Date(startTime) : existing.startTime,
      endTime: endTime ? new Date(endTime) : existing.endTime,
      requireFullscreen: requireFullscreen === undefined ? existing.requireFullscreen : !!requireFullscreen,
      requireWebcam: requireWebcam === undefined ? existing.requireWebcam : !!requireWebcam,
      requireMicrophone: requireMicrophone === undefined ? existing.requireMicrophone : !!requireMicrophone,
      attendanceMandatory: attendanceMandatory === undefined ? existing.attendanceMandatory : !!attendanceMandatory,
      shuffleQuestions: shuffleQuestions === undefined ? existing.shuffleQuestions : !!shuffleQuestions,
      shuffleOptions: shuffleOptions === undefined ? existing.shuffleOptions : !!shuffleOptions,
      questionSelectionMode: mode,
      randomBankFolderId: effectiveBankFolderId,
      randomQuestionsPerStudent: effectivePerStudent != null ? Number(effectivePerStudent) : null,
      difficultyDistribution: effectiveDistribution || null,
      version: { increment: 1 },
    };

    await prisma.$transaction(async (tx) => {
      await tx.test.update({ where: { id: existing.id }, data });

      if (resolvedQuestionIds) {
        await tx.testQuestion.deleteMany({ where: { testId: existing.id } });
        await tx.testQuestion.createMany({
          data: questionCreateData(resolvedQuestionIds, questionTimeLimits).map((q) => ({ ...q, testId: existing.id })),
        });
      }

      if (academicGroupIds) {
        await tx.testAcademicGroup.deleteMany({ where: { testId: existing.id } });
        if (academicGroupIds.length > 0) {
          await tx.testAcademicGroup.createMany({ data: academicGroupIds.map((academicGroupId) => ({ testId: existing.id, academicGroupId })) });
        }
      }
    });

    const test = await prisma.test.findUnique({
      where: { id: existing.id },
      include: { questions: true, classes: true, academicGroups: true },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.TEST_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.instituteId, details: { testId: test.id, title: test.title },
    });
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 400).json({ error: safeErrorMessage(err, "Failed to update test") });
  }
});

// --- ADMIN/STAFF: duplicate a test (questions + class assignment cloned, always starts unpublished) ---
router.post("/:id/duplicate", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const original = await prisma.test.findUnique({
      where: { id: req.params.id },
      include: { questions: true, classes: true, academicGroups: true, shares: { select: { staffId: true } } },
    });
    if (!original) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && original.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only duplicate tests under your own institute" });
    }
    if (!canStaffAccessTest(req, original)) {
      return res.status(403).json({ error: "You can only duplicate tests you created or that were shared with you" });
    }

    const copy = await prisma.test.create({
      data: {
        title: `Copy of ${original.title}`,
        code: original.code,
        description: original.description,
        instructions: original.instructions,
        durationMin: original.durationMin,
        passingMarks: original.passingMarks,
        showResults: original.showResults,
        startTime: original.startTime,
        endTime: original.endTime,
        isPublished: false,
        subject: original.subject,
        unit: original.unit,
        program: original.program,
        // The duplicate is always owned by whoever ran the duplicate action, never inherited from
        // the original — a fresh test with a fresh owner, matching "duplicate ≠ shares stay shared."
        createdById: req.user.id,
        instituteId: original.instituteId,
        questions: {
          create: original.questions.map((q) => ({ questionId: q.questionId, order: q.order, timeLimitSec: q.timeLimitSec })),
        },
        academicGroups: {
          create: original.academicGroups.map((g) => ({ academicGroupId: g.academicGroupId })),
        },
      },
      include: { questions: true, classes: true, academicGroups: true },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.TEST_DUPLICATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: original.instituteId, details: { originalTestId: original.id, newTestId: copy.id, title: copy.title },
    });
    res.json(copy);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to duplicate test" });
  }
});

// --- ADMIN: permanently delete a test (and its attempts/submissions) ---
router.delete("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    // Previously missing entirely — an institute-scoped Admin could delete another institute's
    // test by id. Staff-delete stays disallowed altogether (unchanged); this only tightens Admin.
    const existing = await prisma.test.findUnique({ where: { id: req.params.id }, select: { instituteId: true, title: true } });
    if (!existing) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only delete tests under your own institute" });
    }
    await prisma.test.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.TEST_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: existing.instituteId, details: { testId: req.params.id, title: existing.title },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete test" });
  }
});

// --- ADMIN/STAFF: publish/unpublish ---
router.patch("/:id/publish", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    // Previously had no authorization check at all beyond role — any Staff member anywhere could
    // publish/unpublish any test by id. Now matches every other staff-reachable route's gate.
    const existing = await prisma.test.findUnique({
      where: { id: req.params.id },
      include: {
        shares: { select: { staffId: true } },
        questions: {
          select: {
            id: true,
            question: { select: { questionNumber: true, title: true, questionType: true, points: true, correctAnswer: true, testCases: { select: { id: true } } } },
          },
        },
      },
    });
    if (!existing) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage tests under your own institute" });
    }
    if (!canStaffAccessTest(req, existing)) {
      return res.status(403).json({ error: "You can only publish tests you created or that were shared with you" });
    }

    // Going live (false -> true, or re-confirming an already-published test) must never succeed
    // silently on a broken configuration — previously a 0-question test, a zero/negative duration,
    // or an inverted schedule could be published with no error at all. Unpublishing always
    // succeeds unconditionally: taking a test down is never something to block on validation.
    if (req.body.isPublished) {
      const problems = [];
      // RANDOM mode still requires questions[] populated (see Test.questionSelectionMode's schema
      // comment — it's the bank random subsets are drawn from, not shown to students directly), so
      // this check applies the same way regardless of mode.
      if (existing.questions.length === 0) problems.push("Add at least one question before publishing.");
      if (!(existing.durationMin > 0)) problems.push("Set a test duration greater than 0 minutes.");
      if (existing.startTime && existing.endTime && new Date(existing.startTime) >= new Date(existing.endTime)) {
        problems.push("End time must be after start time.");
      }
      if (existing.questionSelectionMode === "RANDOM" && !(existing.randomQuestionsPerStudent > 0)) {
        problems.push("Set how many random questions each student should receive.");
      }
      // Per-question validity (spec section 21's own worked example: "Question 7 has no correct
      // answer.") — every question on the test must have real marks and, depending on type, an
      // actually-gradable answer key. RANDOM mode still checks every question in the bank folder,
      // since any of them could be drawn for a student.
      const questionLabel = (q) => `Question ${q.question.questionNumber}${q.question.title ? ` ("${q.question.title}")` : ""}`;
      for (const tq of existing.questions) {
        const q = tq.question;
        if (!(q.points > 0)) problems.push(`${questionLabel(tq)} has no marks set.`);
        if (["MCQ", "TRUE_FALSE", "MULTISELECT", "SQL"].includes(q.questionType)) {
          const correct = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
          if (correct.length === 0) problems.push(`${questionLabel(tq)} has no correct answer selected.`);
        } else if (q.questionType === "CODING") {
          if (!q.testCases || q.testCases.length === 0) problems.push(`${questionLabel(tq)} has no test cases.`);
        }
      }
      if (problems.length) return res.status(400).json({ error: "Cannot publish — please fix the following:", problems });
    }

    const test = await prisma.test.update({
      where: { id: req.params.id },
      data: { isPublished: !!req.body.isPublished },
    });
    if (test.isPublished && !existing.isPublished) {
      await logAudit({
        req, action: AUDIT_ACTIONS.TEST_PUBLISHED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: req.requesterInstituteId, details: { testId: test.id, title: test.title },
      });
      // Fire-and-forget, same posture as every other notify call in this codebase — this is the
      // moment the test actually becomes visible to students (false -> true), not the earlier
      // PATCH / group-assignment edit, which may happen well before a test is ready to publish.
      prisma.testAcademicGroup.findMany({ where: { testId: test.id }, select: { academicGroupId: true } })
        .then((groups) => {
          const academicGroupIds = groups.map((g) => g.academicGroupId);
          if (academicGroupIds.length === 0) return [];
          return prisma.user.findMany({ where: { role: "STUDENT", academicGroupId: { in: academicGroupIds } }, select: { id: true, name: true, email: true } });
        })
        .then((students) => notifyTestAssigned(prisma, students, test))
        .catch((err) => console.error("[tests.publish] notification failed:", err));
    } else if (!test.isPublished && existing.isPublished) {
      await logAudit({
        req, action: AUDIT_ACTIONS.TEST_UNPUBLISHED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: req.requesterInstituteId, details: { testId: test.id, title: test.title },
      });
    }
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update publish status" });
  }
});

// --- Everyone authenticated: list tests (students see only published tests assigned to their
// class; staff/admin see full assignment detail — institute, class, batch year, headcount,
// creator — scoped to their own institute unless they're platform-level) ---
router.get("/", authenticate, attachRequesterInstitute, async (req, res) => {
  // Every role that can create/manage a test (see this file's POST "/" / PATCH "/:id" etc.
  // requireRole lists) must also be treated as staff here — SUPER_ADMIN and INSTITUTE_ADMIN were
  // missing from this check, which silently routed them into the STUDENT branch below instead.
  // A STUDENT branch requires isPublished:true plus a matching academicGroupId/classId — fields an
  // Institute Admin's own user row never has — so an Institute Admin who created a test could not
  // see it in their own test list, and opening it directly returned 404 "Test not found" even
  // though they were the creator. Confirmed live against production data (2026-08-27): two tests
  // created by an INSTITUTE_ADMIN account were invisible to that same account for exactly this
  // reason.
  const isStaff = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"].includes(req.user.role);

  // Filtered DB-side (not "load every test on the platform, then filter in JS") — this list used
  // to fetch every Test row plus its full class/academicGroup/institute/department relation tree
  // regardless of who was asking, then discarded most of it in memory. At real scale (many
  // institutes, many tests) that made this endpoint slow for everyone and, under load, slow enough
  // to time out for some students — surfacing as "page loading, test not visible." Same shape of
  // bug as the old leaderboard full-table-scan fix.
  let where;
  if (isStaff) {
    // A test with zero group/class assignments is only "open to all" within its OWN institute (or
    // platform-wide if instituteId is null) — never leaks into another institute's staff test
    // list. Mirrors the matching gate in testEligibility.js.
    const instituteWhere = req.requesterInstituteId
      ? {
          OR: [
            { classes: { some: { class: { instituteId: req.requesterInstituteId } } } },
            { academicGroups: { some: { academicGroup: { instituteId: req.requesterInstituteId } } } },
            {
              classes: { none: {} },
              academicGroups: { none: {} },
              OR: [{ instituteId: null }, { instituteId: req.requesterInstituteId }],
            },
          ],
        }
      : {};
    // staffTestAccessWhere no-ops (returns {}) for ADMIN — Admin visibility stays institute-wide,
    // unchanged. For STAFF it further restricts to "created by me OR explicitly shared with me" —
    // previously a STAFF requester inherited the exact same institute-only visibility as Admin,
    // which is the root cause of two staff members' same-named "Unit 1 Test" being indistinguishable
    // to each other. See utils/testOwnership.js.
    where = { AND: [instituteWhere, staffTestAccessWhere(req)] };
  } else {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { classId: true, academicGroupId: true, instituteId: true } });
    const memberPoolIds = await getStudentPoolIds(prisma, req.user.id);
    where = { isPublished: true, ...testEligibilityWhere(student.academicGroupId, student.classId, [...memberPoolIds], student.instituteId) };
  }

  // Staff need the full management payload (assignment badges, ownership/sharing, per-group
  // headcounts for the Manage Tests UI); students only ever render title/company/timing/duration/
  // question-count/myStatus (confirmed against every student-facing caller: StudentDashboard.jsx,
  // CompanyTests.jsx) — so this list is branched by role rather than sending the same heavy
  // multi-join staff payload to every student polling their assigned-tests list. That heavy shape
  // (nested class/academicGroup/institute details, per-group user counts, shares, createdBy) was
  // previously sent to students unconditionally — real, avoidable DB/JSON work on every request,
  // which compounds badly when many students load this list around the same time (e.g. checking
  // whether a scheduled test has opened yet).
  // Safety-net cap, not real pagination — this route's response is a plain array consumed by
  // several callers (StaffDashboard.jsx, StudentDashboard.jsx, CompanyTests.jsx) that expect
  // res.data to already be the full list, so changing the shape to a paginated envelope would
  // break every one of them. `where` already scopes this to one institute (or one staff member's
  // own+shared tests) in the overwhelming majority of requests; this only guards the pathological
  // case of an unscoped platform-level Super Admin or one institute with an extreme test count.
  const TESTS_LIST_CAP = 2000;
  const tests = await prisma.test.findMany({
    where,
    orderBy: { startTime: "asc" },
    take: TESTS_LIST_CAP,
    ...(isStaff
      ? {
          include: {
            _count: { select: { questions: true, attempts: true } },
            // Needed so the Manage Tests filter/badge UI can tell a genuinely platform-wide test
            // (instituteId null, zero group/class assignments) apart from one that's institute-scoped
            // via Test.instituteId directly but has no per-group assignment yet — those two cases used
            // to be indistinguishable client-side since only academicGroups[]/classes[] carried an
            // institute, never the test itself.
            institute: { select: { id: true, name: true } },
            classes: {
              include: {
                class: {
                  select: {
                    id: true,
                    name: true,
                    batchYear: true,
                    instituteId: true,
                    institute: { select: { id: true, name: true } },
                    _count: { select: { users: true } },
                  },
                },
              },
            },
            academicGroups: {
              include: {
                academicGroup: {
                  select: {
                    id: true,
                    batch: true,
                    section: true,
                    instituteId: true,
                    institute: { select: { id: true, name: true } },
                    department: { select: { id: true, name: true } },
                    _count: { select: { users: true } },
                  },
                },
              },
            },
            talentPools: { select: { poolId: true } },
            createdBy: { select: { id: true, name: true } },
            // Lets the frontend badge "Shared with me" vs "My Tests" and tell canStaffAccessTest-style
            // checks apart client-side — negligible extra join, included unconditionally rather than
            // branched on role for simplicity.
            shares: { select: { staffId: true } },
          },
        }
      : {
          select: {
            id: true, title: true, company: true, startTime: true, endTime: true, durationMin: true,
            attendanceMandatory: true,
            _count: { select: { questions: true } },
          },
        }),
  });

  if (isStaff) return res.json(tests);

  // Surface the student's own attempt status per test so the dashboard can show "Completed"
  // upfront, rather than only after they click Attend and get bounced by a 403.
  const myAttempts = await prisma.testAttempt.findMany({
    where: { studentId: req.user.id, testId: { in: tests.map((t) => t.id) } },
    select: { testId: true, status: true },
  });
  const statusByTest = Object.fromEntries(myAttempts.map((a) => [a.testId, a.status]));
  const withStatus = tests.map((t) => ({ ...t, myStatus: statusByTest[t.id] || null }));

  res.json(withStatus);
});

// --- ADMIN/STAFF: list Staff members at the requester's own institute, for the "share this test
// with" picker. Registered before GET /:id so "/staff-directory" is never swallowed by the :id
// param route. No existing route serves this for STAFF — the only other staff-listing route
// (staffClerk.js's GET /) is ADMIN-only. Deliberately minimal fields — this is a picker source,
// not a directory. ---
router.get("/staff-directory", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const staff = await prisma.user.findMany({
      where: {
        role: "STAFF",
        id: { not: req.user.id },
        ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load staff directory" });
  }
});

// --- Get single test detail (questions without hidden test cases, and without
// correctAnswer/explanation, for students — those would leak the answer key) ---
router.get("/:id", authenticate, attachRequesterInstitute, async (req, res) => {
  // Every role that can create/manage a test (see this file's POST "/" / PATCH "/:id" etc.
  // requireRole lists) must also be treated as staff here — SUPER_ADMIN and INSTITUTE_ADMIN were
  // missing from this check, which silently routed them into the STUDENT branch below instead.
  // A STUDENT branch requires isPublished:true plus a matching academicGroupId/classId — fields an
  // Institute Admin's own user row never has — so an Institute Admin who created a test could not
  // see it in their own test list, and opening it directly returned 404 "Test not found" even
  // though they were the creator. Confirmed live against production data (2026-08-27): two tests
  // created by an INSTITUTE_ADMIN account were invisible to that same account for exactly this
  // reason.
  const isStaff = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"].includes(req.user.role);
  const test = await prisma.test.findUnique({
    where: { id: req.params.id },
    include: {
      classes: { select: { classId: true } },
      academicGroups: { select: { academicGroupId: true } },
      talentPools: { select: { poolId: true } },
      // Includes the shared staff member's name (not just id) here specifically — this is the
      // single-test detail route CreateTest.jsx's edit view calls to populate the "Shared With"
      // panel, and the only place a name is actually displayed; the list route's shares include
      // stays id-only since it's just used for own/shared badge logic there.
      shares: { select: { staffId: true, staff: { select: { id: true, name: true } } } },
      questions: {
        include: {
          question: {
            select: {
              id: true,
              questionNumber: true,
              title: true,
              description: true,
              subject: true,
              topic: true,
              questionType: true,
              difficulty: true,
              points: true,
              timeLimitMs: true,
              starterCode: true,
              starterCodeByLanguage: true,
              evaluationType: true,
              functionSignature: true,
              options: true,
              correctAnswer: isStaff,
              explanation: isStaff,
              testCases: { where: isStaff ? {} : { isHidden: false } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!test) return res.status(404).json({ error: "Test not found" });

  if (isStaff) {
    if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view tests under your own institute" });
    }
    if (!canStaffAccessTest(req, test)) {
      return res.status(403).json({ error: "You can only view tests you created or that were shared with you" });
    }
  } else {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { classId: true, academicGroupId: true, instituteId: true } });
    const memberPoolIds = await getStudentPoolIds(prisma, req.user.id);
    const allowed = isTestVisibleToStudent(test, student.academicGroupId, student.classId, memberPoolIds, student.instituteId);
    if (!allowed) return res.status(404).json({ error: "Test not found" });

    // Apply this student's one-time-generated order (set at attempt creation, see POST
    // /:id/start) — staff/admin always see the test's configured (unshuffled) order, since
    // they're previewing/editing the question bank, not taking the shuffled exam.
    const attempt = await prisma.testAttempt.findUnique({
      where: { testId_studentId: { testId: test.id, studentId: req.user.id } },
      select: { questionOrder: true, optionOrder: true },
    });
    if (attempt?.questionOrder) {
      const byId = new Map(test.questions.map((tq) => [tq.questionId, tq]));
      // A question locked into this student's questionOrder at attempt-start time can end up
      // missing from `test.questions` later — the admin edited the test afterward (removed a
      // question, or in RANDOM mode changed the bank folder). Once a question is assigned to a
      // student it must stay visible/gradable for them regardless of later edits (fairness — an
      // admin edit shouldn't retroactively shrink an already-started or already-completed
      // attempt), so any id not currently on the test is fetched directly from Question instead
      // of being silently dropped. This was the root cause of some students seeing fewer
      // questions than they were actually assigned.
      const missingIds = attempt.questionOrder.filter((qId) => !byId.has(qId));
      if (missingIds.length > 0) {
        const missingQuestions = await prisma.question.findMany({
          where: { id: { in: missingIds } },
          select: {
            id: true, questionNumber: true, title: true, description: true, subject: true, topic: true,
            questionType: true, difficulty: true, points: true, timeLimitMs: true, starterCode: true,
            starterCodeByLanguage: true, evaluationType: true, functionSignature: true, options: true,
            correctAnswer: isStaff, explanation: isStaff,
            testCases: { where: isStaff ? {} : { isHidden: false } },
          },
        });
        for (const q of missingQuestions) byId.set(q.id, { questionId: q.id, question: q });
        const stillMissing = missingIds.filter((qId) => !byId.has(qId));
        if (stillMissing.length > 0) {
          // Only reachable if the Question row itself was hard-deleted, not just unassigned from
          // this test — genuinely nothing left to show. Logged so this is diagnosable instead of
          // a silent "why does my count not match" report.
          console.error(`[tests] attempt for student ${req.user.id} on test ${test.id} references deleted question(s): ${stillMissing.join(", ")}`);
        }
      }
      test.questions = attempt.questionOrder.map((qId) => byId.get(qId)).filter(Boolean);
    }
    if (attempt?.optionOrder) {
      for (const tq of test.questions) {
        const order = attempt.optionOrder[tq.questionId];
        if (order && Array.isArray(tq.question.options)) {
          tq.question.options = order.map((origIdx) => tq.question.options[origIdx]);
        }
      }
    }
  }

  // Attendance Management integration: surface the student's own attendance status for this test
  // so the pre-start screen can show the right message and disable Begin Test — computed here (not
  // trusted from the client) since this is the same GET the pre-start screen already calls as
  // `testMeta`, avoiding an extra round trip. "NOT_MARKED" covers both "no lecture has linked this
  // test yet" and "linked but this student has no record" (e.g. added to the class afterward).
  if (req.user.role === "STUDENT" && test.attendanceMandatory) {
    const record = await prisma.attendanceRecord.findFirst({
      where: { studentId: req.user.id, session: { testId: test.id } },
      select: { status: true },
    });
    test.attendanceStatus = record ? record.status : "NOT_MARKED";
  }

  res.json(test);
});

// --- STUDENT: start/attend a test attempt (one attempt per student, ever) ---
router.post("/:id/start", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const testId = req.params.id;
    // Fetched once with the questions include up front (not re-fetched later only for a brand-new
    // attempt) — this route is hit by a whole class clicking "Begin Test" at the exact scheduled
    // start time, so trimming one redundant round-trip here matters more than it would elsewhere.
    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        classes: { select: { classId: true } },
        academicGroups: { select: { academicGroupId: true } },
        talentPools: { select: { poolId: true } },
        questions: { include: { question: { select: { id: true, questionType: true, options: true, difficulty: true } } } },
      },
    });
    if (!test || !test.isPublished) return res.status(404).json({ error: "Test not available" });

    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { classId: true, academicGroupId: true, instituteId: true } });
    const memberPoolIds = await getStudentPoolIds(prisma, req.user.id);
    // Eligibility relations are now loaded above in the same query as the test itself, so this
    // uses the synchronous, already-loaded check (isTestVisibleToStudent) instead of the
    // DB-authoritative one (studentCanAccessTest), which used to re-query talentPoolTest/
    // testAcademicGroup/testClass counts plus a redundant second test fetch — 4 extra sequential
    // round-trips on the single most synchronized endpoint on the platform (a whole class hitting
    // "Begin Test" within the same few seconds). Same eligibility rules either way — see the
    // "already-loaded" vs "DB-authoritative" comments in testEligibility.js.
    const allowed = isTestVisibleToStudent(test, student.academicGroupId, student.classId, memberPoolIds, student.instituteId);
    if (!allowed) return res.status(404).json({ error: "Test not available" });

    const existing = await prisma.testAttempt.findUnique({
      where: { testId_studentId: { testId, studentId: req.user.id } },
    });
    if (existing && existing.status !== "IN_PROGRESS") {
      return res.status(403).json({ error: "Thank you. You have already completed this assessment." });
    }

    const now = new Date();
    if (now < test.startTime) return res.status(403).json({ error: "Test has not started yet" });
    if (now > test.endTime) return res.status(403).json({ error: "Test window has closed" });

    // The random order is generated exactly once, right here at attempt creation — never
    // recomputed on subsequent /start calls (page refresh, logout/login) since `existing` short-
    // circuits past this block entirely, so the same student always lands back on the same
    // sequence for the rest of the attempt.
    let attempt = existing;
    if (!attempt) {
      // Attendance Management integration: gate only the creation of a brand-new attempt, not a
      // resume (existing already short-circuited past this) — re-checking on every resume could
      // lock a student out mid-test if their attendance record is edited afterward, which isn't
      // what "when a student clicks Start Test" is asking for.
      if (test.attendanceMandatory) {
        const record = await prisma.attendanceRecord.findFirst({
          where: { studentId: req.user.id, session: { testId: test.id } },
          select: { status: true },
        });
        if (!record) return res.status(403).json({ error: "Attendance has not yet been marked for this test. Please contact your faculty." });
        if (record.status === "ABSENT") return res.status(403).json({ error: "You have been marked absent for this test and cannot start it." });
      }

      const { questionOrder, optionOrder } = buildAttemptOrder(test);
      try {
        attempt = await prisma.testAttempt.create({ data: { testId, studentId: req.user.id, questionOrder, optionOrder } });
      } catch (err) {
        // A double-click or a client retry (slow response during the exam-start burst, the client
        // gives up and tries again) can race two /start calls for the same student+test — the
        // second hits the testId_studentId unique constraint. Not an error: just return the
        // attempt the first request already created, instead of a 500 that leaves the student
        // stuck on "Could not start test" for something that actually succeeded.
        if (err.code === "P2002") {
          attempt = await prisma.testAttempt.findUnique({ where: { testId_studentId: { testId, studentId: req.user.id } } });
        } else {
          throw err;
        }
      }
    }
    // Include already-saved submissions (auto-saved MCQ answers, locked coding submissions)
    // so a page refresh mid-test restores exactly where the candidate left off.
    const submissions = await prisma.submission.findMany({ where: { attemptId: attempt.id } });
    // serverTime lets the client compute its own clock's offset from the server's — the deadline
    // timer then measures against (Date.now() + offset) instead of raw Date.now(), so a student
    // whose device clock is skewed doesn't get auto-submitted early or late relative to real time.
    res.json({ ...attempt, submissions, serverTime: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start test" });
  }
});

// --- STUDENT: report a tab-switch / focus-loss violation during an attempt.
// After MAX_VIOLATIONS, the attempt is auto-submitted server-side. ---
const MAX_TAB_VIOLATIONS = 3;
router.post("/attempts/:attemptId/violation", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({ where: { id: req.params.attemptId } });
    if (!attempt || attempt.studentId !== req.user.id) {
      return res.status(403).json({ error: "Invalid attempt" });
    }
    if (attempt.status !== "IN_PROGRESS") {
      return res.json({ tabSwitchCount: attempt.tabSwitchCount, autoSubmitted: true });
    }

    const tabSwitchCount = attempt.tabSwitchCount + 1;
    const autoSubmitted = tabSwitchCount >= MAX_TAB_VIOLATIONS;

    // Coding answers are auto-saved as PENDING drafts and only graded at submission time —
    // a violation-triggered auto-submit is a submission just like any other, so it must grade
    // them too, or those coding questions would sit ungraded (and worth 0) forever.
    if (autoSubmitted) {
      await gradePendingCodingSubmissions(attempt.id);
    }

    const updated = await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: {
        tabSwitchCount,
        ...(autoSubmitted ? { status: "AUTO_SUBMITTED", submittedAt: new Date() } : {}),
      },
    });

    // Still counts as a completed test for XP/streak purposes (same treatment AUTO_SUBMITTED
    // gets everywhere else on the platform) — not surfaced in this response, though, since a
    // celebratory XP/badge toast would be a strange thing to show in the middle of a
    // violation-triggered forced submission.
    if (autoSubmitted) {
      processGamification(req.user.id, { xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true }).catch((e) =>
        console.error("gamification failed", e)
      );
    }

    res.json({ tabSwitchCount: updated.tabSwitchCount, autoSubmitted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record violation" });
  }
});

// --- ADMIN: grant an individual student a reattempt on a test they've already completed.
// Deletes their existing attempt (submissions cascade with it), so their next POST /:id/start
// creates a fresh one — scoped to this one student only, nothing else about the test changes. ---
router.post("/:testId/attempts/:studentId/reattempt", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { testId, studentId } = req.params;
    const [test, student, attempt] = await Promise.all([
      prisma.test.findUnique({ where: { id: testId }, select: { id: true, title: true, createdById: true, shares: { select: { staffId: true } } } }),
      prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true, rollNumber: true, instituteId: true } }),
      prisma.testAttempt.findUnique({ where: { testId_studentId: { testId, studentId } } }),
    ]);
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (!student) return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage students under your own institute" });
    }
    if (!canStaffAccessTest(req, test)) {
      return res.status(403).json({ error: "You can only manage reattempts for tests you created or that were shared with you" });
    }
    if (!attempt) return res.status(404).json({ error: "This student has not attempted this test" });
    if (attempt.status === "IN_PROGRESS") {
      return res.status(400).json({ error: "This student's attempt is still in progress — nothing to reset" });
    }

    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });

    await prisma.$transaction([
      prisma.testAttempt.delete({ where: { id: attempt.id } }), // cascades that attempt's Submissions
      prisma.auditLog.create({
        data: {
          action: "REATTEMPT_GRANTED",
          adminId: req.user.id,
          adminName: admin?.name || req.user.email,
          details: {
            studentId: student.id,
            studentName: student.name,
            studentRollNumber: student.rollNumber,
            testId: test.id,
            testTitle: test.title,
          },
        },
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to grant reattempt" });
  }
});

// --- ADMIN/STAFF: leaderboard / results for a test ---
router.get("/:id/results", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const test = await prisma.test.findUnique({
    where: { id: req.params.id },
    select: { instituteId: true, createdById: true, shares: { select: { staffId: true } } },
  });
  if (!test) return res.status(404).json({ error: "Test not found" });
  if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "You can only view results for tests under your own institute" });
  }
  if (!canStaffAccessTest(req, test)) {
    return res.status(403).json({ error: "You can only view results for tests you created or that were shared with you" });
  }
  const attempts = await prisma.testAttempt.findMany({
    where: { testId: req.params.id },
    include: {
      student: { select: { name: true, email: true, rollNumber: true, registrationNumber: true } },
      // Just questionId, not the full row — this is what lets the leaderboard show "Attempted:
      // X of Y" per student (a saved Submission row = attempted, regardless of verdict), the
      // exact number staff need to confirm a completed attempt actually has every answer saved.
      submissions: { select: { questionId: true } },
    },
    orderBy: { totalScore: "desc" },
  });
  res.json(attempts);
});

// --- STUDENT: view their own result for a test, respecting the test's showResults toggle ---
router.get("/:id/my-result", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const test = await prisma.test.findUnique({ where: { id: req.params.id }, select: { id: true, showResults: true, passingMarks: true } });
    if (!test) return res.status(404).json({ error: "Test not found" });

    const attempt = await prisma.testAttempt.findUnique({
      where: { testId_studentId: { testId: test.id, studentId: req.user.id } },
      include: { submissions: true },
    });
    if (!attempt) return res.status(404).json({ error: "You have not attempted this test" });
    if (attempt.status === "IN_PROGRESS") return res.status(403).json({ error: "Test not yet submitted" });
    if (!test.showResults) {
      return res.json({ status: attempt.status, showResults: false });
    }

    res.json({
      status: attempt.status,
      showResults: true,
      totalScore: attempt.totalScore,
      passingMarks: test.passingMarks,
      submittedAt: attempt.submittedAt,
      tabSwitchCount: attempt.tabSwitchCount,
      submissions: attempt.submissions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load result" });
  }
});

// --- Explicit test sharing: owner (or Admin) grants/revokes another staff member's access.
// Mirrors learning.js's POST/DELETE /courses/:id/assignments (createMany+skipDuplicates /
// deleteMany). Deliberately NOT reachable by a staff member the test is merely shared with — only
// the owner or an Admin can grant/revoke, so access can't be chained/re-shared onward. ---
router.post("/:id/shares", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { staffIds = [] } = req.body;
    const test = await prisma.test.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true, instituteId: true } });
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage tests under your own institute" });
    }
    if (req.user.role === "STAFF" && test.createdById !== req.user.id) {
      return res.status(403).json({ error: "Only the test's creator can share it" });
    }
    if (staffIds.length > 0) {
      // Validate every target is an actual STAFF account in the requester's own institute before
      // writing anything — never trusted from the client, same discipline as
      // assertGroupsBelongToInstitute above.
      const staffRows = await prisma.user.findMany({
        where: { id: { in: staffIds }, role: "STAFF", ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}) },
        select: { id: true },
      });
      if (staffRows.length !== staffIds.length) {
        return res.status(400).json({ error: "One or more selected staff members are not valid for this institute" });
      }
      await prisma.testShare.createMany({
        data: staffIds.map((staffId) => ({ testId: test.id, staffId, sharedByUserId: req.user.id, sharedByName: req.user.name })),
        skipDuplicates: true,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to share test" });
  }
});

router.delete("/:id/shares/:staffId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const test = await prisma.test.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true, instituteId: true } });
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage tests under your own institute" });
    }
    if (req.user.role === "STAFF" && test.createdById !== req.user.id) {
      return res.status(403).json({ error: "Only the test's creator can revoke sharing" });
    }
    await prisma.testShare.deleteMany({ where: { testId: test.id, staffId: req.params.staffId } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to revoke access" });
  }
});

module.exports = router;
