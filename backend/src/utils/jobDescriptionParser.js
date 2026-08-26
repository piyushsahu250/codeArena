// Rule-based (not AI) job description parsing — deterministic extraction of structured fields
// from raw JD text, same "no real AI/LLM anywhere on this platform" principle as resumeAts.js and
// resumeJobRoles.js. This file has zero dependency on resumeParser.js or any other utils file by
// design (per the feature spec) so it can be reasoned about, tested, and reused in isolation.
//
// Same inputs -> same output, byte-for-byte, forever, unless a future change bumps this file's
// engine version constant. No network calls, no randomness, no Date.now(), no AI service.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same alphanumeric-boundary fix as resumeAts.js's matchesKeyword — plain `.includes()` false-
// matches "sql" inside "mysqld" or "ai" inside "domain" style substrings, silently inflating what
// looks like a recognized skill. Checked via lookaround (not `\b`) so symbol-containing terms like
// "c++", "c#", ".net", "ci/cd" still match correctly at a real word boundary.
function matchesKeyword(text, keyword) {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i").test(text);
}

// ---- Normalization dictionary (curated whitelist, NOT fuzzy matching) ----
// Every group below is a set of terms that are genuinely the same technology under a different
// name/spelling. Deliberately conservative: when in doubt, a term is left un-grouped rather than
// risked being merged with something only superficially similar (e.g. Java and JavaScript are
// never merged — they are unrelated technologies that happen to share a prefix).
const SYNONYM_GROUPS = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["react", "react.js", "reactjs"],
  ["node", "node.js", "nodejs"],
  ["vue", "vue.js", "vuejs"],
  ["express", "express.js", "expressjs"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["natural language processing", "nlp"],
  ["postgresql", "postgres"],
  ["mongodb", "mongo"],
  ["kubernetes", "k8s"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud platform", "google cloud"],
  ["continuous integration", "ci"],
  ["continuous deployment", "continuous delivery", "cd"],
  ["scikit-learn", "sklearn"],
  ["visual studio code", "vs code", "vscode"],
  ["golang", "go"],
];

const SYNONYM_LOOKUP = new Map();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0].toLowerCase().trim();
  for (const term of group) SYNONYM_LOOKUP.set(term.toLowerCase().trim(), canonical);
}

// Returns the canonical form of a term (the first item of whichever SYNONYM_GROUPS entry it
// belongs to, lowercased) so two synonymous terms compare equal. A term with no group just
// normalizes to its own lowercased/trimmed form.
function normalizeTerm(term) {
  const t = String(term || "").toLowerCase().trim();
  return SYNONYM_LOOKUP.get(t) || t;
}

