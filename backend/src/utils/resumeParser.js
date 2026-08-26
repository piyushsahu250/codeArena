const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

// Heuristic, regex-based resume parsing — NOT a real NLP/AI model. This works well for
// single-column, text-based resumes (which is also what's ATS-recommended in the first place —
// the whole point of this feature). Multi-column layouts, graphics-heavy templates (e.g. some
// Canva designs), LaTeX/Overleaf PDFs (which can lose inter-word spaces entirely in the
// underlying text layer — a known pdf-parse limitation this can't fully correct for), and legacy
// .doc files degrade gracefully but with lower field-extraction accuracy — genuinely reliable
// resume parsing across arbitrary layouts is a hard, actively researched NLP problem that real
// commercial parsers (Sovren, Affinda, etc.) spend years on; this is a good-faith heuristic pass,
// not a claim of universal accuracy. Every extraction ships with a per-section confidence score
// (see computeConfidence) precisely so students know which fields to double-check rather than
// trusting a false sense of completeness.

// pdf-parse's default text renderer trusts the order pdf.js hands back text items in, which is
// the PDF content stream's internal declaration order — NOT necessarily top-to-bottom reading
// order. Many resume templates (Canva exports especially) position a date or company name as an
// absolutely-positioned "floating" text box rather than inline flowing text; the underlying PDF
// can declare that floating box's text anywhere in the stream regardless of where it's drawn on
// the page. Concretely: a "Work Experience" heading was found appearing in the extracted text
// AFTER the job entries it's supposed to introduce (right before "Projects" instead), which
// silently merged an entire Work Experience section into whatever section preceded it. This
// reconstructs each page's text by actual (x, y) glyph position instead — group text items into
// visual lines by Y-coordinate proximity, sort those lines top-to-bottom, and sort items within
// each line left-to-right — so extraction order matches what a human actually sees on the page.
// This does not attempt real multi-column layout detection (a genuinely hard, separate problem —
// see the file-level comment above); it fixes the specific "elements declared out of visual order
// within an otherwise single reading column" case, which is what broke on the reported test file.
function renderPageInReadingOrder(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((textContent) => {
    const LINE_TOLERANCE = 2; // points — items within this Y delta are treated as the same visual line
    const lineGroups = [];
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform[5];
      const x = item.transform[4];
      let group = lineGroups.find((g) => Math.abs(g.y - y) <= LINE_TOLERANCE);
      if (!group) { group = { y, items: [] }; lineGroups.push(group); }
      group.items.push({ str: item.str, x, endX: x + (item.width || item.str.length * 4) });
    }
    lineGroups.sort((a, b) => b.y - a.y); // PDF y-axis grows upward, so the top of the page has the largest y

    // Most consecutive lines sit one normal line-height apart; a visibly larger gap is the extra
    // spacing a template puts before a new entry/section — the paragraph-break signal splitBlocks()
    // (and, one level up, splitEntries()) relies on to tell "new project/job" apart from "wrapped
    // continuation of the same bullet". Joining every line with a single "\n" and nothing else
    // erases that signal entirely, forcing every resume through the much less reliable structural
    // fallback and causing entries to be mis-split even when the source PDF had normal spacing.
    const gaps = [];
    for (let i = 1; i < lineGroups.length; i++) gaps.push(lineGroups[i - 1].y - lineGroups[i].y);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const typicalGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 12;
    const gapThreshold = Math.max(typicalGap * 1.5, typicalGap + 4);

    const lines = [];
    lineGroups.forEach((group, i) => {
      if (i > 0 && lineGroups[i - 1].y - group.y > gapThreshold) lines.push("");
      group.items.sort((a, b) => a.x - b.x);
      let text = "";
      let lastEndX = null;
      for (const it of group.items) {
        if (lastEndX !== null && it.x - lastEndX > 1) text += " ";
        text += it.str;
        lastEndX = it.endX;
      }
      lines.push(text);
    });
    return lines.join("\n");
  });
}

async function extractTextFromFile(buffer, mimetype, filename) {
  const ext = String(filename || "").toLowerCase().split(".").pop();
  if (mimetype === "application/pdf" || ext === "pdf") {
    const data = await pdfParse(buffer, { pagerender: renderPageInReadingOrder });
    return data.text;
  }
  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    // extractRawText() only returns visible text — a "LinkedIn"/"GitHub" icon or label
    // hyperlinked to the actual profile URL (a very common resume pattern) has no visible URL
    // text at all, so the link target would otherwise vanish entirely. convertToHtml() preserves
    // <a href="..."> targets; appending them lets the existing email/LinkedIn/GitHub/portfolio
    // regexes (which already scan the whole extracted text, not just specific lines) pick them
    // up for free, with no other changes needed.
    const [textResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      mammoth.convertToHtml({ buffer }).catch(() => ({ value: "" })),
    ]);
    const hrefs = [...(htmlResult.value || "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    return hrefs.length ? `${textResult.value}\n${hrefs.join("\n")}` : textResult.value;
  }
  if (ext === "doc") {
    throw new Error("Legacy .doc files aren't supported. Please save your resume as .docx or .pdf and try again.");
  }
  throw new Error("Unsupported file type. Please upload a .pdf or .docx file.");
}

// ---- Section heading recognition ----
const SECTION_SYNONYMS = {
  summary: ["professional summary", "summary", "objective", "career objective", "about me", "profile", "professional profile", "personal summary"],
  education: ["education", "academic background", "academic qualifications", "educational qualifications", "qualifications", "academics"],
  skills: [
    "technical skills", "skills", "core skills", "competencies", "key skills", "skill set", "technical proficiencies",
    "areas of expertise", "technology stack", "tech stack", "tools and technologies", "tools & technologies",
    "technical tools", "tools", "technologies used", "technologies",
  ],
  projects: ["projects", "academic projects", "personal projects", "key projects", "project experience", "major projects"],
  experience: ["experience", "work experience", "professional experience", "employment history", "internship experience", "internships", "work history"],
  certifications: ["certifications", "certificates", "licenses & certifications", "courses & certifications", "certifications & courses"],
  achievements: ["achievements", "awards", "awards & achievements", "honors", "accomplishments", "extracurricular", "achievements & awards"],
  languages: ["languages", "languages known", "spoken languages"],
};

