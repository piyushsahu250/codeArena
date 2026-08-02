// Rule-based job-role keyword matching — a fixed dictionary per role, not a real AI/embedding
// similarity model, same "no real AI anywhere on this platform" principle applied elsewhere.

const ROLE_KEYWORDS = {
  "Java Developer": {
    keywords: ["java", "spring", "spring boot", "hibernate", "microservices", "rest api", "maven", "junit", "sql", "multithreading", "collections", "jvm"],
    skills: ["Java", "Spring Boot", "Hibernate", "REST APIs", "SQL", "Maven", "JUnit", "Microservices"],
  },
  "Full Stack Developer": {
    keywords: ["react", "node", "javascript", "html", "css", "rest api", "mongodb", "sql", "git", "express", "typescript", "redux"],
    skills: ["React", "Node.js", "Express", "MongoDB", "REST APIs", "Git", "HTML/CSS", "JavaScript"],
  },
  "Backend Developer": {
    keywords: ["api", "rest", "database", "sql", "microservices", "docker", "kubernetes", "authentication", "server", "node", "java", "python", "scalability"],
    skills: ["REST APIs", "SQL/NoSQL Databases", "Docker", "Microservices", "Authentication & Authorization", "Cloud (AWS/Azure)"],
  },
  "Software Engineer": {
    keywords: ["data structures", "algorithms", "oop", "git", "testing", "agile", "system design", "api", "database", "ci/cd"],
    skills: ["Data Structures & Algorithms", "OOP", "Git", "Unit Testing", "System Design", "CI/CD"],
  },
  "Data Analyst": {
    keywords: ["sql", "excel", "python", "power bi", "tableau", "data visualization", "statistics", "pandas", "numpy", "etl", "dashboard"],
    skills: ["SQL", "Excel", "Python (Pandas/NumPy)", "Power BI or Tableau", "Data Visualization", "Statistics"],
  },
  "AI/ML Engineer": {
    keywords: ["machine learning", "python", "tensorflow", "pytorch", "deep learning", "nlp", "scikit-learn", "data preprocessing", "model training", "neural network"],
    skills: ["Python", "TensorFlow or PyTorch", "Machine Learning Algorithms", "Data Preprocessing", "Model Evaluation", "Deep Learning"],
  },
};

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same substring-false-positive fix as resumeAts.js's matchesKeyword — plain `.includes()` let
// "git" match inside "digital"/"legitimate" and "api" match inside "rapid"/"capital", inflating
// matchPercent with keywords the resume never actually demonstrated.
function matchesKeyword(text, keyword) {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i").test(text);
}

function collectResumeText(resume) {
  const parts = [resume.summary || ""];
  for (const s of arr(resume.skills)) parts.push(s.name || "");
  for (const p of arr(resume.projects)) parts.push(p.title || "", p.description || "", p.technologies || "");
  for (const e of arr(resume.experience)) parts.push(e.responsibilities || "", e.technologies || "");
  return parts.join(" ").toLowerCase();
}

// Returns which of the role's expected keywords are present/missing, which of its recommended
// skills aren't already listed, a summary tip if the role name itself isn't mentioned, and which
// existing projects are most relevant (by keyword-overlap count) so the student knows which ones
// to foreground for this role.
function analyzeForRole(resume, role) {
  const roleDef = ROLE_KEYWORDS[role];
  if (!roleDef) return null;

  const text = collectResumeText(resume);
  const presentKeywords = roleDef.keywords.filter((k) => matchesKeyword(text, k));
  const missingKeywords = roleDef.keywords.filter((k) => !matchesKeyword(text, k));

  const existingSkillNames = new Set(arr(resume.skills).map((s) => (s.name || "").toLowerCase()));
  const recommendedSkills = roleDef.skills.filter((s) => !existingSkillNames.has(s.toLowerCase()));

  const summaryMentionsRole = (resume.summary || "").toLowerCase().includes(role.toLowerCase());

  const projects = arr(resume.projects).map((p) => {
    const pText = `${p.title || ""} ${p.description || ""} ${p.technologies || ""}`.toLowerCase();
    const overlap = roleDef.keywords.filter((k) => matchesKeyword(pText, k)).length;
    return { title: p.title, relevance: overlap };
  }).filter((p) => p.relevance > 0).sort((a, b) => b.relevance - a.relevance);

  const matchPercent = Math.round((presentKeywords.length / roleDef.keywords.length) * 100);

  return {
    role,
    matchPercent,
    presentKeywords,
    missingKeywords,
    recommendedSkills,
    summaryTip: summaryMentionsRole ? null : `Consider mentioning "${role}" directly in your summary — many ATS systems match on exact role-title phrasing.`,
    relevantProjects: projects.slice(0, 3).map((p) => p.title),
  };
}

module.exports = { ROLE_KEYWORDS, analyzeForRole };
