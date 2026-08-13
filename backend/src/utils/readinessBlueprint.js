const prisma = require("../prisma");
const { instituteWhere } = require("./questionVisibility");

// Question types this platform can actually grade automatically (see Question.questionType /
// utils/judge.js) — the same constraint every other coding surface (Formal Tests, Practice,
// Module Coding, Interview Prep) already operates under. The spec's Section 7 lists several
// question types (Short Answer, Case Study, System Design free-response, etc.) that have no
// grading path anywhere on this platform; adding a fabricated/heuristic grader for those here
// would be new, unreviewed scope, not a reuse of existing infrastructure — so Readiness
// assessments are scoped to exactly the types Question already supports and can score reliably.
const GRADABLE_QUESTION_TYPES = ["MCQ", "MULTISELECT", "TRUE_FALSE", "CODING", "SQL"];

const INTERVIEW_ANTI_REPEAT_DAYS = 90; // same default as interview.js's pickQuestions, reused here

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Spreads a level's selection across its available topics round-robin (pool grouped by
// Question.topic, one pick per group per pass) rather than a flat shuffle — flat shuffle over a
// pool skewed toward one topic (very common with a young question bank) would silently produce
// e.g. "8 of 9 Apply-level questions are all Arrays," which defeats the point of a topic-aware
// blueprint. Falls back to plain shuffle when there's only one topic group (nothing to spread).
function spreadAcrossTopics(pool, count) {
  const byTopic = new Map();
  for (const q of pool) {
    const key = q.topic || "__untagged__";
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(q);
  }
  if (byTopic.size <= 1) return shuffle(pool).slice(0, count);

  const groups = [...byTopic.values()].map((g) => shuffle(g));
  const picked = [];
  let round = 0;
  while (picked.length < count && groups.some((g) => g.length > round)) {
    for (const g of groups) {
      if (picked.length >= count) break;
      if (g[round]) picked.push(g[round]);
    }
    round++;
  }
  return picked;
}

// Resolves subject.defaultBtlDistribution (percentages keyed "1".."6") down to the [btlMin,btlMax]
// range an assessment mode allows, then distributes `questionCount` across the remaining levels
// proportionally. Uses largest-remainder rounding so individual level counts always sum to
// exactly questionCount (plain per-level rounding can drift the total off by 1-2 either way).
function resolveBtlTargets(defaultBtlDistribution, btlMin, btlMax, questionCount) {
  const levels = [];
  for (let lvl = btlMin; lvl <= btlMax; lvl++) levels.push(lvl);

  const weights = levels.map((lvl) => Math.max(0, Number(defaultBtlDistribution?.[String(lvl)]) || 0));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  // No usable distribution configured for this range (e.g. all zero) — split evenly rather than
  // producing an all-zero blueprint.
  const effectiveWeights = totalWeight > 0 ? weights : levels.map(() => 1);
  const effectiveTotal = effectiveWeights.reduce((s, w) => s + w, 0);

  const raw = effectiveWeights.map((w) => (w / effectiveTotal) * questionCount);
  const floors = raw.map(Math.floor);
  let remaining = questionCount - floors.reduce((s, v) => s + v, 0);
  const remainders = raw.map((v, i) => ({ i, frac: v - floors[i] })).sort((a, b) => b.frac - a.frac);
  const targets = { ...Object.fromEntries(levels.map((lvl, i) => [String(lvl), floors[i]])) };
  for (const { i } of remainders) {
    if (remaining <= 0) break;
    targets[String(levels[i])] += 1;
    remaining--;
  }
  return targets;
}

// Builds the actual question set for one ReadinessAssessment attempt. Returns:
//   { items: Question[], blueprint: { target, actual }, usedFallback: boolean, shortfallLevels: string[] }
// `target` is what the subject's configuration asked for; `actual` is what was really assembled —
// the two are allowed to differ (never padded with irrelevant questions to fake a full count), and
// any level short of its target is reported in `shortfallLevels` so the caller/report can be honest
// about what was and wasn't actually assessed, per the "never show 0% for an unassessed level" rule.
async function buildAssessmentBlueprint({ subject, assessmentMode, questionCount, studentInstituteId, excludeStudentId, includeDrafts = false }) {
  const modes = Array.isArray(subject.assessmentModes) ? subject.assessmentModes : [];
  const modeCfg = modes.find((m) => m.key === assessmentMode);
  if (!modeCfg) {
    const err = new Error(`Unknown assessment mode "${assessmentMode}" for this subject`);
    err.status = 400;
    throw err;
  }
  const btlMin = Math.max(1, Number(modeCfg.btlMin) || 1);
  const btlMax = Math.min(6, Number(modeCfg.btlMax) || 6);

  const allowedTypes = (Array.isArray(subject.questionTypesAllowed) ? subject.questionTypesAllowed : [])
    .filter((t) => GRADABLE_QUESTION_TYPES.includes(t));
  if (allowedTypes.length === 0) {
    const err = new Error("This subject has no gradeable question types configured");
    err.status = 400;
    throw err;
  }

  const targets = resolveBtlTargets(subject.defaultBtlDistribution, btlMin, btlMax, questionCount);

  let excludeIds = [];
  if (excludeStudentId) {
    const since = new Date(Date.now() - INTERVIEW_ANTI_REPEAT_DAYS * 24 * 60 * 60 * 1000);
    const recent = await prisma.readinessAnswer.findMany({
      where: { assessment: { studentId: excludeStudentId }, createdAt: { gte: since }, skipped: false },
      select: { questionId: true },
      distinct: ["questionId"],
    });
    excludeIds = recent.map((r) => r.questionId);
  }

  const statusWhere = includeDrafts
    ? {}
    : { questionStatus: { in: ["VERIFIED", "PUBLISHED"] } };
  const baseWhere = {
    ...instituteWhere(studentInstituteId),
    ...statusWhere,
    questionType: { in: allowedTypes },
    subject: { equals: subject.name, mode: "insensitive" },
  };

  const items = [];
  const actual = {};
  const shortfallLevels = [];
  let usedFallback = false;

  for (const [levelStr, target] of Object.entries(targets)) {
    if (target <= 0) { actual[levelStr] = 0; continue; }
    const level = Number(levelStr);
    const already = new Set(items.map((q) => q.id));
    const levelWhere = { ...baseWhere, btlLevel: level, id: { notIn: [...excludeIds, ...already] } };

    // testCases included so CODING/SQL questions carry their sample cases straight through to the
    // student-facing payload (routes/readiness.js's sanitizeQuestionForStudent filters out hidden
    // ones) without a second round-trip query.
    let pool = await prisma.question.findMany({ where: levelWhere, include: { testCases: true } });
    if (pool.length < target && excludeIds.length > 0) {
      // Drop the anti-repeat exclusion first, same fallback ordering as interview.js's pickQuestions
      // — a repeat question is a smaller compromise than an under-filled BTL level.
      usedFallback = true;
      pool = await prisma.question.findMany({ where: { ...baseWhere, btlLevel: level, id: { notIn: [...already] } }, include: { testCases: true } });
    }

    const picked = spreadAcrossTopics(pool, target);
    items.push(...picked);
    actual[levelStr] = picked.length;
    if (picked.length < target) shortfallLevels.push(levelStr);
  }

  return {
    items: shuffle(items),
    blueprint: { target: targets, actual },
    usedFallback,
    shortfallLevels,
  };
}

module.exports = { buildAssessmentBlueprint, resolveBtlTargets, GRADABLE_QUESTION_TYPES };