function normalizeHeading(line) {
  return line.replace(/[^a-zA-Z&\s]/g, "").trim().toLowerCase();
}

function detectSectionKey(line) {
  const norm = normalizeHeading(line);
  if (!norm || norm.split(/\s+/).length > 5) return null;
  for (const [key, synonyms] of Object.entries(SECTION_SYNONYMS)) {
    if (synonyms.includes(norm)) return key;
  }
  return null;
}

// Splits the raw text into { header, summary, education, skills, ... } line arrays. Blank lines
// are preserved as `""` entries within each section's array — when present, they're the most
// reliable signal for splitting a section into individual entries. But many PDF exports (Canva,
// Overleaf, some Word "Save as PDF" paths) simply don't preserve blank lines as blank lines in
// the extracted text layer, which is why entry-splitting below never relies on them exclusively.
function segmentSections(text) {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim());
  const sections = { header: [] };
  let current = "header";
  for (const line of rawLines) {
    if (line === "") {
      sections[current].push("");
      continue;
    }
    const key = detectSectionKey(line);
    if (key) {
      current = key;
      sections[key] = sections[key] || [];
      continue;
    }
    sections[current].push(line);
  }
  for (const k of Object.keys(sections)) {
    sections[k] = collapseBlankRuns(sections[k]);
  }
  return sections;
}

