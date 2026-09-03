const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { interviewQuestionVisibilityWhere, ownsInterviewQuestionRow } = require("../utils/interviewQuestionVisibility");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { resolveCodingFields } = require("../utils/functionHarness");
const { evaluateHrAnswer, evaluateTechnicalAnswer, evaluateAptitudeAnswer, evaluateCodingAnswer } = require("../utils/interviewEvaluation");
const { buildInterviewReport } = require("../utils/interviewReport");
const { buildRecommendations } = require("../utils/interviewRecommendations");
const { generateResumeQuestions } = require("../utils/resumeInterviewQuestions");
const { generateInterviewCertificatePdf } = require("../utils/interviewCertificatePdf");
const { shuffleQuestionOptions, toOriginalSelection } = require("../utils/optionShuffle");
const { generateInterviewReportPdf } = require("../utils/interviewReportPdf");
const { sendMailLogged, wrapBranded } = require("../utils/mailer");
const aiService = require("../services/ai/aiService");
const { sendAiError } = require("../utils/aiErrors");
const { cached } = require("../utils/cache");
const { dedupe, isInFlight } = require("../utils/requestDedup");
const { COMPANIES } = require("../utils/companies");
const { isStudentTalentPoolMember } = require("../utils/talentPoolEligibility");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { safeErrorMessage } = require("../utils/errors");
const logger = require("../utils/logger");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });
// Real, billed Claude API calls — tighter than the global per-user limiter, same rationale as
// learning.js's hintLimiter and resume.js's aiReviewLimiter.
const aiInsightsLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });
// Every other judge-invoking surface in this codebase (submissions.js, moduleCoding.js,
// learning.js, challenges.js) already has this exact per-student throttle on code execution —
// Interview was the one surface missing it.
const execLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });
const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";
const CERT_THRESHOLD = 80;

const SESSION_QUESTION_COUNT = { HR: 6, TECHNICAL: 6, APTITUDE: 10, CODING: 3, SYSTEM_DESIGN: 3, BEHAVIORAL: 6, MANAGERIAL: 5 };
const MOCK_DURATION_MIN = 30;
const COMPANY_ROUND_DURATION_MIN = 45;
const MAX_INTERVIEW_VIOLATIONS = 3;

// Server-side deadline, mirroring submissions.js/moduleCoding.js's identical deadlineOf() pattern
// — sessions with no configured durationMin (plain category drills, resume-based) never had a
// client-side timer either, so they correctly never expire here.
function deadlineOf(session) {
  const durationMin = session.config?.durationMin;
  if (!durationMin) return Infinity;
  return new Date(session.startedAt).getTime() + durationMin * 60 * 1000;
}
// A client-side auto-submit ("reason: TIME_EXPIRED") is only trusted once the server's own clock
// agrees the deadline has actually passed, within this grace window — identical rationale to
// PREMATURE_FINALIZE_GRACE_MS in submissions.js/moduleCoding.js.
const PREMATURE_FINALIZE_GRACE_MS = 15000;

const VALID_CATEGORIES = ["HR", "TECHNICAL", "CODING", "APTITUDE", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];
// Free-text categories (as opposed to APTITUDE's MCQ or CODING's editor) — these get voice
// input and the short-answer depth-probe follow-up.
const FREE_TEXT_CATEGORIES = ["HR", "TECHNICAL", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"];
const CATEGORY_LABEL = { HR: "HR", TECHNICAL: "Technical", CODING: "Coding", APTITUDE: "Aptitude", SYSTEM_DESIGN: "System Design", BEHAVIORAL: "Behavioral", MANAGERIAL: "Managerial" };

function sessionTypeLabel(s) {
  if (s.isMock) return "Mock Interview";
  if (s.isResumeBased) return "Resume-Based";
  if (s.isCompanyRound) return "Company Round";
  return CATEGORY_LABEL[s.category] || s.category || "—";
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Splits a coding interview question's stored test cases into visible/hidden pools. Questions
// authored before isHidden existed have no such key on any case — treated as all-visible, so
// scoring naturally falls back to grading against the full set for those (same policy as
// Practice Coding / Coding Tests / Module Coding Tests).
function splitInterviewCases(testCases) {
  const all = Array.isArray(testCases) ? testCases : [];
  const visible = all.filter((tc) => !tc.isHidden);
  const hidden = all.filter((tc) => tc.isHidden);
  return { visible, hidden };
}

// `seed` (typically `${sessionId}:${q.id}`) shuffles APTITUDE options for display — see
// utils/optionShuffle.js. Deterministic per interview session, so a refresh/resume/review shows
// the same order every time without persisting anything new. Never touches correctAnswer, which
// this sanitizer already excludes from every response.
function sanitizeQuestion(q, seed) {
  const options = seed && Array.isArray(q.options) ? shuffleQuestionOptions(q.options, null, seed).options : q.options;
  return {
    id: q.id, category: q.category, subject: q.subject, company: q.company, aptitudeCategory: q.aptitudeCategory,
    difficulty: q.difficulty, title: q.title || null, prompt: q.prompt, options,
    starterCode: q.starterCode, starterCodeByLanguage: q.starterCodeByLanguage || null, language: q.language, tags: q.tags || null,
    evaluationType: q.evaluationType, functionSignature: q.functionSignature,
    // Descriptive-only fields (CODING category), never reveal an answer — safe to send.
    estimatedTimeMin: q.estimatedTimeMin ?? null,
    realWorldScenario: q.realWorldScenario || null,
    constraints: q.constraints || null,
    inputFormat: q.inputFormat || null,
    outputFormat: q.outputFormat || null,
    notes: q.notes || null,
    edgeCases: q.edgeCases || null,
    problemExplanation: q.problemExplanation || null,
    // Editorial/hints — safe here because Interview Prep is a self-paced practice tool, never a
    // permanently-graded formal assessment; TestTaking.jsx/ModuleCodingAssessment.jsx use their
    // own sanitizers which deliberately omit these fields.
    hints: q.hints || null,
    timeComplexity: q.timeComplexity || null,
    spaceComplexity: q.spaceComplexity || null,
    editorial: q.editorial || null,
    similarQuestions: q.similarQuestions || null,
    // Sample cases only — hidden ones (used for real scoring) never leave the server.
    testCases: q.category === "CODING" ? splitInterviewCases(q.testCases).visible : undefined,
  };
}

// "Soft" narrowing fields — a combination that hasn't been seeded yet falls back to the broader
// pool rather than a hard error (company-specific/package-band/experience-level/difficulty banks
// are seeded modestly on purpose and grown via the admin CMS over time). subject/aptitudeCategory
// stay "hard" filters, applied unconditionally when present, unchanged from before. difficulty
// moved here because it used to be a hard filter with no fallback — a single under-seeded
// difficulty tier could 400 an otherwise-valid session start with no recourse.
// "role" added for the Company-Specific Interview Question Intelligence System — experienceLevel
// was already here (a company-question draft's target level reuses this exact field, see
// InterviewQuestionDraft's schema comment), so only "role" was genuinely new; everything else
// (the soft-filter/fallback machinery below) already generalizes to it with no further change.
const SOFT_FILTER_FIELDS = ["company", "role", "packageBand", "experienceLevel", "difficulty"];

// Weighted-without-replacement sample using a CompanyInterviewProfile.categoryWeights entry:
// { topicWeights: {"Arrays": 0.3, ...}, difficultyMix: {EASY:0.3,MEDIUM:0.5,HARD:0.2} }. A
// question's weight is topicMatch * difficultyMatch, with small non-zero floors so untagged/
// off-profile questions can still be picked (just deprioritized) rather than excluded outright —
// this is a bias on top of the existing pool, never a hard filter. Falls back to plain shuffle
// when the profile defines nothing usable, so profile-less categories see zero behavior change.
function weightedSample(pool, weights, count) {
  const topicWeights = weights?.topicWeights || {};
  const difficultyMix = weights?.difficultyMix || {};
  if (!Object.keys(topicWeights).length && !Object.keys(difficultyMix).length) return shuffle(pool).slice(0, count);

  const remaining = pool.map((q) => {
    const tagMatches = [q.subject, ...(Array.isArray(q.tags) ? q.tags : [])].filter((t) => t && topicWeights[t] != null);
    const topicWeight = tagMatches.length ? Math.max(...tagMatches.map((t) => topicWeights[t])) : 0.05;
    const difficultyWeight = q.difficulty && difficultyMix[q.difficulty] != null ? difficultyMix[q.difficulty] : 0.1;
    return { q, weight: Math.max(0.01, topicWeight * difficultyWeight) };
  });

  const picked = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const total = remaining.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    let idx = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      roll -= remaining[j].weight;
      if (roll <= 0) { idx = j; break; }
    }
    picked.push(remaining[idx].q);
    remaining.splice(idx, 1);
  }
  return picked;
}

