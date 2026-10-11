const express = require("express");
const XLSX = require("xlsx");
const { sendTable } = require("../utils/spreadsheetSafe");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { canStaffAccessTest } = require("../utils/testOwnership");
const { scoreBases } = require("../utils/attemptManifest");

const router = express.Router();

// Everything except the routes below lives in modules/tests: authoring and management, reading tests, and the student attempt flow. The module is mounted
// FIRST so its single-segment routes cannot swallow these. The remaining routes (reattempt, results, export, question analytics) migrate in the next batch.
router.use(require("../modules/tests/tests.routes"));

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

module.exports = router;
