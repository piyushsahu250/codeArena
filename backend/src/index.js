require("dotenv").config();
// Global safety net, not a substitute for excluding internal-only fields (like Submission/
// ModuleCodingSubmission.codeSavedSeq) from client-facing responses at the route level — Express's
// res.json() throws "Do not know how to serialize a BigInt" on any raw BigInt value, which would
// 500 an otherwise-successful request over a field the client never needed. Confirmed root cause
// of a real production bug (2026-08-27): codeSavedSeq was declared Int (32-bit) while every
// caller always sent Date.now() (~1.7 trillion, 13 digits), overflowing on every autosave write;
// fixed by widening it to BigInt, which makes this polyfill necessary wherever a query forgets to
// strip it. Any BigInt column added in the future degrades to a JSON string instead of crashing.
BigInt.prototype.toJSON = function () { return this.toString(); };
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { timingMiddleware, recordProcessError } = require("./utils/metrics");
const logger = require("./utils/logger");
const aiService = require("./services/ai/aiService");
const questionImages = require("./utils/questionImages");
const { getClientIp } = require("./utils/clientIp");
const prisma = require("./prisma");

const authRoutes = require("./routes/auth");
const testRoutes = require("./routes/tests");
const questionRoutes = require("./routes/questions");
const submissionRoutes = require("./routes/submissions");
const userRoutes = require("./routes/users");
const classRoutes = require("./routes/classes");
const academicGroupRoutes = require("./routes/academicGroups");
const instituteRoutes = require("./routes/institutes");
const adminRoutes = require("./routes/admin");
const learningRoutes = require("./routes/learning");
const dashboardRoutes = require("./routes/dashboard");
const gamificationRoutes = require("./routes/gamification");
const resumeRoutes = require("./routes/resume");
const interviewRoutes = require("./routes/interview");
const aiInterviewRoutes = require("./routes/aiInterview");
const moduleCodingRoutes = require("./routes/moduleCoding");
const searchRoutes = require("./routes/search");
const certificateRoutes = require("./routes/certificates");
const backupRoutes = require("./routes/backup");
const exportRoutes = require("./routes/exports");
const aiQuestionRoutes = require("./routes/aiQuestions");
const challengeRoutes = require("./routes/challenges");
const interviewDraftRoutes = require("./routes/interviewDrafts");
const companyQuestionRoutes = require("./routes/companyQuestions");
const attendanceRoutes = require("./routes/attendance");
const profileRoutes = require("./routes/profile");
const companyRoutes = require("./routes/companies");
const placementOfferRoutes = require("./routes/placementOffers");
const studentDocumentRoutes = require("./routes/studentDocuments");
const talentPoolRoutes = require("./routes/talentPools");
const notificationRoutes = require("./routes/notifications");
const resultManagementRoutes = require("./routes/resultManagement");
const staffClerkRoutes = require("./routes/staffClerk");
const readinessRoutes = require("./routes/readiness");
const featureRoutes = require("./routes/features");
const subjectRoutes = require("./routes/subjects");
const issueReportRoutes = require("./routes/issueReports");
const platformHealthRoutes = require("./routes/platformHealth");

const app = express();
// Number of reverse-proxy hops in front of this service — MUST match the real topology exactly,
// not be "safely" set too high. Express/proxy-addr walks back exactly this many entries from the
// end of X-Forwarded-For and trusts whatever is left as req.ip; if this is set HIGHER than the
// real hop count, the extra trusted "hop" is whatever the client itself put in X-Forwarded-For —
// i.e. a raw, unauthenticated attacker-controlled value. Confirmed directly against this exact
// runtime (proxy-addr via a throwaway Express instance): with trust=2 and an inbound request
// carrying `X-Forwarded-For: 1.2.3.4, 203.0.113.99` (203.0.113.99 being nginx's own, correct view
// of the real client), req.ip resolved to "1.2.3.4" — the attacker's own spoofed value — silently
// defeating every IP-keyed control: the global/login/forgot-password rate limiters, and the IP
// recorded on AuditLog/LoginSession rows.
//
// This value was `2`, carried over from an earlier Render+Cloudflare deployment (Cloudflare edge
// + Render's own internal load balancer = 2 real hops back then). Current production topology
// (see docs/DEPLOYMENT.md) is Browser -> nginx (EC2 host, TLS termination) -> this Node process —
// exactly ONE real hop today, so trust proxy must be 1, not 2, until that topology changes again
// (e.g. if CloudFront is ever placed in front of nginx, making it 2 real hops once more — this is
// now env-driven specifically so that a future topology change is a config/redeploy, not a
// code change someone has to remember to make).
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.use(helmet());
app.use(compression());
// Scoped to the known frontend origin(s) rather than reflecting any caller — same FRONTEND_URL
// env var already used platform-wide for building email/certificate links (auth.js, users.js,
// mailer.js, etc.), so no new config surface. Local Vite dev ports are always allowed since this
// list only ever governs a browser's CORS preflight, not authentication itself (auth is a Bearer
// token the frontend attaches explicitly, never an ambient cookie, so this is defense in depth
// rather than the actual access boundary). Requests with no Origin header (curl, server-to-server,
// mobile) are unaffected — CORS only applies to browser-issued cross-origin requests.
// EXTRA_ALLOWED_ORIGINS (optional, comma-separated) exists specifically for the codearena.site
// domain cutover: the old Vercel URL must keep working right up until traffic is fully verified
// on the new domain (see docs/DEPLOYMENT.md's migration notes) — a single-origin FRONTEND_URL
// can't express "allow both at once" during that window. Safe to unset once the cutover is done
// and FRONTEND_URL itself points at the new canonical domain.
const extraAllowedOrigins = (process.env.EXTRA_ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
const allowedOrigins = [
  process.env.FRONTEND_URL || "https://codearena.site",
  ...extraAllowedOrigins,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  exposedHeaders: ["Content-Disposition"],
}));
app.use(express.json({ limit: "1mb" }));
app.use(timingMiddleware);