// Returns { items, usedFallback } rather than a bare array — usedFallback lets a caller (e.g. a
// Company Round composing several categories at once) tell the student when a category had to
// fall back to the general, non-company-specific pool, instead of silently serving generic
// content under a company-branded label.
//
// options.companyProfile: a CompanyInterviewProfile row (or null) — when its categoryWeights has
// an entry for this category, selection is weighted (weightedSample) instead of pure shuffle.
// options.excludeStudentId: when set, excludes questions this student has already answered in the
// last INTERVIEW_ANTI_REPEAT_DAYS days (default 90) — a real anti-repetition gap this platform had
// none of before. Same fallback posture as everything else here: if exclusion would empty the
// pool, it's dropped rather than failing the session start (a repeat question beats no session).
async function pickQuestions(category, config, count, options = {}) {
  const hardWhere = { category, isActive: true, generatedForStudentId: null };
  if (config.subject) hardWhere.subject = config.subject;
  if (config.aptitudeCategory) hardWhere.aptitudeCategory = config.aptitudeCategory;

  const softWhere = {};
  for (const field of SOFT_FILTER_FIELDS) {
    if (config[field]) {
      // Company/role are free text entered by admins (see InterviewDraftReview.jsx) with no
      // normalization anywhere — "TCS" vs "tcs " (or "Software Engineer" vs "software engineer")
      // must still match the same seeded pool.
      softWhere[field] = field === "company" || field === "role"
        ? { equals: String(config[field]).trim(), mode: "insensitive" }
        : config[field];
    }
  }

  let excludeIds = [];
  if (options.excludeStudentId) {
    const days = Math.max(1, Number(process.env.INTERVIEW_ANTI_REPEAT_DAYS) || 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recent = await prisma.interviewAnswer.findMany({
      where: { session: { studentId: options.excludeStudentId }, createdAt: { gte: since } },
      select: { questionId: true },
      distinct: ["questionId"],
    });
    excludeIds = recent.map((r) => r.questionId);
  }

  const fullWhere = { ...hardWhere, ...softWhere };
  let pool = await prisma.interviewQuestion.findMany({ where: excludeIds.length ? { ...fullWhere, id: { notIn: excludeIds } } : fullWhere });
  if (pool.length === 0 && excludeIds.length > 0) {
    // Drop the anti-repeat exclusion first — a repeat is a smaller compromise than falling all
    // the way back to the general (non-company) pool below.
    pool = await prisma.interviewQuestion.findMany({ where: fullWhere });
  }

  const n = count || SESSION_QUESTION_COUNT[category] || 6;
  const categoryWeights = options.companyProfile?.categoryWeights?.[category];
  let usedFallback = false;
  let items;

  if (pool.length >= n || Object.keys(softWhere).length === 0) {
    // Either the soft-filtered (e.g. company) pool already has enough, or there's no soft filter
    // in play at all — no fallback needed.
    items = categoryWeights ? weightedSample(pool, categoryWeights, n) : shuffle(pool).slice(0, n);
  } else {
    // Fewer soft-filtered matches than needed (this is the common case for most companies, which
    // are seeded with only 1-3 questions per category). Previously this only backfilled from the
    // general pool when the company-specific pool was completely EMPTY (pool.length === 0) — a
    // company with e.g. 1 of 2 needed CODING questions fell through neither fallback branch and
    // silently returned just that 1 question, one short. Now: every company-specific question
    // found is always kept (never randomly dropped by a reshuffle across the combined pool), and
    // the remaining slots are topped up from the general pool.
    usedFallback = true;
    let general = await prisma.interviewQuestion.findMany({ where: excludeIds.length ? { ...hardWhere, id: { notIn: excludeIds } } : hardWhere });
    if (general.length === 0) general = await prisma.interviewQuestion.findMany({ where: hardWhere });
    const haveIds = new Set(pool.map((q) => q.id));
    const filler = shuffle(general.filter((q) => !haveIds.has(q.id)));
    items = [...pool, ...filler].slice(0, n);
  }
  return { items, usedFallback };
}

// =========================== Student: dashboard summary ===========================

router.get("/summary", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("ai_mock_interview"), async (req, res) => {
  try {
    const sessions = await prisma.interviewSession.findMany({
      where: { studentId: req.user.id, status: { in: ["COMPLETED", "TERMINATED"] } },
      include: { report: true },
    });
    const totalAttempted = sessions.length;
    const withReport = sessions.filter((s) => s.report);
    const averageScore = withReport.length
      ? Math.round(withReport.reduce((s, x) => s + x.report.overallScore, 0) / withReport.length)
      : 0;

    const strongCounts = new Map(), weakCounts = new Map();
    for (const s of withReport) {
      for (const a of s.report.strongAreas || []) strongCounts.set(a, (strongCounts.get(a) || 0) + 1);
      for (const a of s.report.weakAreas || []) weakCounts.set(a, (weakCounts.get(a) || 0) + 1);
    }
    const strongAreas = [...strongCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const weakAreas = [...weakCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

    const recentRecs = withReport
      .slice(-3)
      .flatMap((s) => s.report.recommendations || [])
      .slice(0, 5);

    const byCategory = {};
    for (const cat of VALID_CATEGORIES) {
      const catSessions = sessions.filter((s) => s.category === cat && !s.isMock && !s.isResumeBased);
      byCategory[cat] = catSessions.length;
    }
    const mockCount = sessions.filter((s) => s.isMock).length;
    const resumeBasedCount = sessions.filter((s) => s.isResumeBased).length;

    res.json({ totalAttempted, averageScore, strongAreas, weakAreas, improvementSuggestions: recentRecs, byCategory: { ...byCategory, MOCK: mockCount, RESUME_BASED: resumeBasedCount } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load interview summary" });
  }
});

// =========================== Student: sessions ===========================

// STUDENT: start (or resume, if one's already in progress with the same shape) a session.
router.post("/sessions", authenticate, requireRole("STUDENT"), attachRequesterInstitute, requireFeature("ai_mock_interview"), async (req, res) => {
  try {
    const { category, isMock, isResumeBased, isCompanyRound, talentPoolConfigId, config } = req.body;
    if (!isMock && !isResumeBased && !isCompanyRound && !talentPoolConfigId && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    if (isCompanyRound && !config?.company) {
      return res.status(400).json({ error: "A company must be selected for a Company Round interview" });
    }

    // Talent Pool exclusivity gate: this is the ONE thing that differs from every other branch
    // below — everything else here just picks a question mix, this one first has to confirm the
    // student is actually allowed to start a session against this config at all. Sibling to the
    // isMock/isCompanyRound branches, not a parallel eligibility engine — reuses the same
    // company/difficulty question-mix logic those already have.
    let talentPoolConfig = null;
    if (talentPoolConfigId) {
      talentPoolConfig = await prisma.talentPoolInterviewConfig.findUnique({
        where: { id: talentPoolConfigId },
        include: { pool: { select: { id: true, name: true, isActive: true } } },
      });
      if (!talentPoolConfig || !talentPoolConfig.isActive || !talentPoolConfig.pool.isActive) {
        return res.status(404).json({ error: "This interview config is no longer available" });
      }
      const isMember = await isStudentTalentPoolMember(prisma, req.user.id, talentPoolConfig.poolId);
      if (!isMember) return res.status(403).json({ error: "You're not a member of this Talent Pool" });
    }

    const existing = await prisma.interviewSession.findFirst({
      where: {
        studentId: req.user.id, status: "IN_PROGRESS",
        category: isMock || isResumeBased || isCompanyRound || talentPoolConfigId ? null : category,
        isMock: !!isMock, isResumeBased: !!isResumeBased, isCompanyRound: !!isCompanyRound,
        talentPoolConfigId: talentPoolConfigId || null,
      },
      include: { answers: true },
    });
    if (existing) {
      // Two ways a matched "existing" session isn't actually resumable: (1) it has zero answer
      // rows — impossible for a session created going forward now that creation is transactional
      // below, but a stale row from before that fix could still be sitting in the DB, and this
      // route used to silently re-serve it forever (permanently "won't start" for that student);
      // (2) for a Company Round, the student picked a DIFFERENT company than the one this session
      // was created for — silently resuming would serve the wrong company's questions under the
      // new company's label. Either way, abandon it (a status flip only — nothing is deleted) and
      // fall through to create a fresh session below instead of leaving the student stuck.
      const companyMismatch = isCompanyRound && config?.company && existing.config?.company
        && String(existing.config.company).trim().toLowerCase() !== String(config.company).trim().toLowerCase();
      // A third way a matched "existing" session isn't actually resumable: its deadline already
      // passed while it sat abandoned (tab closed, crash, etc.). Silently handing it back as
      // resumed used to be the actual "interview starts then immediately exits" bug -- the
      // frontend computes secondsLeft from this session's original (long-past) startedAt, sees
      // 0 the instant it reaches the active phase, and auto-finalizes right there with no warning
      // shown at all. Properly closing it out here (same finalizeSession() a real timeout uses)
      // and falling through to create a genuinely fresh session fixes that at the root, instead of
      // handing back a session that was always going to immediately expire the moment it rendered.
      const alreadyExpired = deadlineOf(existing) !== Infinity && Date.now() > deadlineOf(existing);
      if (existing.answers.length === 0 || companyMismatch || alreadyExpired) {
        if (alreadyExpired && existing.answers.length > 0 && !companyMismatch) {
          await finalizeSession(existing, { terminationReason: "TIME_EXPIRED" }, req).catch((err) => {
            console.error("[interview.sessions] failed to auto-finalize expired stale session:", err);
          });
        } else {
          await prisma.interviewSession.update({ where: { id: existing.id }, data: { status: "ABANDONED" } });
        }
        logger.info("INTERVIEW_ABANDONED", {
          sessionId: existing.id, studentId: req.user.id,
          reason: existing.answers.length === 0 ? "EMPTY_SESSION" : companyMismatch ? "COMPANY_MISMATCH" : "EXPIRED_WHILE_ABANDONED",
        });
      } else {
        const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: existing.answers.map((a) => a.questionId) } } });
        // In-progress sessions store their question order as answer rows created up front (see below),
        // so this reconstructs the original order via createdAt.
        const ordered = existing.answers
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .map((a) => questions.find((q) => q.id === a.questionId))
          .filter(Boolean);
        logger.info("INTERVIEW_RESUMED", { sessionId: existing.id, studentId: req.user.id, questionCount: ordered.length });
        logAudit({
          req, action: AUDIT_ACTIONS.INTERVIEW_SESSION_RESUMED, actorId: req.user.id, actorRole: "STUDENT", studentId: req.user.id,
          details: { sessionId: existing.id },
        });
        return res.json({ session: existing, questions: ordered.map((q) => sanitizeQuestion(q, `${existing.id}:${q.id}`)), resumed: true, serverTime: Date.now() });
      }
    }

    let questions = [];
    let sessionData = { studentId: req.user.id, config: config || {} };

    if (isResumeBased) {
      const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
      const generated = generateResumeQuestions(resume);
      if (generated.length === 0) {
        return res.status(400).json({ error: "Add skills, projects, or experience to your resume first — there's nothing to generate questions from yet." });
      }
      questions = await Promise.all(
        generated.map((g) =>
          prisma.interviewQuestion.create({
            data: { category: "TECHNICAL", subject: g.subject, prompt: g.prompt, expectedKeywords: g.expectedKeywords, generatedForStudentId: req.user.id },
          })
        )
      );
      sessionData = { ...sessionData, isResumeBased: true, category: null };
    } else if (isMock) {
      const difficultyCfg = { difficulty: config?.difficulty };
      const opts = { excludeStudentId: req.user.id };
      const [hr, tech, coding] = await Promise.all([
        pickQuestions("HR", difficultyCfg, 3, opts), pickQuestions("TECHNICAL", difficultyCfg, 3, opts), pickQuestions("CODING", difficultyCfg, 2, opts),
      ]);
      questions = [...hr.items, ...tech.items, ...coding.items];
      if (questions.length === 0) {
        console.warn(`[interview] Mock interview has zero questions available — difficulty=${config?.difficulty}, studentId=${req.user.id}`);
        return res.status(400).json({ error: "No interview questions available yet — ask an admin to add some." });
      }
      sessionData = { ...sessionData, isMock: true, category: null, config: { ...config, durationMin: MOCK_DURATION_MIN } };
    } else if (isCompanyRound) {
      // Company Round has two shapes: (1) a company with an active CompanyInterviewProfile.
      // roundPlan gets the real, sequential, elimination-gated experience below — only the first
      // round's questions are created now, later rounds are created one at a time by
      // POST /sessions/:id/rounds/advance as the student clears each one; (2) every other company
      // (no profile, or a profile with no roundPlan configured) keeps today's exact flat
      // HR(2)+Technical(3)+Coding(2)+Managerial(2) composition, unchanged.
      const companyProfile = await prisma.companyInterviewProfile.findFirst({
        where: { company: { equals: config.company, mode: "insensitive" }, isActive: true },
      });
      const roundPlan = Array.isArray(companyProfile?.roundPlan) ? companyProfile.roundPlan : null;
      const roundCfg = { company: config.company, role: config?.role, difficulty: config?.difficulty, experienceLevel: config?.experienceLevel };
      const opts = { excludeStudentId: req.user.id, companyProfile };

      if (roundPlan && roundPlan.length > 0) {
        const round1 = roundPlan[0];
        const picked = await pickQuestions(round1.category, roundCfg, round1.count, opts);
        questions = picked.items;
        if (questions.length === 0) {
          console.warn(`[interview] Company Round (round-elimination) has zero questions for round 1 — company=${config.company}, category=${round1.category}, studentId=${req.user.id}`);
          return res.status(400).json({ error: "No interview questions available yet — ask an admin to add some." });
        }
        const roundResults = roundPlan.map((r, i) => ({
          roundNumber: r.roundNumber, category: r.category, label: r.label || CATEGORY_LABEL[r.category] || r.category,
          status: i === 0 ? "IN_PROGRESS" : "NOT_REACHED",
          questionIds: i === 0 ? questions.map((q) => q.id) : [],
          answeredCount: 0, score: null,
        }));
        sessionData = {
          ...sessionData, isCompanyRound: true, category: null,
          config: { ...config, durationMin: COMPANY_ROUND_DURATION_MIN, generalFallbackCategories: picked.usedFallback ? [round1.category] : [] },
          roundPlanSnapshot: roundPlan, currentRoundNumber: 1, roundResults,
        };
      } else {
        // "Student selects TCS -> HR + Technical + Coding + Managerial questions, all scoped to
        // that company (falling back to the general pool per-category if that company doesn't
        // have questions in a given category yet — see pickQuestions)."
        const [hr, tech, coding, managerial] = await Promise.all([
          pickQuestions("HR", roundCfg, 2, opts), pickQuestions("TECHNICAL", roundCfg, 3, opts),
          pickQuestions("CODING", roundCfg, 2, opts), pickQuestions("MANAGERIAL", roundCfg, 2, opts),
        ]);
        questions = [...hr.items, ...tech.items, ...coding.items, ...managerial.items];
        if (questions.length === 0) {
          console.warn(`[interview] Company Round has zero questions available — company=${config.company}, experienceLevel=${config?.experienceLevel}, difficulty=${config?.difficulty}, studentId=${req.user.id}`);
          return res.status(400).json({ error: "No interview questions available yet — ask an admin to add some." });
        }
        const generalFallbackCategories = [
          hr.usedFallback && "HR", tech.usedFallback && "TECHNICAL", coding.usedFallback && "CODING", managerial.usedFallback && "MANAGERIAL",
        ].filter(Boolean);
        sessionData = { ...sessionData, isCompanyRound: true, category: null, config: { ...config, durationMin: COMPANY_ROUND_DURATION_MIN, generalFallbackCategories } };
      }
    } else if (talentPoolConfigId) {
      const poolCfg = talentPoolConfig.config || {};
      const roundCfg = { company: poolCfg.company, difficulty: poolCfg.difficulty, experienceLevel: poolCfg.experienceLevel };
      const opts = { excludeStudentId: req.user.id };
      const [hr, tech, coding, managerial] = await Promise.all([
        pickQuestions("HR", roundCfg, 2, opts), pickQuestions("TECHNICAL", roundCfg, 3, opts),
        pickQuestions("CODING", roundCfg, 2, opts), pickQuestions("MANAGERIAL", roundCfg, 2, opts),
      ]);
      questions = [...hr.items, ...tech.items, ...coding.items, ...managerial.items];
      if (questions.length === 0) {
        console.warn(`[interview] Talent Pool interview config has zero questions available — poolConfigId=${talentPoolConfigId}, company=${poolCfg.company}, studentId=${req.user.id}`);
        return res.status(400).json({ error: "No interview questions available yet — ask an admin to add some." });
      }
      const generalFallbackCategories = [
        hr.usedFallback && "HR", tech.usedFallback && "TECHNICAL", coding.usedFallback && "CODING", managerial.usedFallback && "MANAGERIAL",
      ].filter(Boolean);
      sessionData = { ...sessionData, category: null, talentPoolConfigId, config: { ...poolCfg, durationMin: poolCfg.durationMin || COMPANY_ROUND_DURATION_MIN, generalFallbackCategories } };
    } else {
      const result = await pickQuestions(category, config || {}, undefined, { excludeStudentId: req.user.id });
      questions = result.items;
      if (questions.length === 0) {
        console.warn(`[interview] No questions available — category=${category}, config=${JSON.stringify(config || {})}, studentId=${req.user.id}`);
        return res.status(400).json({ error: "No questions available for this selection yet — try a different subject/difficulty or ask an admin to add more." });
      }
      sessionData = { ...sessionData, category };
    }

    // Session creation + its pre-created answer-order rows (so /sessions/:id/answer is a plain
    // upsert-by-unique-key, and resuming later can reconstruct the original order from them) are
    // one atomic state transition — a stray failure between two separate writes here used to leave
    // a committed, permanently-empty IN_PROGRESS session behind (see the auto-abandon check above,
    // which cleans up any such rows left by this bug prior to the fix). Transact them together,
    // same pattern as finalizeSession() below.
    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.interviewSession.create({ data: sessionData });
      await tx.interviewAnswer.createMany({
        data: questions.map((q) => ({ sessionId: s.id, questionId: q.id, skipped: true })),
      });
      return s;
    });

    logger.info("INTERVIEW_CREATED", {
      sessionId: session.id, studentId: req.user.id,
      type: session.isMock ? "MOCK" : session.isResumeBased ? "RESUME_BASED" : session.isCompanyRound ? "COMPANY_ROUND" : session.talentPoolConfigId ? "TALENT_POOL" : session.category,
      company: session.config?.company || null, questionCount: questions.length, usedFallback: !!session.config?.generalFallbackCategories?.length,
    });
    logAudit({
      req, action: AUDIT_ACTIONS.INTERVIEW_SESSION_STARTED, actorId: req.user.id, actorRole: "STUDENT", studentId: req.user.id,
      details: { sessionId: session.id, type: session.isMock ? "MOCK" : session.isResumeBased ? "RESUME_BASED" : session.isCompanyRound ? "COMPANY_ROUND" : session.talentPoolConfigId ? "TALENT_POOL" : session.category, company: session.config?.company || null },
    });
    res.json({ session, questions: questions.map((q) => sanitizeQuestion(q, `${session.id}:${q.id}`)), resumed: false, serverTime: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start interview session" });
  }
});

router.get("/sessions", authenticate, requireRole("STUDENT"), requireFeature("interview_history"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 10;
    const [sessions, total] = await Promise.all([
      prisma.interviewSession.findMany({
        where: { studentId: req.user.id, status: { in: ["COMPLETED", "TERMINATED"] } },
        include: { report: true },
        orderBy: { submittedAt: "desc" },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.interviewSession.count({ where: { studentId: req.user.id, status: { in: ["COMPLETED", "TERMINATED"] } } }),
    ]);
    res.json({ sessions, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load session history" });
  }
});

router.get("/sessions/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: { answers: { orderBy: { createdAt: "asc" } }, report: true },
    });
    if (!session || session.studentId !== req.user.id) return res.status(404).json({ error: "Session not found" });
    const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: session.answers.map((a) => a.questionId) } } });
    const ordered = session.answers.map((a) => ({ ...sanitizeQuestion(questions.find((q) => q.id === a.questionId) || {}, `${session.id}:${a.questionId}`), answer: a }));
    // A completed session's report/weakAreas never changes, so recomputing recommendations on
    // every single report-page load/refresh (confirmed up to ~11 DB round trips) is pure waste —
    // cache per-session with a long TTL.
    const recommendedLearning = session.report
      ? await cached(`interview:recs:${session.id}`, 3600 * 1000, () => buildRecommendations(session.report.weakAreas))
      : [];
    // Resume position on refresh/remount: the first still-`skipped:true` row in creation order —
    // every answer row starts skipped:true at session-creation time and flips to false the moment
    // the student actually submits that question, so this is "the first question not yet visited"
    // without needing a separately-persisted "current question" field.
    const resumeIndexRaw = ordered.findIndex((q) => q.answer.skipped);
    res.json({ session, questions: ordered, recommendedLearning, serverTime: Date.now(), resumeIndex: resumeIndexRaw === -1 ? 0 : resumeIndexRaw });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load session" });
  }
});

