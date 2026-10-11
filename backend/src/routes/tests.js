const crypto = require("crypto");
const express = require("express");
const XLSX = require("xlsx");
const { sendTable } = require("../utils/spreadsheetSafe");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { gradePendingCodingSubmissions } = require("../utils/gradeAttempt");
const { processGamification } = require("../utils/gamification");
const { isTestVisibleToStudent, testEligibilityWhere } = require("../utils/testEligibility");
const { getStudentPoolIds } = require("../utils/talentPoolEligibility");
const { staffTestAccessWhere, canStaffAccessTest } = require("../utils/testOwnership");
const questionImages = require("../utils/questionImages");
const aiService = require("../services/ai/aiService");
const { sendAiError } = require("../utils/aiErrors");
const { classifyViolation } = require("../utils/proctoringSeverity");
const { policyOf, startRequirementFailure } = require("../utils/testExamSecurity");
const X = require("../utils/examSecurity");

const router = express.Router();

// Test authoring and management (create, edit, duplicate, delete, publish, notify, share, staff directory) live in modules/tests and are mounted FIRST so
// "/staff-directory" is matched before the "/:id" read route below. The attempt, results and read routes in this file are migrated in later batches.
router.use(require("../modules/tests/tests.routes"));
const { buildAttemptOrder } = require("../modules/tests/tests.domain");

