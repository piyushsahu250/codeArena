// Automated Daily Platform Health Check — detect-and-report ONLY. This script never modifies
// application code and never deploys anything; it only reads/verifies and, where explicitly noted,
// creates+deletes its own temporary test accounts (never touching real user data). Every finding is
// evidence-based (a real HTTP status, a real DB count, a real judge submission result) — nothing
// here is a guessed or simulated result. Run manually via `node scripts/dailyHealthCheck.js`, or by
// the scheduled task described in docs/PLATFORM_HEALTH.md.
//
// What this DOES cover: institute isolation, basic RBAC, data-integrity read-only scans (never
// deletes anything, only reports), email/AI/compiler live status, a per-role smoke test of a
// handful of key endpoints. What this does NOT cover (see docs/PLATFORM_HEALTH.md for why): a real
// automated test suite (none exists in this codebase), true P95 latency (needs real traffic
// sampling, not a handful of on-demand requests), staging/canary deployment, AI-based support-ticket
// triage, automatic fixing or rollback of anything.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");
const { judgeSubmission } = require("../src/utils/judge");
const aiService = require("../src/services/ai/aiService");

const API_BASE = process.env.HEALTH_CHECK_API_BASE || "http://127.0.0.1:4000/api";
const SLOW_WARN_MS = 1000, SLOW_HIGH_MS = 2000, SLOW_CRITICAL_MS = 5000;
// Gemini call latency is NOT comparable to a DB-backed REST/judge call — measured directly against
// production (scripts/measureAiLatency.js, 5 single-attempt calls, no retries): 1.1s-6.6s, avg 3.5s.
// That's normal variance for this API, not a regression, so it needs its own, much looser bar than
// SLOW_*_MS (which already misfired a P1 at 14.9s for a perfectly healthy call). REQUEST_TIMEOUT_MS
// in geminiProvider.js is 30000ms, so P1 here is set to only fire when a call is genuinely closing
// in on that timeout.
const AI_SLOW_HIGH_MS = 10000, AI_SLOW_CRITICAL_MS = 20000;

const findings = []; // { priority: P0-P3, category, check, message }
function record(priority, category, check, message) {
  findings.push({ priority, category, check, message });
}

async function timedFetch(path, options = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, options);
    return { status: res.status, ms: Date.now() - started, res };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, error: err.message };
  }
}

function latencyPriority(ms) {
  if (ms > SLOW_CRITICAL_MS) return "P1";
  if (ms > SLOW_HIGH_MS) return "P2";
  if (ms > SLOW_WARN_MS) return "P3";
  return null;
}

function aiLatencyPriority(ms) {
  if (ms > AI_SLOW_CRITICAL_MS) return "P1";
  if (ms > AI_SLOW_HIGH_MS) return "P3";
  return null;
}