// STUDENT: qualitative narrative analysis via Claude — augments the existing rule-based
// InterviewReport (score/scoreBreakdown/strongAreas/weakAreas/recommendations, computed in
// utils/interviewEvaluation.js) rather than replacing it. That heuristic scoring stays the
// authoritative, always-available number; this is a read-only, on-demand richer pass reading
// the same transcript. Never stored — recomputed fresh each time it's requested.
// A row stuck at GENERATING longer than this is treated as dead (the process that started it
// crashed or was redeployed mid-call, not a real long-running request) — self-heals into a
// retryable FAILED state instead of blocking every future request on this session forever. Kept
// comfortably above GEMINI_TIMEOUT_MS + one retry so a genuinely-still-running call is never
// preempted by a client that just happened to poll at the wrong moment.
const AI_INSIGHTS_STALE_GENERATING_MS = 60000;

router.get("/sessions/:id/ai-insights", authenticate, requireRole("STUDENT"), aiInsightsLimiter, async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: { answers: { orderBy: { createdAt: "asc" } }, report: true, student: { select: { instituteId: true } } },
    });
    if (!session || session.studentId !== req.user.id) return res.status(404).json({ error: "Session not found" });
    if (!session.report) return res.status(400).json({ error: "This interview hasn't been submitted yet" });

    let report = session.report;

    // Already generated — return the persisted result. Never regenerates on a page refresh or a
    // second visit to the report (this is exactly what a browser-refresh-during/after-generation
    // must recover into, per the "don't create duplicate work from a refresh" requirement).
    if (report.aiInsightsStatus === "READY" && report.aiInsights) {
      return res.json({ status: "READY", ...report.aiInsights });
    }

    const isStale = report.aiInsightsStatus === "GENERATING" && report.aiInsightsRequestedAt
      && (Date.now() - new Date(report.aiInsightsRequestedAt).getTime() > AI_INSIGHTS_STALE_GENERATING_MS);
    if (report.aiInsightsStatus === "GENERATING" && !isStale) {
      // A genuinely in-flight request (this instance or another) — the frontend polls this same
      // endpoint again shortly rather than firing a second generation.
      return res.status(202).json({ status: "GENERATING" });
    }

    if (report.aiInsightsStatus === "FAILED" && !req.query.retry) {
      // Surface the last failure without re-billing a call the student hasn't explicitly retried —
      // the frontend's Retry button re-requests with ?retry=1 to actually attempt again.
      return res.status(200).json({ status: "FAILED", error: report.aiInsightsError || "AI analysis failed — try again later" });
    }

    report = await prisma.interviewReport.update({
      where: { id: report.id },
      data: { aiInsightsStatus: "GENERATING", aiInsightsRequestedAt: new Date(), aiInsightsError: null },
    });

    const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: session.answers.map((a) => a.questionId) } } });
    const transcript = session.answers.map((a) => {
      const q = questions.find((qq) => qq.id === a.questionId);
      const answer = a.skipped ? "(skipped)" : a.code ? `[${a.language} code]\n${a.code}` : (a.answerText || "(no answer)");
      return `Q: ${q?.prompt || "?"}\nA: ${answer}\nScore: ${a.score}/100`;
    }).join("\n\n");

    const roundContext = session.eliminatedAtRound
      ? ` The candidate was eliminated at round ${session.eliminatedAtRound} of a ${Array.isArray(session.roundPlanSnapshot) ? session.roundPlanSnapshot.length : "?"}-round company-style interview (company readiness score: ${session.report.companyReadinessScore ?? "n/a"}%).`
      : Array.isArray(session.roundPlanSnapshot) && session.roundPlanSnapshot.length > 0
        ? ` The candidate cleared all ${session.roundPlanSnapshot.length} rounds of a company-style interview (company readiness score: ${session.report.companyReadinessScore ?? "n/a"}%).`
        : "";

    try {
      // A double-click (or a poll landing at the same instant as another) would otherwise fire two
      // separate billed Gemini calls for the exact same request — coalesce into one in-process.
      const evaluation = await dedupe(`ai-insights:${session.id}`, () =>
        aiService.evaluateInterview({
          userId: req.user.id, instituteId: session.student.instituteId,
          transcript: `Overall rule-based score: ${session.report.overallScore}%.${roundContext}\n\n${transcript.slice(0, 8000)}`,
          category: session.category, jobRole: session.config?.jobRole,
        })
      );
      await prisma.interviewReport.update({
        where: { id: report.id },
        data: { aiInsightsStatus: "READY", aiInsights: evaluation, aiInsightsError: null },
      });
      return res.json({ status: "READY", ...evaluation });
    } catch (aiErr) {
      // Never leaves the row stuck at GENERATING — every failure path lands on FAILED with a
      // safe, student-facing message, so the next request (retry) always has a clean state to
      // start from instead of tripping the stale-GENERATING self-heal unnecessarily.
      const message = aiErr.notConfigured
        ? "AI features are not configured on this server yet."
        : aiErr.quotaExceeded ? aiErr.message
        : "AI service is temporarily unavailable. Please retry.";
      await prisma.interviewReport.update({
        where: { id: report.id },
        data: { aiInsightsStatus: "FAILED", aiInsightsError: message },
      });
      throw aiErr;
    }
  } catch (err) {
    sendAiError(res, err, "AI analysis failed — try again later");
  }
});

// Rule-based "adaptive" follow-up — NOT a real NLU model generating a question from the
// semantic content of the answer (that's a genuine LLM capability this platform doesn't have).
// Two mechanisms: (1) an admin-configured link on the question itself (e.g. "Explain JVM" ->
// "How does JVM differ from JRE?"), deterministic and transparent; (2) a generic depth-probe,
// at most once per session, when a free-text answer is very short — honestly framed as "that
// was brief, elaborate," not a claim of having understood the answer's content.
async function maybeInsertFollowUp(session, question, answerText, skipped) {
  if (skipped) return null;

  if (question.followUpQuestionId) {
    const alreadyAsked = await prisma.interviewAnswer.findUnique({
      where: { sessionId_questionId: { sessionId: session.id, questionId: question.followUpQuestionId } },
    });
    if (alreadyAsked) return null;
    const followUpQ = await prisma.interviewQuestion.findUnique({ where: { id: question.followUpQuestionId } });
    return followUpQ && followUpQ.isActive ? followUpQ : null;
  }

  if (FREE_TEXT_CATEGORIES.includes(question.category) && answerText && answerText.trim().split(/\s+/).filter(Boolean).length < 15) {
    const probeAlreadyUsed = await prisma.interviewAnswer.count({
      where: { sessionId: session.id, question: { prompt: { startsWith: "[Follow-up]" } } },
    });
    if (probeAlreadyUsed === 0) {
      return prisma.interviewQuestion.create({
        data: {
          category: question.category, subject: question.subject,
          prompt: "[Follow-up] Can you elaborate further and give a specific example?",
          expectedKeywords: question.expectedKeywords || [],
          generatedForStudentId: session.studentId,
        },
      });
    }
  }
  return null;
}

// STUDENT: run a coding interview question's code against its VISIBLE (sample) test cases only
// — a free, unlimited, side-effect-free self-check before answering, matching the Run/Submit
// split used everywhere else on the platform. Does not save an answer or affect the score.
router.post("/sessions/:id/run-code", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return res.status(403).json({ error: "Invalid session" });
    if (session.status !== "IN_PROGRESS") return res.status(400).json({ error: "This session is already finalized" });
    if (Date.now() > deadlineOf(session)) return res.status(403).json({ error: "Time is up for this interview" });

    const { questionId, code, language } = req.body;
    const question = await prisma.interviewQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.category !== "CODING") return res.status(400).json({ error: "Not a coding question" });

    const { visible } = splitInterviewCases(question.testCases);
    // Coalesces a double-click/retry on the same question into one judge job instead of two.
    const dedupeKey = `run:${session.id}:${questionId}`;
    if (isInFlight(dedupeKey)) logger.info("JUDGE_DEDUP_HIT", { sessionId: session.id, questionId, route: "run-code" });
    const result = await dedupe(dedupeKey, () =>
      runQueued(() => judgeSubmission({ language, code, testCases: visible, timeLimitMs: 3000, evaluationType: question.evaluationType, functionSignature: question.functionSignature }))
    );
    res.json(result);
  } catch (err) {
    if (err.queueBusy) {
      logger.info("JUDGE_QUEUE_BUSY", { sessionId: req.params.id, route: "run-code" });
      return res.status(503).json({ error: "Code execution is currently busy. Your interview session is safe. Please try again shortly.", queueBusy: true });
    }
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

// STUDENT: autosave the in-progress code draft for a coding interview question — same atomic
// upsert pattern used for autosave everywhere else, keyed by session+question since the same
// question bank entry could in principle appear again in a different session.
router.post("/sessions/:id/questions/:questionId/draft", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return res.status(403).json({ error: "Invalid session" });

    const { language, code } = req.body;
    if (typeof code !== "string" || !language) return res.status(400).json({ error: "language and code are required" });
    const contextId = `${req.params.id}:${req.params.questionId}`;
    await prisma.codeDraft.upsert({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "INTERVIEW", contextId } },
      update: { code, language },
      create: { studentId: req.user.id, contextType: "INTERVIEW", contextId, code, language },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Autosave failed" });
  }
});