const { MANIFEST_VERSION, validateManifest, scoreBases, scoreBase, logCountMismatch } = require("../utils/attemptManifest");

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
    // A syntactically valid, still-active session can outlive the User row itself (e.g. the
    // account was deleted after this token was issued, before the token naturally expired or was
    // explicitly signed out) — authenticate() only verifies the JWT and session-active flag, never
    // that the underlying user still exists. Confirmed live in production: this exact null
    // dereference was crashing this route (as an uncaught unhandledRejection, since this handler
    // has no try/catch) every ~10-40s for one such stale session. Treat it exactly like any other
    // dead session, via the same authExpired discriminator the frontend already forces a logout on.
    if (!student) return res.status(401).json({ error: "This account no longer exists. Please log in again.", authExpired: true });
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
              // NUMERICAL answer key — staff only, exactly like correctAnswer. A student's payload
              // never carries the expected value or tolerance (the select is an allowlist, and
              // `isStaff` is false for them, so Prisma drops these fields entirely).
              numericAnswer: isStaff,
              numericTolerance: isStaff,
              numericAnswerDisplay: isStaff,
              explanation: isStaff,
              // Not staff-gated, unlike the answer-key fields above — a figure/diagram is part of
              // the question stem itself, something every student taking this test must see.
              imageKey: true,
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
    if (!student) return res.status(401).json({ error: "This account no longer exists. Please log in again.", authExpired: true });
    const memberPoolIds = await getStudentPoolIds(prisma, req.user.id);
    const allowed = isTestVisibleToStudent(test, student.academicGroupId, student.classId, memberPoolIds, student.instituteId);
    if (!allowed) return res.status(404).json({ error: "Test not found" });

    // Apply this student's one-time-generated order (set at attempt creation, see POST
    // /:id/start) — staff/admin always see the test's configured (unshuffled) order, since
    // they're previewing/editing the question bank, not taking the shuffled exam.
    const attempt = await prisma.testAttempt.findUnique({
      where: { testId_studentId: { testId: test.id, studentId: req.user.id } },
      select: { questionOrder: true, optionOrder: true, status: true, id: true, expectedQuestionCount: true, manifestVersion: true },
    });
    // QUESTION ENUMERATION GUARD: a student only receives question content while their attempt is IN_PROGRESS (or, once their
    // attempt is finished, after the test window has closed). Before the attempt starts -- including before startTime, and for a
    // RANDOM-mode test the whole bank -- they get an aggregate summary only, never the questions.
    const attemptNow = attempt;
    const questionsAllowed = attemptNow?.status === "IN_PROGRESS" || (!!attemptNow && new Date() > test.endTime);
    if (!questionsAllowed) {
      const pts = test.questions.map((tq) => tq.question?.points || 0);
      const random = test.questionSelectionMode === "RANDOM";
      test.questionSummary = {
        count: random && test.randomQuestionsPerStudent ? test.randomQuestionsPerStudent : test.questions.length,
        maxMarks: random ? null : pts.reduce((a, b) => a + b, 0),
        types: [...new Set(test.questions.map((tq) => tq.question?.questionType).filter(Boolean))],
      };
      test.questions = [];
      test.questionsWithheld = true;
    }
    if (test.questionsWithheld) {
      // nothing to order: questions are withheld until the attempt is running
    } else if (attempt?.questionOrder) {
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
            numericAnswer: isStaff, numericTolerance: isStaff, numericAnswerDisplay: isStaff,
            imageKey: true,
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
      // Authoritative manifest for the client: how many questions this attempt must show and exactly which. The browser verifies it received all of them
      // before the exam starts, instead of assuming that whatever arrived is everything. Ids only -- no content.
      const expected = attempt.expectedQuestionCount ?? attempt.questionOrder.length;
      // unavailableCount = assigned questions that no longer exist at all (hard-deleted): permanent, so the client must not keep retrying for them.
      const unavailableCount = attempt.questionOrder.filter((qId) => !byId.has(qId)).length;
      test.manifest = { version: attempt.manifestVersion ?? 0, expectedCount: expected, questionIds: attempt.questionOrder, unavailableCount };
      logCountMismatch("GET /tests/:id", { attemptId: attempt.id, testId: test.id, expected, manifest: attempt.questionOrder.length, delivered: test.questions.length });
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

  test.security = X.clientPolicy(policyOf(test));
  if (!isStaff) delete test.securityPolicy;
  await questionImages.attachQuestionImageUrls(test.questions);
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
    if (!student) return res.status(401).json({ error: "This account no longer exists. Please log in again.", authExpired: true });
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
    // Server-side start requirements (the page cannot override these): phones/tablets are refused when the test is PROCTORED
    // (or an admin turned phones off). Applies to resume as well as a first start.
    const startPolicy = policyOf(test);
    const startFailure = startRequirementFailure(req, startPolicy);
    if (startFailure) return res.status(403).json(startFailure);

    const existing = await prisma.testAttempt.findUnique({
      where: { testId_studentId: { testId, studentId: req.user.id } },
    });
    if (existing && existing.status !== "IN_PROGRESS") {
      return res.status(403).json({ error: "Thank you. You have already completed this assessment." });
    }

    const now = new Date();
    if (now < test.startTime) return res.status(403).json({ error: "Test has not started yet" });
    // An admin-approved reattempt (see TestReattemptGrant's own schema comment) is a one-time,
    // single-use exception to the window-closed check below -- checked here, before that check,
    // rather than after, so a student who's just outside the window but has a live grant isn't
    // rejected before we even look. Only ever relevant when `existing` is falsy (a genuinely new
    // attempt to create): a resume of an already-IN_PROGRESS attempt has no reason to consult this.
    let reattemptGrant = null;
    if (now > test.endTime && !existing) {
      reattemptGrant = await prisma.testReattemptGrant.findUnique({ where: { testId_studentId: { testId, studentId: req.user.id } } });
      if (!reattemptGrant) return res.status(403).json({ error: "Test window has closed" });
    } else if (now > test.endTime) {
      return res.status(403).json({ error: "Test window has closed" });
    }

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
      // Never start a shorter (or empty, or duplicated) assessment than the one configured: refuse with an actionable message instead.
      const manifestCheck = validateManifest(test, questionOrder);
      if (!manifestCheck.ok) {
        console.error(JSON.stringify({ event: "assessment_manifest_invalid", testId, studentId: req.user.id, errors: manifestCheck.errors, configured: manifestCheck.configuredCount, available: manifestCheck.availableCount, delivered: manifestCheck.deliveredCount, at: new Date().toISOString() }));
        return res.status(409).json({ error: manifestCheck.message, code: "ASSESSMENT_CONFIG_INVALID", configuredCount: manifestCheck.configuredCount, availableCount: manifestCheck.availableCount });
      }
      try {
        attempt = await prisma.testAttempt.create({ data: { testId, studentId: req.user.id, questionOrder, optionOrder, expectedQuestionCount: questionOrder.length, manifestVersion: MANIFEST_VERSION } });
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
      // Consumed the moment a new attempt actually gets created off the back of it — a reattempt
      // grant is a one-time pass, not standing permission to keep restarting past the window.
      if (reattemptGrant) {
        await prisma.testReattemptGrant.delete({ where: { id: reattemptGrant.id } }).catch(() => {});
      }
    }
    // One-active-session control: the newest start/resume owns attempt.sessionId (every later answer/submit must carry it in
    // X-Exam-Session). A harmless refresh simply takes the session over; a second tab/device that kept the old id is the one refused.
    const sessionId = crypto.randomBytes(16).toString("hex");
    if (attempt.status === "IN_PROGRESS") {
      await prisma.testAttempt.update({ where: { id: attempt.id }, data: { sessionId } });
    }
    // Include already-saved submissions (auto-saved MCQ answers, locked coding submissions)
    // so a page refresh mid-test restores exactly where the candidate left off. codeSavedSeq is
    // stripped before this ever reaches res.json() below — it's a BigInt column (see its schema
    // comment), and JSON.stringify throws on a raw BigInt; nothing on the frontend needs this
    // internal ordering guard anyway.
    const submissions = (await prisma.submission.findMany({ where: { attemptId: attempt.id } }))
      .map(({ codeSavedSeq, ...rest }) => rest);
    // serverTime lets the client compute its own clock's offset from the server's — the deadline
    // timer then measures against (Date.now() + offset) instead of raw Date.now(), so a student
    // whose device clock is skewed doesn't get auto-submitted early or late relative to real time.
    res.json({ ...attempt, sessionId, submissions, serverTime: Date.now(), security: X.clientPolicy(startPolicy) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start test" });
  }
});

