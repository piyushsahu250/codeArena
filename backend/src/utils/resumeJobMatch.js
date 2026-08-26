// Rule-based (not AI) Job Match Score — compares a resume against a pasted job description using
// the same deterministic, whitelist-based keyword/skill overlap approach as resumeAts.js and
// resumeJobRoles.js. Same "no real AI/LLM anywhere on this platform" principle: this file never
// calls aiService/geminiProvider or any other model, and it never touches the database — it is a
// pure function of (resume, jobDescriptionText) plus the fixed dictionaries in this file and in
// jobDescriptionParser.js, which is exactly what makes "same resume + same JD text + same engine
// version -> always the same result, byte-for-byte" true without needing to persist anything.
//
// This score is DELIBERATELY separate from the CodeArena ATS Compatibility Score
// (resumeAts.js/computeAtsScore). The ATS score measures resume completeness + writing quality
// against a fixed generic rubric; this score measures keyword/skill overlap against ONE specific
// pasted job description. The two numbers are not comparable and must never be merged, averaged,
// or displayed as if they were the same metric.
const { parseJobDescription, normalizeTerm, SYNONYM_GROUPS } = require("./jobDescriptionParser");

const JOB_MATCH_ENGINE_VERSION = "v1.0";

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same alphanumeric-boundary fix as resumeAts.js's matchesKeyword — copied here (not imported)
// so this file stays dependency-free of resumeAts.js, per the feature spec.
function matchesKeyword(text, keyword) {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i").test(text);
}

// Same free-text gathering approach as resumeJobRoles.js's collectResumeText.
function collectResumeText(resume) {
  const parts = [resume.summary || ""];
  for (const s of arr(resume.skills)) parts.push(s.name || "");
  for (const p of arr(resume.projects)) parts.push(p.title || "", p.description || "", p.technologies || "");
  for (const e of arr(resume.experience)) parts.push(e.title || "", e.responsibilities || "", e.technologies || "");
  return parts.join(" ").toLowerCase();
}