// ---- Keyword dictionary (recognized skills/tools/technologies scanned across the whole JD) ----
// Expands on resumeAts.js's 38-word KEYWORDS list plus resumeParser.js's SKILL_CATEGORIES lists.
// Bare single-character tokens ("c", "r", "go") are deliberately excluded even though
// resumeParser.js's SKILL_CATEGORIES includes some of them — too high a false-positive risk when
// scanning free-flowing prose rather than a structured, user-authored skills list.
const KEYWORD_DICTIONARY = [
  // technical: languages, paradigms, core CS concepts
  { term: "java", category: "technical" },
  { term: "python", category: "technical" },
  { term: "c++", category: "technical" },
  { term: "c#", category: "technical" },
  { term: "javascript", category: "technical" },
  { term: "js", category: "technical" },
  { term: "typescript", category: "technical" },
  { term: "ts", category: "technical" },
  { term: "golang", category: "technical" },
  { term: "ruby", category: "technical" },
  { term: "php", category: "technical" },
  { term: "kotlin", category: "technical" },
  { term: "swift", category: "technical" },
  { term: "rust", category: "technical" },
  { term: "scala", category: "technical" },
  { term: "matlab", category: "technical" },
  { term: "html", category: "technical" },
  { term: "css", category: "technical" },
  { term: "sql", category: "technical" },
  { term: "data structures", category: "technical" },
  { term: "algorithms", category: "technical" },
  { term: "oop", category: "technical" },
  { term: "object-oriented", category: "technical" },
  { term: "agile", category: "technical" },
  { term: "scrum", category: "technical" },
  { term: "testing", category: "technical" },
  { term: "unit testing", category: "technical" },
  { term: "tdd", category: "technical" },
  { term: "microservices", category: "technical" },
  { term: "rest api", category: "technical" },
  { term: "rest", category: "technical" },
  { term: "api", category: "technical" },
  { term: "system design", category: "technical" },
  { term: "machine learning", category: "technical" },
  { term: "ml", category: "technical" },
  { term: "deep learning", category: "technical" },
  { term: "artificial intelligence", category: "technical" },
  { term: "ai", category: "technical" },
  { term: "nlp", category: "technical" },
  { term: "natural language processing", category: "technical" },
  { term: "computer vision", category: "technical" },
  { term: "data science", category: "technical" },
  { term: "statistics", category: "technical" },

  // tool: dev tools, IDEs, infra/CI tooling
  { term: "git", category: "tool" },
  { term: "github", category: "tool" },
  { term: "gitlab", category: "tool" },
  { term: "docker", category: "tool" },
  { term: "kubernetes", category: "tool" },
  { term: "k8s", category: "tool" },
  { term: "jenkins", category: "tool" },
  { term: "jira", category: "tool" },
  { term: "postman", category: "tool" },
  { term: "figma", category: "tool" },
  { term: "vs code", category: "tool" },
  { term: "visual studio code", category: "tool" },
  { term: "intellij", category: "tool" },
  { term: "eclipse", category: "tool" },
  { term: "linux", category: "tool" },
  { term: "bash", category: "tool" },
  { term: "webpack", category: "tool" },
  { term: "npm", category: "tool" },
  { term: "maven", category: "tool" },
  { term: "gradle", category: "tool" },
  { term: "terraform", category: "tool" },
  { term: "ansible", category: "tool" },
  { term: "circleci", category: "tool" },
  { term: "github actions", category: "tool" },
  { term: "gitlab ci", category: "tool" },
  { term: "excel", category: "tool" },
  { term: "jupyter", category: "tool" },
  { term: "jupyter notebook", category: "tool" },
  { term: "canva", category: "tool" },
  { term: "ci", category: "tool" },
  { term: "cd", category: "tool" },
  { term: "ci/cd", category: "tool" },

  // technology: frameworks, databases, cloud platforms, libraries
  { term: "react", category: "technology" },
  { term: "react.js", category: "technology" },
  { term: "reactjs", category: "technology" },
  { term: "angular", category: "technology" },
  { term: "vue", category: "technology" },
  { term: "vue.js", category: "technology" },
  { term: "node", category: "technology" },
  { term: "node.js", category: "technology" },
  { term: "nodejs", category: "technology" },
  { term: "express", category: "technology" },
  { term: "express.js", category: "technology" },
  { term: "next.js", category: "technology" },
  { term: "django", category: "technology" },
  { term: "flask", category: "technology" },
  { term: "spring", category: "technology" },
  { term: "spring boot", category: "technology" },
  { term: "hibernate", category: "technology" },
  { term: "laravel", category: "technology" },
  { term: ".net", category: "technology" },
  { term: "asp.net", category: "technology" },
  { term: "bootstrap", category: "technology" },
  { term: "tailwind", category: "technology" },
  { term: "tailwindcss", category: "technology" },
  { term: "fastapi", category: "technology" },
  { term: "mysql", category: "technology" },
  { term: "postgresql", category: "technology" },
  { term: "postgres", category: "technology" },
  { term: "mongodb", category: "technology" },
  { term: "sqlite", category: "technology" },
  { term: "oracle", category: "technology" },
  { term: "redis", category: "technology" },
  { term: "cassandra", category: "technology" },
  { term: "dynamodb", category: "technology" },
  { term: "firebase", category: "technology" },
  { term: "mssql", category: "technology" },
  { term: "sql server", category: "technology" },
  { term: "aws", category: "technology" },
  { term: "amazon web services", category: "technology" },
  { term: "azure", category: "technology" },
  { term: "gcp", category: "technology" },
  { term: "google cloud", category: "technology" },
  { term: "google cloud platform", category: "technology" },
  { term: "heroku", category: "technology" },
  { term: "vercel", category: "technology" },
  { term: "netlify", category: "technology" },
  { term: "tensorflow", category: "technology" },
  { term: "pytorch", category: "technology" },
  { term: "keras", category: "technology" },
  { term: "scikit-learn", category: "technology" },
  { term: "sklearn", category: "technology" },
  { term: "pandas", category: "technology" },
  { term: "numpy", category: "technology" },
  { term: "opencv", category: "technology" },
  { term: "jquery", category: "technology" },
  { term: "redux", category: "technology" },
  { term: "axios", category: "technology" },
];