// Mirrors moduleCoding.js's and interview.js's identical allowlist exactly. Before this existed,
// the exam side didn't even know WHAT happened — the client sent no type at all, and every call
// to this endpoint blindly incremented tabSwitchCount by 1, so a face-missing blip counted as a
// full strike exactly like a real tab switch. FACE_MISSING/MULTIPLE_FACES intentionally stay
// off this list — same "log don't penalize" policy interview.js already documents for face
// signals, now applied consistently across every proctored surface.
//
// Superseded by utils/proctoringSeverity.js's 4-level taxonomy (NORMAL/INTERRUPTION/SUSPICIOUS/
// CONFIRMED_VIOLATION) below — the binary allowlist this used to be couldn't express "penalize
// this only if it keeps happening," which SUSPICIOUS-severity escalation now does.

// --- STUDENT: report a proctoring violation during an attempt. `type` distinguishes what
// happened; classifyViolation() (utils/proctoringSeverity.js) is the sole source of truth for
// its severity and whether THIS occurrence counts toward MAX_TAB_VIOLATIONS — never a
// client-supplied flag. Every event is still logged to TestViolation regardless of severity, so
// an admin reviewing a flagged attempt sees the real event history, not just a count. After
// MAX_VIOLATIONS penalized events, the attempt is auto-submitted server-side. ---
const MAX_TAB_VIOLATIONS = 3;
// Gap fixed 2026-09-07: this route had no rate limit at all -- reportViolation() on the frontend
// already self-throttles to one call per 1500ms regardless of type (see TestTaking.jsx), but that
// is a client-side courtesy, not a server-side guarantee (a modified/replayed request can ignore
// it entirely). A burst of requests here is cheap per-call (no judge/compute involved) but each
// one is still a DB write (testViolation.create, sometimes inside a transaction with a
// testAttempt.update) -- same per-student (not per-IP) keying as execLimiter/examAiAssistLimiter
// above and in submissions.js, for the same reason: a shared lab/campus network IP must not share
// one budget across every student on it. Generous relative to the frontend's own ~1/1.5s natural
// rate (40/min) so a legitimately fast run of real violations is never itself the thing that gets
// rate-limited.
const violationLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, keyGenerator: (req) => req.user.id });
router.post("/attempts/:attemptId/violation", authenticate, requireRole("STUDENT"), violationLimiter, async (req, res) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({ where: { id: req.params.attemptId } });
    if (!attempt || attempt.studentId !== req.user.id) {
      return res.status(403).json({ error: "Invalid attempt" });
    }
    if (attempt.status !== "IN_PROGRESS") {
      return res.json({ tabSwitchCount: attempt.tabSwitchCount, autoSubmitted: true });
    }

    const type = String(req.body.type || "UNKNOWN").toUpperCase().slice(0, 40);
    // SUSPICIOUS escalation needs to know how many SUSPICIOUS events this attempt already has —
    // counted fresh from the log every time rather than kept in a running counter column, so the
    // escalation threshold in proctoringSeverity.js can change later without a backfill.
    const priorSuspiciousCount = await prisma.testViolation.count({ where: { attemptId: attempt.id, severity: "SUSPICIOUS" } });
    const { severity, penalized } = classifyViolation(type, priorSuspiciousCount);
    const tabSwitchCount = penalized ? attempt.tabSwitchCount + 1 : attempt.tabSwitchCount;
    const autoSubmitted = penalized && tabSwitchCount >= MAX_TAB_VIOLATIONS;

    // Coding answers are auto-saved as PENDING drafts and only graded at submission time —
    // a violation-triggered auto-submit is a submission just like any other, so it must grade
    // them too, or those coding questions would sit ungraded (and worth 0) forever.
    if (autoSubmitted) {
      await gradePendingCodingSubmissions(attempt.id);
    }

    // Log row and count update describe one event -- transact them together when penalized (same
    // reasoning as moduleCoding.js's identical route) so a partial write never leaves the two out
    // of sync. Non-penalized events only ever write the log.
    if (penalized) {
      await prisma.$transaction([
        prisma.testViolation.create({ data: { attemptId: attempt.id, type, severity, penalized } }),
        prisma.testAttempt.update({
          where: { id: attempt.id },
          data: { tabSwitchCount, ...(autoSubmitted ? { status: "AUTO_SUBMITTED", submittedAt: new Date() } : {}) },
        }),
      ]);
    } else {
      await prisma.testViolation.create({ data: { attemptId: attempt.id, type, severity, penalized } });
    }

    // Still counts as a completed test for XP/streak purposes (same treatment AUTO_SUBMITTED
    // gets everywhere else on the platform) — not surfaced in this response, though, since a
    // celebratory XP/badge toast would be a strange thing to show in the middle of a
    // violation-triggered forced submission.
    if (autoSubmitted) {
      processGamification(req.user.id, { xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true }).catch((e) =>
        console.error("gamification failed", e)
      );
    }

    res.json({ tabSwitchCount, maxViolations: MAX_TAB_VIOLATIONS, severity, penalized, autoSubmitted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record violation" });
  }
});