// Structured per-request log line (JSON, one per request) — the only per-request record that
// existed before this was metrics.js's anonymous rolling-average timing window, which has no way
// to answer "what did request X do." requestId is echoed back as a response header so a student/
// admin bug report ("it broke, here's what I saw") can be correlated to the exact log line.
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const start = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.user?.id || null,
    });
  });
  next();
});

// RENDER_GIT_COMMIT is set automatically by Render on every deploy (no config needed); COMMIT_SHA
// is set the same way via Cloud Build's $SHORT_SHA substitution on Cloud Run. Exposing whichever
// is present is the only way to tell "the service is up" apart from "the service is up but running
// a stale build," since a health check with no version marker can't distinguish the two.
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "CodeArena API", commit: process.env.COMMIT_SHA || process.env.RENDER_GIT_COMMIT || null }));

// Deeper, DELIBERATELY SEPARATE from /api/health above — that one stays a fast, dependency-free
// liveness check exactly as it always was (any external uptime monitor / load balancer already
// polling it keeps getting the same instant response, unaffected by this). This one actually
// exercises each critical dependency so a real outage (DB unreachable, AI misconfigured, no email
// path at all) shows up here instead of only being discovered when a student hits it live. No
// secret VALUES are ever returned — only booleans/status strings, per the explicit "do not expose
// sensitive configuration" requirement this was built against.
app.get("/api/health/deep", async (req, res) => {
  const checks = {};

  try {
    const started = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    checks.database = { ok: false, error: "unreachable" };
  }

  checks.ai = { ok: aiService.isConfigured(), configured: aiService.isConfigured() };

  checks.questionImageStorage = { ok: true, configured: questionImages.isConfigured() }; // not configured yet is a valid, non-broken state -- feature-gated, not a failure

  const emailConfigured = !!(
    (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASSWORD) ||
    (process.env.APPS_SCRIPT_WEB_APP_URL && process.env.APPS_SCRIPT_SHARED_SECRET)
  );
  checks.email = { ok: true, configured: emailConfigured }; // same reasoning -- absence isn't this endpoint's failure to report on

  // Presence-only, never the value itself -- a missing one of these is a genuine misconfiguration
  // (auth/PII/compiler-adjacent secrets this platform cannot safely run without), unlike AI/email/
  // image-storage above, which are optional features.
  const requiredEnv = ["DATABASE_URL", "JWT_SECRET", "PII_ENCRYPTION_KEY"];
  checks.environment = {
    ok: requiredEnv.every((k) => !!process.env[k]),
    missing: requiredEnv.filter((k) => !process.env[k]),
  };

  const overallOk = Object.values(checks).every((c) => c.ok);
  res.status(overallOk ? 200 : 503).json({ status: overallOk ? "ok" : "degraded", checks, checkedAt: new Date().toISOString() });
});

// Public, boolean-only — lets any page check whether GEMINI_API_KEY is set before showing an
// AI-feature button, instead of the student clicking it and hitting a raw 503 error message.
app.get("/api/ai/status", (req, res) => res.json({ configured: aiService.isConfigured() }));