function collapseBlankRuns(lines) {
  const out = [];
  let lastBlank = true; // trims leading blanks
  for (const l of lines) {
    if (l === "") {
      if (!lastBlank) out.push("");
      lastBlank = true;
    } else {
      out.push(l);
      lastBlank = false;
    }
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function splitBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line === "") {
      if (current.length) { blocks.push(current); current = []; }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

// ---- Field-level regexes ----
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/;
const LINKEDIN_RE = /(https?:\/\/)?(www\.)?linkedin\.com\/[a-zA-Z0-9_\-/]+/i;
const GITHUB_RE = /(https?:\/\/)?(www\.)?github\.com\/[a-zA-Z0-9_\-/]+/i;
// Domain part requires 2+ characters — "M.Tech" (single-letter "M" + ".Tech") was previously
// matching this regex as if it were a domain name, and since it happened to be the first
// non-linkedin/github URL-shaped text found anywhere in the whole resume body, it got assigned
// as the portfolio link, corrupting the contact line with a stray "M.Tech" appended to it.
//
// The bare-domain alternative (no http(s):// or www. prefix) excludes a handful of common
// code/framework suffixes ("React.js", "Node.js", "Vue.js", "app.py", "styles.css", ...) via a
// negative lookahead — without this, a completely ordinary project-description line like "Built
// with React.js and Node.js" matched "React.js" as if it were a live-demo URL, which caused the
// WHOLE line to be pulled out of the description in parseProjectBlock (see the `liveMatch`
// branch there: matches are consumed per-line via `continue`, not per-substring), silently
// erasing real content and replacing it with a bogus liveUrl. A URL with an explicit http(s):// or
// www. prefix is always trusted regardless of its extension, since that's unambiguous.
const GENERIC_URL_RE = /https?:\/\/[^\s,;]+|www\.[a-zA-Z0-9-]{2,}\.[a-zA-Z]{2,}(?:\/[^\s,;]*)?|[a-zA-Z0-9-]{2,}\.(?!js\b|jsx\b|ts\b|tsx\b|py\b|css\b|html?\b)[a-zA-Z]{2,}(?:\/[^\s,;]*)?/i;
const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const DATE_TOKEN = `(?:(?:${MONTH})[a-z]*\\.?\\s*)?\\d{4}|present|current`;
const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:[-–—]|to)\\s*(${DATE_TOKEN})`, "i");
const YEAR_RE = /\b(19|20)\d{2}\b/;
const BULLET_RE = /^[•\-*▪‣●○◦]\s*/;
const TECH_LINE_RE = /^(tech(nologies)?( used)?|tools|stack)\s*[:\-]\s*(.+)/i;
const ROLE_LINE_RE = /^(role|position|my\s*role)\s*[:\-]\s*(.+)/i;

function extractPersonalDetails(headerLines, wholeText) {
  const details = { fullName: "", email: "", mobile: "", linkedin: "", github: "", portfolio: "", address: "" };

  const emailMatch = wholeText.match(EMAIL_RE);
  if (emailMatch) details.email = emailMatch[0];

  const phoneMatch = wholeText.match(PHONE_RE);
  if (phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 10) details.mobile = phoneMatch[0].trim();

  const linkedinMatch = wholeText.match(LINKEDIN_RE);
  if (linkedinMatch) details.linkedin = linkedinMatch[0];

  const githubMatch = wholeText.match(GITHUB_RE);
  if (githubMatch) details.github = githubMatch[0];

  // Portfolio: first generic URL that isn't linkedin/github/email domain — scoped to the
  // header/contact block only, not the whole document. A real portfolio link always lives in the
  // contact area; searching the entire resume body previously let an unrelated URL-shaped false
  // positive from anywhere in the document (e.g. a degree abbreviation) win the "first match"
  // and get assigned as the portfolio link.
  const headerText = headerLines.join("\n");
  const urlMatches = headerText.match(new RegExp(GENERIC_URL_RE, "gi")) || [];
  for (const u of urlMatches) {
    if (/linkedin\.com|github\.com/i.test(u)) continue;
    if (details.email && u.includes(details.email.split("@")[1])) continue;
    details.portfolio = u;
    break;
  }

  // Name: the first header line that looks like a person's name (2-4 capitalized words, no
  // digits/@/URLs). Some templates split the name across two lines ("John" / "Doe") or render
  // it fully upper-case ("JOHN DOE") — both are handled below.
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    if (!line || line.length > 50) continue;
    if (/[@\d]/.test(line)) continue;
    if (EMAIL_RE.test(line) || LINKEDIN_RE.test(line) || GITHUB_RE.test(line)) continue;
    const words = line.split(/\s+/);
    const looksLikeName =
      words.length >= 1 && words.length <= 4 &&
      words.every((w) => /^[A-Z][a-zA-Z.'-]*$/.test(w) || /^[A-Z]+$/.test(w));
    if (looksLikeName) {
      // All-caps single word followed by another all-caps word on the very next line is likely
      // a first-name/last-name split across two lines (some templates center-align each part).
      const next = headerLines[i + 1];
      if (words.length === 1 && next && /^[A-Z][a-zA-Z.'-]*$/.test(next) && next.length < 25) {
        details.fullName = `${toTitleCase(line)} ${toTitleCase(next)}`;
      } else {
        details.fullName = words.length === 1 && /^[A-Z]+$/.test(line) ? toTitleCase(line) : line;
      }
      break;
    }
  }

  // Address: a header/contact-area line with a pincode or 2+ comma-separated location parts
  for (const line of headerLines) {
    if (/\d{5,6}/.test(line) && !EMAIL_RE.test(line) && !PHONE_RE.test(line.replace(/\d{5,6}/, ""))) {
      details.address = line;
      break;
    }
    if ((line.match(/,/g) || []).length >= 2 && line.length < 80 && !EMAIL_RE.test(line)) {
      details.address = line;
      break;
    }
  }

  return details;
}

function toTitleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const DEGREE_RE = /\b(b\.?\s?tech|b\.?\s?e\.?\b|m\.?\s?tech|m\.?\s?e\.?\b|b\.?\s?sc|m\.?\s?sc|bca|mca|bba|mba|b\.?\s?com|m\.?\s?com|ph\.?\s?d|bachelor'?s?|master'?s?|diploma|class\s?xii|class\s?x\b|hsc|ssc|10th|12th|associate'?s?\s?degree)\b/i;

// A bare "NN%" is only trustworthy as a CGPA/percentage score when it's genuinely describing an
// academic score, not any percentage figure that happens to appear on the same line — e.g. a
// misclassified job-experience bullet ("resulting in a 90% improvement in user engagement") once
// got picked up as a CGPA purely because it contained "90%", fabricating a score that never
// existed in the Education section at all. A bare percentage is only accepted when the line looks
// short/score-like (no verbs like "improvement", "growth", "increase" nearby) — CGPA/GPA-labeled
// scores are always accepted since that label is unambiguous either way.
const SCORE_WORD_RE = /\b(cgpa|gpa)\b\s*[:\-]?\s*(\d+(\.\d+)?)|\b(\d+(\.\d+)?)\s*(cgpa|gpa)\b/i;
const BARE_PERCENT_RE = /(\d+(\.\d+)?)\s*%/;
const PERCENT_DISQUALIFIER_RE = /\b(improve|improvement|growth|increase|reduc|decrease|engagement|efficiency|performance|accuracy|coverage|users?|customers?|satisfaction|productivity)\b/i;

function parseEducationSection(lines) {
  const entries = [];
  let current = null;
  for (const raw of lines) {
    if (raw === "") continue;
    const line = raw.replace(BULLET_RE, "").trim();
    if (DEGREE_RE.test(line)) {
      if (current) entries.push(current);
      current = { degree: "", specialization: "", institution: "", board: "", startYear: "", endYear: "", score: "", status: "Completed" };
      const degMatch = line.match(DEGREE_RE);
      const matchStart = degMatch.index;
      // A qualifier word immediately before the matched abbreviation ("Integrated" in "Integrated
      // M.Tech.") is part of the degree name, not something to silently drop — previously only
      // "M.TECH" was kept and "Integrated" vanished with no trace.
      const before = line.slice(0, matchStart).trim();
      const qualifierMatch = before.match(/([A-Za-z]+)\s*$/);
      const qualifier = qualifierMatch && qualifierMatch[1].length <= 15 && !/[,()]/.test(qualifierMatch[1]) ? qualifierMatch[1] : "";
      current.degree = `${qualifier ? qualifier + " " : ""}${degMatch[0]}`.replace(/\s+/g, " ").trim().toUpperCase();
      const rest = line.slice(matchStart + degMatch[0].length).replace(/^[\s,.\-–]+/, "");
      // A parenthetical specialization ("(CSE – AI&ML)") must be captured whole — splitting on
      // the first comma/dash inside it (the old behavior) truncated "(CSE – AI&ML)" down to just
      // "CSE" and silently dropped "– AI&ML)".
      const parenMatch = rest.match(/\(([^)]+)\)?/);
      if (parenMatch) {
        current.specialization = parenMatch[1].trim();
      } else if (rest) {
        current.specialization = rest.split(/[,–\-|]/)[0].replace(/^(in|with|of)\s+/i, "").trim();
      }
    }
    if (!current) continue;
    const yearRange = line.match(/\b(19|20)\d{2}\b\s*[-–]\s*(present|current|\b(19|20)\d{2}\b)/i);
    if (yearRange) {
      const years = line.match(/\b(19|20)\d{2}\b/g) || [];
      current.startYear = years[0] || "";
      current.endYear = /present|current/i.test(yearRange[0]) ? "" : years[1] || "";
      if (/present|current/i.test(yearRange[0])) current.status = "Pursuing";
      continue;
    }
    const labeledScore = line.match(SCORE_WORD_RE);
    if (labeledScore) {
      current.score = labeledScore[0].trim();
      continue;
    }
    const bareScore = line.match(BARE_PERCENT_RE);
    if (bareScore && !PERCENT_DISQUALIFIER_RE.test(line) && line.length < 40) {
      current.score = bareScore[0].trim();
      continue;
    }
    // Keep the whole line — "Vellore Institute of Technology, Bhopal" previously lost ", Bhopal"
    // by only keeping the text before the first comma; a campus/city suffix is meaningful, not
    // noise to strip.
    if (!current.institution && !DEGREE_RE.test(line) && !bareScore) {
      current.institution = line;
    }
  }
  if (current) entries.push(current);
  return entries;
}

const SKILL_CATEGORIES = {
  "Programming Languages": ["java", "python", "c++", "c#", "javascript", "typescript", "golang", "go", "ruby", "php", "kotlin", "swift", "rust", "scala", "r", "matlab", "dart", "c"],
  "Frameworks": ["react", "react.js", "angular", "vue", "vue.js", "spring", "spring boot", "django", "flask", "express", "express.js", "node.js", "node", "next.js", "laravel", ".net", "asp.net", "bootstrap", "tailwind", "tailwindcss", "hibernate", "fastapi"],
  "Databases": ["mysql", "postgresql", "postgres", "mongodb", "sqlite", "oracle", "redis", "cassandra", "dynamodb", "firebase", "mssql", "sql server", "sql"],
  "Cloud": ["aws", "azure", "gcp", "google cloud", "google cloud platform", "heroku", "vercel", "netlify", "aws lambda", "amazon web services"],
  "DevOps": ["docker", "kubernetes", "terraform", "jenkins", "ci/cd", "ansible", "github actions", "gitlab ci", "circleci"],
  "Tools": ["git", "github", "gitlab", "postman", "jira", "figma", "vs code", "visual code studio", "visual studio code", "intellij", "eclipse", "linux", "bash", "webpack", "npm", "maven", "gradle", "excel", "jupyter notebook", "jupyter", "apache netbeans", "netbeans", "canva"],
  "Libraries": ["jquery", "numpy", "pandas", "matplotlib", "scikit-learn", "sklearn", "tensorflow", "pytorch", "keras", "opencv", "seaborn", "redux", "axios", "lodash", "plotly"],
  "Soft Skills": ["communication", "teamwork", "leadership", "problem solving", "problem-solving", "time management", "adaptability", "collaboration", "critical thinking", "public speaking"],
};

// Spoken languages are cross-checked out of the Skills section when a resume lists them there
// instead of (or in addition to) a dedicated Languages section — e.g. "Skills: Java, Python,
// English, Hindi" — so "English"/"Hindi" don't end up miscategorized as "Other" technical skills.
const SPOKEN_LANGUAGES = [
  "english", "hindi", "marathi", "tamil", "telugu", "kannada", "malayalam", "gujarati", "bengali",
  "punjabi", "urdu", "odia", "assamese", "french", "german", "spanish", "mandarin", "chinese",
  "japanese", "russian", "arabic", "portuguese", "italian", "korean",
];

function categorizeSkill(name) {
  const lower = name.toLowerCase().trim();
  for (const [category, list] of Object.entries(SKILL_CATEGORIES)) {
    if (list.includes(lower)) return category;
  }
  return "Other";
}

// A line's own explicit category label ("Programming Languages: Python, Java") is a far stronger
// signal than guessing per-token via keyword lookup — respecting it is what fixes a resume like
// "Programming Languages : Python, ... / Web Technologies : HTML, CSS, ... / Database : MySQL"
// from collapsing into one indistinguishable "Other" blob. Previously the whole section was
// joined into one comma list with no per-line awareness at all: the label text itself doesn't
// match any hardcoded skill keyword, so with no line-aware parsing every category label became a
// bogus "skill" of its own (dumped in "Other"), while the *values* got separately auto-bucketed
// by keyword-matching regardless of what the user actually labeled them as.
const CATEGORY_LABEL_RE = /^([A-Za-z][A-Za-z &/-]{1,40}?)\s*:\s*(.+)$/;
const KNOWN_CATEGORY_ALIASES = {
  "programming languages": "Programming Languages", "programming language": "Programming Languages",
  "frameworks": "Frameworks", "framework": "Frameworks", "frameworks & libraries": "Frameworks",
  "databases": "Databases", "database": "Databases",
  "cloud": "Cloud", "cloud platforms": "Cloud", "cloud technologies": "Cloud",
  "devops": "DevOps", "devops tools": "DevOps",
  "tools": "Tools", "tools & technologies": "Tools", "developer tools": "Tools",
  "libraries": "Libraries", "library": "Libraries",
  "soft skills": "Soft Skills", "soft skill": "Soft Skills",
};

function resolveExplicitCategory(label) {
  const key = label.toLowerCase().trim();
  if (KNOWN_CATEGORY_ALIASES[key]) return KNOWN_CATEGORY_ALIASES[key];
  // An unrecognized-but-explicit label ("Web Technologies", "Testing Tools") is still a real,
  // user-authored category — Title Case it and keep it as its own group rather than discarding
  // it into "Other", which would throw away structure the user deliberately wrote.
  return label.replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function splitSkillTokens(str) {
  return str.split(/[,•|;\/]/).map((s) => s.trim()).filter(Boolean);
}

function parseSkillsSection(lines) {
  const seen = new Set();
  const skills = [];
  const spokenLanguages = [];

  function addToken(rawToken, explicitCategory) {
    const cleaned = rawToken.replace(BULLET_RE, "").replace(/\.$/, "").trim();
    if (cleaned.length < 2 || cleaned.length > 30) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (SPOKEN_LANGUAGES.includes(key)) {
      spokenLanguages.push({ name: toTitleCase(cleaned), proficiency: "Intermediate" });
      return;
    }
    skills.push({ category: explicitCategory || categorizeSkill(cleaned), name: cleaned, proficiency: "" });
  }

  // Some templates wrap one long "Category: values" list across two lines (label on one line,
  // more values starting the next). A carried category only applies when the previous line
  // visibly continues (ends in a trailing comma) — otherwise a later plain line (e.g. a
  // standalone "Cloud Architecture" with no label at all) would wrongly inherit whatever
  // category came before it.
  let carryCategory = null;
  let prevEndedWithComma = false;
  for (const raw of lines) {
    if (raw === "") { carryCategory = null; prevEndedWithComma = false; continue; }
    const line = raw.replace(BULLET_RE, "").trim();
    const labelMatch = line.match(CATEGORY_LABEL_RE);
    if (labelMatch) {
      const category = resolveExplicitCategory(labelMatch[1]);
      const value = labelMatch[2];
      for (const token of splitSkillTokens(value)) addToken(token, category);
      carryCategory = value.trim().endsWith(",") ? category : null;
    } else {
      for (const token of splitSkillTokens(line)) addToken(token, prevEndedWithComma ? carryCategory : null);
      carryCategory = prevEndedWithComma && line.trim().endsWith(",") ? carryCategory : null;
    }
    prevEndedWithComma = line.trim().endsWith(",");
  }
  return { skills, spokenLanguages };
}

// ---- Multi-entry splitting for Projects/Experience (the main accuracy fix) ----
//
// Blank-line separation between entries is the most reliable signal when present, but many PDF
// exports don't preserve it — so when a section reduces to a single block via blank lines, this
// structural fallback splits it using three signals instead: (1) an explicit ordinal header like
// "Project 2" or "Internship 1", (2) a plain (non-bulleted) line appearing right after we've
// already started collecting body content (bullets/description/tech) for the current entry —
// the classic "Title" -> bullets -> next "Title" pattern — and (3) never anything mid-entry, so
// a resume with genuinely one very long entry isn't incorrectly fragmented.
const ORDINAL_HEADER_RE = /^(project|experience|internship|work\s*experience|company)\s*[#:\-]?\s*\d+\b\s*[:\-]?\s*$/i;

function splitStructuralEntries(lines) {
  const nonEmpty = lines.filter((l) => l !== "");
  if (nonEmpty.length === 0) return [];

  const entries = [];
  let current = null;
  let sawBodyContent = false;

  for (const raw of nonEmpty) {
    const isOrdinal = ORDINAL_HEADER_RE.test(raw);
    const isBullet = BULLET_RE.test(raw);
    const isTechLine = TECH_LINE_RE.test(raw);

    if (isOrdinal) {
      // The ordinal line itself ("Project 2") is a label, not content — start a fresh entry and
      // don't push the label line into it.
      if (current && current.length) entries.push(current);
      current = [];
      sawBodyContent = false;
      continue;
    }

    // A long bullet that wraps across two visual lines in the source PDF produces a second raw
    // line with no bullet marker of its own (only the wrap's first line keeps the "•") — without
    // this guard, that wrap-continuation line looked identical to "a plain line after body
    // content", the exact signal used to detect a *new* entry's title, and got misread as one.
    // A continuation line reliably starts lowercase (it's mid-sentence); a real title doesn't.
    const looksLikeContinuation = /^[a-z]/.test(raw.trim());
    // A genuine new entry's title is short, like "SPAM MAIL PREDICTION" — a wrapped bullet's
    // *first* line-fragment (no bullet marker to identify it by, since not every template renders
    // list bullets as an extractable text glyph at all) is capitalized too, so it passes the
    // continuation check above, but reads like "Performed feature engineering using key variables
    // like temperature and humidity, enhancing model" — a near-full-width sentence fragment, not a
    // title. Titles also don't dangle on a mid-clause punctuation mark the way a wrap point can.
    const looksLikeTitle = raw.trim().length < 80 && !/[,;:]$/.test(raw.trim());
    const startsNewEntry = current && current.length > 0 && !isBullet && sawBodyContent && !looksLikeContinuation && looksLikeTitle;
    if (startsNewEntry) {
      entries.push(current);
      current = [];
      sawBodyContent = false;
    }
    if (!current) current = [];
    current.push(raw);

    if (isBullet || isTechLine) sawBodyContent = true;
    else if (current.length > 1) sawBodyContent = true; // a second plain line is body/description too
  }
  if (current && current.length) entries.push(current);
  return entries;
}

// Blank-line splitting first (trusted when it actually finds more than one block); structural
// splitting only as a fallback when the whole section collapsed into a single undivided block.
function splitEntries(lines) {
  const blankBased = splitBlocks(lines);
  if (blankBased.length > 1) return blankBased;
  const structural = splitStructuralEntries(lines);
  return structural.length > 0 ? structural : blankBased;
}

// Certifications are usually one per line (or one short multi-line block per cert). A
// "continuation" line — a date, a bare URL, an "Issued by ..." clause, a parenthetical, or a
// line starting lowercase — is folded into the current entry; anything else starts a new one.
function isCertContinuationLine(line) {
  if (/^\(/.test(line)) return true;
  if (/^(issued by|issuer|org(anization)?)\s*[:\-]/i.test(line)) return true;
  if (DATE_RANGE_RE.test(line) && line.replace(DATE_RANGE_RE, "").trim().length < 5) return true;
  if (YEAR_RE.test(line) && line.trim().length < 15) return true;
  const urlMatch = line.match(GENERIC_URL_RE);
  if (urlMatch && line.trim().length < 60 && line.replace(urlMatch[0], "").trim().split(/\s+/).filter((w) => w.length > 3).length === 0) return true;
  if (/^[a-z]/.test(line)) return true;
  return false;
}

function splitCertEntries(lines) {
  const blankBased = splitBlocks(lines);
  if (blankBased.length > 1) return blankBased;
  const nonEmpty = lines.filter((l) => l !== "");
  const entries = [];
  let current = [];
  for (const line of nonEmpty) {
    if (current.length > 0 && !isCertContinuationLine(line)) {
      entries.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) entries.push(current);
  return entries;
}

function parseProjectBlock(lines) {
  const p = { title: "", description: "", technologies: "", role: "", duration: "", githubUrl: "", liveUrl: "" };
  const descLines = [];
  let titleSet = false;
  for (const raw of lines) {
    const isBullet = BULLET_RE.test(raw);
    const line = raw.replace(BULLET_RE, "").trim();
    const githubMatch = line.match(GITHUB_RE);
    const techMatch = line.match(TECH_LINE_RE);
    const roleMatch = line.match(ROLE_LINE_RE);
    const dateMatch = line.match(DATE_RANGE_RE);
    if (!titleSet && !isBullet && line.length < 80 && !githubMatch && !techMatch && !roleMatch && !dateMatch) {
      p.title = line;
      titleSet = true;
      continue;
    }
    if (githubMatch) { p.githubUrl = githubMatch[0]; continue; }
    if (techMatch) { p.technologies = techMatch[4]; continue; }
    if (roleMatch) { p.role = roleMatch[2]; continue; }
    if (dateMatch && !p.duration) { p.duration = dateMatch[0]; continue; }
    const liveMatch = line.match(GENERIC_URL_RE);
    if (liveMatch && !GITHUB_RE.test(line) && !p.liveUrl) { p.liveUrl = liveMatch[0]; continue; }
    descLines.push(line);
  }
  // Every line was bulleted (no plain title line found, e.g. "Project 2" ordinal header with
  // every real line under it bulleted) — fall back to the first collected line as the title.
  if (!titleSet && descLines.length > 0) {
    p.title = descLines.shift();
  }
  // A short bare comma-separated word list with no "Tech:" prefix ("Java, Spring Boot, MySQL")
  // is almost always the tech stack, not a prose description — reclassify it.
  if (!p.technologies && descLines.length === 1 && /^[\w+#.() ]+(,\s*[\w+#.() ]+){1,7}$/.test(descLines[0]) && descLines[0].length < 100) {
    p.technologies = descLines.shift();
  }
  p.description = descLines.join(" ").trim();
  return p;
}

function parseExperienceBlock(lines) {
  const e = { company: "", title: "", employmentType: "Internship", startDate: "", endDate: "", responsibilities: "", technologies: "" };
  const descLines = [];
  let headerSet = false;
  let companySet = false;
  for (const raw of lines) {
    const isBullet = BULLET_RE.test(raw);
    const line = raw.replace(BULLET_RE, "").trim();
    const techMatch = line.match(TECH_LINE_RE);
    const dateMatch = line.match(DATE_RANGE_RE);
    if (!headerSet && !isBullet && line.length < 100 && !techMatch) {
      const sep = line.split(/\s[—\-|]\s|\sat\s/i);
      if (sep.length >= 2) {
        e.title = sep[0].trim();
        e.company = sep.slice(1).join(" ").trim();
        companySet = true;
      } else {
        e.title = line;
      }
      headerSet = true;
      continue;
    }
    // The company name very often sits on its own line right after the title, before any
    // bullets/dates ("Software Engineer" / "ABC Company" as two separate lines) — without this,
    // that line was silently falling through to `responsibilities` and the Company field stayed
    // blank. Guarded to short, non-sentence-like lines so real bulletless description text (long,
    // ends in punctuation) doesn't get misread as a company name.
    if (headerSet && !companySet && !isBullet && !techMatch && !dateMatch && line.length < 60 && line.split(/\s+/).length <= 6 && !/[.!?]$/.test(line)) {
      e.company = line;
      companySet = true;
      continue;
    }
    if (techMatch) { e.technologies = techMatch[4]; continue; }
    if (dateMatch) {
      companySet = true; // a date line always ends the header block either way
      const parts = dateMatch[0].split(/[-–—]|(?:\bto\b)/i).map((s) => s.trim()).filter(Boolean);
      e.startDate = parts[0] || "";
      e.endDate = parts[1] || "";
      continue;
    }
    companySet = true; // first real description line also ends the header block
    descLines.push(line);
  }
  if (!headerSet && descLines.length > 0) {
    e.title = descLines.shift();
  }
  e.responsibilities = descLines.join(" ").trim();
  return e;
}

function parseCertBlock(lines) {
  let rest = lines.map((l) => l.replace(BULLET_RE, "")).join(" ").trim();
  const c = { name: "", org: "", issueDate: "", credentialId: "", credentialUrl: "" };
  const urlMatch = rest.match(GENERIC_URL_RE);
  if (urlMatch) { c.credentialUrl = urlMatch[0]; rest = rest.replace(urlMatch[0], "").trim(); }
  const idMatch = rest.match(/(credential\s*id|cert(ificate)?\s*id|id)\s*[:\-]\s*([\w-]+)/i);
  if (idMatch) { c.credentialId = idMatch[3]; rest = rest.replace(idMatch[0], "").trim(); }
  const dateMatch = rest.match(DATE_RANGE_RE) || rest.match(YEAR_RE);
  if (dateMatch) { c.issueDate = dateMatch[0]; rest = rest.replace(dateMatch[0], "").trim(); }
  // Splitting on every comma broke titles that legitimately contain commas of their own — a real
  // Coursera course title, "HTML, CSS, and JavaScript for Web Developers", got chopped down to
  // just "HTML" (first comma segment) with the actual issuer "Coursera" discarded entirely (it
  // was never even parts[1], since the extra commas shifted everything over). A dash/pipe
  // separator (" — ", " - ", " | ") is checked first since it's unambiguous; when only commas
  // remain, the LAST comma is treated as the title/issuer boundary — an issuer name is virtually
  // always the final segment, so this preserves any commas that are genuinely part of the title.
  const dashSplit = rest.split(/\s[—\-|]\s/);
  let name, org;
  if (dashSplit.length >= 2) {
    name = dashSplit[0];
    org = dashSplit.slice(1).join(" - ");
  } else {
    const lastComma = rest.lastIndexOf(",");
    if (lastComma !== -1) {
      name = rest.slice(0, lastComma);
      org = rest.slice(lastComma + 1);
    } else {
      name = rest;
      org = "";
    }
  }
  c.name = name.replace(/[,\-–|]+$/, "").trim();
  c.org = org.replace(/^\(|\)$/g, "").replace(/[,\-–|()]+$/, "").trim();
  return c;
}

function categorizeAchievement(text) {
  const lower = text.toLowerCase();
  if (/hackathon/.test(lower)) return "Hackathon";
  if (/scholarship/.test(lower)) return "Scholarship";
  if (/publish|paper|journal|conference/.test(lower)) return "Academic";
  if (/rank|position|place|winner|runner.?up/.test(lower)) return "Contest Ranking";
  if (/open.?source|contributor/.test(lower)) return "Open Source";
  return "Award";
}

function parseAchievements(lines) {
  return lines
    .filter((l) => l !== "")
    .map((raw) => raw.replace(BULLET_RE, "").trim())
    .filter(Boolean)
    .map((text) => ({ category: categorizeAchievement(text), text }));
}

function parseLanguages(lines) {
  const text = lines.join(", ");
  const tokens = text.split(/[,•|;]/).map((s) => s.trim()).filter(Boolean);
  return tokens.map((token) => {
    const m = token.match(/^(.+?)\s*[\(\-]\s*(native|fluent|advanced|intermediate|beginner|basic|proficient)\)?/i);
    if (m) {
      const prof = m[2].toLowerCase();
      const mapped = /native/.test(prof) ? "Native" : /fluent|proficient|advanced/.test(prof) ? "Fluent" : /intermediate/.test(prof) ? "Intermediate" : "Beginner";
      return { name: m[1].trim(), proficiency: mapped };
    }
    return { name: token, proficiency: "Intermediate" };
  }).filter((l) => l.name);
}

// ---- Confidence scoring (spec: per-section confidence, highlight only uncertain fields) ----
// A section that genuinely had no content in the source resume scores `null` ("not applicable")
// rather than 0 — only sections that had raw content but still extracted poorly (or not at all)
// count as "low confidence, please review."
function hadRawContent(rawLines) {
  return Array.isArray(rawLines) && rawLines.some((l) => l !== "");
}

function entryConfidence(entries, rawLines, scoreFn) {
  if (!entries || entries.length === 0) return hadRawContent(rawLines) ? 0 : null;
  const total = entries.reduce((s, e) => s + scoreFn(e), 0);
  return Math.round(total / entries.length);
}

// Fine-grained per-field confidence (spec: "Name -> 99%, Email -> 100%, ..." not one blended
// number) — purely additive alongside the existing coarse `personal` score below, which stays
// exactly as it was so the existing low-confidence banner's behavior doesn't change. These extra
// keys are for the Review Extracted Information screen, which needs a real number per field, not
// a five-field-blended average.
function computePersonalFieldConfidence(parsed, sections) {
  const hasHeaderContent = hadRawContent(sections.header);
  const fullName = parsed.fullName
    ? (/^[A-Z][a-zA-Z.'-]*(\s+[A-Z][a-zA-Z.'-]*){0,3}$/.test(parsed.fullName) ? 99 : 70)
    : (hasHeaderContent ? 0 : null);
  const email = parsed.email ? (EMAIL_RE.test(parsed.email) ? 100 : 60) : (hasHeaderContent ? 0 : null);
  const mobile = parsed.mobile ? (parsed.mobile.replace(/\D/g, "").length >= 10 ? 99 : 60) : (hasHeaderContent ? 0 : null);
  const linkedin = parsed.linkedin ? 98 : null;
  const github = parsed.github ? 98 : null;
  const address = parsed.address ? 85 : null;
  return { fullName, email, mobile, linkedin, github, address };
}

function computeConfidence(parsed, sections, ocrCeiling = null) {
  let personalPts = 0;
  if (parsed.fullName) personalPts++;
  if (parsed.email) personalPts++;
  if (parsed.mobile) personalPts++;
  if (parsed.linkedin || parsed.github) personalPts++;
  if (parsed.address) personalPts++;
  const personal = Math.round((personalPts / 5) * 100);
  const personalFields = computePersonalFieldConfidence(parsed, sections);

  const summary = parsed.summary && parsed.summary.length >= 40 ? 95 : parsed.summary ? 55 : hadRawContent(sections.summary) ? 0 : null;

  const education = entryConfidence(parsed.education, sections.education, (e) => {
    let pts = 0;
    if (e.degree) pts++;
    if (e.institution) pts++;
    if (e.startYear || e.endYear) pts++;
    if (e.score) pts++;
    return (pts / 4) * 100;
  });

  let skills;
  if (!parsed.skills || parsed.skills.length === 0) skills = hadRawContent(sections.skills) ? 0 : null;
  else {
    const categorized = parsed.skills.filter((s) => s.category !== "Other").length;
    skills = Math.round((categorized / parsed.skills.length) * 70 + 30);
  }

  const projects = entryConfidence(parsed.projects, sections.projects, (p) => {
    let pts = 0;
    if (p.title) pts++;
    if (p.description) pts++;
    if (p.technologies || p.githubUrl || p.liveUrl) pts++;
    return (pts / 3) * 100;
  });

  const experience = entryConfidence(parsed.experience, sections.experience, (e) => {
    let pts = 0;
    if (e.title) pts++;
    if (e.company) pts++;
    if (e.responsibilities) pts++;
    return (pts / 3) * 100;
  });

  const certifications = entryConfidence(parsed.certifications, sections.certifications, (c) => (c.name ? (c.org ? 100 : 65) : 0));

  let scores = { personal, ...personalFields, summary, education, skills, projects, experience, certifications };

  // OCR-derived text is inherently less reliable than a native PDF/DOCX text layer even when a
  // field's own pattern happens to match cleanly (e.g. a misread character can still produce a
  // syntactically valid-looking email) — cap every non-null field once OCR was used, scaled by
  // Tesseract's own recognition confidence for this document. `null` sections (nothing found and
  // no raw content to explain it) are left untouched — a lower ceiling doesn't change "N/A".
  if (typeof ocrCeiling === "number") {
    scores = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v === null ? null : Math.min(v, ocrCeiling)]));
  }

  // Unchanged from before: only the original 7 coarse section keys drive the existing
  // low-confidence banner, so adding the new fine-grained personal fields above never changes
  // that banner's behavior — they're additive, for the new Review Extracted Information screen.
  const COARSE_KEYS = ["personal", "summary", "education", "skills", "projects", "experience", "certifications"];
  const lowConfidenceFields = COARSE_KEYS.filter((k) => scores[k] !== null && scores[k] < 70);
  return { scores, lowConfidenceFields };
}

// Main entry point. Returns a partial Resume-shaped object — every field matches the exact
// shape the existing Resume model / ResumeBuilder editor already expects, so parsed output can
// be saved and edited with zero translation layer — plus a `confidence` block the frontend uses
// to highlight exactly which sections need a manual review pass, instead of implying the whole
// resume is equally reliable.
async function parseResumeFile(buffer, mimetype, filename) {
  let text = await extractTextFromFile(buffer, mimetype, filename);
  const ext = String(filename || "").toLowerCase().split(".").pop();
  const looksLikePdf = mimetype === "application/pdf" || ext === "pdf";

  // Native extraction (pdf-parse) is always tried first — this only runs when it came back
  // (near-)empty, which is exactly what a scanned/image-only PDF with no real text layer looks
  // like. OCR is never used for a PDF that already has usable native text, and DOCX has no
  // "scanned" equivalent (it's always a real text document), so this path is PDF-only.
  let usedOcr = false;
  let ocrConfidence = null;
  if ((!text || text.trim().length < 30) && looksLikePdf) {
    try {
      const { ocrPdfBuffer } = require("./resumeOcr");
      const ocrResult = await ocrPdfBuffer(buffer);
      if (ocrResult.text && ocrResult.text.trim().length >= 30) {
        text = ocrResult.text;
        usedOcr = true;
        ocrConfidence = ocrResult.confidence;
      }
    } catch (ocrErr) {
      console.error("OCR fallback failed:", ocrErr.message);
      // fall through — the original "couldn't extract readable text" error below still fires
    }
  }

  if (!text || text.trim().length < 30) {
    throw new Error("Couldn't extract readable text from this file — it may be a scanned image rather than a text-based document, and automatic text recognition (OCR) could not read it either.");
  }

  // Tesseract's own recognition confidence (0-100) scales how much we trust every extracted
  // field — a clean scan still isn't as reliable as a native text layer, and a messy one is much
  // less reliable, so every field's confidence score is capped accordingly (see computeConfidence).
  const ocrCeiling = usedOcr ? (ocrConfidence >= 85 ? 80 : ocrConfidence >= 65 ? 65 : 45) : null;

  const sections = segmentSections(text);
  const personal = extractPersonalDetails(sections.header || [], text);

  const summaryLines = sections.summary || [];
  const summary = summaryLines.filter((l) => l !== "").join(" ").trim();

  const education = parseEducationSection(sections.education || []);
  const { skills, spokenLanguages } = parseSkillsSection(sections.skills || []);
  const projects = splitEntries(sections.projects || []).map(parseProjectBlock).filter((p) => p.title || p.description);
  const experience = splitEntries(sections.experience || []).map(parseExperienceBlock).filter((e) => e.title || e.responsibilities);
  const certifications = splitCertEntries(sections.certifications || []).map(parseCertBlock).filter((c) => c.name);
  const achievements = parseAchievements(sections.achievements || []);

  // Merge spoken languages found inside the Skills section with a dedicated Languages section,
  // if both exist — de-duped by name so a language mentioned in both places isn't doubled.
  const fromLanguageSection = parseLanguages(sections.languages || []);
  const seenLangNames = new Set(fromLanguageSection.map((l) => l.name.toLowerCase()));
  const languages = [...fromLanguageSection, ...spokenLanguages.filter((l) => !seenLangNames.has(l.name.toLowerCase()))];

  const parsed = { ...personal, summary, education, skills, projects, experience, certifications, achievements, languages };
  const confidence = computeConfidence(parsed, sections, ocrCeiling);

  // Raw extracted text, capped to a sane size — used only for the frontend's "original vs
  // parsed" side-by-side review view. Never persisted (no original file is stored either), just
  // passed through this one response so students can sanity-check the parse against the source.
  const rawText = text.trim().slice(0, 20000);

  return {
    ...parsed,
    confidence: confidence.scores,
    lowConfidenceFields: confidence.lowConfidenceFields,
    rawText,
    usedOcr,
    ocrConfidence,
  };
}

module.exports = { parseResumeFile, extractTextFromFile };
