const express = require("express");
const prisma = require("../prisma");
const { authenticate } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { testEligibilityWhere } = require("../utils/testEligibility");

const router = express.Router();

const LIMIT = 6;
const insensitive = (q) => ({ contains: q, mode: "insensitive" });
const QUESTION_TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select", SQL: "SQL Query" };

// Role-scoped global search across the platform's real resource types — every result links to
// an actual route that exists in the app. Students search their own learning content and
// assessments; staff/admin additionally search students, courses, question bank content, and
// assessments within their institute scope (attachRequesterInstitute), matching how every other
// admin/staff list endpoint in this codebase already scopes data. Staff/Academic Groups/
// Institutes are ADMIN-only, mirroring who can already manage those elsewhere in the app.
router.get("/", authenticate, attachRequesterInstitute, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json({ results: [] });
    const results = [];

    if (req.user.role === "STUDENT") {
      const courses = await prisma.course.findMany({ where: { name: insensitive(q), isActive: true }, take: LIMIT });
      results.push(...courses.map((c) => ({ type: "Learning Module", label: c.name, url: `/learning/${c.slug}` })));

      const lessons = await prisma.lesson.findMany({
        where: { title: insensitive(q) },
        include: { module: { include: { course: true } } },
        take: LIMIT,
      });
      results.push(...lessons.map((l) => ({ type: "Lesson", label: `${l.title} (${l.module.course.name})`, url: `/learning/${l.module.course.slug}/lesson/${l.id}` })));

      const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { academicGroupId: true, classId: true } });
      const tests = await prisma.test.findMany({
        where: { title: insensitive(q), ...testEligibilityWhere(student?.academicGroupId, student?.classId) },
        take: LIMIT,
      });
      results.push(...tests.map((t) => ({ type: "Assessment", label: t.title, url: `/dashboard` })));
    } else {
      const instituteFilter = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
      // Question Bank rows use the same institute-visibility rule as questions.js's own reads:
      // an institute-scoped requester sees their own institute's questions PLUS legacy/shared rows
      // (instituteId: null) — see instituteVisibilityWhere() in questions.js for the original.
      const questionInstituteVisibility = req.requesterInstituteId
        ? { OR: [{ instituteId: req.requesterInstituteId }, { instituteId: null }] }
        : {};

      const students = await prisma.user.findMany({
        where: { role: "STUDENT", ...instituteFilter, OR: [{ name: insensitive(q) }, { email: insensitive(q) }, { rollNumber: insensitive(q) }] },
        take: LIMIT,
      });
      const basePath = req.user.role === "ADMIN" ? "/admin" : "/staff";
      results.push(...students.map((s) => ({ type: "Student", label: `${s.name} (${s.rollNumber || s.email})`, url: `${basePath}/students/${s.id}` })));

      // Staff visibility is ADMIN-only, matching Academic Groups/Institutes below — staff-account
      // management elsewhere in the app (user creation/edit) is already admin-only, so this is
      // search coverage over what an Admin can already see, not a new capability.
      if (req.user.role === "ADMIN") {
        const staff = await prisma.user.findMany({
          where: { role: "STAFF", ...instituteFilter, OR: [{ name: insensitive(q) }, { email: insensitive(q) }] },
          take: LIMIT,
        });
        results.push(...staff.map((s) => ({ type: "Staff", label: `${s.name} (${s.email})`, url: "/admin" })));
      }

      // Unlike the student branch, no `isActive` restriction here — staff/admin manage draft
      // courses too, not just published ones.
      const courses = await prisma.course.findMany({ where: { name: insensitive(q) }, take: LIMIT });
      results.push(...courses.map((c) => ({ type: "Course", label: c.name, url: `/learning/${c.slug}` })));

      const questions = await prisma.question.findMany({
        where: { OR: [{ title: insensitive(q) }, { description: insensitive(q) }], ...questionInstituteVisibility },
        take: LIMIT,
      });
      results.push(...questions.map((qn) => ({
        type: QUESTION_TYPE_LABELS[qn.questionType] || qn.questionType,
        label: qn.title || qn.description.slice(0, 60),
        url: `/staff/questions/${qn.id}/edit`,
      })));

      if (req.user.role === "ADMIN") {
        const groups = await prisma.academicGroup.findMany({
          where: { ...instituteFilter, OR: [{ batch: insensitive(q) }, { section: insensitive(q) }, { department: { name: insensitive(q) } }] },
          include: { department: true },
          take: LIMIT,
        });
        results.push(...groups.map((g) => ({ type: "Academic Group", label: `${g.department.name} · ${g.section} (${g.batch})`, url: "/admin/academic-groups" })));
      }

      const tests = await prisma.test.findMany({ where: { title: insensitive(q), createdBy: { ...instituteFilter } }, take: LIMIT });
      results.push(...tests.map((t) => ({ type: "Assessment", label: t.title, url: `/staff/tests/${t.id}/results` })));

      if (req.user.role === "ADMIN") {
        const institutes = await prisma.institute.findMany({ where: { name: insensitive(q) }, take: LIMIT });
        results.push(...institutes.map((i) => ({ type: "Institute", label: i.name, url: "/admin/institutes" })));
      }
    }

    res.json({ results: results.slice(0, 20) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
