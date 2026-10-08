// Exam-security glue for the FORMAL Test engine (routes/tests.js + routes/submissions.js). It reuses the policy presets,
// event catalogue and risk scoring from utils/examSecurity.js; only the attempt model (TestAttempt) differs.
//
// Honest scope: STANDARD and PROCTORED only. LOCKDOWN needs the secure-client attempt engine (module coding tests) and is
// refused here instead of being offered without real enforcement. Everything that matters is decided here on the server:
//   - phones/tablets can be refused at start (server reads the User-Agent; the page cannot override it),
//   - one active session per attempt (the newest start/resume owns attempt.sessionId; stale tabs get 409 when BLOCK),
//   - questions are never sent before the student has started the attempt (see tests.js GET /:id).
const crypto = require("crypto");
const prisma = require("../prisma");
const X = require("./examSecurity");

const TEST_LEVELS = ["STANDARD", "PROCTORED"];
const UNSUPPORTED_KEYS = ["secureBrowserRequired", "requiredCapabilities", "requireScreenShare"];

// Admin input -> persisted fields. Returns { error } or { data }.
function parseSecurityInput(body) {
  const data = {};
  if (body.securityLevel !== undefined) {
    if (body.securityLevel === "LOCKDOWN") return { error: "LOCKDOWN needs the secure exam client and is only available for coding assessments. Use PROCTORED for this test." };
    if (!TEST_LEVELS.includes(body.securityLevel)) return { error: "securityLevel must be STANDARD or PROCTORED" };
    data.securityLevel = body.securityLevel;
  }
  if (body.securityPolicy !== undefined) {
    const clean = X.sanitizePolicyOverrides(body.securityPolicy);
    for (const k of UNSUPPORTED_KEYS) delete clean[k];
    data.securityPolicy = clean;
  }
  return { data };
}

// Effective policy for a formal test. PROCTORED tests refuse phones unless the admin explicitly allows them: a phone is
// where split-screen assistants and floating AI windows live, and a web page cannot see them.
function policyOf(test) {
  const p = X.resolvePolicy({ ...test, securityLevel: TEST_LEVELS.includes(test?.securityLevel) ? test.securityLevel : "STANDARD" });
  p.secureBrowserRequired = false; p.requireScreenShare = false; p.requiredCapabilities = [];
  const explicitPhones = test?.securityPolicy && typeof test.securityPolicy === "object" && typeof test.securityPolicy.mobileAllowed === "boolean";
  if (p.level === "PROCTORED" && !explicitPhones) p.mobileAllowed = false;
  return p;
}

function startRequirementFailure(req, policy) {
  if (!policy.mobileAllowed && X.isMobileUserAgent(req.get("user-agent"))) {
    return { code: "MOBILE_NOT_SUPPORTED", error: "This assessment requires Secure Exam Mode, which a phone or tablet browser cannot provide. Please use a laptop or desktop computer." };
  }
  return null;
}

// ---- generic evidence + session control, shared by every attempt kind (TEST, READINESS, INTERVIEW) -------------------------
// One implementation, three attempt models. `kind` is stored in ExamSecurityEvent.attemptKind so the monitor can tell them apart.
async function recordEvent({ kind, attemptId, studentId, testId, type, metadata, questionId }) {
  try {
    await prisma.examSecurityEvent.create({ data: {
      attemptKind: kind, attemptId, studentId, testId: testId || null,
      questionId: questionId || null, type, severity: X.EVENT_SEVERITY[type] || "MEDIUM", metadata: X.cleanMetadata(metadata),
    } });
  } catch (e) { console.error("[examSecurity] could not record", type, e.message); }
}

// An attempt without a sessionId (started before this existed) is not enforced. Evidence writes are throttled so a retrying
// stale tab cannot flood the table.
const lastSessionEvent = new Map();
async function enforceSession(req, res, { kind, attemptId, studentId, testId, sessionId, policySource }) {
  if (!sessionId) return true;
  const given = req.get("x-exam-session");
  // Compatibility: a page bundle that predates session control sends neither header. It keeps working (no enforcement) until it is
  // reloaded; every current client sends X-Client-Features, so a current client with no session id (a second tab) IS refused.
  // Set EXAM_SESSION_REQUIRE_CLIENT=1 to drop this allowance once old bundles have aged out.
  if (!given && !req.get("x-client-features") && process.env.EXAM_SESSION_REQUIRE_CLIENT !== "1") return true;
  if (given === sessionId) return true;
  const policy = policyOf(policySource);
  const now = Date.now();
  if (now - (lastSessionEvent.get(attemptId) || 0) > 60000) {
    lastSessionEvent.set(attemptId, now);
    if (lastSessionEvent.size > 5000) lastSessionEvent.clear();
    await recordEvent({ kind, attemptId, studentId, testId, type: policy.multiSession === "BLOCK" ? "SESSION_REPLACED" : "MULTIPLE_SESSION", metadata: { hadHeader: !!given } });
  }
  if (policy.multiSession === "BLOCK") {
    res.status(409).json({ error: "This assessment is open in another tab, window or device. Close this one and continue there.", code: "SESSION_REPLACED" });
    return false;
  }
  return true;
}

