// Deterministic (not AI) resume consistency / fact-checker — same "no real AI/LLM anywhere on
// this platform" standing decision as resumeAts.js. This module is READ-ONLY analysis: it never
// mutates the resume object it is given, and the caller (the route wiring this into an endpoint)
// must never use it to auto-correct or reject a save — it only surfaces suspicious-but-possibly-
// legitimate data for a HUMAN to review.
//
// HONEST SCOPE: a real student's resume can legitimately contain unusual-but-true situations —
// working while studying, a promotion at the same company, concurrent part-time roles, a dual
// degree. Every rule below is written to be conservative: it only fires on things that are
// genuinely internally inconsistent (an end date before its start date, the exact same skill
// listed twice, a malformed email), never on things that are merely uncommon. Every message is
// phrased as a request to verify ("please check"), never as an accusation or a claim that the
// data is definitely wrong — this module cannot know the student's real history, it can only spot
// patterns worth a second look.
const FACT_CHECK_ENGINE_VERSION = "v1.0";

const { isValidEmail } = require("./emailValidation");

// Precise, stable category strings — the route/UI layer that wires this in keys off these exact
// values (e.g. to group warnings by type or explain a category in the UI), so they are exported
// and must not be changed casually once something depends on them.
const CATEGORIES = {
  IMPOSSIBLE_DATE_RANGE: "impossible_date_range",
  OVERLAPPING_EMPLOYMENT: "overlapping_employment",
  EDUCATION_TIMELINE_CONFLICT: "education_timeline_conflict",
  DUPLICATE_SKILL: "duplicate_skill",
  DUPLICATE_PROJECT: "duplicate_project",
  CONTRADICTORY_JOB_TITLE: "contradictory_job_title",
  INVALID_EMAIL: "invalid_email",
  INVALID_PHONE: "invalid_phone",
  INVALID_URL: "invalid_url",
  DUPLICATE_CERTIFICATION: "duplicate_certification",
};

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function normalize(x) {
  return String(x || "").trim().toLowerCase();
}

function addWarning(warnings, severity, category, field, message) {
  warnings.push({ severity, category, field, message });
}

// Lenient year extractor — this platform's date fields are free-text ("Jan 2022", "2022",
// "10th August 2026", "Present", ...), not real Date objects, so this only ever looks for a bare
// 4-digit year and an explicit "present"/"current"/empty marker for "still ongoing." It never
// tries to parse a full calendar date — that would require guessing formats (DD/MM vs MM/DD,
// month-name locales, ordinals like "10th") this platform does not consistently produce, and a
// wrong guess there would turn a conservative checker into a source of false positives.
const ONGOING_RE = /\b(present|current)\b/i;
function parseLenientYear(raw) {
  if (raw === undefined || raw === null) return { year: null, ongoing: true }; // no end date at all = ongoing
  const str = String(raw).trim();
  if (str === "") return { year: null, ongoing: true };
  if (ONGOING_RE.test(str)) return { year: null, ongoing: true };
  const m = str.match(/\d{4}/);
  return m ? { year: parseInt(m[0], 10), ongoing: false } : { year: null, ongoing: false }; // unparseable text — treated as "unknown", not flagged either way
}

// True only when both bounds are known years AND the end year is strictly before the start year.
// "Present"/"current"/empty end, or either bound unparseable, is never impossible — this is
// deliberately the narrowest possible check (see rule #1 in the spec this implements).
function isImpossibleRange(startRaw, endRaw) {
  const end = parseLenientYear(endRaw);
  if (end.ongoing) return false;
  const start = parseLenientYear(startRaw);
  if (start.year == null || end.year == null) return false;
  return end.year < start.year;
}

// A comparable {startYear, endYear} range for overlap detection, or null when either bound can't
// be confidently determined (in which case the entry is silently excluded from overlap checks
// rather than guessed at — a missed warning is far safer here than a false one).
function getYearRange(startRaw, endRaw) {
  const start = parseLenientYear(startRaw);
  if (start.year == null) return null;
  const end = parseLenientYear(endRaw);
  const endYear = end.ongoing ? Infinity : end.year;
  if (endYear == null) return null;
  return { startYear: start.year, endYear };
}

// Genuine overlap = the two ranges share more than just a boundary year. Two roles/degrees where
// one ends in 2022 and the next starts in 2022 are NOT flagged — that's the ordinary "finished one
// thing and started the next the same year" case, not a conflict.
function rangesOverlap(a, b) {
  return a.startYear < b.endYear && b.startYear < a.endYear;
}

// "Fully" overlapping = one range entirely contains the other (or they're identical) — the strong
// signal used for the two full-time-degree and same-company-different-title checks, where a
// partial overlap is normal (dual-degree programs, back-to-back registration) but one range fully
// swallowing another is the kind of thing worth a human double-checking.
function rangesFullyOverlap(a, b) {
  if (!rangesOverlap(a, b)) return false;
  return (a.startYear <= b.startYear && a.endYear >= b.endYear) || (b.startYear <= a.startYear && b.endYear >= a.endYear);
}

