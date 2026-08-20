const express = require("express");
const prisma = require("../prisma");
const { authenticate } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { testEligibilityWhere } = require("../utils/testEligibility");
const { staffTestAccessWhere } = require("../utils/testOwnership");
const { questionVisibilityWhere } = require("../utils/questionVisibility");
const { courseEligibilityWhere, isEligibilityUnresolvable } = require("../utils/courseEligibility");

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
      const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { academicGroupId: true, classId: true, instituteId: true } });

      // Same PUBLISHED + institute/academic-group assignment gate learning.js's GET /courses
      // already enforces — previously this search had no eligibility filter at all (just
      // isActive), so a student could see a non-eligible course's name+link in results even
      // though opening it via /learning/:slug correctly 404s. Information-disclosure gap, not
      // an access gap, but worth closing while the underlying course data is the same either way.
      const eligible = !isEligibilityUnresolvable(student?.instituteId, student?.academicGroupId);
      const courseWhere = eligible
        ? { name: insensitive(q), status: "PUBLISHED", ...courseEligibilityWhere(student.instituteId, student.academicGroupId) }
        : null;
      const courses = courseWhere ? await prisma.course.findMany({ where: courseWhere, take: LIMIT }) : [];
      results.push(...courses.map((c) => ({ type: "Learning Module", label: c.name, url: `/learning/${c.slug}` })));

      // Lessons inherit the same gate via their parent course — a lesson whose course fails
      // eligibility must not surface here either, for the same reason.
      const lessons = eligible
        ? await prisma.lesson.findMany({
            where: { title: insensitive(q), module: { course: { status: "PUBLISHED", ...courseEligibilityWhere(student.instituteId, student.academicGroupId) } } },
            include: { module: { include: { course: true } } },
            take: LIMIT,
          })
        : [];
      results.push(...lessons.map((l) => ({ type: "Lesson", label: `${l.title} (${l.module.course.name})`, url: `/learning/${l.module.course.slug}/lesson/${l.id}` })));

      const tests = await prisma.test.findMany({
        where: { title: insensitive(q), ...testEligibilityWhere(student?.academicGroupId, student?.classId, [], student?.instituteId) },
        take: LIMIT,
      });
      results.push(...tests.map((t) => ({ type: "Assessment", label: t.title, url: `/dashboard` })));
    } else if (req.user.role === "CLERK") {
      // Clerk's module set is Placement Cell only (see App.jsx's /clerk/* routes) — no Course/
      // Question Bank/Test/Academic Group/Institute/Staff access exists for this role anywhere else
      // in the app, so surfacing those as search results would only produce dead links. Scoped to
      // students alone, on the /clerk basePath (the ADMIN/STAFF branch below hardcodes /staff,
      // which 403s for Clerk).
      const instituteFilter = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
      const students = await prisma.user.findMany({
        where: { role: "STUDENT", ...instituteFilter, OR: [{ name: insensitive(q) }, { email: insensitive(q) }, { rollNumber: insensitive(q) }, { registrationNumber: insensitive(q) }, { mobile: insensitive(q) }] },
        take: LIMIT,
      });
      results.push(...students.map((s) => {
        const rollPrefix = s.rollNumber ? `${s.rollNumber} — ` : "";
        const idSuffix = s.registrationNumber || s.email;
        return { type: "Student", label: `${rollPrefix}${s.name} (${idSuffix})`, url: `/clerk/students/${s.id}` };
      }));
    } else {
      const instituteFilter = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};

      const students = await prisma.user.findMany({
        where: { role: "STUDENT", ...instituteFilter, OR: [{ name: insensitive(q) }, { email: insensitive(q) }, { rollNumber: insensitive(q) }, { registrationNumber: insensitive(q) }, { mobile: insensitive(q) }] },
        take: LIMIT,
      });
      const basePath = req.user.role === "ADMIN" ? "/admin" : "/staff";
      // Roll -> Name -> PRN per the platform's standard display order — shows both identifiers
      // together (not a fallback pick between one or the other) whenever either is set.
      results.push(...students.map((s) => {
        const rollPrefix = s.rollNumber ? `${s.rollNumber} — ` : "";
        const idSuffix = s.registrationNumber || s.email;
        return { type: "Student", label: `${rollPrefix}${s.name} (${idSuffix})`, url: `${basePath}/students/${s.id}` };
      }));

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

      // Reuses the exact same rule questions.js's own list/edit routes enforce (institute PLUS,
      // for a STAFF requester, createdById restricted to their own + legacy rows) — previously
      // this only re-derived the institute half locally and dropped the creator half, leaking
      // every institute-mate's private question titles/descriptions into search results.
      const questions = await prisma.question.findMany({
        where: { AND: [{ OR: [{ title: insensitive(q) }, { description: insensitive(q) }] }, questionVisibilityWhere(req)] },
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

      // staffTestAccessWhere no-ops for ADMIN (institute-wide search stays unchanged) but restricts
      // STAFF to tests they created or were explicitly shared — search must never surface a test a
      // staff member can't actually open (see testOwnership.js / the same gate tests.js enforces).
      const tests = await prisma.test.findMany({
        where: { AND: [{ title: insensitive(q), createdBy: { ...instituteFilter } }, staffTestAccessWhere(req)] },
        take: LIMIT,
      });
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
