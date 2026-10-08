// Exam-security glue for the FORMAL Test engine (routes/tests.js + routes/submissions.js). It reuses the policy presets,
// event catalogue and risk scoring from utils/examSecurity.js; only the attempt model (TestAttempt) differs.
//
// Honest scope: STANDARD and PROCTORED only. LOCKDOWN needs the secure-client attempt engine (module coding tests) and is
// refused here instead of being offered without real enforcement. Everything that matters is decided here on the server:
//   - phones/tablets can be refused at start (server reads the User-Agent; the page cannot override it),
//   - one active session per attempt (the newest start/resume owns attempt.sessionId; stale tabs get 409 when BLOCK),
//   - questions are never sent before the student has started the attempt (see tests.js GET /:id).
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

async function recordTestEvent({ attempt, type, metadata, questionId }) {
  try {
    await prisma.examSecurityEvent.create({ data: {
      attemptKind: "TEST", attemptId: attempt.id, studentId: attempt.studentId, testId: attempt.testId,
      questionId: questionId || null, type, severity: X.EVENT_SEVERITY[type] || "MEDIUM", metadata: X.cleanMetadata(metadata),
    } });
  } catch (e) { console.error("[testExamSecurity] could not record", type, e.message); }
}

// attempt must carry its test's securityLevel/securityPolicy (include/select them). An attempt without a sessionId
// (started before this existed) is not enforced. Evidence writes are throttled so a retrying stale tab cannot flood.
const lastSessionEvent = new Map();
async function enforceTestSession(req, res, attempt, test) {
  if (!attempt.sessionId) return true;
  const given = req.get("x-exam-session");
  if (given === attempt.sessionId) return true;
  const policy = policyOf(test || attempt.test);
  const now = Date.now();
  if (now - (lastSessionEvent.get(attempt.id) || 0) > 60000) {
    lastSessionEvent.set(attempt.id, now);
    if (lastSessionEvent.size > 5000) lastSessionEvent.clear();
    await recordTestEvent({ attempt, type: policy.multiSession === "BLOCK" ? "SESSION_REPLACED" : "MULTIPLE_SESSION", metadata: { hadHeader: !!given } });
  }
  if (policy.multiSession === "BLOCK") {
    res.status(409).json({ error: "This assessment is open in another tab, window or device. Close this one and continue there.", code: "SESSION_REPLACED" });
    return false;
  }
  return true;
}

module.exports = { TEST_LEVELS, parseSecurityInput, policyOf, startRequirementFailure, recordTestEvent, enforceTestSession };
