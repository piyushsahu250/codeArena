// Level-based Practice tracks (Course.kind === "PRACTICE"), e.g. JAVA Practice. This is a thin read layer over the
// existing LMS tables (Course > CourseModule > Chapter > ModuleCodingTest > Question); the attempt engine, judge,
// proctoring and grading all stay in moduleCoding.js. Nothing here writes.
const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { courseEligibilityWhere, isEligibilityUnresolvable } = require("../utils/courseEligibility");
const { loadPracticeState } = require("../utils/practiceProgress");

const router = express.Router();
const STAFF = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"];

// Same gate as /learning/courses/:slug: students need a Published course assigned to their institute/group, and a
// miss is the same 404 as a nonexistent slug. Staff see their own institute's courses plus global ones.
async function loadCourse(req, res) {
  const where = { slug: req.params.slug, kind: "PRACTICE" };
  if (req.user.role === "STUDENT") {
    const s = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true, academicGroupId: true } });
    if (isEligibilityUnresolvable(s?.instituteId, s?.academicGroupId)) { res.status(404).json({ error: "Course not found" }); return null; }
    where.status = "PUBLISHED";
    Object.assign(where, courseEligibilityWhere(s.instituteId, s.academicGroupId));
  } else if (req.requesterInstituteId) {
    where.OR = [{ instituteId: req.requesterInstituteId }, { instituteId: null }];
  }
  const course = await prisma.course.findFirst({ where, select: { id: true, slug: true, name: true, description: true, instituteId: true } });
  if (!course) { res.status(404).json({ error: "Course not found" }); return null; }
  return course;
}

const strip = (t) => ({ ...t, levels: undefined });
const sectionSummary = (s) => ({ ...s, topics: undefined });

// Course home: the sections with progress, lock state and where "Continue" should go.
router.get("/:slug", authenticate, attachRequesterInstitute, async (req, res) => {
  try {
    const course = await loadCourse(req, res); if (!course) return;
    const state = await loadPracticeState(prisma, req.user.role === "STUDENT" ? req.user.id : null, course.id);
    res.json({ course, sections: state.sections.map(sectionSummary), overall: state.overall, resume: state.resume });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load practice course" }); }
});

// One section's topics (duration, outline, level counts, progress, lock).
router.get("/:slug/sections/:sectionId", authenticate, attachRequesterInstitute, async (req, res) => {
  try {
    const course = await loadCourse(req, res); if (!course) return;
    const state = await loadPracticeState(prisma, req.user.role === "STUDENT" ? req.user.id : null, course.id);
    const section = state.sections.find((s) => s.id === req.params.sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });
    res.json({ course, section: sectionSummary(section), topics: section.topics.map(strip), resume: state.resume });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load section" }); }
});

// One topic with its levels. A locked topic still returns its title/lock reason but no level list.
router.get("/:slug/topics/:topicId", authenticate, attachRequesterInstitute, async (req, res) => {
  try {
    const course = await loadCourse(req, res); if (!course) return;
    const state = await loadPracticeState(prisma, req.user.role === "STUDENT" ? req.user.id : null, course.id);
    for (const s of state.sections) {
      const t = s.topics.find((x) => x.id === req.params.topicId);
      if (t) {
        return res.json({
          course, section: { id: s.id, title: s.title, locked: s.locked }, topic: t.locked ? { ...t, levels: [] } : t,
          next: nextLevelAfter(state.sections, req.query.after),
        });
      }
    }
    res.status(404).json({ error: "Topic not found" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load topic" }); }
});

// "Continue to the next level" target after finishing `afterLevelId` (next startable level in course order).
function nextLevelAfter(sections, afterLevelId) {
  if (!afterLevelId) return null;
  let seen = false;
  for (const s of sections) for (const t of s.topics) for (const l of t.levels) {
    if (seen && l.startable && !t.locked && !s.locked) return { topicId: t.id, levelId: l.id, title: l.title };
    if (l.id === afterLevelId) seen = true;
  }
  return null;
}

// Staff/admin analytics: per topic and level (real attempt data). Institute-scoped admins/staff only count their own
// institute's students; the enrolled figure is students the course is assigned to (institute or academic group).
router.get("/:slug/analytics", authenticate, requireRole(...STAFF), attachRequesterInstitute, async (req, res) => {
  try {
    const course = await loadCourse(req, res); if (!course) return;
    const studentScope = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
    const levels = await prisma.moduleCodingTest.findMany({
      where: { chapter: { module: { courseId: course.id } } },
      select: { id: true, title: true, order: true, chapter: { select: { id: true, title: true, order: true, module: { select: { id: true, title: true, order: true } } } } },
    });
    const attempts = levels.length
      ? await prisma.moduleCodingAttempt.findMany({
          where: { moduleCodingTestId: { in: levels.map((l) => l.id) }, student: studentScope },
          select: { moduleCodingTestId: true, studentId: true, status: true, passed: true, score: true, startedAt: true, submittedAt: true },
        })
      : [];
    const [instAssign, groupAssign] = await Promise.all([
      prisma.courseInstituteAssignment.findMany({ where: { courseId: course.id }, select: { instituteId: true } }),
      prisma.courseAcademicGroupAssignment.findMany({ where: { courseId: course.id }, select: { academicGroupId: true } }),
    ]);
    const or = [
      ...(instAssign.length ? [{ instituteId: { in: instAssign.map((a) => a.instituteId) } }] : []),
      ...(groupAssign.length ? [{ academicGroupId: { in: groupAssign.map((a) => a.academicGroupId) } }] : []),
    ];
    const enrolled = or.length ? await prisma.user.count({ where: { role: "STUDENT", ...studentScope, OR: or } }) : 0;

    const rows = levels.map((l) => {
      const a = attempts.filter((x) => x.moduleCodingTestId === l.id);
      const done = a.filter((x) => x.status !== "IN_PROGRESS");
      const students = new Set(a.map((x) => x.studentId));
      const passedStudents = new Set(a.filter((x) => x.passed).map((x) => x.studentId));
      const timed = done.filter((x) => x.submittedAt && x.startedAt);
      const avg = (arr) => (arr.length ? Math.round((arr.reduce((n, v) => n + v, 0) / arr.length) * 10) / 10 : null);
      return {
        levelId: l.id, level: l.title, order: l.order, topicId: l.chapter.id, topic: l.chapter.title, topicOrder: l.chapter.order,
        sectionId: l.chapter.module.id, section: l.chapter.module.title, sectionOrder: l.chapter.module.order,
        started: students.size, passed: passedStudents.size, failed: [...students].filter((s) => !passedStudents.has(s) && done.some((x) => x.studentId === s)).length,
        attempts: a.length, passRate: students.size ? Math.round((passedStudents.size / students.size) * 100) : null,
        avgScore: avg(done.map((x) => x.score || 0)), avgTimeMin: avg(timed.map((x) => (new Date(x.submittedAt) - new Date(x.startedAt)) / 60000)),
      };
    }).sort((x, y) => x.sectionOrder - y.sectionOrder || x.topicOrder - y.topicOrder || x.order - y.order);

    const withData = rows.filter((r) => r.started > 0);
    res.json({
      course, enrolled, levels: rows,
      summary: {
        studentsStarted: new Set(attempts.map((x) => x.studentId)).size,
        mostFailedLevel: withData.length ? [...withData].sort((x, y) => (x.passRate ?? 100) - (y.passRate ?? 100))[0].level : null,
        overallPassRate: withData.length ? Math.round(withData.reduce((n, r) => n + (r.passRate || 0), 0) / withData.length) : null,
      },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Failed to load analytics" }); }
});

module.exports = router;