// ---- Section heading recognition (same spirit as resumeParser.js's SECTION_SYNONYMS, but a
// small, standalone copy — this file must have no dependency on resumeParser.js) ----
const SECTION_SYNONYMS = {
  responsibilities: [
    "responsibilities", "duties", "key responsibilities", "roles and responsibilities",
    "role responsibilities", "what youll do", "day to day responsibilities", "job duties",
  ],
  required: [
    "requirements", "required skills", "required qualifications", "must have skills",
    "minimum qualifications", "minimum requirements", "basic qualifications", "qualifications",
    "who you are", "what you need", "what were looking for",
  ],
  preferred: [
    "preferred skills", "preferred qualifications", "nice to have", "nice to haves",
    "good to have", "good to haves", "bonus points", "bonus", "preferred", "a plus",
  ],
  education: ["education", "educational qualifications", "academic qualifications"],
  experience: ["experience", "work experience", "experience required", "years of experience"],
  certifications: ["certifications", "certificates", "licenses certifications", "certifications courses"],
};

function normalizeHeadingLine(line) {
  return line.replace(/[^a-zA-Z&\s]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function detectHeadingKind(line) {
  const norm = normalizeHeadingLine(line);
  if (!norm || norm.split(" ").length > 6) return null;
  for (const [kind, synonyms] of Object.entries(SECTION_SYNONYMS)) {
    if (synonyms.includes(norm)) return kind;
  }
  return null;
}

const BULLET_RE = /^[•\-*▪‣●○◦]\s*/;
function cleanBulletLine(line) {
  return line.replace(BULLET_RE, "").trim();
}

// A line is "required" if it falls under a Requirements/Required-heading section OR contains
// phrasing like "must have"/"required"/"mandatory". A line is "preferred" if under a
// Preferred/Nice-to-have heading OR contains "preferred"/"nice to have"/"good to have"/"a
// plus"/"bonus". Inline phrasing is checked first since it's the more specific signal.
const REQUIRED_PHRASE_RE = /\bmust[\s-]?have\b|\brequired\b|\bmandatory\b/i;
const PREFERRED_PHRASE_RE = /\bpreferred\b|\bnice[\s-]?to[\s-]?have\b|\bgood[\s-]?to[\s-]?have\b|\ba\s+plus\b|\bbonus\b/i;

function classifyLine(line, sectionKind) {
  if (REQUIRED_PHRASE_RE.test(line)) return "required";
  if (PREFERRED_PHRASE_RE.test(line)) return "preferred";
  if (sectionKind === "required") return "required";
  if (sectionKind === "preferred") return "preferred";
  return "neutral";
}

// ---- Title / company extraction ----
function extractTitle(lines) {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const labelMatch = line.match(/^(job title|position|role)\s*[:\-]\s*(.+)$/i);
    if (labelMatch) return labelMatch[2].trim();
  }
  const firstNonEmpty = lines.map((l) => l.trim()).find((l) => l !== "");
  if (firstNonEmpty) {
    const wordCount = firstNonEmpty.split(/\s+/).length;
    const looksLikeSentence = /[.!?]$/.test(firstNonEmpty) || wordCount > 10;
    if (firstNonEmpty.length < 80 && !looksLikeSentence) return firstNonEmpty;
  }
  return null;
}

const COMPANY_GENERIC_RE = /^(us|the role|this role|the position|the job|the company|our team|the team)$/i;

function extractCompany(lines) {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const labeled = line.match(/^(company|organization)\s*[:\-]\s*(.+)$/i);
    if (labeled) return labeled[2].trim();
    const about = line.match(/^about\s+(.+?)\s*:?\s*$/i);
    if (about) {
      const name = about[1].trim();
      if (name && !COMPANY_GENERIC_RE.test(name) && name.length < 60) return name;
    }
  }
  return null;
}