// ADMIN/STAFF: event-level proctoring log for one exam attempt -- for reviewing exactly what
// happened, not just tabSwitchCount. Mirrors moduleCoding.js's /admin/attempts/:attemptId and
// interview.js's /admin/sessions/:id/violations exactly.
router.get("/admin/attempts/:attemptId/violations", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: req.params.attemptId },
      include: { test: { select: { instituteId: true, createdById: true, shares: { select: { staffId: true } } } }, student: { select: { name: true, email: true } } },
    });
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (req.requesterInstituteId && attempt.test.instituteId && attempt.test.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view attempts for tests under your own institute" });
    }
    if (!canStaffAccessTest(req, attempt.test)) {
      return res.status(403).json({ error: "You can only view attempts for tests you created or that were shared with you" });
    }
    const violations = await prisma.testViolation.findMany({ where: { attemptId: attempt.id }, orderBy: { createdAt: "asc" } });
    const byType = {};
    for (const v of violations) byType[v.type] = (byType[v.type] || 0) + 1;
    res.json({ student: attempt.student, tabSwitchCount: attempt.tabSwitchCount, byType, events: violations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load violation log" });
  }
});

const examAiAssistLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });

// STUDENT: ask the in-page AI panel a question about the CURRENT exam question. Gated per-question
// by TestQuestion.aiAllowed (see its own schema comment) -- the sole source of truth, looked up
// fresh from the database every call, never a client-supplied claim that AI is allowed here. Same
// guardrail as Practice Coding's /practice/:id/hint: hints and explanations only, enforced via the
// system prompt below, and defense-in-depth by literally never including hidden test cases,
// correctAnswer, or explanation in what's sent to the model -- not "the model was told not to
// reveal it," but "it was never given it to reveal." Rendered as an in-page panel on the exam
// itself (never a new tab/window), so this needs no proctoring exemption of any kind: fullscreen
// stays active and the page never becomes hidden, exactly like using the exam's own editor.
router.post("/attempts/:attemptId/ai-assist", authenticate, requireRole("STUDENT"), examAiAssistLimiter, async (req, res) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: req.params.attemptId },
      select: { id: true, testId: true, studentId: true, status: true },
    });
    if (!attempt || attempt.studentId !== req.user.id) return res.status(403).json({ error: "Invalid attempt" });
    if (attempt.status !== "IN_PROGRESS") return res.status(400).json({ error: "This attempt is no longer in progress" });

    const { questionId, message } = req.body;
    if (!questionId || !message || !message.trim()) {
      return res.status(400).json({ error: "questionId and message are required" });
    }

    const testQuestion = await prisma.testQuestion.findUnique({
      where: { testId_questionId: { testId: attempt.testId, questionId } },
      select: {
        aiAllowed: true,
        question: { select: { title: true, description: true, questionType: true, subject: true, topic: true, options: true } },
      },
    });
    if (!testQuestion || !testQuestion.aiAllowed) {
      return res.status(403).json({ error: "AI assistance is not enabled for this question" });
    }

    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
    if (!student) return res.status(401).json({ error: "This account no longer exists. Please log in again.", authExpired: true });
    const q = testQuestion.question;
    const questionContext = [
      `Question type: ${q.questionType}`,
      q.subject ? `Subject: ${q.subject}` : null,
      q.topic ? `Topic: ${q.topic}` : null,
      `Title: ${q.title}`,
      `Description: ${q.description}`,
      // Options are already visible to every student taking this MCQ, not a secret -- correctAnswer
      // and explanation are deliberately never selected above, at all, regardless of what's asked.
      Array.isArray(q.options) && q.options.length ? `Options: ${q.options.join(" | ")}` : null,
    ].filter(Boolean).join("\n");

    const reply = await aiService.generateText({
      feature: aiService.FEATURES.EXAM_AI_ASSIST, userId: req.user.id, instituteId: student?.instituteId,
      system: "You are a patient exam-time teaching assistant. Help the student understand the question, clarify terminology, and think through their approach with hints -- never state the final answer, never write a complete solution, never reveal or guess a hidden test case. If asked directly for the answer or a full solution, politely decline and offer a hint toward it instead. Keep replies short (3-6 sentences).",
      prompt: `${questionContext}\n\n${aiService.wrapUntrusted("Student's question", message.trim().slice(0, 1000))}`,
      maxTokens: 400,
      temperature: 0.5,
    });
    res.json({ reply });
  } catch (err) {
    sendAiError(res, err, "Failed to get AI assistance");
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
      // Grants a one-time bypass of the test's own startTime/endTime window on this student's next
      // POST /:id/start (see TestReattemptGrant's own schema comment for why this is needed at
      // all — deleting the old attempt alone does nothing about an already-closed test window,
      // which is the single most common reason to grant a reattempt in the first place). Upsert,
      // not create: granting a reattempt twice in a row (e.g. the student still doesn't manage to
      // start it in time) must refresh this, not collide on the unique constraint.
      prisma.testReattemptGrant.upsert({
        where: { testId_studentId: { testId, studentId } },
        create: { testId, studentId, grantedByUserId: req.user.id, grantedByName: admin?.name || req.user.email },
        update: { grantedByUserId: req.user.id, grantedByName: admin?.name || req.user.email, grantedAt: new Date() },
      }),
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

// ADMIN/STAFF: results as a real spreadsheet. Built server-side (typed numeric cells, text roll/PRN so
// leading zeros survive, formula-injection guard on every text cell) instead of the browser quoting
// every value into a CSV string, which made Excel treat scores as text and mangle long roll/PRN
// numbers. Rank is computed over the full score-ordered list so it matches the leaderboard even when
// a roll-number filter is applied; `roll` narrows the rows exactly like the on-screen filter.
router.get("/:id/results/export", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const test = await prisma.test.findUnique({
      where: { id: req.params.id },
      select: {
        title: true, passingMarks: true, instituteId: true, createdById: true, shares: { select: { staffId: true } },
        questions: { select: { questionId: true, question: { select: { points: true } } } },
      },
    });
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only export results for tests under your own institute" });
    }
    if (!canStaffAccessTest(req, test)) {
      return res.status(403).json({ error: "You can only export results for tests you created or that were shared with you" });
    }
    const attempts = await prisma.testAttempt.findMany({
      where: { testId: req.params.id },
      include: {
        student: { select: { name: true, email: true, rollNumber: true, registrationNumber: true } },
        submissions: { select: { questionId: true } },
      },
      orderBy: [{ totalScore: "desc" }, { startedAt: "asc" }],
      take: 20000,
    });
    // Each attempt is scored out of ITS OWN assigned questions (manifest), with points read from the Question table so a question removed from the test later
    // still counts for the students who were given it.
    const bases = await scoreBases(prisma, attempts);
    const roll = String(req.query.roll || "").trim().toLowerCase();
    const STATUS = { IN_PROGRESS: "In progress", SUBMITTED: "Submitted", AUTO_SUBMITTED: "Auto-submitted" };
    const iso = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "");

    const rows = attempts
      .map((a, idx) => ({ a, rank: idx + 1 }))
      .filter(({ a }) => !roll || (a.student.rollNumber || "").toLowerCase().includes(roll))
      .map(({ a, rank }) => {
        const base = bases.get(a.id);
        const max = base.maxScore;
        const completed = a.status !== "IN_PROGRESS";
        return {
          Rank: rank,
          "Roll No.": a.student.rollNumber || "",
          Student: a.student.name || "",
          "Registration No. (PRN)": a.student.registrationNumber || "",
          Email: a.student.email || "",
          Score: a.totalScore ?? 0,
          "Max Score": max,
          "Percentage (%)": max > 0 ? Math.round(((a.totalScore ?? 0) / max) * 1000) / 10 : "",
          Result: !completed || test.passingMarks == null ? "" : (a.totalScore ?? 0) >= test.passingMarks ? "Pass" : "Fail",
          Attempted: new Set(a.submissions.map((s) => s.questionId)).size,
          "Total Questions": base.expectedCount,
          Status: STATUS[a.status] || a.status,
          "Tab Switches / Violations": a.tabSwitchCount ?? 0,
          "Started At": iso(a.startedAt),
          "Submitted At": iso(a.submittedAt),
        };
      });
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const filename = (test.title || "test-results").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "test-results";
    return sendTable(res, XLSX, { rows, sheetName: "Results", filename: `${filename}-results`, format, colWidths: [6, 14, 24, 22, 30, 8, 10, 14, 8, 10, 15, 14, 24, 24, 24] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export results" });
  }
});