const newSessionId = () => crypto.randomBytes(16).toString("hex");

// -- formal tests: attempt must carry its test's securityLevel/securityPolicy (include/select them)
const recordTestEvent = ({ attempt, type, metadata, questionId }) => recordEvent({ kind: "TEST", attemptId: attempt.id, studentId: attempt.studentId, testId: attempt.testId, type, metadata, questionId });
const enforceTestSession = (req, res, attempt, test) => enforceSession(req, res, { kind: "TEST", attemptId: attempt.id, studentId: attempt.studentId, testId: attempt.testId, sessionId: attempt.sessionId, policySource: test || attempt.test });

// -- readiness: the policy is the SNAPSHOT taken at attempt start (config.security), so editing the subject mid-attempt changes nothing
const readinessPolicySource = (assessment) => ({ securityLevel: assessment?.config?.security?.level, securityPolicy: assessment?.config?.security?.policy });
const enforceReadinessSession = (req, res, a) => enforceSession(req, res, { kind: "READINESS", attemptId: a.id, studentId: a.studentId, testId: a.subjectId, sessionId: a.sessionId, policySource: readinessPolicySource(a) });
const readinessSecuritySnapshot = (subject) => ({ level: TEST_LEVELS.includes(subject.securityLevel) ? subject.securityLevel : "STANDARD", policy: subject.securityPolicy && typeof subject.securityPolicy === "object" ? subject.securityPolicy : {} });

// -- mock interviews: the level comes from the SESSION TYPE (decided by the server, never the client). Graded/placement-style
// sessions are PROCTORED (phones refused, one session, evidence + monitor); free practice by category and resume-based stays STANDARD.
// Flip an entry here to change the policy for a session type.
const INTERVIEW_LEVEL_BY_TYPE = { TALENT_POOL: "PROCTORED", COMPANY_ROUND: "PROCTORED", MOCK: "PROCTORED", RESUME_BASED: "STANDARD", CATEGORY: "STANDARD" };
const interviewTypeOf = (s) => (s.talentPoolConfigId ? "TALENT_POOL" : s.isCompanyRound ? "COMPANY_ROUND" : s.isMock ? "MOCK" : s.isResumeBased ? "RESUME_BASED" : "CATEGORY");
const interviewLevelFor = (s) => INTERVIEW_LEVEL_BY_TYPE[interviewTypeOf(s)] || "STANDARD";
const enforceInterviewSession = (req, res, s) => enforceSession(req, res, { kind: "INTERVIEW", attemptId: s.id, studentId: s.studentId, testId: null, sessionId: s.sessionId, policySource: { securityLevel: s.securityLevel } });

module.exports = {
  TEST_LEVELS, parseSecurityInput, policyOf, startRequirementFailure, newSessionId,
  recordEvent, enforceSession,
  recordTestEvent, enforceTestSession,
  enforceReadinessSession, readinessSecuritySnapshot, readinessPolicySource,
  INTERVIEW_LEVEL_BY_TYPE, interviewTypeOf, interviewLevelFor, enforceInterviewSession,
};

// -- AI voice interview: level from the interview TYPE (server-decided). Placement-style and mock types are PROCTORED; free practice
// types stay STANDARD. Evidence only: this engine has no strike counter and never auto-terminates (a deliberate, documented product choice).
const AI_INTERVIEW_LEVEL_BY_TYPE = { PLACEMENT: "PROCTORED", COMPANY_SPECIFIC: "PROCTORED", AI_MOCK: "PROCTORED" };
const aiInterviewLevelFor = (interviewType) => AI_INTERVIEW_LEVEL_BY_TYPE[interviewType] || "STANDARD";
const enforceAiInterviewSession = (req, res, s) => enforceSession(req, res, { kind: "AI_INTERVIEW", attemptId: s.id, studentId: s.studentId, testId: null, sessionId: s.sessionId, policySource: { securityLevel: s.securityLevel } });
module.exports.AI_INTERVIEW_LEVEL_BY_TYPE = AI_INTERVIEW_LEVEL_BY_TYPE;
module.exports.aiInterviewLevelFor = aiInterviewLevelFor;
module.exports.enforceAiInterviewSession = enforceAiInterviewSession;