// STUDENT: fetch the saved draft (if any) for a coding interview question, so reloading mid-
// question after a refresh or network blip restores in-progress code instead of losing it.
router.get("/sessions/:id/questions/:questionId/draft", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const contextId = `${req.params.id}:${req.params.questionId}`;
    const draft = await prisma.codeDraft.findUnique({
      where: { studentId_contextType_contextId: { studentId: req.user.id, contextType: "INTERVIEW", contextId } },
    });
    res.json(draft ? { code: draft.code, language: draft.language } : null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load draft" });
  }
});

// STUDENT: submit/update one answer. Coding gets immediate pass/fail feedback on the hidden
// grading cases (after the candidate already self-checked against sample cases via
// POST /sessions/:id/run-code); HR/Technical/Aptitude are graded silently — the full picture
// only shows up in the final report, matching "AI evaluates after submission" (of the whole
// interview, not each question). May
// frontend appends it to the live question list rather than the session needing to be re-fetched.
router.post("/sessions/:id/answer", authenticate, requireRole("STUDENT"), execLimiter, async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return res.status(403).json({ error: "Invalid session" });
    if (session.status !== "IN_PROGRESS") return res.status(400).json({ error: "This session is already finalized" });
    if (Date.now() > deadlineOf(session)) return res.status(403).json({ error: "Time is up for this interview" });

    const { questionId, answerText, code, language, skipped, timeTakenSec } = req.body;
    const question = await prisma.interviewQuestion.findUnique({ where: { id: questionId } });
    if (!question) return res.status(404).json({ error: "Question not found" });

    let score = 0, breakdown = null, immediateResult = null;
    if (skipped) {
      score = 0; breakdown = null;
    } else if (question.category === "HR" || question.category === "BEHAVIORAL" || question.category === "MANAGERIAL") {
      // Managerial questions (leadership, prioritization, conflict resolution) are free-text/
      // speech, same shape as HR/Behavioral — the same linguistic heuristics apply.
      const r = evaluateHrAnswer(answerText, question.expectedKeywords || []);
      score = r.score; breakdown = r.breakdown;
    } else if (question.category === "TECHNICAL" || question.category === "SYSTEM_DESIGN") {
      // System Design answers are free-text explanations graded the same way as a technical
      // concept answer: keyword coverage against the expected-concepts list an admin sets on
      // the question (e.g. "load balancer", "caching", "sharding", "CAP theorem").
      const r = evaluateTechnicalAnswer(answerText, question.expectedKeywords || []);
      score = r.score; breakdown = r.breakdown;
    } else if (question.category === "APTITUDE") {
      // answerText carries a position in the shuffled options[] this student was shown (see
      // sanitizeQuestion — same `${sessionId}:${questionId}` seed) — invert back to the original
      // Question.correctAnswer index space before comparing.
      const shuffleOrder = Array.isArray(question.options) ? shuffleQuestionOptions(question.options, null, `${session.id}:${questionId}`).order : null;
      const originalAnswer = answerText !== undefined && answerText !== null && answerText !== "" ? toOriginalSelection(Number(answerText), shuffleOrder) : answerText;
      const r = evaluateAptitudeAnswer(originalAnswer, question.correctAnswer, session.config?.negativeMarking);
      score = r.score; breakdown = { correct: r.correct };
    } else if (question.category === "CODING") {
      // Save the code as a PENDING answer BEFORE invoking the judge — same "save first, grade
      // second" pattern already used by submissions.js/moduleCoding.js's coding submit routes —
      // so a judge failure (busy queue, timeout, crash) never loses the student's code; the
      // upsert below (after grading) then overwrites this with the real score. Worst case on a
      // judge failure, the code the student typed is still saved and they can retry.
      await prisma.interviewAnswer.upsert({
        where: { sessionId_questionId: { sessionId: session.id, questionId } },
        update: { code: code ?? null, language: language ?? null, skipped: false, timeTakenSec: timeTakenSec ?? null },
        create: { sessionId: session.id, questionId, code: code ?? null, language: language ?? null, skipped: false, timeTakenSec: timeTakenSec ?? null },
      });

      // Final scoring (like the rest of the platform) is based on hidden test cases only, with a
      // fallback to the visible set for legacy questions that predate isHidden. The candidate
      // already had unlimited access to a sample-only self-check via POST /sessions/:id/run-code
      // before submitting this answer.
      const { visible, hidden } = splitInterviewCases(question.testCases);
      const gradingCases = hidden.length > 0 ? hidden : visible;
      // Coalesces a double-click/retry into one judge job instead of two.
      const dedupeKey = `answer:${session.id}:${questionId}`;
      if (isInFlight(dedupeKey)) logger.info("JUDGE_DEDUP_HIT", { sessionId: session.id, questionId, route: "answer" });
      const judgeResult = await dedupe(dedupeKey, () =>
        runQueued(() => judgeSubmission({ language, code, testCases: gradingCases, timeLimitMs: 3000, evaluationType: question.evaluationType, functionSignature: question.functionSignature }))
      );
      const r = evaluateCodingAnswer(judgeResult, code);
      score = r.score; breakdown = r.breakdown;
      // Hidden case inputs/expected outputs never leave the server — only counts/verdict/timing
      // and (when every case failed the same way) judge.js's already-content-free error summary.
      const { details, ...safeJudgeResult } = judgeResult;
      immediateResult = safeJudgeResult;
    }

    const answer = await prisma.interviewAnswer.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId } },
      update: { answerText: answerText ?? null, code: code ?? null, language: language ?? null, skipped: !!skipped, timeTakenSec: timeTakenSec ?? null, score, breakdown: breakdown ?? undefined },
      create: { sessionId: session.id, questionId, answerText: answerText ?? null, code: code ?? null, language: language ?? null, skipped: !!skipped, timeTakenSec: timeTakenSec ?? null, score, breakdown: breakdown ?? undefined },
    });
    // Correlates on sessionId/questionId only — never the answer text/code itself.
    logger.info("ANSWER_SAVED", { sessionId: session.id, questionId, category: question.category, skipped: !!skipped, score });

    let followUpQuestion = null;
    try {
      const followUpQ = await maybeInsertFollowUp(session, question, answerText, skipped);
      if (followUpQ) {
        await prisma.interviewAnswer.create({ data: { sessionId: session.id, questionId: followUpQ.id, skipped: true } });
        followUpQuestion = sanitizeQuestion(followUpQ, `${session.id}:${followUpQ.id}`);
      }
    } catch (e) {
      console.error("follow-up insertion failed", e);
    }

    res.json({ saved: true, answer, immediateResult, followUpQuestion });
  } catch (err) {
    if (err.queueBusy) {
      logger.info("JUDGE_QUEUE_BUSY", { sessionId: req.params.id, route: "answer" });
      return res.status(503).json({ error: "Code execution is currently busy. Your interview session is safe. Please try again shortly.", queueBusy: true });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to save answer" });
  }
});

// STUDENT: called when the frontend has walked the student through every question in the
// session's current round — advances to the next round if the round's score clears its
// eliminationThreshold, or ends the session early (finalizes with whatever exists; later rounds
// stay NOT_REACHED and never get their questions created) otherwise. The server is the sole
// authority on scoring here — a question's score was already locked in by POST /sessions/:id/
// answer at submit time, this route only aggregates what's already stored, never trusts a client
// claim about how the student did. Like the rest of this session flow (a student can already
// submit a whole interview with every question skipped), this does not hard-block on incomplete
// answers — an unanswered question simply scores 0 toward the round average, same as everywhere
// else in this file.
router.post("/sessions/:id/rounds/advance", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return res.status(403).json({ error: "Invalid session" });
    if (session.status !== "IN_PROGRESS") return res.status(400).json({ error: "This session is already finalized" });
    if (Date.now() > deadlineOf(session)) return res.status(403).json({ error: "Time is up for this interview" });
    const roundPlan = Array.isArray(session.roundPlanSnapshot) ? session.roundPlanSnapshot : null;
    if (!roundPlan) return res.status(400).json({ error: "This session has no round structure" });

    const roundResults = Array.isArray(session.roundResults) ? [...session.roundResults] : [];
    const idx = session.currentRoundNumber - 1;
    const currentRound = roundResults[idx];
    if (!currentRound || currentRound.status !== "IN_PROGRESS") {
      return res.status(400).json({ error: "No round is currently in progress for this session" });
    }

    const answers = await prisma.interviewAnswer.findMany({ where: { sessionId: session.id, questionId: { in: currentRound.questionIds } } });
    const answered = answers.filter((a) => !a.skipped);
    const roundScore = answered.length > 0 ? Math.round(answered.reduce((s, a) => s + a.score, 0) / answered.length) : 0;
    const threshold = roundPlan[idx]?.eliminationThreshold;
    const passed = threshold == null || roundScore >= threshold;

    roundResults[idx] = { ...currentRound, status: passed ? "PASSED" : "ELIMINATED", score: roundScore, answeredCount: answered.length };

    if (!passed) {
      for (let i = idx + 1; i < roundResults.length; i++) roundResults[i] = { ...roundResults[i], status: "NOT_REACHED" };
      await prisma.interviewSession.update({ where: { id: session.id }, data: { roundResults, eliminatedAtRound: session.currentRoundNumber } });
      const { session: updated, report } = await finalizeSession({ ...session, roundResults, eliminatedAtRound: session.currentRoundNumber }, {}, req);
      return res.json({ eliminated: true, completed: true, session: updated, report });
    }

    const nextIdx = idx + 1;
    if (nextIdx >= roundPlan.length) {
      await prisma.interviewSession.update({ where: { id: session.id }, data: { roundResults } });
      const { session: updated, report } = await finalizeSession({ ...session, roundResults }, {}, req);
      return res.json({ eliminated: false, completed: true, session: updated, report });
    }

    const nextRound = roundPlan[nextIdx];
    const companyProfile = await prisma.companyInterviewProfile.findFirst({
      where: { company: { equals: session.config?.company, mode: "insensitive" }, isActive: true },
    });
    const roundCfg = { company: session.config?.company, difficulty: session.config?.difficulty, experienceLevel: session.config?.experienceLevel };
    const picked = await pickQuestions(nextRound.category, roundCfg, nextRound.count, { excludeStudentId: req.user.id, companyProfile });
    if (picked.items.length === 0) {
      // No questions available for the next round — end the session gracefully rather than
      // getting the student stuck on a round that can never start.
      for (let i = nextIdx; i < roundResults.length; i++) roundResults[i] = { ...roundResults[i], status: "NOT_REACHED" };
      await prisma.interviewSession.update({ where: { id: session.id }, data: { roundResults } });
      const { session: updated, report } = await finalizeSession({ ...session, roundResults }, {}, req);
      return res.json({ eliminated: false, completed: true, session: updated, report, note: "No further round questions were available." });
    }

    roundResults[nextIdx] = { ...roundResults[nextIdx], status: "IN_PROGRESS", questionIds: picked.items.map((q) => q.id) };
    // Same class of bug as session-start above: the next round's answer rows and the session's
    // round-pointer update describe one atomic transition — transact them together so a stray
    // failure can't leave the session pointed at a round with no answer rows to resume into.
    const [, updatedSession] = await prisma.$transaction([
      prisma.interviewAnswer.createMany({ data: picked.items.map((q) => ({ sessionId: session.id, questionId: q.id, skipped: true })) }),
      prisma.interviewSession.update({ where: { id: session.id }, data: { currentRoundNumber: nextRound.roundNumber, roundResults } }),
    ]);
    logger.info("ROUND_ADVANCED", { sessionId: session.id, roundNumber: nextRound.roundNumber, category: nextRound.category, questionCount: picked.items.length, usedFallback: picked.usedFallback });

    res.json({ eliminated: false, completed: false, session: updatedSession, nextRoundQuestions: picked.items.map(sanitizeQuestion) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to advance to the next round" });
  }
});

