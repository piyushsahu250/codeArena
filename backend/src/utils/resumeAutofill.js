const prisma = require("../prisma");

const LANG_LABELS = { java: "Java", python: "Python", javascript: "JavaScript", c: "C", cpp: "C++" };
const EXAM_QUIZ_TYPES = ["MCQ", "TRUE_FALSE", "MULTISELECT"];

// Builds a starter draft from data the platform already has: profile, class/institute (as a
// best-guess education record), languages solved successfully (as skills), earned course
// certificates, and gamification badges/coding-volume (as achievements). Returns only the
// fields there's real signal for — projects, work experience, and languages-spoken have no
// platform source and are left for the student to fill in themselves.
async function buildAutofillData(studentId) {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    include: { institute: true, class: true, academicGroup: true },
  });
  if (!student) return null;

  const [certificates, badges, acceptedRuns, acceptedSubmissions] = await Promise.all([
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
  };
}

module.exports = { buildAutofillData };
