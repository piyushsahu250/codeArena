const prisma = require("../prisma");
const { computeStudentPerformance } = require("./studentPerformance");
const { computeAtsScore } = require("./resumeAts");

// Combines existing, independently-computed signals into one transparent, weighted readiness
// score (platform-maturity spec item #18). Deliberately NOT a new scoring engine of its own --
// every component here is read from (or computed by) a function that already exists and is
// independently used elsewhere: computeStudentPerformance for coding/aptitude/academic (the same
// numbers StudentPerformance.jsx already shows), computeAtsScore for resume/ATS (the same
// function the Resume Builder's own ATS tab calls), InterviewReport.overallScore for mock
// interviews, Certificate count for certifications. This file's only job is combining them with a
// stated, visible weighting -- it never invents a new per-component scoring method, and it never
// touches marks/results (those stay deterministic and untouched by this, matching the platform's
// existing "AI/derived scores assist, never silently modify official marks" rule).
//
// Per the spec's own explicit instruction: "Don't present it as a guaranteed prediction. Present
// it as an internal readiness indicator." The disclaimer travels with every response, and the
// full per-component breakdown is always returned alongside the single number -- never just the
// number by itself, so a student or staff member reading this can see exactly what it's made of.
const WEIGHTS = {
  coding: 0.30, // codingVsMcq.coding.percentage from computeStudentPerformance
  aptitude: 0.15, // codingVsMcq.mcq.percentage -- the platform's closest existing proxy for
  // "aptitude": test-based MCQ correctness. There is no separate aptitude-only test type today;
  // this is an honest substitution, not a claim that MCQ accuracy IS aptitude.
  academic: 0.15, // overallPercentage from computeStudentPerformance (formal Test results)
  resume: 0.15, // computeAtsScore's own 0-100 score
  interview: 0.20, // average InterviewReport.overallScore across the student's sessions
  certifications: 0.05, // count-based, capped -- see scoreCertifications below
};

// Capped, not linear-forever -- 5+ certificates already demonstrates real breadth; beyond that
// adds nothing further to a readiness signal. A display/scoring convenience, not a claim that 5
// is a meaningful real-world threshold.
function scoreCertifications(count) {
  return Math.min(100, count * 20);
}

// Returns null only when the student itself doesn't exist (computeStudentPerformance's own
// not-found signal) -- a student with zero activity on every other signal still gets a real
// response, just with overallScore: null and dataCompleteness showing 0 of N, rather than a 500
// or a misleadingly confident number built from nothing.
async function computePlacementReadiness(studentId) {
  const [performance, resume, interviewReports, certificateCount] = await Promise.all([
    computeStudentPerformance(studentId),
    prisma.resume.findUnique({ where: { studentId } }),
    prisma.interviewReport.findMany({ where: { studentId }, select: { overallScore: true } }),
    prisma.certificate.count({ where: { studentId, status: "VALID" } }),
  ]);
  if (!performance) return null;

  const codingScore = performance.analytics.codingVsMcq.coding.percentage;
  const aptitudeScore = performance.analytics.codingVsMcq.mcq.percentage;
  const academicScore = performance.summary.overallPercentage;
  // A Resume ROW existing is not the same as a resume with actual content -- the Resume Builder
  // creates an empty shell the first time a student opens it, before they've typed anything.
  // Confirmed live: without this check, that empty shell scored a genuine 0% (every ATS section
  // legitimately empty) and dragged down the weighted average exactly like a real, badly-written
  // resume would -- indistinguishable from "hasn't started this yet," which is the same
  // data-completeness gap every other component already excludes rather than penalizes.
  const hasResumeContent = !!(resume && (resume.fullName || resume.summary || resume.skills?.length || resume.experience?.length || resume.projects?.length));
  const resumeScore = hasResumeContent ? computeAtsScore(resume).score : null;
  const interviewScore = interviewReports.length
    ? Math.round(interviewReports.reduce((sum, r) => sum + r.overallScore, 0) / interviewReports.length)
    : null;
  const certScore = scoreCertifications(certificateCount);

  const components = [
    { key: "coding", label: "Coding", weight: WEIGHTS.coding, score: codingScore, dataPoints: performance.summary.totalCodingAttempted },
    { key: "aptitude", label: "Aptitude (test MCQs)", weight: WEIGHTS.aptitude, score: aptitudeScore, dataPoints: performance.summary.totalMcqAttempted },
    { key: "academic", label: "Academic (formal tests)", weight: WEIGHTS.academic, score: academicScore, dataPoints: performance.summary.totalTestsCompleted },
    { key: "resume", label: "Resume / ATS", weight: WEIGHTS.resume, score: resumeScore, dataPoints: hasResumeContent ? 1 : 0 },
    { key: "interview", label: "Mock Interviews", weight: WEIGHTS.interview, score: interviewScore, dataPoints: interviewReports.length },
    { key: "certifications", label: "Certifications", weight: WEIGHTS.certifications, score: certScore, dataPoints: certificateCount },
  ];

  // A component with zero data (no resume saved yet, no interview taken yet) is excluded from the
  // weighted average and its weight redistributed proportionally across the rest -- scoring it as
  // 0 would punish a student for not having tried a feature yet, which is a data-completeness gap,
  // not a real readiness signal.
  const available = components.filter((c) => c.score !== null && c.dataPoints > 0);
  const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
  const overallScore = totalWeight > 0
    ? Math.round(available.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight)
    : null;

  return {
    overallScore,
    disclaimer: "An internal readiness indicator only -- not a guaranteed placement outcome or prediction.",
    components: components.map((c) => ({ ...c, included: c.score !== null && c.dataPoints > 0 })),
    dataCompleteness: `${available.length} of ${components.length} signals available`,
  };
}

module.exports = { computePlacementReadiness };