// Shared by the normal finalize flow and the proctoring-violation auto-terminate path — a
// terminated session still gets a real report built from whatever was genuinely answered before
// termination (partial credit), not an empty/blank one.
async function finalizeSession(session, { status = "COMPLETED", terminationReason = null } = {}, req = null) {
  const answers = await prisma.interviewAnswer.findMany({ where: { sessionId: session.id } });
  const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: answers.map((a) => a.questionId) } } });
  const answersWithQuestions = answers.map((a) => ({ ...a, question: questions.find((q) => q.id === a.questionId) || {} }));
  const built = buildInterviewReport(answersWithQuestions, {
    roundPlanSnapshot: session.roundPlanSnapshot, eliminatedAtRound: session.eliminatedAtRound, durationMin: session.config?.durationMin,
  });

  const [updated, report] = await prisma.$transaction([
    prisma.interviewSession.update({ where: { id: session.id }, data: { status, submittedAt: new Date(), terminationReason } }),
    prisma.interviewReport.upsert({
      where: { sessionId: session.id }, update: built, create: { sessionId: session.id, studentId: session.studentId, ...built },
    }),
  ]);
  logger.info(status === "TERMINATED" ? "INTERVIEW_TERMINATED" : "INTERVIEW_COMPLETED", {
    sessionId: session.id, studentId: session.studentId, terminationReason, overallScore: report.overallScore,
  });
  // Durable audit trail for session-lifecycle events — previously only ever hit ephemeral console
  // logs, so diagnosing "why did this student's interview end" had no queryable history at all.
  // Fire-and-forget: must never be able to fail the finalize response it's describing.
  logAudit({
    req, action: status === "TERMINATED" ? AUDIT_ACTIONS.INTERVIEW_SESSION_TERMINATED : AUDIT_ACTIONS.INTERVIEW_SESSION_COMPLETED,
    actorId: session.studentId, actorRole: "STUDENT", studentId: session.studentId,
    details: { sessionId: session.id, terminationReason, overallScore: report.overallScore },
  });

  // Notify the student their report is ready — scoped to Mock/Company Round sessions only
  // (the "full interview experience" types), not every quick single-category practice drill,
  // so students doing rapid-fire aptitude/HR practice reps aren't emailed on every submission.
  // Fire-and-forget: never blocks the finalize response; delivery status is still visible to
  // admins via the existing Email Logs page (sendMailLogged always writes an EmailLog row).
  if (updated.isMock || updated.isCompanyRound) {
    prisma.user.findUnique({ where: { id: session.studentId }, select: { name: true, email: true } }).then((student) => {
      if (!student?.email) return;
      sendMailLogged(prisma, {
        to: student.email, name: student.name, studentId: session.studentId,
        emailType: "INTERVIEW_REPORT_READY",
        subject: "Your AI Mock Interview Report is Ready",
        html: wrapBranded(`
          <p>Hi ${student.name},</p>
          <p>Your ${sessionTypeLabel(updated)} interview has been evaluated.</p>
          <p><strong>Overall Score: ${report.overallScore}%</strong></p>
          <p>Log in to view your full report, question-by-question feedback, and improvement suggestions at <a href="${FRONTEND_URL}/interview/report/${updated.id}">${FRONTEND_URL}</a>.</p>
          <p>Regards,<br/>CodeArena Team</p>
        `),
      }).catch(() => {});
    }).catch(() => {});
  }

  return { session: updated, report };
}

router.post("/sessions/:id/finalize", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id }, include: { report: true } });
    if (!session || session.studentId !== req.user.id) return res.status(403).json({ error: "Invalid session" });
    if (session.status !== "IN_PROGRESS") {
      return res.json({ session, report: session.report });
    }

    // A client-triggered "time's up" auto-finalize is only trusted once the server's own clock
    // agrees the deadline has actually passed, within a grace window — identical rationale to
    // submissions.js/moduleCoding.js's premature-finalize guard (protects against a fast client
    // clock finalizing a session early). A manual Submit click (reason omitted) is never blocked —
    // a student is always allowed to submit early.
    if (req.body?.reason === "TIME_EXPIRED") {
      const remainingMs = deadlineOf(session) - Date.now();
      if (remainingMs > PREMATURE_FINALIZE_GRACE_MS) {
        return res.json({ premature: true, deadline: deadlineOf(session), serverNow: Date.now() });
      }
    }

    const terminationReason = Date.now() > deadlineOf(session) ? "TIME_EXPIRED" : null;
    const { session: updated, report } = await finalizeSession(session, { terminationReason }, req);
    const recommendedLearning = await buildRecommendations(report.weakAreas);
    res.json({ session: updated, report, recommendedLearning });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to finalize interview" });
  }
});

// STUDENT: report a proctoring violation. `type` distinguishes what happened; `penalized`
// (client-supplied, cross-checked against a fixed server-side set below — never trust the
// client's own penalized flag) determines whether it counts toward the 3-strike auto-terminate
// threshold or is only logged for review (face missing briefly, multiple faces detected — per
// spec, "future ready, log don't penalize"). Noise/silent-environment reminders never reach this
// endpoint at all — they're pure client-side UI state, not a proctoring concern.
const PENALIZED_VIOLATION_TYPES = new Set(["TAB_SWITCH", "FULLSCREEN_EXIT", "CAMERA_DROPPED", "MIC_DROPPED", "SCREEN_OVERLAY_DETECTED"]);
router.post("/sessions/:id/violation", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return res.status(403).json({ error: "Invalid session" });
    if (session.status !== "IN_PROGRESS") {
      return res.json({ violationCount: session.violationCount, maxViolations: MAX_INTERVIEW_VIOLATIONS, terminated: session.status === "TERMINATED" });
    }

    const type = String(req.body.type || "UNKNOWN").toUpperCase().slice(0, 40);
    const penalized = PENALIZED_VIOLATION_TYPES.has(type);
    const violationCount = penalized ? session.violationCount + 1 : session.violationCount;
    // The violation log row and the session's running count describe one event — transact them
    // together (same class of fix as session-start/round-advance above) when penalized, rather
    // than as two separate writes that could partially land and leave the count out of sync with
    // the log it's supposed to be derived from.
    if (penalized) {
      await prisma.$transaction([
        prisma.interviewViolation.create({ data: { sessionId: session.id, type, penalized } }),
        prisma.interviewSession.update({ where: { id: session.id }, data: { violationCount } }),
      ]);
    } else {
      await prisma.interviewViolation.create({ data: { sessionId: session.id, type, penalized } });
    }
    logger.info("VIOLATION_RECORDED", { sessionId: session.id, type, penalized, violationCount });
    if (penalized) {
      logAudit({
        req, action: AUDIT_ACTIONS.INTERVIEW_VIOLATION_RECORDED, actorId: req.user.id, actorRole: "STUDENT", studentId: req.user.id,
        details: { sessionId: session.id, type, violationCount },
      });
    }

    const terminated = penalized && violationCount >= MAX_INTERVIEW_VIOLATIONS;
    if (terminated) {
      await finalizeSession({ ...session, violationCount }, { status: "TERMINATED", terminationReason: "MAX_VIOLATIONS" }, req);
    }

    res.json({ violationCount, maxViolations: MAX_INTERVIEW_VIOLATIONS, penalized, terminated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to record violation" });
  }
});

// STUDENT: download the full detailed report as a PDF (questions, answers/code, per-question
// score, overall breakdown, strengths/weaknesses, improvement plan) — distinct from the
// platform-wide "Interview Ready" certificate PDF, which is a single summary document, not a
// per-session report.
router.get("/sessions/:id/report/pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: { answers: { orderBy: { createdAt: "asc" } }, report: true },
    });
    if (!session || session.studentId !== req.user.id) return res.status(404).json({ error: "Session not found" });
    if (!session.report) return res.status(400).json({ error: "This interview hasn't been submitted yet" });

    const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: session.answers.map((a) => a.questionId) } } });
    const ordered = session.answers.map((a) => ({ ...sanitizeQuestion(questions.find((q) => q.id === a.questionId) || {}, `${session.id}:${a.questionId}`), answer: a }));
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="interview-report-${session.id.slice(0, 8)}.pdf"`);
    generateInterviewReportPdf({ studentName: student.name, session, questions: ordered, report: session.report }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate report PDF" });
  }
});

// =========================== Student: leaderboard + progress ===========================

router.get("/leaderboard", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.user.id } });
    const scope = req.query.scope || "group";
    let studentIds;
    if (scope === "institute" && student.instituteId) {
      studentIds = (await prisma.user.findMany({ where: { instituteId: student.instituteId, role: "STUDENT" }, select: { id: true } })).map((u) => u.id);
    } else if (scope === "overall") {
      studentIds = (await prisma.user.findMany({ where: { role: "STUDENT" }, select: { id: true } })).map((u) => u.id);
    } else if (student.academicGroupId) {
      // "group" (and the deprecated "class" alias) both land here — scoped to the student's own
      // academic group.
      studentIds = (await prisma.user.findMany({ where: { academicGroupId: student.academicGroupId, role: "STUDENT" }, select: { id: true } })).map((u) => u.id);
    } else {
      return res.json([]);
    }

    const reports = await prisma.interviewReport.findMany({
      where: { studentId: { in: studentIds }, session: { category: "APTITUDE" } },
      select: { studentId: true, overallScore: true },
    });
    const sums = new Map(), counts = new Map();
    for (const r of reports) {
      sums.set(r.studentId, (sums.get(r.studentId) || 0) + r.overallScore);
      counts.set(r.studentId, (counts.get(r.studentId) || 0) + 1);
    }
    const students = await prisma.user.findMany({ where: { id: { in: [...sums.keys()] } }, select: { id: true, name: true } });
    const nameMap = new Map(students.map((s) => [s.id, s.name]));

    const rows = [...sums.entries()]
      .map(([id, sum]) => ({ studentId: id, name: nameMap.get(id) || "—", averageScore: Math.round(sum / counts.get(id)), attempts: counts.get(id) }))
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, 50)
      .map((r, i) => ({ rank: i + 1, ...r }));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

router.get("/progress", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const reports = await prisma.interviewReport.findMany({
      where: { studentId: req.user.id },
      include: { session: { select: { category: true, isMock: true, submittedAt: true } } },
      orderBy: { createdAt: "asc" },
    });

    const weekly = new Map(), monthly = new Map();
    for (const r of reports) {
      const d = new Date(r.createdAt);
      const weekKey = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, "0")}-${d.getMonth() + 1}`;
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      for (const [map, key] of [[weekly, weekKey], [monthly, monthKey]]) {
        if (!map.has(key)) map.set(key, { sum: 0, count: 0 });
        const cur = map.get(key);
        cur.sum += r.overallScore; cur.count++;
      }
    }
    const toSeries = (map) => [...map.entries()].map(([period, { sum, count }]) => ({ period, averageScore: Math.round(sum / count), count }));

    res.json({
      weekly: toSeries(weekly),
      monthly: toSeries(monthly),
      history: reports.map((r) => ({ date: r.createdAt, score: r.overallScore, category: r.session?.category, isMock: r.session?.isMock })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load progress" });
  }
});

// =========================== Question bank (read, any authenticated) ===========================

// These three are platform-wide (not per-student) and only change when an admin edits question/
// company content — cached() (the existing in-process TTL helper, same one already used for
// admin analytics below) avoids hitting Postgres on every hub/browse-page load under concurrent
// student traffic.
router.get("/subjects", authenticate, async (req, res) => {
  const bySubject = await cached("interview:subjects", 120 * 1000, async () => {
    const rows = await prisma.interviewQuestion.groupBy({ by: ["category", "subject"], where: { isActive: true, generatedForStudentId: null } });
    const result = {};
    for (const r of rows) {
      if (!r.subject) continue;
      (result[r.category] = result[r.category] || []).push(r.subject);
    }
    return result;
  });
  res.json(bySubject);
});

// Companies with at least one seeded question — the hub only offers a company as a filter
// option once real content exists for it, rather than listing all 12 named in the spec
// regardless of whether any have been seeded/added yet.
router.get("/companies", authenticate, async (req, res) => {
  const result = await cached("interview:companies", 120 * 1000, async () => {
    const rows = await prisma.interviewQuestion.groupBy({
      by: ["company"], where: { isActive: true, generatedForStudentId: null, company: { not: null } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ company: r.company, questionCount: r._count._all })).sort((a, b) => a.company.localeCompare(b.company));
  });
  res.json(result);
});

// Unlike GET /companies above (which only lists companies that already have questions, for the
// session-config dropdown), this always returns all COMPANIES so a browse/admin grid can show a
// company before any content has been seeded for it yet. Originally student-only (the browse
// grid), but CompanyProfilesPanel.jsx (Interview Admin) needs this exact "every named company,
// even with zero questions" shape too, to let an admin start a profile for a brand-new company —
// nothing in this response is student-specific or sensitive (public company names, aggregate
// counts, a boolean), so it's safe to open to ADMIN/STAFF rather than duplicate the query.
router.get("/companies/browse", authenticate, requireRole("STUDENT", "ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  const result = await cached("interview:companies:browse", 120 * 1000, async () => {
    const [counts, patternCompanies] = await Promise.all([
      prisma.interviewQuestion.groupBy({ by: ["company"], where: { isActive: true, company: { not: null } }, _count: { _all: true } }),
      prisma.companyPatternNote.findMany({ where: { status: "APPROVED" }, select: { company: true }, distinct: ["company"] }),
    ]);
    const countByCompany = Object.fromEntries(counts.map((c) => [c.company, c._count._all]));
    const withPattern = new Set(patternCompanies.map((p) => p.company));
    return COMPANIES.map((company) => ({ company, questionCount: countByCompany[company] || 0, hasApprovedPattern: withPattern.has(company) }));
  });
  res.json(result);
});

