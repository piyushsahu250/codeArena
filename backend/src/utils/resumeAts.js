// Rule-based (not AI) resume completeness + ATS scoring — deterministic and reproducible, same
// spirit as the judge's exact-match grading elsewhere on this platform. "No real AI/LLM anywhere
// on this platform" is a deliberate, standing decision, not a missing feature.
//
// HONEST SCOPE (read before assuming this number means more than it does): this score measures
// resume completeness + general resume-writing quality + presence of ~38 generic CS keywords
// (see KEYWORDS below) against THIS rubric only. It does NOT match against any specific job
// description (no such feature exists on this platform), and it does NOT run the resume through
// any real external ATS product's parser (Workday/Greenhouse/Taleo/etc. all use different,
// proprietary parsing and ranking logic this platform has no access to). A resume can legitimately
// score 100/100 here — every section complete, well-written, keyword-rich by this rubric's own
// list — and still score very differently on a specific job posting's real ATS, because that
// system is scoring something else entirely (this exact resume's fit against ONE job's specific
// required keywords). This is why the frontend must label this "CodeArena ATS Compatibility Score"
// and never bare "ATS Score," and must never imply it predicts or guarantees any external result.
const ATS_ENGINE_VERSION = "v1.0";

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Plain `text.includes(keyword)` false-matches on any keyword that happens to be a substring of a
// longer, unrelated word — "oop" inside "cooperative", "git" inside "digital"/"legitimate", "api"
// inside "rapid"/"capital" — silently inflating the keyword/matchPercent score with credit the
// resume never earned. `\b` alone doesn't fix this for symbol-containing keywords like "c++" or
// "ci/cd" (a `\b` can't match between two non-word characters, e.g. "+" followed by a space), so
// this checks for alphanumeric adjacency directly via lookaround instead of word-boundary tokens.
function matchesKeyword(text, keyword) {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i").test(text);
}

const SECTION_DEFS = [
  { key: "personal", label: "Personal Details", check: (r) => !!(r.fullName && r.email && r.mobile) },
  { key: "summary", label: "Professional Summary", check: (r) => !!(r.summary && r.summary.trim().length >= 20) },
  { key: "education", label: "Education", check: (r) => arr(r.education).length > 0 },
  { key: "skills", label: "Skills", check: (r) => arr(r.skills).length > 0 },
  { key: "projects", label: "Projects", check: (r) => arr(r.projects).length > 0 },
  { key: "experience", label: "Experience", check: (r) => arr(r.experience).length > 0 },
  { key: "certifications", label: "Certifications", check: (r) => arr(r.certifications).length > 0 },
  { key: "achievements", label: "Achievements", check: (r) => arr(r.achievements).length > 0 },
  { key: "languages", label: "Languages", check: (r) => arr(r.languages).length > 0 },
];

function computeCompletion(resume, mandatorySections = []) {
  const results = SECTION_DEFS.map((s) => ({ key: s.key, label: s.label, complete: s.check(resume) }));
  const percent = Math.round((results.filter((r) => r.complete).length / results.length) * 100);
  const missingSections = results.filter((r) => !r.complete).map((r) => r.label);
  const missingMandatory = results.filter((r) => !r.complete && mandatorySections.includes(r.key)).map((r) => r.label);
  return { percent, missingSections, missingMandatory };
}

const KEYWORDS = [
  "java", "python", "c++", "javascript", "typescript", "sql", "git", "github", "api", "rest",
  "microservices", "data structures", "algorithms", "oop", "object-oriented", "agile", "scrum",
  "docker", "kubernetes", "aws", "azure", "cloud", "ci/cd", "testing", "unit test", "react",
  "node", "spring", "django", "database", "mongodb", "mysql", "postgresql", "machine learning",
  "linux", "html", "css",
];

const WEAK_PHRASES = ["worked on", "helped with", "was responsible for", "did", "handled", "involved in"];

const STRONG_ACTION_VERBS = [
  "developed", "built", "designed", "implemented", "created", "led", "managed", "optimized",
  "improved", "reduced", "increased", "automated", "architected", "launched", "deployed",
  "engineered", "streamlined", "spearheaded", "delivered", "collaborated", "integrated",
  "resolved", "achieved", "coordinated", "analyzed", "researched", "mentored", "established",
];

// Transparency detail, not a separately-scored category (the 100-point breakdown below already
// folds weak phrasing into "Readability" — this just surfaces exactly which strong verbs were
// found vs which weak phrases were flagged, so the suggestion isn't a black box).
function computeActionVerbUsage(text) {
  const strongVerbsFound = STRONG_ACTION_VERBS.filter((v) => matchesKeyword(text, v));
  const weakPhrasesFound = WEAK_PHRASES.filter((p) => matchesKeyword(text, p));
  return { strongCount: strongVerbsFound.length, weakCount: weakPhrasesFound.length, strongVerbsFound, weakPhrasesFound };
}