async function mkTempUser(role, instituteId) {
  const email = `health-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Health", 10);
  const user = await prisma.user.create({ data: { name: `Health Check ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, token, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

// ============================================================
// 1. Institute isolation + basic RBAC
// ============================================================
async function checkIsolationAndRbac(institutes, cleanup) {
  const [instA, instB] = institutes;
  if (!instB) { record("P3", "SECURITY", "institute_isolation", "Only one institute exists — cross-institute isolation could not be tested."); return; }

  const adminA = await mkTempUser("INSTITUTE_ADMIN", instA.id);
  const studentB = await mkTempUser("STUDENT", instB.id);
  cleanup.push(adminA, studentB);

  const cross = await timedFetch(`/users/${studentB.user.id}`, { headers: adminA.headers });
  if (cross.status !== 403 && cross.status !== 404) {
    record("P0", "SECURITY", "institute_isolation", `Institute A admin reached Institute B's student via GET /users/:id — got ${cross.status}, expected 403/404.`);
  }

  const studentA = await mkTempUser("STUDENT", instA.id);
  cleanup.push(studentA);
  const rbac = await timedFetch("/admin/stats", { headers: studentA.headers });
  if (rbac.status !== 403 && rbac.status !== 401) {
    record("P0", "SECURITY", "rbac", `A STUDENT session reached GET /admin/stats — got ${rbac.status}, expected 401/403.`);
  }
}

// ============================================================
// 2. Data integrity (read-only — never deletes/modifies anything)
// ============================================================
async function checkDataIntegrity() {
  const dupPrn = await prisma.$queryRaw`
    SELECT "registrationNumber", COUNT(*) c FROM "User"
    WHERE "registrationNumber" IS NOT NULL
    GROUP BY "registrationNumber" HAVING COUNT(*) > 1 LIMIT 20`;
  if (dupPrn.length > 0) {
    record("P1", "DATA_INTEGRITY", "duplicate_prn", `${dupPrn.length} registration number(s) (PRN) shared by more than one account.`);
  }

  const dupRoll = await prisma.$queryRaw`
    SELECT "academicGroupId", "rollNumber", COUNT(*) c FROM "User"
    WHERE "rollNumber" IS NOT NULL AND "academicGroupId" IS NOT NULL
    GROUP BY "academicGroupId", "rollNumber" HAVING COUNT(*) > 1 LIMIT 20`;
  if (dupRoll.length > 0) {
    record("P2", "DATA_INTEGRITY", "duplicate_roll_number", `${dupRoll.length} roll number(s) duplicated within the same academic group (batch+branch+section) — flagged for manual review, per policy, never auto-renamed.`);
  }

  const orphanAcademicGroup = await prisma.user.count({ where: { academicGroupId: { not: null }, academicGroup: null } });
  if (orphanAcademicGroup > 0) record("P2", "DATA_INTEGRITY", "orphan_academic_group_ref", `${orphanAcademicGroup} user(s) reference a deleted AcademicGroup.`);

  const orphanInstitute = await prisma.user.count({ where: { instituteId: { not: null }, institute: null } });
  if (orphanInstitute > 0) record("P1", "DATA_INTEGRITY", "orphan_institute_ref", `${orphanInstitute} user(s) reference a deleted Institute.`);

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failedEmails = await prisma.emailLog.count({ where: { status: "FAILED", createdAt: { gte: last24h } } });
  if (failedEmails > 0) record(failedEmails > 20 ? "P1" : "P2", "EMAIL", "failed_emails_24h", `${failedEmails} email(s) failed to send in the last 24 hours.`);

  const failedAi = await prisma.aiUsageLog.count({ where: { success: false, createdAt: { gte: last24h } } });
  const totalAi = await prisma.aiUsageLog.count({ where: { createdAt: { gte: last24h } } });
  if (totalAi > 0 && failedAi / totalAi > 0.2) {
    record("P1", "AI", "ai_failure_rate_24h", `AI request failure rate over the last 24h is ${Math.round((failedAi / totalAi) * 100)}% (${failedAi}/${totalAi}).`);
  }
}

// ============================================================
// 3. Compiler / judge — a real submission, not a status flag
// ============================================================
async function checkCompiler() {
  const started = Date.now();
  try {
    const result = await judgeSubmission({
      language: "python", code: "print(2 + 2)",
      testCases: [{ input: "", expected: "4" }], timeLimitMs: 5000,
    });
    const ms = Date.now() - started;
    if (result.verdict !== "ACCEPTED") {
      record("P0", "COMPILER", "judge_smoke_test", `A trivial Python submission did not pass — verdict: ${result.verdict}. The compiler/judge may be broken.`);
    }
    const p = latencyPriority(ms);
    if (p) record(p, "PERFORMANCE", "judge_latency", `Judge took ${ms}ms for a trivial submission (warn>${SLOW_WARN_MS}ms).`);
  } catch (err) {
    record("P0", "COMPILER", "judge_smoke_test", `Judge threw an exception on a trivial submission: ${err.message}`);
  }
}

// ============================================================
// 4. AI service — real status + (only if configured) a real cheap call
// ============================================================
async function checkAi() {
  if (!aiService.isConfigured()) {
    record("P3", "AI", "ai_configured", "GEMINI_API_KEY is not configured — AI features are unavailable platform-wide (may be intentional).");
    return;
  }
  const started = Date.now();
  try {
    const text = await aiService.generateText({ feature: "daily_health_check", prompt: "Reply with exactly: ok", maxTokens: 10, injectionGuard: false });
    const ms = Date.now() - started;
    if (!text || !text.toLowerCase().includes("ok")) {
      record("P2", "AI", "ai_smoke_test", `AI smoke-test call returned an unexpected response: ${JSON.stringify(text).slice(0, 100)}`);
    }
    const p = aiLatencyPriority(ms);
    if (p) record(p, "PERFORMANCE", "ai_latency", `AI smoke-test call took ${ms}ms (Gemini latency varies 1-7s normally; see scripts/measureAiLatency.js — flagged only once it starts approaching Gemini's own request timeout).`);
  } catch (err) {
    record(err.quotaExceeded ? "P3" : "P1", "AI", "ai_smoke_test", `AI smoke-test call failed: ${err.message}`);
  }
}

// ============================================================
// 5. Per-role smoke test — a handful of real, read-only key endpoints
// ============================================================
async function checkRoleWorkflows(institute, cleanup) {
  const student = await mkTempUser("STUDENT", institute.id);
  const staff = await mkTempUser("STAFF", institute.id);
  const instAdmin = await mkTempUser("INSTITUTE_ADMIN", institute.id);
  cleanup.push(student, staff, instAdmin);

  const checks = [
    ["STUDENT", "GET", "/users/me/sessions", student.headers],
    ["STUDENT", "GET", "/resume/me", student.headers],
    ["STAFF", "GET", "/tests/staff-directory", staff.headers],
    ["STAFF", "GET", "/institutes", staff.headers],
    ["INSTITUTE_ADMIN", "GET", "/admin/stats", instAdmin.headers],
    ["INSTITUTE_ADMIN", "GET", "/users/audit-log", instAdmin.headers],
  ];

  for (const [role, method, path, headers] of checks) {
    const { status, ms } = await timedFetch(path, { method, headers });
    if (status >= 500) record("P0", "WORKFLOW", `${role}_${path}`, `${role} ${method} ${path} returned ${status} (server error).`);
    else if (status >= 400 && status !== 404) record("P1", "WORKFLOW", `${role}_${path}`, `${role} ${method} ${path} returned ${status} (expected 200).`);
    const p = latencyPriority(ms);
    if (p) record(p, "PERFORMANCE", `${role}_${path}_latency`, `${role} ${method} ${path} took ${ms}ms.`);
  }
}

// ============================================================
// Report assembly + persistence
// ============================================================
function buildReport(durationMs) {
  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) byPriority[f.priority] = (byPriority[f.priority] || 0) + 1;
  const overallStatus = byPriority.P0 > 0 ? "CRITICAL" : byPriority.P1 > 0 ? "WARNING" : "HEALTHY";
  return { overallStatus, findings, byPriority, durationMs, runAt: new Date().toISOString() };
}