// ---- Experience requirement extraction ----
const EXP_RANGE_RE = /\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*\+?\s*years?/i;
const EXP_PLUS_RE = /\b(\d{1,2})\s*\+\s*years?/i;
const EXP_AT_LEAST_RE = /\bat\s*least\s*(\d{1,2})\s*years?/i;
const EXP_MINIMUM_RE = /\bmin(?:imum)?\s*(?:of\s*)?(\d{1,2})\s*years?/i;
const EXP_PLAIN_RE = /\b(\d{1,2})\s*years?\s*(?:of\s*)?experience/i;

function extractExperienceRequirement(text) {
  const rangeMatch = text.match(EXP_RANGE_RE);
  if (rangeMatch) return { minYears: parseInt(rangeMatch[1], 10), maxYears: parseInt(rangeMatch[2], 10), raw: rangeMatch[0].trim() };
  const plusMatch = text.match(EXP_PLUS_RE);
  if (plusMatch) return { minYears: parseInt(plusMatch[1], 10), maxYears: null, raw: plusMatch[0].trim() };
  const atLeastMatch = text.match(EXP_AT_LEAST_RE);
  if (atLeastMatch) return { minYears: parseInt(atLeastMatch[1], 10), maxYears: null, raw: atLeastMatch[0].trim() };
  const minMatch = text.match(EXP_MINIMUM_RE);
  if (minMatch) return { minYears: parseInt(minMatch[1], 10), maxYears: null, raw: minMatch[0].trim() };
  const plainMatch = text.match(EXP_PLAIN_RE);
  if (plainMatch) return { minYears: parseInt(plainMatch[1], 10), maxYears: null, raw: plainMatch[0].trim() };
  return { minYears: null, maxYears: null, raw: "" };
}

// ---- Education requirement extraction ----
// Same spirit as resumeParser.js's DEGREE_RE (duplicated here on purpose — this file must stand
// alone with zero dependency on resumeParser.js).
const DEGREE_RE = /\b(b\.?\s?tech|b\.?\s?e\.?\b|m\.?\s?tech|m\.?\s?e\.?\b|b\.?\s?sc|m\.?\s?sc|bca|mca|bba|mba|b\.?\s?com|m\.?\s?com|ph\.?\s?d|bachelor'?s?(?:\s+degree)?|master'?s?(?:\s+degree)?|diploma|associate'?s?\s?degree)\b/gi;

function extractEducationRequirement(text) {
  const matches = text.match(DEGREE_RE) || [];
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    const key = m.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m.trim().replace(/\s+/g, " "));
  }
  return result;
}