// Metadata-only catalog browse for the student-facing filter UI — title/tags/difficulty/
// frequencyTag ONLY, never prompt/modelAnswer/testCases/correctAnswer (the answer-bearing
// fields), since this isn't a session — a student could otherwise read every question's answer
// straight off the browse page before ever attempting it.
router.get("/questions/browse", authenticate, requireRole("STUDENT"), async (req, res) => {
  const where = { isActive: true, generatedForStudentId: null };
  if (req.query.company) where.company = req.query.company;
  if (req.query.difficulty) where.difficulty = req.query.difficulty;
  if (req.query.category) where.category = req.query.category;
  if (req.query.topic) where.subject = { contains: req.query.topic, mode: "insensitive" };
  if (req.query.frequencyTag) where.frequencyTag = req.query.frequencyTag;
  if (req.query.packageBand) where.packageBand = req.query.packageBand;
  if (req.query.experienceLevel) where.experienceLevel = req.query.experienceLevel;

  const rows = await cached(`interview:questions:browse:${JSON.stringify(where)}`, 60 * 1000, () =>
    prisma.interviewQuestion.findMany({
      where,
      select: { id: true, title: true, category: true, subject: true, company: true, difficulty: true, tags: true, frequencyTag: true, packageBand: true, experienceLevel: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  );
  res.json(rows);
});

// =========================== Certificate ===========================

async function computeAverageInterviewScore(studentId) {
  const reports = await prisma.interviewReport.findMany({ where: { studentId }, select: { overallScore: true } });
  if (reports.length === 0) return null;
  return Math.round(reports.reduce((s, r) => s + r.overallScore, 0) / reports.length);
}

async function issueOrFetchCertificate(studentId, avg) {
  let cert = await prisma.interviewCertificate.findUnique({ where: { studentId } });
  if (!cert) {
    const code = `CA-INTERVIEW-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    cert = await prisma.interviewCertificate.create({ data: { certificateCode: code, studentId, averageScore: avg } });
  }
  return cert;
}

router.get("/certificate", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const avg = await computeAverageInterviewScore(req.user.id);
    if (avg === null || avg < CERT_THRESHOLD) {
      return res.status(400).json({ error: `Complete more interviews and reach an average score of ${CERT_THRESHOLD}% to earn this certificate`, currentAverage: avg });
    }
    const cert = await issueOrFetchCertificate(req.user.id, avg);
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    res.json({ ...cert, studentName: student.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load certificate" });
  }
});

router.get("/certificate/pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const avg = await computeAverageInterviewScore(req.user.id);
    if (avg === null || avg < CERT_THRESHOLD) return res.status(400).json({ error: "Certificate not yet earned" });
    const cert = await issueOrFetchCertificate(req.user.id, avg);
    const student = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="interview-ready-certificate.pdf"`);
    await generateInterviewCertificatePdf({
      studentName: student.name, averageScore: cert.averageScore, certificateCode: cert.certificateCode,
      issuedAt: cert.issuedAt, verifyUrl: `${FRONTEND_URL}/interview/verify/${cert.certificateCode}`,
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

// PUBLIC (no auth) — scanned via the certificate's QR code to confirm authenticity.
router.get("/certificate/verify/:code", async (req, res) => {
  try {
    const cert = await prisma.interviewCertificate.findUnique({
      where: { certificateCode: req.params.code },
      include: { student: { select: { name: true } } },
    });
    if (!cert) return res.status(404).json({ valid: false });
    res.json({ valid: true, studentName: cert.student.name, averageScore: cert.averageScore, issuedAt: cert.issuedAt, certificateCode: cert.certificateCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ valid: false, error: "Verification failed" });
  }
});

// =========================== Admin/Staff: question bank CMS ===========================

router.get("/admin/questions", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const where = { generatedForStudentId: null, ...interviewQuestionVisibilityWhere(req) };
  if (req.query.category) where.category = req.query.category;
  if (req.query.subject) where.subject = req.query.subject;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
  const [questions, total] = await Promise.all([
    prisma.interviewQuestion.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.interviewQuestion.count({ where }),
  ]);
  res.json({ rows: questions, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.post("/admin/questions", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      category, subject, company, aptitudeCategory, difficulty, title, prompt, expectedKeywords, modelAnswer, options, correctAnswer, explanation, starterCode, testCases, language, tags, followUpQuestionId,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes, edgeCases, problemExplanation,
      evaluationType, functionSignature, starterCodeByLanguage, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
    } = req.body;
    if (!category || !prompt) return res.status(400).json({ error: "category and prompt are required" });
    // CODING was previously the one category with no minimum test-case check at all (every other
    // coding surface on the platform enforces this) — same 2 visible / 10 hidden bar as Question/
    // PracticeQuestion. Unconditional (not gated on testCases being present) since this is
    // creation — a CODING question with no test cases at all must never be allowed to exist,
    // not just one with too few.
    let resolved = { evaluationType: "STDIO", functionSignature: null, starterCodeByLanguage: undefined };
    if (category === "CODING") {
      const cases = Array.isArray(testCases) ? testCases : [];
      if (cases.filter((tc) => !tc.isHidden).length < 2) {
        return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
      }
      if (cases.filter((tc) => tc.isHidden).length < 10) {
        return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
      }
      resolved = resolveCodingFields({ evaluationType, functionSignature, starterCodeByLanguage });
    }
    const q = await prisma.interviewQuestion.create({
      data: {
        category, subject: subject || null, company: company || null, aptitudeCategory: aptitudeCategory || null, difficulty: difficulty || "EASY",
        title: title || null, prompt, expectedKeywords: expectedKeywords ?? undefined, modelAnswer: modelAnswer || null,
        options: options ?? undefined, correctAnswer: correctAnswer ?? undefined, explanation: explanation || null,
        starterCode: starterCode || null, testCases: testCases ?? undefined, language: language || null,
        tags: Array.isArray(tags) && tags.length > 0 ? tags : undefined,
        estimatedTimeMin: estimatedTimeMin ?? null, realWorldScenario: realWorldScenario || null,
        constraints: constraints || null, inputFormat: inputFormat || null, outputFormat: outputFormat || null,
        notes: notes || null, edgeCases: edgeCases || null, problemExplanation: problemExplanation || null,
        hints: hints ?? undefined, timeComplexity: timeComplexity || null, spaceComplexity: spaceComplexity || null,
        editorial: editorial ?? undefined, similarQuestions: similarQuestions ?? undefined,
        followUpQuestionId: followUpQuestionId || null,
        evaluationType: resolved.evaluationType, functionSignature: resolved.functionSignature, starterCodeByLanguage: resolved.starterCodeByLanguage,
        instituteId: req.requesterInstituteId || null,
        createdById: req.user.id,
      },
    });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to create question") });
  }
});

router.patch("/admin/questions/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.interviewQuestion.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Question not found" });
    if (!ownsInterviewQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });
    const effectiveCategory = req.body.category !== undefined ? req.body.category : existing.category;
    if (effectiveCategory === "CODING" && Array.isArray(req.body.testCases)) {
      if (req.body.testCases.filter((tc) => !tc.isHidden).length < 2) {
        return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
      }
      if (req.body.testCases.filter((tc) => tc.isHidden).length < 10) {
        return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
      }
    }
    const fields = [
      "category", "subject", "company", "aptitudeCategory", "difficulty", "title", "prompt", "expectedKeywords", "modelAnswer",
      "options", "correctAnswer", "explanation", "starterCode", "testCases", "language", "tags", "isActive", "followUpQuestionId",
      "estimatedTimeMin", "realWorldScenario", "constraints", "inputFormat", "outputFormat", "notes", "edgeCases", "problemExplanation",
      "hints", "timeComplexity", "spaceComplexity", "editorial", "similarQuestions",
    ];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = f === "isActive" ? !!req.body[f] : req.body[f];

    // evaluationType/functionSignature/starterCodeByLanguage are deliberately excluded from the
    // generic loop above and always re-resolved server-side (never trusted directly from the
    // client) — same guarantee resolveCodingFields documents on Question/PracticeQuestion.
    if (effectiveCategory === "CODING" && (req.body.evaluationType !== undefined || req.body.functionSignature !== undefined || req.body.starterCodeByLanguage !== undefined)) {
      const resolved = resolveCodingFields({
        evaluationType: req.body.evaluationType !== undefined ? req.body.evaluationType : existing.evaluationType,
        functionSignature: req.body.functionSignature !== undefined ? req.body.functionSignature : existing.functionSignature,
        starterCodeByLanguage: req.body.starterCodeByLanguage !== undefined ? req.body.starterCodeByLanguage : existing.starterCodeByLanguage,
      });
      data.evaluationType = resolved.evaluationType;
      data.functionSignature = resolved.functionSignature;
      data.starterCodeByLanguage = resolved.starterCodeByLanguage;
    } else if (req.body.category !== undefined && effectiveCategory !== "CODING") {
      // Switching a question away from CODING must clear any leftover FUNCTION-mode state —
      // otherwise sanitizeQuestion() would keep exposing a stale signature/per-language starter
      // code on a question that's no longer CODING at all.
      data.evaluationType = "STDIO";
      data.functionSignature = null;
      data.starterCodeByLanguage = null;
    }

    const q = await prisma.interviewQuestion.update({ where: { id: req.params.id }, data });
    res.json(q);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update question") });
  }
});

router.delete("/admin/questions/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.interviewQuestion.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Question not found" });
    if (!ownsInterviewQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });
    await prisma.interviewQuestion.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This question is part of one or more students' interview history and can't be deleted." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// =========================== Admin: Company Interview Profiles ===========================
// Drives the weighted question selection + round-elimination flow in pickQuestions()/POST
// /sessions/POST /sessions/:id/rounds/advance — see CompanyInterviewProfile's schema comment for
// the legally-safe-sourcing constraint (general public interview-prep knowledge only, never a
// claim about a specific real question). Read access matches the rest of this file's admin
// routes (ADMIN+STAFF); write access is ADMIN-only since this materially changes what every
// student sees in a Company Round, not a per-question edit.

router.get("/admin/company-profiles", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), async (req, res) => {
  try {
    const profiles = await prisma.companyInterviewProfile.findMany({ orderBy: { company: "asc" } });
    res.json(profiles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load company interview profiles" });
  }
});

function validateRoundPlan(roundPlan) {
  if (roundPlan == null) return null;
  if (!Array.isArray(roundPlan) || roundPlan.length === 0) return "roundPlan must be a non-empty array or omitted entirely";
  for (const [i, r] of roundPlan.entries()) {
    if (!VALID_CATEGORIES.includes(r.category)) return `Round ${i + 1}: invalid category "${r.category}"`;
    if (!Number.isInteger(r.count) || r.count < 1 || r.count > 10) return `Round ${i + 1}: count must be an integer between 1 and 10`;
    if (r.eliminationThreshold != null && (typeof r.eliminationThreshold !== "number" || r.eliminationThreshold < 0 || r.eliminationThreshold > 100)) {
      return `Round ${i + 1}: eliminationThreshold must be a number 0-100, or left blank`;
    }
  }
  return null;
}

router.post("/admin/company-profiles", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const { company, isActive, categoryWeights, roundPlan, notes } = req.body;
    const trimmed = String(company || "").trim();
    if (!trimmed) return res.status(400).json({ error: "A company name is required" });
    const roundPlanNormalized = Array.isArray(roundPlan)
      ? roundPlan.map((r, i) => ({ ...r, roundNumber: i + 1 }))
      : null;
    const roundPlanError = validateRoundPlan(roundPlanNormalized);
    if (roundPlanError) return res.status(400).json({ error: roundPlanError });

    const profile = await prisma.companyInterviewProfile.upsert({
      where: { company: trimmed },
      update: { isActive: isActive !== false, categoryWeights: categoryWeights ?? null, roundPlan: roundPlanNormalized, notes: notes || null, updatedByAdminId: req.user.id },
      create: { company: trimmed, isActive: isActive !== false, categoryWeights: categoryWeights ?? null, roundPlan: roundPlanNormalized, notes: notes || null, updatedByAdminId: req.user.id },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.COMPANY_INTERVIEW_PROFILE_SAVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { company: trimmed, hasRoundPlan: !!roundPlanNormalized, categories: Object.keys(categoryWeights || {}) },
    });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save company interview profile" });
  }
});

router.patch("/admin/company-profiles/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const existing = await prisma.companyInterviewProfile.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    const { isActive, categoryWeights, roundPlan, notes } = req.body;
    const roundPlanNormalized = roundPlan === undefined ? undefined
      : Array.isArray(roundPlan) ? roundPlan.map((r, i) => ({ ...r, roundNumber: i + 1 })) : null;
    if (roundPlanNormalized !== undefined) {
      const roundPlanError = validateRoundPlan(roundPlanNormalized);
      if (roundPlanError) return res.status(400).json({ error: roundPlanError });
    }
    const profile = await prisma.companyInterviewProfile.update({
      where: { id: req.params.id },
      data: {
        ...(isActive !== undefined ? { isActive } : {}),
        ...(categoryWeights !== undefined ? { categoryWeights } : {}),
        ...(roundPlanNormalized !== undefined ? { roundPlan: roundPlanNormalized } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
        updatedByAdminId: req.user.id,
      },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.COMPANY_INTERVIEW_PROFILE_SAVED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { company: existing.company },
    });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update company interview profile" });
  }
});