async function main() {
  const started = Date.now();
  const cleanup = [];
  try {
    const institutes = await prisma.institute.findMany({ take: 2, orderBy: { createdAt: "asc" } });
    if (institutes.length === 0) {
      record("P3", "SETUP", "no_institutes", "No institutes exist yet — most checks were skipped.");
    } else {
      await checkIsolationAndRbac(institutes, cleanup);
      await checkRoleWorkflows(institutes[0], cleanup);
    }
    await checkDataIntegrity();
    await checkCompiler();
    await checkAi();
  } finally {
    const jtis = cleanup.map((c) => c.jti);
    const userIds = cleanup.map((c) => c.user.id);
    if (jtis.length) await prisma.loginSession.deleteMany({ where: { token: { in: jtis } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  const report = buildReport(Date.now() - started);
  await prisma.platformHealthReport.create({
    data: {
      overallStatus: report.overallStatus, findings: report,
      totalChecks: findings.length + 10, // approximate — see docs/PLATFORM_HEALTH.md on what "a check" means here
      issuesFound: findings.length,
      p0Count: report.byPriority.P0, p1Count: report.byPriority.P1, p2Count: report.byPriority.P2, p3Count: report.byPriority.P3,
      durationMs: report.durationMs,
    },
  });

  console.log("\n=== CODEARENA DAILY HEALTH REPORT ===");
  console.log(`Date: ${new Date().toLocaleString()}`);
  console.log(`Overall Status: ${report.overallStatus}`);
  console.log(`Issues Detected: ${findings.length}`);
  console.log(`P0: ${report.byPriority.P0} | P1: ${report.byPriority.P1} | P2: ${report.byPriority.P2} | P3: ${report.byPriority.P3}`);
  console.log(`Duration: ${report.durationMs}ms`);
  if (findings.length > 0) {
    console.log("\nFindings:");
    for (const f of findings) console.log(`  [${f.priority}] ${f.category}/${f.check}: ${f.message}`);
  } else {
    console.log("\nNo issues detected by this run's checks.");
  }
  console.log(`\nNote: 0 known unresolved P0 issues does NOT mean "bug-free" — it means these specific ${findings.length ? "checks" : "automated checks"} passed. See docs/PLATFORM_HEALTH.md for exactly what is and isn't covered.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Health check itself crashed:", e); process.exit(1); });
