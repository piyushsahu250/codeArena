const prisma = require("../prisma");
const { COMPANIES } = require("./companies");
const { generateQuestionDrafts } = require("./interviewDraftGenerator");
const { logAudit, AUDIT_ACTIONS } = require("./auditLog");

// Opt-in, off-by-default scheduled top-up for the AI-Powered Auto-Updating Mock Interview System.
// This is the ONLY part of that system that makes unattended, recurring, billed Gemini API calls —
// everything else (the admin "Generate" button in InterviewDraftReview.jsx) only spends money when
// a human explicitly clicks it. Disabled unless ENABLE_AI_AUTO_REFRESH="true" is set in the
// environment; a fresh/default deploy makes zero calls from this file, ever.
//
// Every question this produces lands as an InterviewQuestionDraft with status PENDING — exactly
// the same generateQuestionDrafts() the admin-triggered route uses (backend/src/routes/
// interviewDrafts.js), so there is exactly one implementation of "what we ask Gemini for." Nothing
// this scheduler creates is ever auto-approved; a human still has to review it in the drafts queue
// before it can reach a student.

const CATEGORIES = ["HR", "TECHNICAL", "CODING", "APTITUDE", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];

async function runOnce() {
  const minPool = Math.max(1, Number(process.env.AI_AUTO_REFRESH_MIN_POOL) || 5);
  const maxCalls = Math.max(1, Number(process.env.AI_AUTO_REFRESH_MAX_CALLS_PER_RUN) || 10);
  const sourceRun = `auto-${new Date().toISOString()}`;

  let callsMade = 0;
  const combosTopped = [];
  let draftsCreated = 0;

  companyLoop: for (const company of COMPANIES) {
    for (const category of CATEGORIES) {
      if (callsMade >= maxCalls) break companyLoop;

      const activeCount = await prisma.interviewQuestion.count({ where: { company, category, isActive: true } });
      if (activeCount >= minPool) continue;

      // Counted against the cap the moment we're about to make the (billed) call — not only on
      // success. The Gemini call bills the HTTP request before it ever gets to parse the response,
      // so a run of malformed-JSON or other post-call failures must still consume the budget,
      // otherwise a systematic failure mode could make far more real API calls than maxCalls
      // documents as the worst-case bound per run.
      callsMade += 1;
      try {
        const rows = await generateQuestionDrafts({ category, company, count: minPool - activeCount, sourceRun });
        draftsCreated += rows.length;
        combosTopped.push(`${company}/${category}`);
      } catch (err) {
        // A single company/category failing (rate limit, transient API error) must not abort the
        // whole run — log and move on, same "best-effort side channel" posture as logAudit itself.
        console.error(`AI auto-refresh: failed to generate drafts for ${company}/${category}:`, err.message);
      }
    }
  }

  await logAudit({
    action: AUDIT_ACTIONS.AI_AUTO_REFRESH_RUN,
    details: { sourceRun, combosTopped, draftsCreated, callsMade, minPool, maxCalls },
  });

  return { sourceRun, combosTopped, draftsCreated, callsMade };
}

// Called once from index.js at boot. Deliberately does NOT run immediately on startup — only on
// the interval boundary — so enabling this flag doesn't trigger a burst of API calls on every
// container restart/redeploy; the first run happens intervalMs after the process comes up.
function startAiRefreshScheduler() {
  if (process.env.ENABLE_AI_AUTO_REFRESH !== "true") return;

  const intervalMs = Math.max(60 * 1000, Number(process.env.AI_AUTO_REFRESH_INTERVAL_MS) || 24 * 60 * 60 * 1000);
  console.log(`AI auto-refresh scheduler enabled — running every ${intervalMs}ms, next run in ${intervalMs}ms.`);
  setInterval(() => {
    runOnce().catch((err) => console.error("AI auto-refresh run failed:", err));
  }, intervalMs);
}

module.exports = { startAiRefreshScheduler, runOnce };