// STAFF/ADMIN: per-question breakdown for one test — "Faculty Analytics" (platform-maturity spec
// item #6): attempted count, fully-correct count/rate, and average score-as-percent-of-max, sorted
// hardest-first (lowest correct rate) so the questions students actually struggled with surface at
// the top rather than being buried in per-student rows. "Fully correct" is defined the same way
// regardless of question type — score >= the question's own points — since Submission.score is
// already the one universal, type-agnostic field (MCQ full-or-zero, CODING/SQL proportional to
// passedCases/totalCases), so this needs no separate MCQ/coding branching logic.
//
// `reviewRecommended` is a heuristic flag (correct rate under 20%, with at least 5 attempts so a
// single early submission can't trigger it), not a claim that a question IS broken -- a genuinely
// hard question and a badly-worded one produce the identical signal from this data alone; only a
// human can tell them apart. This is intentionally surfaced, never auto-corrected.
router.get("/:id/question-analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const test = await prisma.test.findUnique({
    where: { id: req.params.id },
    select: {
      instituteId: true, createdById: true, shares: { select: { staffId: true } },
      questions: { orderBy: { order: "asc" }, select: { questionId: true, question: { select: { questionNumber: true, title: true, points: true, questionType: true } } } },
    },
  });
  if (!test) return res.status(404).json({ error: "Test not found" });
  if (req.requesterInstituteId && test.instituteId && test.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "You can only view analytics for tests under your own institute" });
  }
  if (!canStaffAccessTest(req, test)) {
    return res.status(403).json({ error: "You can only view analytics for tests you created or that were shared with you" });
  }

  const questionIds = test.questions.map((tq) => tq.questionId);
  const submissions = questionIds.length
    ? await prisma.submission.findMany({
        where: { attempt: { testId: req.params.id }, questionId: { in: questionIds } },
        select: { questionId: true, score: true, studentId: true },
      })
    : [];
  const byQuestion = new Map(questionIds.map((id) => [id, []]));
  for (const s of submissions) byQuestion.get(s.questionId)?.push(s);

  const rows = test.questions.map((tq) => {
    const q = tq.question;
    const subs = byQuestion.get(tq.questionId) || [];
    // Distinct students, not raw submission rows — autosave can write more than one Submission
    // row per student per question over the course of an attempt (see Submission.createdAt/the
    // autosave endpoints), so a raw count would overcount "attempted."
    const byStudent = new Map();
    for (const s of subs) {
      const prior = byStudent.get(s.studentId);
      if (!prior || s.score > prior.score) byStudent.set(s.studentId, s);
    }
    const attempted = byStudent.size;
    const scores = [...byStudent.values()].map((s) => s.score);
    const fullyCorrect = q.points > 0 ? scores.filter((sc) => sc >= q.points).length : 0;
    const correctRate = attempted > 0 ? fullyCorrect / attempted : null;
    const avgScorePercent = attempted > 0 && q.points > 0
      ? Math.round((scores.reduce((sum, sc) => sum + sc, 0) / attempted / q.points) * 100)
      : null;
    return {
      questionId: tq.questionId, questionNumber: q.questionNumber, title: q.title, questionType: q.questionType, points: q.points,
      attempted, fullyCorrect, correctRate, avgScorePercent,
      reviewRecommended: attempted >= 5 && correctRate !== null && correctRate < 0.2,
    };
  });
  // Hardest (or least-attempted-yet, correctRate null) first — that ordering is what makes this a
  // "which questions need attention" view rather than just the test's own authored question order.
  rows.sort((a, b) => (a.correctRate ?? -1) - (b.correctRate ?? -1));
  res.json(rows);
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
    // codeSavedSeq is a BigInt (see its schema comment) — must never reach res.json() below raw.
    if (attempt.submissions) attempt.submissions = attempt.submissions.map(({ codeSavedSeq, ...rest }) => rest);
    if (attempt.status === "IN_PROGRESS") return res.status(403).json({ error: "Test not yet submitted" });
    if (!test.showResults) {
      return res.json({ status: attempt.status, showResults: false });
    }

    // Scored out of the questions this attempt was assigned (its manifest), never out of what was answered or rendered.
    const base = await scoreBase(prisma, attempt);
    const answeredCount = new Set((attempt.submissions || []).map((s) => s.questionId)).size;
    res.json({
      status: attempt.status,
      showResults: true,
      totalScore: attempt.totalScore,
      maxScore: base.maxScore,
      expectedQuestionCount: base.expectedCount,
      answeredCount,
      unansweredCount: Math.max(0, base.expectedCount - answeredCount),
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
