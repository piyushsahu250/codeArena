// READ-ONLY dry-run evidence report for module coding attempts that are still IN_PROGRESS past their deadline. Writes nothing and grades nothing.
// For each attempt: who, which assessment, timeline, the evidence of saved work per question, whether the student has since moved on, and a proposed action.
// Any action that changes marks, module access, eligibility or certificates needs explicit approval (see docs/STUCK_ATTEMPTS_REPORT.md).
//   node scripts/reportStuckModuleCoding.js [--json=/tmp/stuck-module-coding.json]
const fs = require("fs");
const prisma = require("../src/prisma");
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const maskEmail = (e) => (e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : "-");

(async () => {
  const now = Date.now();
  const attempts = await prisma.moduleCodingAttempt.findMany({
    where: { status: "IN_PROGRESS" },
    orderBy: { startedAt: "asc" },
    include: {
      student: { select: { id: true, name: true, email: true, instituteId: true, institute: { select: { name: true } } } },
      moduleCodingTest: { select: { id: true, timeLimitMin: true, passingPercent: true, isActive: true, allowResume: true, module: { select: { id: true, title: true, courseId: true } }, chapter: { select: { title: true } } } },
      questions: { select: { questionId: true, order: true } },
      submissions: { select: { questionId: true, language: true, code: true, verdict: true, passedCases: true, totalCases: true, score: true, createdAt: true, updatedAt: true } },
      violations: { select: { type: true, createdAt: true } },
    },
  });
  const rows = [];
  for (const a of attempts) {
    const limit = a.moduleCodingTest?.timeLimitMin || 45;
    const deadline = a.startedAt.getTime() + limit * 60000;
    if (now <= deadline) continue; // still inside its window: not stuck
    const subs = a.submissions;
    const graded = subs.filter((s) => s.verdict !== "PENDING");
    const pending = subs.filter((s) => s.verdict === "PENDING" && s.code && s.code.trim().length > 0);
    const lastActivity = [a.startedAt, ...subs.map((s) => s.updatedAt), ...a.violations.map((v) => v.createdAt)].reduce((m, d) => (d > m ? d : m));
    const lastLogin = await prisma.loginSession.findFirst({ where: { userId: a.studentId }, orderBy: { loginAt: "desc" }, select: { loginAt: true } });
    const otherAttempts = await prisma.moduleCodingAttempt.findMany({ where: { moduleCodingTestId: a.moduleCodingTestId, studentId: a.studentId, id: { not: a.id } }, select: { attemptNumber: true, status: true, passed: true, score: true, startedAt: true } });
    const passedElsewhere = otherAttempts.some((o) => o.passed);
    const movedOn = otherAttempts.some((o) => o.status !== "IN_PROGRESS" && o.startedAt > a.startedAt);
    let evidence, proposal;
    if (subs.length === 0) { evidence = "NO_SAVED_WORK"; proposal = "Close as expired with score 0 (nothing to evaluate). Needs approval: it records a failed attempt."; }
    else if (pending.length > 0) { evidence = "SAVED_CODE_NOT_YET_EVALUATED"; proposal = "Evaluate the saved code with the original assessment rules (the same grading a late finalize applies), then record the result. Needs approval: it sets marks and may pass the student."; }
    else if (graded.length > 0) { evidence = "ALL_SAVED_WORK_ALREADY_EVALUATED"; proposal = "Only the final tally is missing: total the already-evaluated submissions and close the attempt. Needs approval: it sets marks."; }
    else { evidence = "SAVED_BUT_EMPTY"; proposal = "Close as expired with score 0. Needs approval."; }
    if (passedElsewhere) proposal = "SUPERSEDED: the student already passed this assessment in another attempt. Close this attempt without changing their pass. Needs approval.";
    else if (movedOn) proposal = "SUPERSEDED: the student has a later finished attempt. Close this one as expired; do not re-grade. Needs approval.";
    rows.push({
      attemptId: a.id, student: `${a.student.name} <${maskEmail(a.student.email)}>`, institute: a.student.institute?.name || "-",
      assessment: `${a.moduleCodingTest?.module?.title || a.moduleCodingTest?.chapter?.title || "?"} (test ${a.moduleCodingTestId.slice(0, 8)}, pass ${a.moduleCodingTest?.passingPercent}%)`,
      attemptNo: a.attemptNumber, status: a.status, startedAt: a.startedAt.toISOString(), deadline: new Date(deadline).toISOString(),
      overdueDays: Math.round((now - deadline) / 864e5 * 10) / 10, lastActivity: lastActivity.toISOString(),
      studentLastLogin: lastLogin ? lastLogin.loginAt.toISOString() : null, loggedInAfterDeadline: lastLogin ? lastLogin.loginAt.getTime() > deadline : null,
      questions: a.questions.length, savedAnswers: subs.length, evaluated: graded.length, savedNotEvaluated: pending.length,
      proctoringEvents: a.violations.length, otherAttempts: otherAttempts.map((o) => `#${o.attemptNumber} ${o.status}${o.passed ? " PASSED" : ""}`).join(", ") || "none",
      perQuestion: subs.map((s) => ({ language: s.language, codeChars: (s.code || "").length, verdict: s.verdict, cases: `${s.passedCases}/${s.totalCases}`, savedAt: s.updatedAt.toISOString() })),
      evidence, proposal,
    });
  }
  console.log(`module coding attempts in progress past their deadline: ${rows.length}`);
  const by = {}; for (const r of rows) by[r.evidence] = (by[r.evidence] || 0) + 1;
  console.log("by evidence:", JSON.stringify(by));
  console.log("\nWhy they are stuck: these attempts were never finalized by the student's browser. Module coding attempts are only closed (a) by the student's own finalize call, (b) lazily when the student restarts that assessment, or (c) since 2026-10-09 by a sweep limited to the last 48 hours. There is no persistent judge queue to lose a job: grading runs inside the finalize request, and an unevaluated saved answer shows verdict PENDING. A judge failure would show verdicts such as RUNTIME_ERROR or COMPILE_ERROR on saved answers, not PENDING.\n");
  for (const r of rows) {
    console.log(`${r.attemptId.slice(0, 8)}  ${r.student}  ${r.institute}\n   ${r.assessment}  attempt #${r.attemptNo}\n   started ${r.startedAt.slice(0, 16)}  deadline ${r.deadline.slice(0, 16)}  overdue ${r.overdueDays} d  last activity ${r.lastActivity.slice(0, 16)}  student last login ${r.studentLastLogin ? r.studentLastLogin.slice(0, 10) : "-"}${r.loggedInAfterDeadline ? " (after the deadline)" : ""}\n   questions ${r.questions}, saved ${r.savedAnswers}, evaluated ${r.evaluated}, saved-not-evaluated ${r.savedNotEvaluated}, proctoring events ${r.proctoringEvents}, other attempts: ${r.otherAttempts}\n   evidence: ${r.evidence}\n   proposal: ${r.proposal}\n`);
  }
  const out = arg("json", "");
  if (out) { fs.writeFileSync(out, JSON.stringify(rows, null, 2)); console.log(`wrote ${out}`); }
  console.log("READ ONLY: nothing was graded or changed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