// A skill/tech "name" field on this platform is often messy real-world data — "Git, Github
// (Intermediate)", "HTML,CSS (Intermediate)" — so this strips a trailing proficiency parenthetical
// and splits on the same separators resumeParser.js's splitSkillTokens uses, before normalizing
// each resulting token.
function splitSkillTokens(str) {
  return String(str || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .split(/[,•|;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Builds the resume's own normalized skill/technology footprint from its structured fields —
// skills[].name, projects[].technologies, experience[].technologies — so "JS" on the resume can
// match "JavaScript" required by the JD (both normalize to the same canonical term), while "Java"
// never matches "JavaScript" (they normalize to different, unrelated canonical terms).
function buildResumeSkillSet(resume) {
  const set = new Set();
  for (const s of arr(resume.skills)) {
    for (const token of splitSkillTokens(s.name)) set.add(normalizeTerm(token));
  }
  for (const p of arr(resume.projects)) {
    for (const token of splitSkillTokens(p.technologies)) set.add(normalizeTerm(token));
  }
  for (const e of arr(resume.experience)) {
    for (const token of splitSkillTokens(e.technologies)) set.add(normalizeTerm(token));
  }
  set.delete("");
  return set;
}

const SYNONYM_GROUP_BY_CANONICAL = new Map();
for (const group of SYNONYM_GROUPS) {
  SYNONYM_GROUP_BY_CANONICAL.set(group[0].toLowerCase().trim(), group);
}

// All surface forms a canonical term can appear as in free text (e.g. canonical "javascript" ->
// ["javascript", "js"]). A term with no synonym group is just itself.
function surfaceFormsFor(canonicalTerm) {
  return SYNONYM_GROUP_BY_CANONICAL.get(canonicalTerm) || [canonicalTerm];
}

// A JD skill/keyword (already canonicalized by jobDescriptionParser.js) is "on the resume" if
// either (a) it's in the resume's own structured skill/technology set, comparing canonical forms
// only — so "Postgres" on the resume satisfies a JD requiring "PostgreSQL" — or (b) any of its
// surface-form variants appears as a real word in the resume's free text (summary/descriptions),
// via the same boundary-safe matchesKeyword used everywhere else on this platform.
function resumeHasSkill(canonicalTerm, resumeSkillSet, resumeText) {
  if (resumeSkillSet.has(canonicalTerm)) return true;
  return surfaceFormsFor(canonicalTerm).some((variant) => matchesKeyword(resumeText, variant));
}

// Light display formatting for canonical terms, used only in the plain-language potentialGaps
// strings below — never changes the underlying canonical comparison logic above.
const DISPLAY_OVERRIDES = {
  aws: "AWS", "amazon web services": "AWS", sql: "SQL", "sql server": "SQL Server", api: "API",
  "rest api": "REST API", rest: "REST", ci: "CI", cd: "CD", "ci/cd": "CI/CD",
  "continuous integration": "CI", "continuous deployment": "CD", ml: "ML", "machine learning": "Machine Learning",
  ai: "AI", "artificial intelligence": "AI", nlp: "NLP", "natural language processing": "NLP",
  gcp: "GCP", "google cloud platform": "GCP", css: "CSS", html: "HTML", k8s: "Kubernetes",
  kubernetes: "Kubernetes", oop: "OOP", tdd: "TDD", php: "PHP", "c++": "C++", "c#": "C#",
  ".net": ".NET", "asp.net": "ASP.NET", mongodb: "MongoDB", mysql: "MySQL", postgresql: "PostgreSQL",
  javascript: "JavaScript", typescript: "TypeScript", "node": "Node.js", react: "React",
  "vue": "Vue.js", express: "Express.js", "scikit-learn": "scikit-learn", "vs code": "VS Code",
  "visual studio code": "VS Code", golang: "Go",
};

function displayTerm(canonical) {
  if (DISPLAY_OVERRIDES[canonical]) return DISPLAY_OVERRIDES[canonical];
  return canonical.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- Education match ----
const DEGREE_LEVEL_GROUPS = {
  bachelor: ["bachelor", "bachelors", "btech", "be", "bsc", "bca", "bba", "bcom"],
  master: ["master", "masters", "mtech", "me", "msc", "mca", "mba", "mcom"],
  phd: ["phd", "doctorate"],
  diploma: ["diploma"],
  associate: ["associate", "associates"],
};

function degreeLevel(str) {
  const norm = String(str || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!norm) return null;
  for (const [level, tokens] of Object.entries(DEGREE_LEVEL_GROUPS)) {
    if (tokens.some((t) => norm.includes(t))) return level;
  }
  return null;
}

function computeEducationMatch(resume, educationRequirement) {
  if (!educationRequirement || educationRequirement.length === 0) {
    return { matched: true, note: "Job description did not specify an education requirement." };
  }
  const requiredLevels = new Set(educationRequirement.map(degreeLevel).filter(Boolean));
  const resumeLevels = new Set(arr(resume.education).map((e) => degreeLevel(e.degree)).filter(Boolean));
  const matched = [...requiredLevels].some((lvl) => resumeLevels.has(lvl));
  const reqList = educationRequirement.join(", ");
  return matched
    ? { matched: true, note: `Resume includes a degree matching the job description's education requirement (${reqList}).` }
    : { matched: false, note: `Job description requires ${reqList}, but no matching degree was found in the resume's education section.` };
}

// ---- Certification match ----
function computeCertificationMatch(resume, jdCertifications) {
  const resumeCertNames = arr(resume.certifications).map((c) => (c.name || "").toLowerCase().trim()).filter(Boolean);
  const matched = [];
  const missing = [];
  for (const cert of jdCertifications) {
    const certLower = cert.toLowerCase().trim();
    const found = resumeCertNames.some((rc) => rc.includes(certLower) || certLower.includes(rc));
    (found ? matched : missing).push(cert);
  }
  return { matched, missing };
}

// ---- Relevant experience/projects ----
// Same idea as resumeJobRoles.js's relevantProjects: which resume entries mention 2+ of the JD's
// recognized skills/keywords, sorted by how many they mention.
function computeRelevantExperience(resume, allJdTerms) {
  const scoreEntry = (type, title, text) => {
    const lower = text.toLowerCase();
    const count = allJdTerms.filter((term) => surfaceFormsFor(term).some((v) => matchesKeyword(lower, v))).length;
    return { type, title: title || "(untitled)", count };
  };
  const entries = [
    ...arr(resume.projects).map((p) => scoreEntry("project", p.title, `${p.title || ""} ${p.description || ""} ${p.technologies || ""}`)),
    ...arr(resume.experience).map((e) => scoreEntry("experience", e.title, `${e.title || ""} ${e.responsibilities || ""} ${e.technologies || ""}`)),
  ];
  return entries.filter((e) => e.count >= 2).sort((a, b) => b.count - a.count);
}

// Main entry point. Pure function of (resume, jobDescriptionText) — never mutates `resume`, never
// touches Prisma/the database, never calls an AI service. Deterministic: identical inputs always
// produce an identical (JSON-equal) result, forever, unless JOB_MATCH_ENGINE_VERSION changes.
function computeJobMatch(resume, jobDescriptionText) {
  const jobDescription = parseJobDescription(jobDescriptionText);

  const resumeSkillSet = buildResumeSkillSet(resume);
  const resumeText = collectResumeText(resume);
  const hasSkill = (term) => resumeHasSkill(term, resumeSkillSet, resumeText);

  const allJdSkills = [
    ...new Set([
      ...jobDescription.requiredSkills,
      ...jobDescription.preferredSkills,
      ...jobDescription.technicalSkills,
      ...jobDescription.tools,
      ...jobDescription.technologies,
    ]),
  ].sort();

  const matchedSkills = allJdSkills.filter(hasSkill);
  const missingRequiredSkills = jobDescription.requiredSkills.filter((t) => !hasSkill(t));
  const missingPreferredSkills = jobDescription.preferredSkills.filter((t) => !hasSkill(t));

  const matchedKeywords = jobDescription.keywords.filter(hasSkill);
  const missingKeywords = jobDescription.keywords.filter((t) => !hasSkill(t));

  const relevantExperience = computeRelevantExperience(resume, jobDescription.keywords);

  // Conditional phrasing only — never an instruction to fabricate experience that doesn't exist.
  const potentialGaps = missingRequiredSkills.map(
    (term) => `Add ${displayTerm(term)} only if you have genuine ${displayTerm(term)} experience.`
  );

  const educationMatch = computeEducationMatch(resume, jobDescription.educationRequirement);
  const certificationMatch = computeCertificationMatch(resume, jobDescription.certifications);

  // 100-point breakdown, separate from and not comparable to the ATS score's own breakdown.
  // Required Skills Match matters most (40) since failing to meet a JD's stated must-haves is the
  // single biggest real-world rejection risk; Preferred (15) and Keyword Coverage (20) reward
  // broader overlap; Education/Experience/Certification round out the remaining 25.
  const requiredScore = jobDescription.requiredSkills.length === 0
    ? 40
    : Math.round(((jobDescription.requiredSkills.length - missingRequiredSkills.length) / jobDescription.requiredSkills.length) * 40);

  const preferredScore = jobDescription.preferredSkills.length === 0
    ? 15
    : Math.round(((jobDescription.preferredSkills.length - missingPreferredSkills.length) / jobDescription.preferredSkills.length) * 15);

  const keywordScore = jobDescription.keywords.length === 0
    ? 20
    : Math.round((matchedKeywords.length / jobDescription.keywords.length) * 20);

  const educationScore = educationMatch.matched ? 10 : 0;

  const experienceRelevanceScore = Math.min(relevantExperience.length, 2) * 5;

  const certificationScore = jobDescription.certifications.length === 0
    ? 5
    : Math.round((certificationMatch.matched.length / jobDescription.certifications.length) * 5);

  const breakdown = [
    { key: "requiredSkills", label: "Required Skills Match", score: requiredScore, max: 40 },
    { key: "preferredSkills", label: "Preferred Skills Match", score: preferredScore, max: 15 },
    { key: "keywordCoverage", label: "Keyword Coverage", score: keywordScore, max: 20 },
    { key: "education", label: "Education Match", score: educationScore, max: 10 },
    { key: "experienceRelevance", label: "Experience Relevance", score: experienceRelevanceScore, max: 10 },
    { key: "certifications", label: "Certification Match", score: certificationScore, max: 5 },
  ];
  const score = Math.min(100, breakdown.reduce((a, b) => a + b.score, 0));
  const status = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Fair" : "Needs Improvement";

  return {
    jobDescription,
    // Passed through displayTerm() here (not left as raw lowercase canonical strings like
    // "amazon web services") so the frontend can render these lists directly with no extra
    // formatting step of its own — matches resumeAts.js's convention of returning already
    // display-ready labels rather than pushing that formatting decision onto the UI layer.
    matchedSkills: matchedSkills.map(displayTerm),
    missingRequiredSkills: missingRequiredSkills.map(displayTerm),
    missingPreferredSkills: missingPreferredSkills.map(displayTerm),
    matchedKeywords: matchedKeywords.map(displayTerm),
    missingKeywords: missingKeywords.map(displayTerm),
    relevantExperience,
    potentialGaps,
    educationMatch,
    certificationMatch,
    score,
    status,
    breakdown,
    engineVersion: JOB_MATCH_ENGINE_VERSION,
    methodology: "CodeArena Job Match Score — this is a SEPARATE score from the CodeArena ATS Compatibility Score and must never be confused with it. It measures rule-based keyword/skill overlap between this resume and the ONE job description pasted in for this comparison only — it does not measure general resume quality or completeness (that's what the ATS score is for), and it does not run any real ATS product's parser or ranking logic. A high Job Match Score means this resume's stated skills/experience textually overlap with this job posting's stated requirements as extracted by this platform's own deterministic parser; it is not a guarantee of interview selection or of how any real employer's applicant-tracking system will actually rank this resume.",
  };
}

module.exports = { computeJobMatch, JOB_MATCH_ENGINE_VERSION };