router.delete("/admin/company-profiles/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const existing = await prisma.companyInterviewProfile.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    await prisma.companyInterviewProfile.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.COMPANY_INTERVIEW_PROFILE_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      details: { company: existing.company },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete company interview profile" });
  }
});

// "5"/"25" -> "5->25" style pair, joined with "||" — the same pipe-delimited hidden-test-case cell
// format questions.js's coding bulk-import/export uses, so admins moving between the two question
// banks see one consistent convention rather than two different spreadsheet dialects.
function formatHiddenTestCases(cases) {
  return cases.map((tc) => `${tc.input}->${tc.expected}`).join("||");
}
function parseHiddenTestCases(raw) {
  return String(raw || "")
    .split("||")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("->");
      if (idx === -1) return null;
      return { input: pair.slice(0, idx).trim(), expected: pair.slice(idx + 2).trim(), isHidden: true };
    })
    .filter(Boolean);
}

// Download a sample .xlsx template for bulk interview-question import — same column set the
// /export route produces (so an existing export can always be re-imported), plus one sample row.
// Previously this route had no template at all; admins had to reverse-engineer the columns from
// an export, unlike every other question-bank importer in this codebase.
const INTERVIEW_TEMPLATE_HEADERS = [
  "category", "subject", "company", "aptitudeCategory", "difficulty", "prompt", "expectedKeywords",
  "modelAnswer", "options", "correctAnswer", "explanation", "starterCode",
  "sampleInput1", "sampleOutput1", "sampleExplanation1", "sampleInput2", "sampleOutput2", "sampleExplanation2",
  "hiddenTestCases", "language",
];
router.get("/admin/questions/bulk-template", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), (req, res) => {
  const sampleRow = [
    "TECHNICAL", "Operating Systems", "", "", "MEDIUM", "Explain the difference between a process and a thread.",
    "process|thread|memory|scheduling", "A process is an independent execution unit with its own memory space; a thread is a lightweight unit of execution within a process, sharing its memory.",
    "", "", "Threads within the same process share the heap and static memory but have their own stack.", "",
    "", "", "", "", "", "",
    "", "",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([INTERVIEW_TEMPLATE_HEADERS, sampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Interview Questions");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=interview-question-template.xlsx");
  res.send(buffer);
});

router.get("/admin/questions/export", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const where = { generatedForStudentId: null, ...interviewQuestionVisibilityWhere(req) };
  if (req.query.category) where.category = req.query.category;
  const questions = await prisma.interviewQuestion.findMany({ where });
  const rows = questions.map((q) => {
    const cases = Array.isArray(q.testCases) ? q.testCases : [];
    const visible = cases.filter((tc) => !tc.isHidden);
    const hidden = cases.filter((tc) => tc.isHidden);
    return {
      category: q.category, subject: q.subject || "", company: q.company || "", aptitudeCategory: q.aptitudeCategory || "", difficulty: q.difficulty,
      prompt: q.prompt, expectedKeywords: Array.isArray(q.expectedKeywords) ? q.expectedKeywords.join("|") : "",
      modelAnswer: q.modelAnswer || "", options: Array.isArray(q.options) ? q.options.join("|") : "",
      correctAnswer: q.correctAnswer ?? "", explanation: q.explanation || "", starterCode: q.starterCode || "",
      sampleInput1: visible[0]?.input || "", sampleOutput1: visible[0]?.expected || "", sampleExplanation1: visible[0]?.explanation || "",
      sampleInput2: visible[1]?.input || "", sampleOutput2: visible[1]?.expected || "", sampleExplanation2: visible[1]?.explanation || "",
      hiddenTestCases: hidden.length > 0 ? formatHiddenTestCases(hidden) : "",
      // Kept for backward compatibility with files exported before the named columns above existed
      // — re-importing an old export still works, since the import route still reads this column.
      testCases: cases.length > 0 ? JSON.stringify(cases) : "",
      language: q.language || "",
    };
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="interview-questions${req.query.category ? `-${req.query.category}` : ""}.csv"`);
  res.send(csv);
});

// ADMIN/STAFF: bulk-import questions from a .csv/.xlsx file. expectedKeywords/options are
// pipe-separated ("java|jvm|bytecode"); testCases is a JSON array string.
router.post("/admin/questions/import", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .csv or .xlsx file." });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    let created = 0;
    const errors = [];
    // Duplicate detection mirrors questions.js's bulk-import pattern (within-file Set +
    // lazily-loaded existing-prompt Set) — this route had none before, unlike every other
    // question-bank importer, so re-uploading the same file silently created full duplicates.
    const skipped = [];
    const seenPrompts = new Set();
    const existingPromptsByCategory = new Map(); // category -> Set of existing prompts, loaded lazily
    async function existingPrompts(category) {
      if (!existingPromptsByCategory.has(category)) {
        const existingRows = await prisma.interviewQuestion.findMany({
          where: { category, generatedForStudentId: null },
          select: { prompt: true },
        });
        existingPromptsByCategory.set(category, new Set(existingRows.map((r) => (r.prompt || "").trim().toLowerCase()).filter(Boolean)));
      }
      return existingPromptsByCategory.get(category);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const category = String(row.category || "").trim().toUpperCase();
      if (!VALID_CATEGORIES.includes(category)) {
        errors.push({ row: rowNum, reason: `Invalid category "${row.category}"` });
        continue;
      }
      if (!row.prompt) {
        errors.push({ row: rowNum, reason: "Missing prompt" });
        continue;
      }
      const promptKey = String(row.prompt).trim().toLowerCase();
      if (seenPrompts.has(promptKey)) {
        skipped.push({ row: rowNum, reason: "Duplicate prompt within this file" });
        continue;
      }
      if ((await existingPrompts(category)).has(promptKey)) {
        skipped.push({ row: rowNum, reason: "A question with this prompt already exists in this category" });
        continue;
      }
      seenPrompts.add(promptKey);
      // Named Sample Input/Output + Hidden Test Cases columns (matching the coding question bank's
      // own bulk-import format) take priority over the legacy raw-JSON "testCases" cell — an admin
      // filling in the friendlier named columns shouldn't need to also know the JSON shape, and a
      // row with both present is unambiguous about which one was actually intended.
      const namedSample1 = row.sampleInput1 && row.sampleOutput1
        ? [{ input: String(row.sampleInput1), expected: String(row.sampleOutput1), isHidden: false, explanation: row.sampleExplanation1 || null }]
        : [];
      const namedSample2 = row.sampleInput2 && row.sampleOutput2
        ? [{ input: String(row.sampleInput2), expected: String(row.sampleOutput2), isHidden: false, explanation: row.sampleExplanation2 || null }]
        : [];
      const namedHidden = row.hiddenTestCases ? parseHiddenTestCases(row.hiddenTestCases) : [];
      const usingNamedColumns = namedSample1.length > 0 || namedSample2.length > 0 || namedHidden.length > 0;
      const legacyTestCases = row.testCases ? (() => { try { return JSON.parse(row.testCases); } catch { return null; } })() : null;
      const parsedTestCases = usingNamedColumns ? [...namedSample1, ...namedSample2, ...namedHidden] : legacyTestCases;
      if (category === "CODING") {
        const cases = Array.isArray(parsedTestCases) ? parsedTestCases : [];
        if (cases.filter((tc) => !tc.isHidden).length < 2 || cases.filter((tc) => tc.isHidden).length < 10) {
          errors.push({ row: rowNum, reason: usingNamedColumns ? "Coding questions need 2 complete sample test cases and at least 10 hidden test cases" : "Coding questions need testCases as a JSON array with at least 2 visible and 10 hidden cases" });
          continue;
        }
      }
      try {
        await prisma.interviewQuestion.create({
          data: {
            category, subject: row.subject || null, company: row.company || null, aptitudeCategory: row.aptitudeCategory || null,
            difficulty: ["EASY", "MEDIUM", "HARD"].includes(String(row.difficulty || "").toUpperCase()) ? String(row.difficulty).toUpperCase() : "EASY",
            prompt: row.prompt,
            expectedKeywords: row.expectedKeywords ? String(row.expectedKeywords).split("|").map((s) => s.trim()).filter(Boolean) : undefined,
            modelAnswer: row.modelAnswer || null,
            options: row.options ? String(row.options).split("|").map((s) => s.trim()).filter(Boolean) : undefined,
            correctAnswer: row.correctAnswer !== "" && row.correctAnswer !== undefined ? Number(row.correctAnswer) : undefined,
            explanation: row.explanation || null, starterCode: row.starterCode || null,
            testCases: parsedTestCases ?? undefined,
            language: row.language || null,
            instituteId: req.requesterInstituteId || null,
            createdById: req.user.id,
          },
        });
        created++;
      } catch {
        errors.push({ row: rowNum, reason: "Failed to create" });
      }
    }
    res.json({ total: rows.length, created, skippedCount: skipped.length, skipped, errorCount: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

// =========================== Admin/Staff: reports + analytics ===========================

router.get("/admin/stats", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const stats = await cached(`interview:stats:${req.requesterInstituteId || "all"}`, 60 * 1000, async () => {
      const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId, role: "STUDENT" } : { role: "STUDENT" };
      const students = await prisma.user.findMany({ where, select: { id: true } });
      const ids = students.map((s) => s.id);
      if (ids.length === 0) return { totalStudents: 0, studentsParticipated: 0, completionPercent: 0, totalSessions: 0, completedSessions: 0, averageScore: 0, totalQuestions: 0 };

      const [totalSessions, completedSessions, avgAgg, questionCount, participated] = await Promise.all([
        prisma.interviewSession.count({ where: { studentId: { in: ids } } }),
        prisma.interviewSession.count({ where: { studentId: { in: ids }, status: "COMPLETED" } }),
        prisma.interviewReport.aggregate({ where: { studentId: { in: ids } }, _avg: { overallScore: true } }),
        prisma.interviewQuestion.count({ where: { generatedForStudentId: null } }),
        prisma.interviewSession.findMany({ where: { studentId: { in: ids } }, select: { studentId: true }, distinct: ["studentId"] }),
      ]);

      return {
        totalStudents: ids.length,
        studentsParticipated: participated.length,
        completionPercent: Math.round((participated.length / ids.length) * 100),
        totalSessions, completedSessions,
        averageScore: Math.round(avgAgg._avg.overallScore || 0),
        totalQuestions: questionCount,
      };
    });
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load interview stats" });
  }
});

// Ranked by average interview score, computed and sorted DB-side (Prisma groupBy + orderBy on
// the aggregate) rather than loading every report row and ranking in JS — the previous version
// pulled the institute's entire student list plus every one of their reports into memory on
// every request. Note: only students with at least one interview report appear here (a groupBy
// naturally excludes students with zero rows) — this is a "who's been interviewing and how are
// they doing" view, not a full roster; the full roster is available via /admin/students/:id or
// the general student list.
router.get("/admin/students", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId, role: "STUDENT" } : { role: "STUDENT" };
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const scopedStudents = await prisma.user.findMany({ where, select: { id: true } });
    const idList = scopedStudents.map((s) => s.id);
    if (idList.length === 0) return res.json({ rows: [], page, pageSize, total: 0, totalPages: 0 });

    const [grouped, distinctIds] = await Promise.all([
      prisma.interviewReport.groupBy({
        by: ["studentId"],
        where: { studentId: { in: idList } },
        _avg: { overallScore: true },
        _count: { _all: true },
        orderBy: { _avg: { overallScore: "desc" } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.interviewReport.findMany({ where: { studentId: { in: idList } }, select: { studentId: true }, distinct: ["studentId"] }),
    ]);

    const students = grouped.length
      ? await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.studentId) } }, select: { id: true, name: true, email: true, rollNumber: true } })
      : [];
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const rows = grouped.map((g) => {
      const s = studentMap.get(g.studentId);
      return {
        studentId: g.studentId, name: s?.name, email: s?.email, rollNumber: s?.rollNumber,
        sessionsCompleted: g._count._all,
        averageScore: Math.round(g._avg.overallScore || 0),
      };
    });

    const total = distinctIds.length;
    res.json({ rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student list" });
  }
});

// ADMIN/STAFF: which topics show up as "weak areas" most often across all reports — the
// signal an admin actually needs to decide what to update in the question bank next.
router.get("/admin/weak-topics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId, role: "STUDENT" } : { role: "STUDENT" };
    const students = await prisma.user.findMany({ where, select: { id: true } });
    const ids = students.map((s) => s.id);
    const reports = ids.length ? await prisma.interviewReport.findMany({ where: { studentId: { in: ids } }, select: { weakAreas: true, strongAreas: true } }) : [];

    const weakCounts = new Map();
    for (const r of reports) {
      for (const area of r.weakAreas || []) weakCounts.set(area, (weakCounts.get(area) || 0) + 1);
    }
    const topics = [...weakCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    res.json({ totalReports: reports.length, topics });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load weak-topic analytics" });
  }
});

router.get("/admin/students/:studentId/sessions", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.studentId } });
    if (!target || target.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && target.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view students under your own institute" });
    }
    const sessions = await prisma.interviewSession.findMany({
      where: { studentId: req.params.studentId, status: { in: ["COMPLETED", "TERMINATED"] } },
      include: { report: true },
      orderBy: { submittedAt: "desc" },
    });
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student sessions" });
  }
});

// ADMIN/STAFF: event-level proctoring log for one session — for reviewing exactly what
// happened during a TERMINATED (or any) interview, not just the final violation count.
router.get("/admin/sessions/:sessionId/violations", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.sessionId }, include: { student: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (req.requesterInstituteId && session.student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view students under your own institute" });
    }
    const violations = await prisma.interviewViolation.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } });
    res.json(violations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load violation log" });
  }
});

// =========================== Admin/Staff: interview reports & analytics ===========================

// Shared filter-building for the sessions list, analytics, and Excel export routes below, so
// the dashboard's charts/cards and its table always reflect the exact same filtered set the
// user has selected. Institute scoping (Staff = own institute only, Admin = unscoped) rides on
// the same attachRequesterInstitute pattern used by /admin/stats etc. above.
function buildAdminSessionWhere(req) {
  const studentWhere = { role: "STUDENT" };
  if (req.requesterInstituteId) studentWhere.instituteId = req.requesterInstituteId;
  if (req.query.academicGroupId) studentWhere.academicGroupId = req.query.academicGroupId;
  // Legacy filter — the admin filter UI here still uses the old class picker (not yet rebuilt as
  // an academic-group picker, see Phase E), so both continue to work until that rebuild ships.
  if (req.query.classId) studentWhere.classId = req.query.classId;
  if (req.query.batchYear) studentWhere.batchYear = req.query.batchYear;
  if (req.query.department) studentWhere.department = req.query.department;
  if (req.query.search) {
    const q = String(req.query.search).trim();
    if (q) {
      studentWhere.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { rollNumber: { contains: q, mode: "insensitive" } },
        { registrationNumber: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  const where = { status: { in: ["COMPLETED", "TERMINATED"] }, student: studentWhere };
  if (req.query.status && ["COMPLETED", "TERMINATED"].includes(req.query.status)) where.status = req.query.status;

  if (req.query.type) {
    const t = String(req.query.type).toUpperCase();
    if (t === "MOCK") where.isMock = true;
    else if (t === "COMPANY_ROUND") where.isCompanyRound = true;
    else if (t === "RESUME_BASED") where.isResumeBased = true;
    else if (VALID_CATEGORIES.includes(t)) { where.category = t; where.isMock = false; where.isResumeBased = false; where.isCompanyRound = false; }
  }
  if (req.query.company) where.config = { path: ["company"], equals: req.query.company };

  if (req.query.dateFrom || req.query.dateTo) {
    where.submittedAt = {};
    if (req.query.dateFrom) where.submittedAt.gte = new Date(`${req.query.dateFrom}T00:00:00`);
    if (req.query.dateTo) where.submittedAt.lte = new Date(`${req.query.dateTo}T23:59:59`);
  }
  if (req.query.scoreMin || req.query.scoreMax) {
    where.report = {};
    if (req.query.scoreMin) where.report.overallScore = { gte: Number(req.query.scoreMin) };
    if (req.query.scoreMax) where.report.overallScore = { ...(where.report.overallScore || {}), lte: Number(req.query.scoreMax) };
  }
  return where;
}

const STUDENT_JOIN_SELECT = {
  id: true, name: true, email: true, rollNumber: true, registrationNumber: true, department: true, batchYear: true, section: true,
  instituteId: true,
  institute: { select: { name: true } },
  class: { select: { name: true, batchYear: true } },
  academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
};

function toReportRow(s) {
  const g = s.student.academicGroup;
  const groupLabel = g ? `${g.department?.name || "—"} - ${g.section}` : s.student.class?.name || null;
  return {
    sessionId: s.id,
    studentId: s.student.id,
    studentName: s.student.name,
    email: s.student.email,
    rollNumber: s.student.rollNumber,
    registrationNumber: s.student.registrationNumber,
    institute: s.student.institute?.name || null,
    groupLabel,
    batchYear: g?.batch || s.student.batchYear || s.student.class?.batchYear || null,
    department: s.student.department,
    type: sessionTypeLabel(s),
    company: s.config?.company || null,
    date: s.submittedAt,
    score: s.report?.overallScore ?? null,
    status: s.status,
  };
}

// STAFF/ADMIN: paginated, filterable list of every completed/terminated interview across
// students (institute-scoped for Staff) — the "Student List" / results table the per-student-
// summary /admin/students endpoint above doesn't provide (that one aggregates one row per
// student, not one row per attempt).
router.get("/admin/sessions", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = buildAdminSessionWhere(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const [sessions, total] = await Promise.all([
      prisma.interviewSession.findMany({
        where,
        include: { student: { select: STUDENT_JOIN_SELECT }, report: { select: { overallScore: true } } },
        orderBy: { submittedAt: "desc" },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.interviewSession.count({ where }),
    ]);
    res.json({ rows: sessions.map(toReportRow), page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load interview reports" });
  }
});

// STAFF/ADMIN: dashboard summary cards + chart data, computed over the same filtered set as
// /admin/sessions above (so selecting a filter updates both the table and the charts).
router.get("/admin/analytics", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    // Staff requests are already institute-scoped, so the working set is naturally bounded. An
    // unscoped platform Admin request with no explicit date range is not — it would load every
    // completed interview across every institute, ever. Default that specific case to a rolling
    // 90-day window rather than silently materializing the whole table; an Admin who genuinely
    // wants all-time, cross-institute data can still ask for it explicitly via dateFrom/dateTo.
    let defaultDateRangeApplied = null;
    if (!req.requesterInstituteId && !req.query.dateFrom && !req.query.dateTo) {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      defaultDateRangeApplied = ninetyDaysAgo.toISOString().slice(0, 10);
      req.query.dateFrom = defaultDateRangeApplied;
    }
    const where = buildAdminSessionWhere(req);
    // Cache key includes the full effective filter set (post date-default) so two different
    // filter combinations never collide — TTL is short since an admin actively narrowing filters
    // expects each combination to compute fresh, this just protects against rapid re-renders/
    // double-fetches hitting the DB twice for the identical query.
    const cacheKey = `interview:analytics:${req.requesterInstituteId || "all"}:${JSON.stringify(req.query)}`;
    const payload = await cached(cacheKey, 30 * 1000, async () => {
      const sessions = await prisma.interviewSession.findMany({
        where,
        include: {
          student: { select: { batchYear: true, department: true, academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } } } },
          report: { select: { overallScore: true } },
        },
      });

      const withScore = sessions.filter((s) => s.report);
      const scores = withScore.map((s) => s.report.overallScore);
      const totalInterviews = sessions.length;
      const completedCount = sessions.filter((s) => s.status === "COMPLETED").length;
      const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const highestScore = scores.length ? Math.max(...scores) : 0;
      const lowestScore = scores.length ? Math.min(...scores) : 0;

      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000, monthMs = 30 * 24 * 60 * 60 * 1000;
      const thisWeekCount = sessions.filter((s) => s.submittedAt && now - new Date(s.submittedAt).getTime() <= weekMs).length;
      const thisMonthCount = sessions.filter((s) => s.submittedAt && now - new Date(s.submittedAt).getTime() <= monthMs).length;

      function groupAvg(keyFn) {
        const sums = new Map(), counts = new Map();
        for (const s of withScore) {
          const key = keyFn(s);
          if (!key) continue;
          sums.set(key, (sums.get(key) || 0) + s.report.overallScore);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...sums.entries()]
          .map(([key, sum]) => ({ key, count: counts.get(key), averageScore: Math.round(sum / counts.get(key)) }))
          .sort((a, b) => b.count - a.count);
      }

      const companyWise = groupAvg((s) => s.config?.company || null);
      const byGroup = groupAvg((s) => {
        const g = s.student.academicGroup;
        return g ? `${g.department?.name || "—"} - ${g.section}` : null;
      });
      const byBatch = groupAvg((s) => s.student.academicGroup?.batch || s.student.batchYear || null);
      const byType = groupAvg((s) => sessionTypeLabel(s));

      const weekly = new Map(), monthly = new Map();
      for (const s of withScore) {
        if (!s.submittedAt) continue;
        const d = new Date(s.submittedAt);
        const weekKey = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, "0")}-${d.getMonth() + 1}`;
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        for (const [map, key] of [[weekly, weekKey], [monthly, monthKey]]) {
          if (!map.has(key)) map.set(key, { sum: 0, count: 0 });
          const cur = map.get(key);
          cur.sum += s.report.overallScore; cur.count++;
        }
      }
      const toSeries = (map) => [...map.entries()].map(([period, { sum, count }]) => ({ period, averageScore: Math.round(sum / count), count }));

      // Placement-readiness is a rule-based score bucket (>=75 Ready, 50-74 Needs Improvement,
      // <50 Not Ready) for a quick-glance distribution chart — a heuristic threshold, not a
      // predictive model, same spirit as the rest of this platform's "no real AI" scoring.
      const placementReadiness = { ready: 0, needsImprovement: 0, notReady: 0 };
      for (const sc of scores) {
        if (sc >= 75) placementReadiness.ready++;
        else if (sc >= 50) placementReadiness.needsImprovement++;
        else placementReadiness.notReady++;
      }

      return {
        totalInterviews, completedCount, averageScore, highestScore, lowestScore, thisWeekCount, thisMonthCount,
        companyWise, byGroup, byBatch, byType,
        weeklyTrend: toSeries(weekly), monthlyTrend: toSeries(monthly),
        placementReadiness,
        defaultDateRangeApplied,
      };
    });

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load interview analytics" });
  }
});