function collectSearchableText(resume) {
  const parts = [resume.summary || ""];
  for (const s of arr(resume.skills)) parts.push(s.name || "");
  for (const p of arr(resume.projects)) parts.push(p.description || "", p.technologies || "");
  for (const e of arr(resume.experience)) parts.push(e.responsibilities || "", e.technologies || "");
  return parts.join(" ").toLowerCase();
}

// Readability: a lightweight proxy, not a linguistic analysis — average sentence length (too
// long or too short both read poorly) and a crude passive-voice heuristic (was/were/is/are +
// a past-participle-looking word). Good enough to nudge toward "short, active-voice bullet
// points," which is the actual ATS/readability advice being approximated here.
function computeReadability(resume) {
  const blocks = [
    resume.summary || "",
    ...arr(resume.projects).map((p) => p.description || ""),
    ...arr(resume.experience).map((e) => e.responsibilities || ""),
  ].filter(Boolean);
  if (blocks.length === 0) return { score: 0, avgSentenceLength: 0, passivePercent: 0 };

  const allText = blocks.join(" ");
  const sentences = allText.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const wordCounts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const avgLen = wordCounts.length ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length : 0;
  const passiveMatches = (allText.match(/\b(was|were|is|are|been|being)\s+\w+ed\b/gi) || []).length;
  const passiveRatio = sentences.length ? passiveMatches / sentences.length : 0;

  let score = 5;
  if (avgLen > 30 || avgLen < 4) score -= 2;
  else if (avgLen > 25 || avgLen < 6) score -= 1;
  if (passiveRatio > 0.4) score -= 2;
  else if (passiveRatio > 0.2) score -= 1;

  return { score: Math.max(0, score), avgSentenceLength: Math.round(avgLen), passivePercent: Math.round(passiveRatio * 100) };
}

