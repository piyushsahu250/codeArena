const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { gradePendingCodingSubmissions } = require("../utils/gradeAttempt");
const { processGamification } = require("../utils/gamification");
const { isTestVisibleToStudent, studentCanAccessTest, testEligibilityWhere } = require("../utils/testEligibility");
const { getStudentPoolIds } = require("../utils/talentPoolEligibility");

const router = express.Router();

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

router.post("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      title, code, description, instructions, durationMin, passingMarks, showResults,
      startTime, endTime, questionIds, questionTimeLimits, academicGroupIds,
      requireFullscreen, requireWebcam, requireMicrophone, attendanceMandatory,
      shuffleQuestions, shuffleOptions,
      questionSelectionMode, randomBankFolderId, randomQuestionsPerStudent, difficultyDistribution,
      company,
    } = req.body;

    await assertGroupsBelongToInstitute(academicGroupIds, req.requesterInstituteId);

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
        createdById: req.user.id,
        instituteId: req.requesterInstituteId,
        questions: { create: questionCreateData(resolvedQuestionIds, questionTimeLimits) },
        academicGroups: { create: (academicGroupIds || []).map((academicGroupId) => ({ academicGroupId })) },
      },
      include: { questions: true, classes: true, academicGroups: true },
    });
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 400).json({ error: err.message || "Failed to create test" });
  }
});

// --- ADMIN/STAFF: edit an existing test (replaces questions + class assignment) ---
router.patch("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.test.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage tests under your own institute" });
    }

    const {
      title, code, description, instructions, durationMin, passingMarks, showResults,
      startTime, endTime, questionIds, questionTimeLimits, academicGroupIds,
      requireFullscreen, requireWebcam, requireMicrophone, attendanceMandatory,
      shuffleQuestions, shuffleOptions,
      questionSelectionMode, randomBankFolderId, randomQuestionsPerStudent, difficultyDistribution,
      company,
    } = req.body;

    await assertGroupsBelongToInstitute(academicGroupIds, req.requesterInstituteId);

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
      title: title ?? existing.title,
      code: code !== undefined ? (code?.trim() || null) : existing.code,
      description: description ?? existing.description,
      instructions: instructions !== undefined ? (instructions?.trim() || null) : existing.instructions,
      company: company !== undefined ? (company?.trim() || null) : existing.company,
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
    res.json(test);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 400).json({ error: err.message || "Failed to update test" });
  }
});

// --- ADMIN/STAFF: duplicate a test (questions + class assignment cloned, always starts unpublished) ---
router.post("/:id/duplicate", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const original = await prisma.test.findUnique({
      where: { id: req.params.id },
      include: { questions: true, classes: true, academicGroups: true },
    });
    if (!original) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && original.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only duplicate tests under your own institute" });
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
    res.json(copy);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to duplicate test" });
  }
});

// --- ADMIN: permanently delete a test (and its attempts/submissions) ---
router.delete("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    await prisma.test.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete test" });
  }
});

// --- ADMIN/STAFF: publish/unpublish ---
router.patch("/:id/publish", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const test = await prisma.test.update({
    where: { id: req.params.id },
    data: { isPublished: !!req.body.isPublished },
  });
  res.json(test);
});

// --- Everyone authenticated: list tests (students see only published tests assigned to their
// class; staff/admin see full assignment detail — institute, class, batch year, headcount,
// creator — scoped to their own institute unless they're platform-level) ---
router.get("/", authenticate, attachRequesterInstitute, async (req, res) => {
  const isStaff = req.user.role === "ADMIN" || req.user.role === "STAFF";

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
    where = req.requesterInstituteId
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
  } else {
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { classId: true, academicGroupId: true, instituteId: true } });
    const memberPoolIds = await getStudentPoolIds(prisma, req.user.id);
    where = { isPublished: true, ...testEligibilityWhere(student.academicGroupId, student.classId, memberPoolIds, student.instituteId) };
  }

  const tests = await prisma.test.findMany({
    where,
    orderBy: { startTime: "asc" },
    include: {
      _count: { select: { questions: true, attempts: true } },
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
    },
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

// --- Get single test detail (questions without hidden test cases, and without
// correctAnswer/explanation, for students — those would leak the answer key) ---
router.get("/:id", authenticate, attachRequesterInstitute, async (req, res) => {
  const isStaff = req.user.role === "ADMIN" || req.user.role === "STAFF";
  const test = await prisma.test.findUnique({
    where: { id: req.params.id },
    include: {
      classes: { select: { classId: true } },
      academicGroups: { select: { academicGroupId: true } },
      talentPools: { select: { poolId: true } },
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
    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test || !test.isPublished) return res.status(404).json({ error: "Test not available" });

    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { classId: true, academicGroupId: true, instituteId: true } });
    const memberPoolIds = await getStudentPoolIds(prisma, req.user.id);
    const allowed = await studentCanAccessTest(prisma, test.id, student.academicGroupId, student.classId, memberPoolIds, student.instituteId);
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

      const testWithQuestions = await prisma.test.findUnique({
        where: { id: testId },
        include: { questions: { include: { question: { select: { id: true, questionType: true, options: true, difficulty: true } } } } },
      });
      const { questionOrder, optionOrder } = buildAttemptOrder(testWithQuestions);
      attempt = await prisma.testAttempt.create({ data: { testId, studentId: req.user.id, questionOrder, optionOrder } });
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
router.post("/:testId/attempts/:studentId/reattempt", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { testId, studentId } = req.params;
    const [test, student, attempt] = await Promise.all([
      prisma.test.findUnique({ where: { id: testId }, select: { id: true, title: true } }),
      prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true, rollNumber: true, instituteId: true } }),
      prisma.testAttempt.findUnique({ where: { testId_studentId: { testId, studentId } } }),
    ]);
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (!student) return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage students under your own institute" });
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
router.get("/:id/results", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const test = await prisma.test.findUnique({ where: { id: req.params.id }, select: { instituteId: true } });
  if (!test) return res.status(404).json({ error: "Test not found" });
  if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "You can only view results for tests under your own institute" });
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
    const test = await prisma.test.findUnique({ where: { id: req.params.id } });
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

module.exports = router;