// STAFF/ADMIN: full detail for one student's interview — session + report + every question with
// the student's answer/code and per-question score, plus a proctoring summary (violation counts
// by type, not just the raw log /admin/sessions/:sessionId/violations already exposes).
router.get("/admin/sessions/:sessionId/report", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        student: { select: STUDENT_JOIN_SELECT },
        answers: { orderBy: { createdAt: "asc" } },
        report: true,
        violations: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) return res.status(404).json({ error: "Session not found" });
    // session.student already carries instituteId (STUDENT_JOIN_SELECT) — no need for a second
    // query just to re-fetch the same student.
    if (req.requesterInstituteId && session.student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view students under your own institute" });
    }

    const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: session.answers.map((a) => a.questionId) } } });
    const ordered = session.answers.map((a) => ({ ...sanitizeQuestion(questions.find((q) => q.id === a.questionId) || {}, `${session.id}:${a.questionId}`), answer: a }));

    const violationsByType = {};
    for (const v of session.violations) violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;

    res.json({
      session, student: session.student, questions: ordered, report: session.report,
      proctoring: {
        violationCount: session.violationCount,
        terminationReason: session.terminationReason,
        byType: violationsByType,
        events: session.violations,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load interview report" });
  }
});

// STAFF/ADMIN: PDF download for any (institute-scoped) student's report — same generator as the
// student's own self-service download, just fetched by sessionId instead of the requester's own id.
router.get("/admin/sessions/:sessionId/report/pdf", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.sessionId },
      include: { student: { select: { name: true, instituteId: true } }, answers: { orderBy: { createdAt: "asc" } }, report: true },
    });
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (req.requesterInstituteId && session.student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view students under your own institute" });
    }
    if (!session.report) return res.status(400).json({ error: "This interview hasn't been submitted yet" });

    const questions = await prisma.interviewQuestion.findMany({ where: { id: { in: session.answers.map((a) => a.questionId) } } });
    const ordered = session.answers.map((a) => ({ ...sanitizeQuestion(questions.find((q) => q.id === a.questionId) || {}, `${session.id}:${a.questionId}`), answer: a }));

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="interview-report-${session.student.name.replace(/\s+/g, "-")}-${session.id.slice(0, 8)}.pdf"`);
    generateInterviewReportPdf({ studentName: session.student.name, session, questions: ordered, report: session.report }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate report PDF" });
  }
});

// STAFF/ADMIN: Excel summary export of the filtered session list (same filters as /admin/sessions,
// unpaginated) — one row per interview attempt.
router.get("/admin/sessions/export", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = buildAdminSessionWhere(req);
    const sessions = await prisma.interviewSession.findMany({
      where,
      include: { student: { select: STUDENT_JOIN_SELECT }, report: { select: { overallScore: true } } },
      orderBy: { submittedAt: "desc" },
      take: 5000,
    });
    const rows = sessions.map((s) => {
      const r = toReportRow(s);
      return {
        "Student Name": r.studentName, "Roll Number": r.rollNumber || "", "Registration Number (PRN)": r.registrationNumber || "",
        "Institute": r.institute || "", "Academic Group": r.groupLabel || "", "Batch": r.batchYear || "", "Department": r.department || "",
        "Interview Type": r.type, "Company": r.company || "", "Date": r.date ? new Date(r.date).toLocaleString() : "",
        "Score (%)": r.score ?? "", "Status": r.status,
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Interview Reports");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="interview-reports.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export interview reports" });
  }
});

module.exports = router;
