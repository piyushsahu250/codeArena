require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const { timingMiddleware, recordProcessError } = require("./utils/metrics");
const { isConfigured: isAiConfigured } = require("./utils/aiClient");

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

const app = express();
// Render sits in front of this service behind a reverse proxy — without trusting it, req.ip
// resolves to the proxy's own address instead of the real client IP, which breaks IP-keyed rate
// limiting fairness and makes every audit-log/login-session IP identical and useless.
app.set("trust proxy", 1);
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(timingMiddleware);

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "CodeArena API" }));

// Public, boolean-only — lets any page check whether ANTHROPIC_API_KEY is set before showing an
// AI-feature button, instead of the student clicking it and hitting a raw 503 error message.
app.get("/api/ai/status", (req, res) => res.json({ configured: isAiConfigured() }));

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
      const payload = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
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

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  recordProcessError(err, "uncaughtException");
});
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
  recordProcessError(err, "unhandledRejection");
});

const { startAiRefreshScheduler } = require("./utils/aiRefreshScheduler");
startAiRefreshScheduler();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CodeArena API running on port ${PORT}`);
  // Best-effort: warms the OS page cache for javac/gcc/g++ right away instead of waiting for the
  // first real student submission to pay that cost — see warmUpCompilers()'s own comment for why
  // this matters specifically on this instance. Fire-and-forget: must never delay startup or crash
  // the process if it fails.
  require("./utils/judge").warmUpCompilers().catch((err) => console.warn("judge warm-up failed", err.message));
});
