require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { timingMiddleware, recordProcessError } = require("./utils/metrics");
const logger = require("./utils/logger");
const { isConfigured: isAiConfigured } = require("./utils/aiClient");
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
const moduleCodingRoutes = require("./routes/moduleCoding");
const searchRoutes = require("./routes/search");
const certificateRoutes = require("./routes/certificates");
const backupRoutes = require("./routes/backup");
const exportRoutes = require("./routes/exports");
const aiQuestionRoutes = require("./routes/aiQuestions");
const challengeRoutes = require("./routes/challenges");
const interviewDraftRoutes = require("./routes/interviewDrafts");
const attendanceRoutes = require("./routes/attendance");
const profileRoutes = require("./routes/profile");
const companyRoutes = require("./routes/companies");
const placementOfferRoutes = require("./routes/placementOffers");
const studentDocumentRoutes = require("./routes/studentDocuments");
const talentPoolRoutes = require("./routes/talentPools");
const notificationRoutes = require("./routes/notifications");
const resultManagementRoutes = require("./routes/resultManagement");
const staffClerkRoutes = require("./routes/staffClerk");

const app = express();
// There are TWO proxy hops in front of this service, not one — confirmed directly via a
// temporary debug route that echoed X-Forwarded-For across repeated requests: Cloudflare's edge
// (its IP changes per request/edge node) sits in front of Render's own internal load balancer
// (which itself bounces between at least two internal addresses). With trust proxy=1, Express
// only trusted the innermost hop (Render's own proxy) and used ITS address as req.ip — meaning
// req.ip was effectively random per request (whichever internal Render node handled it), never
// the real client. This silently broke every IP-keyed mechanism in the app: the login/forgot-
// password rate limiters (each request landed in a different bucket, so the limit never
// triggered), the global rate limiter's IP fallback, and the IP recorded on AuditLog/LoginSession
// rows. Trusting 2 hops walks back through both proxies to the address Cloudflare itself reports
// as the original client (confirmed stable across every test request), which is what req.ip
// should have been resolving to all along.
app.set("trust proxy", 2);
app.use(helmet());
app.use(compression());
// Scoped to the known frontend origin(s) rather than reflecting any caller — same FRONTEND_URL
// env var already used platform-wide for building email/certificate links (auth.js, users.js,
// mailer.js, etc.), so no new config surface. Local Vite dev ports are always allowed since this
// list only ever governs a browser's CORS preflight, not authentication itself (auth is a Bearer
// token the frontend attaches explicitly, never an ambient cookie, so this is defense in depth
// rather than the actual access boundary). Requests with no Origin header (curl, server-to-server,
// mobile) are unaffected — CORS only applies to browser-issued cross-origin requests.
const allowedOrigins = [
  process.env.FRONTEND_URL || "https://codearena-app.vercel.app",
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

// RENDER_GIT_COMMIT is set automatically by Render on every deploy (no config needed) — exposing
// it here is the only way to tell "the service is up" apart from "the service is up but running a
// stale build," since a health check with no version marker can't distinguish the two.
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "CodeArena API", commit: process.env.RENDER_GIT_COMMIT || null }));

// Public, boolean-only — lets any page check whether ANTHROPIC_API_KEY is set before showing an
// AI-feature button, instead of the student clicking it and hitting a raw 503 error message.
app.get("/api/ai/status", (req, res) => res.json({ configured: isAiConfigured() }));

// TEMPORARY diagnostic route — the DB-backed rate limiter isn't blocking after its threshold in
// live testing even with a correct, stable req.ip. Exercises prisma.rateLimitHit directly (count
// then create) with the raw error surfaced, to confirm whether the model/table itself works
// against the live database. Remove once the cause is confirmed.
app.get("/api/_debug/ratelimit", async (req, res) => {
  const key = "debug-test-key";
  try {
    const before = await prisma.rateLimitHit.count({ where: { key } });
    const created = await prisma.rateLimitHit.create({ data: { key } });
    const after = await prisma.rateLimitHit.count({ where: { key } });
    res.json({ ok: true, before, after, createdId: created.id, reqIp: req.ip });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, code: err.code, meta: err.meta });
  }
});

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
  return `ip:${req.ip}`;
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
app.use("/api/interview", interviewDraftRoutes);
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CodeArena API running on port ${PORT}`);
  // Best-effort: warms the OS page cache for javac/gcc/g++ right away instead of waiting for the
  // first real student submission to pay that cost — see warmUpCompilers()'s own comment for why
  // this matters specifically on this instance. Fire-and-forget: must never delay startup or crash
  // the process if it fails.
  require("./utils/judge").warmUpCompilers().catch((err) => console.warn("judge warm-up failed", err.message));
});
