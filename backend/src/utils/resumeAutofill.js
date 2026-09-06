const prisma = require("../prisma");

const LANG_LABELS = { java: "Java", python: "Python", javascript: "JavaScript", c: "C", cpp: "C++" };
const EXAM_QUIZ_TYPES = ["MCQ", "TRUE_FALSE", "MULTISELECT"];

// Builds a starter draft from data the platform already has: profile, class/institute (as a
// best-guess education record), languages solved successfully (as skills), earned course
// certificates, gamification badges/coding-volume (as achievements), and — since Project-Based
// Learning shipped (LMS master-spec sections 14-17/34-35) — fully-completed CourseProjects (every
// ProjectTask COMPLETED) as real, platform-verified `projects` entries. Work experience and
// languages-spoken still have no platform source and are left for the student to fill in.
async function buildAutofillData(studentId) {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    include: { institute: true, class: true, academicGroup: true },
  });
  if (!student) return null;

  const [certificates, badges, acceptedRuns, acceptedSubmissions, completedProjects] = await Promise.all([
    prisma.certificate.findMany({ where: { studentId }, include: { course: true } }),
    prisma.studentBadge.findMany({ where: { studentId }, include: { badge: true } }),
    prisma.practiceRunLog.findMany({
      where: { studentId, verdict: "ACCEPTED" },
      select: { questionId: true, question: { select: { language: true } } },
    }),
    prisma.submission.findMany({
      where: { studentId, verdict: "ACCEPTED" },
      select: { language: true },
    }),
    getCompletedProjects(studentId),
  ]);

  const langSet = new Set();
  for (const r of acceptedRuns) if (r.question?.language) langSet.add(r.question.language);
  for (const s of acceptedSubmissions) if (s.language && !EXAM_QUIZ_TYPES.includes(s.language)) langSet.add(s.language);
  const skills = [...langSet].map((l, i) => ({
    category: "Programming Languages", name: LANG_LABELS[l] || l, proficiency: "Intermediate", order: i,
  }));

  const education = [];
  if (student.class || student.academicGroup || student.institute) {
    const [startYear, endYear] = (student.academicGroup?.batch || student.class?.batchYear || student.batchYear || "").split("-");
    education.push({
      degree: student.class?.name || student.program || "",
      specialization: student.department || "",
      institution: student.institute?.name || "",
      board: "",
      startYear: startYear || "",
      endYear: endYear || "",
      score: "",
      status: "Pursuing",
    });
  }

  // `title` is always populated with a real, human-readable name for every certificate type (e.g.
  // "Java Learning Course", "Java Coding Assessment") — preferred over reconstructing a label from
  // `course`, which only disambiguates LEARNING_MODULE/CODING_ASSESSMENT from MANUAL certs (that
  // have no course at all), not what kind of achievement it was.
  const certifications = certificates.map((c) => ({
    name: c.title || c.programName || (c.course ? `${c.course.name} Certificate` : "CodeArena Certificate"),
    org: "CodeArena",
    issueDate: new Date(c.issuedAt).toISOString().slice(0, 10),
    expiryDate: "",
    credentialId: c.certificateCode,
    credentialUrl: "",
  }));

  const achievements = badges.map((b) => ({ category: "Badge", text: `${b.badge.icon || ""} ${b.badge.name}`.trim() }));
  const distinctSolved = new Set(acceptedRuns.map((r) => r.questionId)).size;
  if (distinctSolved > 0) {
    achievements.push({ category: "Coding", text: `Solved ${distinctSolved} coding practice problem${distinctSolved === 1 ? "" : "s"} on CodeArena` });
  }

  return {
    fullName: student.name,
    email: student.email,
    mobile: student.mobile || "",
    education,
    skills,
    certifications,
    achievements,
    projects: completedProjects,
  };
}

// Every CourseProject this student has genuinely finished (every one of its ProjectTasks is
// COMPLETED — never a partial project) mapped onto Resume.projects' own existing shape
// ({ title, description, technologies, role, duration, githubUrl, liveUrl }). Nothing invented:
// `technologies` comes straight from the project's authored `skillsRequired`, `description` from
// its authored `objective`/`description` — never AI-generated, never guessed.
//
// Starts from THIS STUDENT's own ProjectTaskProgress rows (naturally small — bounded by their own
// activity) rather than fetching every active CourseProject on the entire platform first, which
// scales with total platform project count, not with anything about this student — exactly the
// unbounded full-table-scan pattern this platform has hit before as content volume grows. Called
// on every /resume/me/portfolio and /resume/me/autofill request, with no route-level caching on
// either, so this was the highest-traffic version of the mistake, not just a stylistic one.
async function getCompletedProjects(studentId) {
  const completedTaskRows = await prisma.projectTaskProgress.findMany({
    where: { studentId, status: "COMPLETED" },
    select: { taskId: true, task: { select: { projectId: true } } },
  });
  if (completedTaskRows.length === 0) return [];
  const candidateProjectIds = [...new Set(completedTaskRows.map((r) => r.task.projectId))];
  const completedSet = new Set(completedTaskRows.map((r) => r.taskId));

  const projects = await prisma.courseProject.findMany({
    where: { id: { in: candidateProjectIds }, isActive: true },
    select: { id: true, title: true, description: true, objective: true, skillsRequired: true, tasks: { select: { id: true } } },
  });

  return projects
    .filter((p) => p.tasks.length > 0 && p.tasks.every((t) => completedSet.has(t.id)))
    .map((p) => ({
      title: p.title,
      description: p.objective || p.description || "",
      technologies: Array.isArray(p.skillsRequired) ? p.skillsRequired.join(", ") : "",
      role: "Student", duration: "", githubUrl: "", liveUrl: "",
    }));
}

module.exports = { buildAutofillData, getCompletedProjects };