// ---- Certification extraction ----
function extractCertifications(lines, certSectionLines) {
  const result = [];
  const seen = new Set();
  const pushIfNew = (val) => {
    const v = cleanBulletLine(val);
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(v);
  };
  for (const l of certSectionLines) {
    if (l.trim()) pushIfNew(l);
  }
  const certSet = new Set(certSectionLines);
  for (const l of lines) {
    if (!l.trim() || certSet.has(l)) continue;
    if (!/certifi/i.test(l)) continue;
    const clauses = l.split(/[,;]/).map((c) => c.trim()).filter(Boolean);
    for (const c of clauses) if (/certifi/i.test(c)) pushIfNew(c);
  }
  return result;
}

// ---- Skill/tool/technology scanning ----
// Scans the ENTIRE JD text (not just section-scoped) for every dictionary term, tagging each
// occurrence's containing line as required/preferred/neutral based on which section it fell in
// (or its own inline phrasing). A term found on at least one required-classified line is treated
// as required even if it also appears elsewhere; otherwise a term found on at least one
// preferred-classified line is treated as preferred; everything else is neutral (still counted in
// technicalSkills/tools/technologies/keywords, just not in either requirement bucket).
function analyzeSkills(lineRecords) {
  const requiredSet = new Set();
  const preferredSet = new Set();
  const allFound = new Map(); // canonical -> category

  for (const { text, sectionKind } of lineRecords) {
    if (!text) continue;
    const classification = classifyLine(text, sectionKind);
    for (const entry of KEYWORD_DICTIONARY) {
      if (!matchesKeyword(text, entry.term)) continue;
      const canonical = normalizeTerm(entry.term);
      if (!allFound.has(canonical)) allFound.set(canonical, entry.category);
      if (classification === "required") requiredSet.add(canonical);
      else if (classification === "preferred") preferredSet.add(canonical);
    }
  }
  // A term classified required anywhere always wins over a merely-preferred classification
  // elsewhere in the document.
  for (const c of requiredSet) preferredSet.delete(c);

  const technicalSkills = [];
  const tools = [];
  const technologies = [];
  for (const [canonical, category] of allFound.entries()) {
    if (category === "technical") technicalSkills.push(canonical);
    else if (category === "tool") tools.push(canonical);
    else if (category === "technology") technologies.push(canonical);
  }

  return {
    requiredSkills: [...requiredSet].sort(),
    preferredSkills: [...preferredSet].sort(),
    technicalSkills: technicalSkills.sort(),
    tools: tools.sort(),
    technologies: technologies.sort(),
    keywords: [...allFound.keys()].sort(),
  };
}

// Main entry point. Pure function of `text` (plus the fixed dictionaries above) — no I/O, no
// randomness, no AI service. Same text in -> same structured object out, always.
function parseJobDescription(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((l) => l.trim());

  const lineRecords = [];
  const sectionLines = { responsibilities: [], required: [], preferred: [], education: [], experience: [], certifications: [] };
  let currentKind = null;
  for (const line of lines) {
    if (!line) continue;
    const headingKind = detectHeadingKind(line);
    if (headingKind) {
      currentKind = headingKind;
      continue;
    }
    lineRecords.push({ text: line, sectionKind: currentKind });
    if (currentKind && sectionLines[currentKind]) sectionLines[currentKind].push(line);
  }

  const { requiredSkills, preferredSkills, technicalSkills, tools, technologies, keywords } = analyzeSkills(lineRecords);

  return {
    title: extractTitle(lines),
    company: extractCompany(lines),
    requiredSkills,
    preferredSkills,
    technicalSkills,
    tools,
    technologies,
    responsibilities: sectionLines.responsibilities.map(cleanBulletLine).filter(Boolean),
    experienceRequirement: extractExperienceRequirement(raw),
    educationRequirement: extractEducationRequirement(raw),
    certifications: extractCertifications(lines, sectionLines.certifications),
    keywords,
  };
}

module.exports = { SYNONYM_GROUPS, normalizeTerm, parseJobDescription };