// Section maxes sum to exactly 100: Contact 10, Summary 10, Education 10, Skills 15, Projects
// 15, Experience 10, Certifications 5, Keywords 15, Formatting 5, Readability 5.
function computeAtsScore(resume) {
  const text = collectSearchableText(resume);
  const matchedKeywords = KEYWORDS.filter((k) => matchesKeyword(text, k));

  const contactScore = (() => {
    let s = resume.email && resume.mobile ? 6 : resume.email || resume.mobile ? 3 : 0;
    if (resume.linkedin) s += 2;
    if (resume.github || resume.portfolio) s += 2;
    return Math.min(s, 10);
  })();

  const summaryLen = (resume.summary || "").trim().length;
  const summaryScore = summaryLen >= 150 ? 10 : summaryLen >= 60 ? 7 : summaryLen >= 20 ? 4 : 0;

  const educationOk = arr(resume.education).some((e) => e.degree && e.institution);
  const educationScore = educationOk ? 10 : arr(resume.education).length > 0 ? 5 : 0;

  const skillsCount = arr(resume.skills).length;
  const skillsScore = Math.round((Math.min(skillsCount, 10) / 10) * 15);

  // Quality-gated, not just counted — a project entry with only a bare title (no description)
  // previously scored the same 4/4 points as a fully fleshed-out one, which let the score look
  // "done" while the actual content was empty. Mirrors the same bar `educationOk` already applies
  // to Education below (real, substantive content required for full credit, not just presence).
  const projects = arr(resume.projects);
  const projectQualityScore = projects.slice(0, 3).reduce((sum, p) => {
    if (p.title && p.description && p.description.trim().length >= 20) return sum + 4;
    if (p.title || p.description) return sum + 2;
    return sum;
  }, 0);
  const projectsScore = Math.min(projectQualityScore + (projects.some((p) => p.githubUrl || p.liveUrl) ? 3 : 0), 15);

  const experienceEntries = arr(resume.experience);
  const experienceCount = experienceEntries.length;
  const qualityExperienceCount = experienceEntries.filter((e) => e.title && e.company).length;
  const experienceScore = Math.min(qualityExperienceCount, 2) * 5;

  const certCount = arr(resume.certifications).length;
  const certScore = Math.round((Math.min(certCount, 3) / 3) * 5);

  const keywordScore = Math.round((Math.min(matchedKeywords.length, 12) / 12) * 15);

  const { percent: completionPercent } = computeCompletion(resume, []);
  const formattingScore = Math.round((completionPercent / 100) * 5);

  const readability = computeReadability(resume);
  const actionVerbUsage = computeActionVerbUsage(text);

  const breakdown = [
    { key: "contact", label: "Contact Information", score: contactScore, max: 10 },
    { key: "summary", label: "Professional Summary", score: summaryScore, max: 10 },
    { key: "education", label: "Education", score: educationScore, max: 10 },
    { key: "skills", label: "Technical Skills", score: skillsScore, max: 15 },
    { key: "projects", label: "Projects", score: Math.min(projectsScore, 15), max: 15 },
    { key: "experience", label: "Experience", score: experienceScore, max: 10 },
    { key: "certifications", label: "Certifications", score: certScore, max: 5 },
    { key: "keywords", label: "Keywords", score: keywordScore, max: 15 },
    { key: "formatting", label: "Formatting", score: formattingScore, max: 5 },
    { key: "readability", label: "Readability", score: readability.score, max: 5 },
  ];
  const score = Math.min(100, breakdown.reduce((a, b) => a + b.score, 0));
  const status = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Fair" : "Needs Improvement";

  // Structured, section-specific suggestions — {issue, recommendation} rather than one flat
  // list, so the frontend can render them the way the spec's own examples are formatted
  // ("❌ problem" / "Recommendation: fix").
  const suggestions = [];
  if (!resume.email || !resume.mobile) suggestions.push({ issue: "Missing email or phone number.", recommendation: "Add both an email address and a phone number — most ATS systems reject resumes without complete contact info." });
  if (!resume.linkedin) suggestions.push({ issue: "Missing LinkedIn profile.", recommendation: "Add your LinkedIn URL — recruiters check it before responding." });
  if (!resume.github && !resume.portfolio) suggestions.push({ issue: "Missing GitHub or portfolio link.", recommendation: "Add your GitHub profile to showcase coding projects, or a portfolio site if you have one." });
  if (summaryLen === 0) suggestions.push({ issue: "Professional Summary is missing.", recommendation: "Add 3–4 lines highlighting your technical expertise and career goals." });
  else if (summaryLen < 60) suggestions.push({ issue: "Professional Summary is too short.", recommendation: "Expand to 3–4 lines highlighting technical expertise and career goals." });
  if (!educationOk) suggestions.push({ issue: "Education details are incomplete.", recommendation: "Fill in degree, institution, and graduation year for each entry." });
  if (skillsCount < 6) suggestions.push({ issue: "Too few skills listed.", recommendation: "List at least 6–10 relevant technical skills, grouped by category." });
  if (projects.length === 0) suggestions.push({ issue: "No projects found.", recommendation: "Add at least 2–3 technical projects with a brief description and tech stack." });
  else if (projects.length === 1) suggestions.push({ issue: "Only one project found.", recommendation: "Add at least 2–3 technical projects to better demonstrate your range." });
  if (projects.length > 0 && !projects.some((p) => p.githubUrl || p.liveUrl)) suggestions.push({ issue: "Projects have no GitHub or live links.", recommendation: "Link to a GitHub repo or live demo for at least one project." });
  if (experienceCount === 0) suggestions.push({ issue: "No experience listed.", recommendation: "Add internship, freelance, or research experience if available — even short-term roles count." });
  if (certCount === 0) suggestions.push({ issue: "No certifications listed.", recommendation: "Add relevant certifications to strengthen your credentials." });
  if (matchedKeywords.length < 8) suggestions.push({ issue: "Resume is missing common industry keywords.", recommendation: "Include more role-relevant terms (e.g. Data Structures, REST APIs, Git, Cloud, Testing) naturally in your descriptions." });
  if (actionVerbUsage.weakCount > 0) {
    suggestions.push({
      issue: `Weak phrasing found (${actionVerbUsage.weakPhrasesFound.map((p) => `"${p}"`).join(", ")}).`,
      recommendation: 'Replace with a strong action verb and a specific outcome — e.g. "Developed a Java-based inventory system that streamlined manual tracking."',
    });
  } else if (actionVerbUsage.strongCount < 3 && (projects.length > 0 || experienceCount > 0)) {
    suggestions.push({
      issue: `Only ${actionVerbUsage.strongCount} strong action verb${actionVerbUsage.strongCount === 1 ? "" : "s"} found across project/experience descriptions.`,
      recommendation: "Start each bullet with a strong action verb — Developed, Built, Designed, Implemented, Optimized, Led — instead of describing what you were assigned.",
    });
  }
  if (readability.passivePercent > 30) suggestions.push({ issue: "Descriptions read as passive voice.", recommendation: "Rewrite in active voice, starting each bullet with an action verb (Built, Designed, Implemented, Optimized)." });
  if (!/\d/.test(text)) suggestions.push({ issue: "Missing measurable achievements.", recommendation: 'Quantify impact where you genuinely can — e.g. "reduced load time by 30%" or "supported 500+ users" — only using real numbers, never invented ones.' });

  return {
    score, status, breakdown, matchedKeywords, actionVerbUsage, suggestions: suggestions.slice(0, 10),
    engineVersion: ATS_ENGINE_VERSION,
    methodology: "CodeArena ATS Compatibility Score — measures resume completeness, keyword presence (against a fixed general list, not a specific job posting), and writing quality against this platform's own documented rubric. It does not match a job description and does not reproduce any external ATS product's scoring. Different systems use different algorithms; a high score here does not guarantee any particular result elsewhere.",
  };
}

module.exports = { SECTION_DEFS, computeCompletion, computeAtsScore, ATS_ENGINE_VERSION };
