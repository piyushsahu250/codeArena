// READ-ONLY dry-run classification of mock/company/resume interview sessions and AI voice interview sessions that are still open past their deadline.
// Writes nothing, finalizes nothing, calls no AI. Classes: ACTIVE, COMPLETED_NOT_FINALIZED, INTERRUPTED, FAILED, ABANDONED, EXPIRED, UNKNOWN.
//   node scripts/reportStaleInterviews.js [--json=/tmp/stale-interviews.json]
const fs = require("fs");
const prisma = require("../src/prisma");
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const days = (ms) => Math.round(ms / 864e5 * 10) / 10;

(async () => {
  const now = Date.now();
  const out = { sessions: [], ai: [] };

  const sessions = await prisma.interviewSession.findMany({
    where: { status: "IN_PROGRESS" },
    include: { answers: { select: { skipped: true, answerText: true, code: true, createdAt: true, updatedAt: true } }, report: { select: { id: true } }, violations: { select: { id: true } }, student: { select: { name: true, instituteId: true } } },
    orderBy: { startedAt: "asc" },
  });
  const counts = {};
  for (const s of sessions) {
    const dur = Number(s.config?.durationMin) || 60;
    const deadline = s.startedAt.getTime() + dur * 60000;
    const real = s.answers.filter((a) => a.skipped === false);
    const total = s.answers.length;
    const lastAct = [s.startedAt, ...s.answers.map((a) => a.updatedAt || a.createdAt)].reduce((m, d) => (d > m ? d : m));
    let cls, why;
    if (s.submittedAt) { cls = "FAILED"; why = "submittedAt is set but the status never left IN_PROGRESS (finalize started and did not complete)"; }
    else if (now <= deadline) { cls = "ACTIVE"; why = "still inside its time limit"; }
    else if (total > 0 && real.length === total) { cls = "COMPLETED_NOT_FINALIZED"; why = "every question has a real answer but no report was generated"; }
    else if (real.length > 0) { cls = "INTERRUPTED"; why = `${real.length} of ${total} questions answered, then the student stopped`; }
    else if (total > 0) { cls = "ABANDONED"; why = "opened but not one question was answered"; }
    else { cls = "UNKNOWN"; why = "no answer rows at all"; }
    counts[cls] = (counts[cls] || 0) + 1;
    out.sessions.push({ id: s.id, type: s.isMock ? "MOCK" : s.isCompanyRound ? "COMPANY_ROUND" : s.isResumeBased ? "RESUME_BASED" : s.category || "OTHER", class: cls, why, answered: real.length, of: total, hasReport: !!s.report, violations: s.violations.length, startedAt: s.startedAt.toISOString(), overdueDays: days(now - deadline), lastActivity: lastAct.toISOString(), hasWork: real.some((a) => (a.answerText && a.answerText.trim()) || (a.code && a.code.trim())) });
  }
  console.log(`mock-style interview sessions open past their deadline: ${sessions.length}`);
  console.log("by class:", JSON.stringify(counts));
  const byType = {}; for (const r of out.sessions) { const k = `${r.type}/${r.class}`; byType[k] = (byType[k] || 0) + 1; }
  console.log("by type/class:", JSON.stringify(byType));
  const ages = out.sessions.map((r) => r.overdueDays).sort((a, b) => a - b);
  console.log(`overdue days: min ${ages[0]}, median ${ages[Math.floor(ages.length / 2)]}, max ${ages[ages.length - 1]}`);
  console.log("recoverable results (interrupted or complete with real answers):", out.sessions.filter((r) => ["COMPLETED_NOT_FINALIZED", "INTERRUPTED"].includes(r.class) && r.hasWork).length);
  console.table(out.sessions.filter((r) => ["COMPLETED_NOT_FINALIZED", "INTERRUPTED", "FAILED", "UNKNOWN"].includes(r.class)).slice(0, 40).map((r) => ({ id: r.id.slice(0, 8), type: r.type, class: r.class, answered: `${r.answered}/${r.of}`, overdueDays: r.overdueDays, lastActivity: r.lastActivity.slice(0, 10) })));

  const ai = await prisma.aiInterviewSession.findMany({
    where: { status: { in: ["CREATED", "INTRODUCTION", "QUESTIONING", "FOLLOW_UP", "DEEP_DIVE", "SKILL_TRANSITION", "FINAL_QUESTION", "COMPLETED", "EVALUATING"] } },
    include: { turns: { select: { answerText: true, answeredAt: true, skipped: true, evaluation: true } }, report: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const s of ai) {
    const answered = s.turns.filter((t) => t.answeredAt || (t.answerText && t.answerText.trim()));
    const evaluated = s.turns.filter((t) => t.evaluation);
    const expired = s.expiresAt ? now > s.expiresAt.getTime() : now - s.createdAt.getTime() > 24 * 3600 * 1000;
    let cls, why;
    if (s.report) continue; // already has a report: not stale
    if (s.status === "CREATED" || s.status === "INTRODUCTION") { if (!expired) continue; cls = "ABANDONED"; why = "never moved past the introduction"; }
    else if (!expired) continue;
    else if (s.status === "COMPLETED" || s.status === "EVALUATING") { cls = "COMPLETED_NOT_FINALIZED"; why = `marked ${s.status} but no report exists`; }
    else if (answered.length > 0) { cls = "INTERRUPTED"; why = `${answered.length} answered turn(s) (${evaluated.length} evaluated), then the connection ended`; }
    else { cls = "EXPIRED"; why = "past its expiry with no answered turns"; }
    out.ai.push({ id: s.id, status: s.status, class: cls, why, turns: s.turns.length, answered: answered.length, evaluated: evaluated.length, interviewType: s.interviewType, voice: s.voiceEnabled, startedAt: s.startedAt ? s.startedAt.toISOString() : null, expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null, overdueDays: s.expiresAt ? days(now - s.expiresAt.getTime()) : null, termination: s.terminationReason });
  }
  console.log(`\nAI voice interview sessions open past expiry without a report: ${out.ai.length}`);
  console.table(out.ai.map((r) => ({ id: r.id.slice(0, 8), status: r.status, class: r.class, turns: r.turns, answered: r.answered, evaluated: r.evaluated, type: r.interviewType, voice: r.voice, overdueDays: r.overdueDays })));
  for (const r of out.ai) console.log(`  ${r.id.slice(0, 8)}: ${r.why}`);

  console.log("\nNotes: no recordings are stored (the platform has no object storage for interviews); transcripts are the answer text on each turn. Finalizing an AI session triggers AI evaluation, which uses quota. This report calls no AI.");
  const f = arg("json", "");
  if (f) { fs.writeFileSync(f, JSON.stringify(out, null, 2)); console.log(`wrote ${f}`); }
  console.log("READ ONLY: nothing was finalized, deleted or changed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