// Syntactic URL validity only (rule #9's portfolio/project-link/certification-link check) — never
// used to require a specific domain. A bare domain like "example.com" is accepted by prepending
// "https://" first, since students very commonly type portfolio links without a protocol.
function isSyntacticallyValidUrl(value) {
  const str = String(value).trim();
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(str) ? str : `https://${str}`;
  try {
    // eslint-disable-next-line no-new
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

function looksLikeLinkedIn(value) {
  return /linkedin\.com/i.test(String(value));
}
function looksLikeGithub(value) {
  return /github\.com/i.test(String(value));
}

// One warning per duplicate-name GROUP (not one per pair) — three identical skill entries produce
// one warning naming all three indices, not three redundant ones about the same underlying issue.
function findDuplicateGroups(list, keyFn) {
  const groups = new Map(); // normalized key -> [index, ...]
  list.forEach((item, i) => {
    const key = keyFn(item);
    if (!key) return; // blank name — nothing meaningful to compare
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  return [...groups.values()].filter((indices) => indices.length > 1);
}

function checkImpossibleRanges(warnings, resume) {
  arr(resume.education).forEach((raw, i) => {
    const e = raw || {}; // a malformed entry (null, etc.) has no dates to conflict — never throw on it
    if (isImpossibleRange(e.startYear, e.endYear)) {
      addWarning(
        warnings, "error", CATEGORIES.IMPOSSIBLE_DATE_RANGE, `education[${i}].endYear`,
        "Please verify the education dates — they appear to end before they start."
      );
    }
  });
  arr(resume.experience).forEach((raw, i) => {
    const e = raw || {};
    if (isImpossibleRange(e.startDate, e.endDate)) {
      addWarning(
        warnings, "error", CATEGORIES.IMPOSSIBLE_DATE_RANGE, `experience[${i}].endDate`,
        "Please verify the experience dates — they appear to end before they start."
      );
    }
  });
}

// Rules #2 and #6 share the same pairwise scan: two experience entries with valid, overlapping
// date ranges, where "different" means differing in company OR title. When the pair is the more
// specific "same company, different title, fully overlapping" shape, only the more informative
// contradictory-job-title warning fires (not a redundant generic overlap warning for the same pair).
function checkExperienceOverlaps(warnings, resume) {
  const experience = arr(resume.experience);
  for (let i = 0; i < experience.length; i++) {
    for (let j = i + 1; j < experience.length; j++) {
      const a = experience[i] || {};
      const b = experience[j] || {};
      const rangeA = getYearRange(a.startDate, a.endDate);
      const rangeB = getYearRange(b.startDate, b.endDate);
      if (!rangeA || !rangeB) continue;
      if (!rangesOverlap(rangeA, rangeB)) continue;

      const sameCompany = normalize(a.company) && normalize(a.company) === normalize(b.company);
      const sameTitle = normalize(a.title) && normalize(a.title) === normalize(b.title);
      if (sameCompany && sameTitle) continue; // exact duplicate entry — not what either rule is about

      const fullyOverlap = rangesFullyOverlap(rangeA, rangeB);
      if (sameCompany && !sameTitle && fullyOverlap) {
        addWarning(
          warnings, "warning", CATEGORIES.CONTRADICTORY_JOB_TITLE, `experience[${i}], experience[${j}]`,
          `Please verify these two roles at "${a.company}" — the dates fully overlap but the job titles differ. If this reflects a promotion or title change, please confirm the dates are correct.`
        );
      } else {
        addWarning(
          warnings, "warning", CATEGORIES.OVERLAPPING_EMPLOYMENT, `experience[${i}], experience[${j}]`,
          "Please verify these two experience entries — their dates overlap. Concurrent or part-time roles are legitimate, so please just confirm this was intentional."
        );
      }
    }
  }
}

// Rule #3 — only fires on FULL overlap (one degree's years entirely containing the other's, or an
// exact match), not ordinary partial overlap, since partial overlap between two education entries
// (e.g. a bridging certificate finishing as a degree starts) is common and legitimate.
function checkEducationOverlaps(warnings, resume) {
  const education = arr(resume.education);
  for (let i = 0; i < education.length; i++) {
    for (let j = i + 1; j < education.length; j++) {
      const eduA = education[i] || {};
      const eduB = education[j] || {};
      const rangeA = getYearRange(eduA.startYear, eduA.endYear);
      const rangeB = getYearRange(eduB.startYear, eduB.endYear);
      if (!rangeA || !rangeB) continue;
      if (!rangesFullyOverlap(rangeA, rangeB)) continue;
      addWarning(
        warnings, "warning", CATEGORIES.EDUCATION_TIMELINE_CONFLICT, `education[${i}], education[${j}]`,
        "Please verify these two education entries — their date ranges fully overlap. If this reflects two genuinely parallel programs, please just confirm the dates are correct."
      );
    }
  }
}

function checkDuplicateSkills(warnings, resume) {
  const skills = arr(resume.skills);
  for (const indices of findDuplicateGroups(skills, (s) => normalize(s && s.name))) {
    const name = skills[indices[0]].name;
    addWarning(
      warnings, "warning", CATEGORIES.DUPLICATE_SKILL, `skills[${indices.join(",")}]`,
      `Please verify the skills list — "${name}" appears more than once.`
    );
  }
}

function checkDuplicateProjects(warnings, resume) {
  const projects = arr(resume.projects);
  for (const indices of findDuplicateGroups(projects, (p) => normalize(p && p.title))) {
    const title = projects[indices[0]].title;
    addWarning(
      warnings, "warning", CATEGORIES.DUPLICATE_PROJECT, `projects[${indices.join(",")}]`,
      `Please verify the projects list — "${title}" appears more than once.`
    );
  }
}

function checkDuplicateCertifications(warnings, resume) {
  const certifications = arr(resume.certifications);
  for (const indices of findDuplicateGroups(certifications, (c) => normalize(c && c.name))) {
    const name = certifications[indices[0]].name;
    addWarning(
      warnings, "warning", CATEGORIES.DUPLICATE_CERTIFICATION, `certifications[${indices.join(",")}]`,
      `Please verify the certifications list — "${name}" appears more than once.`
    );
  }
}

function checkContactFormats(warnings, resume) {
  if (resume.email && !isValidEmail(resume.email)) {
    addWarning(
      warnings, "warning", CATEGORIES.INVALID_EMAIL, "email",
      "Please verify the email address — it doesn't match a standard email format."
    );
  }

  if (resume.mobile) {
    const digits = String(resume.mobile).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      addWarning(
        warnings, "warning", CATEGORIES.INVALID_PHONE, "mobile",
        "Please verify the phone number — it doesn't look like a valid contact number (expected 10-15 digits)."
      );
    }
  }
}

function checkUrls(warnings, resume) {
  if (resume.linkedin && !looksLikeLinkedIn(resume.linkedin)) {
    addWarning(
      warnings, "warning", CATEGORIES.INVALID_URL, "linkedin",
      "Please verify the LinkedIn URL — it doesn't look like a linkedin.com profile link."
    );
  }
  if (resume.github && !looksLikeGithub(resume.github)) {
    addWarning(
      warnings, "warning", CATEGORIES.INVALID_URL, "github",
      "Please verify the GitHub URL — it doesn't look like a github.com profile link."
    );
  }
  if (resume.portfolio && !isSyntacticallyValidUrl(resume.portfolio)) {
    addWarning(
      warnings, "warning", CATEGORIES.INVALID_URL, "portfolio",
      "Please verify the portfolio URL — it doesn't look like a valid web address."
    );
  }

  arr(resume.projects).forEach((raw, i) => {
    const p = raw || {};
    if (p.githubUrl && !isSyntacticallyValidUrl(p.githubUrl)) {
      addWarning(
        warnings, "warning", CATEGORIES.INVALID_URL, `projects[${i}].githubUrl`,
        "Please verify this project's GitHub link — it doesn't look like a valid web address."
      );
    }
    if (p.liveUrl && !isSyntacticallyValidUrl(p.liveUrl)) {
      addWarning(
        warnings, "warning", CATEGORIES.INVALID_URL, `projects[${i}].liveUrl`,
        "Please verify this project's live demo link — it doesn't look like a valid web address."
      );
    }
  });

  arr(resume.certifications).forEach((raw, i) => {
    const c = raw || {};
    if (c.credentialUrl && !isSyntacticallyValidUrl(c.credentialUrl)) {
      addWarning(
        warnings, "warning", CATEGORIES.INVALID_URL, `certifications[${i}].credentialUrl`,
        "Please verify this certification's credential link — it doesn't look like a valid web address."
      );
    }
  });
}

// Pure function of its argument — no DB/Prisma calls, no network/AI calls, nothing but reading the
// `resume` object handed to it. Never mutates `resume` or any of its nested arrays/objects; every
// array is read via the defensive `arr()` helper so a missing/non-array field (undefined, null, a
// stray string) is treated as empty instead of throwing.
function checkResumeFacts(resume) {
  const safeResume = resume && typeof resume === "object" ? resume : {};
  const warnings = [];

  checkImpossibleRanges(warnings, safeResume);
  checkExperienceOverlaps(warnings, safeResume);
  checkEducationOverlaps(warnings, safeResume);
  checkDuplicateSkills(warnings, safeResume);
  checkDuplicateProjects(warnings, safeResume);
  checkDuplicateCertifications(warnings, safeResume);
  checkContactFormats(warnings, safeResume);
  checkUrls(warnings, safeResume);

  return {
    warnings,
    checkedAt: new Date().toISOString(),
    engineVersion: FACT_CHECK_ENGINE_VERSION,
  };
}

module.exports = { checkResumeFacts, FACT_CHECK_ENGINE_VERSION, CATEGORIES };