// Global floor well above any legitimate per-user traffic pattern (dashboard loads fire several
// parallel GETs; this is not meant to constrain normal use, just block runaway scripts/scraping).
// Expensive routes (judge execution, etc.) already carry their own tighter per-route limiters.
//
// Keyed by student/staff id when the request carries a valid token, falling back to IP only for
// requests that genuinely have no user yet (login, register, health check). This mirrors the
// same reasoning already documented on submissions.js's execLimiter: a single shared campus/lab
// IP (very common on Indian college networks — a whole lab or hostel block behind one NAT'd
// gateway) would otherwise share one collective budget across every student behind it. During a
// real proctored exam, dozens of students on the same lab IP each auto-saving answers would blow
// through an IP-keyed limit in minutes even though no individual student is doing anything wrong.
// This is a soft decode, not full authentication — an invalid/expired token just falls through to
// the IP key rather than rejecting the request here (the real `authenticate` middleware on each
// route still enforces auth properly; this is only about picking a fair rate-limit bucket).
function rateLimitKey(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET, { algorithms: ["HS256"] });
      if (payload?.id) return `user:${payload.id}`;
    } catch {
      // falls through to IP-keying below
    }
  }
  return `ip:${getClientIp(req)}`;
}
const globalLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: rateLimitKey });
app.use(globalLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/academic-groups", academicGroupRoutes);
app.use("/api/institutes", instituteRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/learning", learningRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/gamification", gamificationRoutes);
app.use("/api/resume", resumeRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/ai-interviews", aiInterviewRoutes);
app.use("/api/interview", interviewDraftRoutes);
app.use("/api/interview", companyQuestionRoutes);
app.use("/api/module-coding", moduleCodingRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/ai/questions", aiQuestionRoutes);
app.use("/api/challenges", challengeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/placement", placementOfferRoutes);
app.use("/api/documents", studentDocumentRoutes);
app.use("/api/talent-pools", talentPoolRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/results", resultManagementRoutes);
app.use("/api/staff-clerk", staffClerkRoutes);
app.use("/api/readiness", readinessRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/features", featureRoutes);
app.use("/api/issue-reports", issueReportRoutes);
app.use("/api/platform-health", platformHealthRoutes);

// Global 4-arg error handler — must be mounted after every route above so any error a route
// hands to next(err) (or an unhandled synchronous throw) lands here instead of Express's default
// HTML/plain-text handler. This is specifically what makes Multer's file-size-limit error (thrown
// by the upload middleware BEFORE a route's own try/catch ever runs, on every bulk-upload route
// across the platform) come back as clean JSON instead of a raw response the frontend can't parse.
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File size exceeds the allowed limit (5 MB). Please upload a smaller file." });
  }
  if (err?.name === "MulterError") {
    return res.status(400).json({ error: "File upload failed. Please check the file and try again." });
  }
  logger.error("unhandled route error", { message: err?.message, stack: err?.stack, path: req.path });
  res.status(err?.statusCode || 500).json({ error: "Something went wrong. Please try again." });
});

process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { message: err?.message, stack: err?.stack });
  recordProcessError(err, "uncaughtException");
});
process.on("unhandledRejection", (err) => {
  logger.error("unhandledRejection", { message: err?.message, stack: err?.stack });
  recordProcessError(err, "unhandledRejection");
});

const { startAiRefreshScheduler } = require("./utils/aiRefreshScheduler");
startAiRefreshScheduler();

const { startTalentPoolReminderScheduler } = require("./utils/talentPoolReminderScheduler");
startTalentPoolReminderScheduler();

const { startChallengeScheduler } = require("./utils/challengeScheduler");
startChallengeScheduler();

const { startTestScheduledPublishScheduler } = require("./utils/testScheduledPublishScheduler");
startTestScheduledPublishScheduler();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CodeArena API running on port ${PORT}`);
  // Best-effort: warms the OS page cache for javac/gcc/g++ right away instead of waiting for the
  // first real student submission to pay that cost — see warmUpCompilers()'s own comment for why
  // this matters specifically on this instance. Fire-and-forget: must never delay startup or crash
  // the process if it fails.
  const judge = require("./utils/judge");
  judge.warmUpCompilers().catch((err) => console.warn("judge warm-up failed", err.message));
  // Network-egress isolation for sandbox-uid submissions is now installed once, as real root,
  // by docker-entrypoint.sh BEFORE this process ever starts — not from here. Node itself no
  // longer holds cap_net_admin (see the Dockerfile's setcap comment); that capability delegation
  // was tried and confirmed live to be insufficient for either iptables backend in this
  // environment anyway, which is why the mechanism moved to the entrypoint's root phase instead.
});
