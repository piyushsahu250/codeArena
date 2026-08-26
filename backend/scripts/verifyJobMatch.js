// Verify the new deterministic Job Match feature (jobDescriptionParser.js + resumeJobMatch.js).
// Pure functions, no DB/server needed — same convention as verifyResumeAtsAccuracy.js.
const { computeJobMatch, JOB_MATCH_ENGINE_VERSION } = require("../src/utils/resumeJobMatch");
const { normalizeTerm } = require("../src/utils/jobDescriptionParser");

let passCount = 0;
let failCount = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS - ${label}`);
    passCount++;
  } else {
    console.log(`FAIL - ${label}${detail ? ` (${detail})` : ""}`);
    failCount++;
  }
}

// resumeJobMatch.js's returned skill/keyword lists are passed through a display-formatting step
// (e.g. "aws" -> "AWS", "javascript" -> "JavaScript") before being returned to the API caller, so
// every comparison below is case-insensitive rather than comparing against the raw lowercase
// canonical form directly.
function sameSet(actual, expected) {
  const a = [...new Set(actual.map((s) => s.toLowerCase()))].sort();
  const b = [...new Set(expected.map((s) => s.toLowerCase()))].sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function includesCI(list, term) {
  return list.some((s) => s.toLowerCase() === term.toLowerCase());
}

// ---- 1. Worked example from the spec ----
console.log("\n=== 1. Worked example: Python/SQL/Docker resume vs Python/SQL/AWS/Docker JD ===");
const jd1 = `Software Engineer

Required Skills:
- Python
- SQL
- AWS
- Docker
`;
const resume1 = {
  summary: "",
  education: [],
  skills: [{ name: "Python" }, { name: "SQL" }, { name: "Docker" }],
  projects: [],
  experience: [],
  certifications: [],
};
const result1 = computeJobMatch(resume1, jd1);
const awsCanonical = normalizeTerm("aws"); // "amazon web services" (aws/amazon web services group)

console.log("matchedSkills:", result1.matchedSkills);
console.log("missingRequiredSkills:", result1.missingRequiredSkills);

check(
  "matchedSkills contains exactly Python/SQL/Docker",
  sameSet(result1.matchedSkills, ["python", "sql", "docker"]),
  `got ${JSON.stringify(result1.matchedSkills)}`
);
check(
  "missingRequiredSkills contains exactly AWS (nothing else)",
  sameSet(result1.missingRequiredSkills, [awsCanonical]),
  `got ${JSON.stringify(result1.missingRequiredSkills)}`
);

// ---- 2. Reproducibility ----
console.log("\n=== 2. Reproducibility (same inputs -> byte-for-byte identical output) ===");
const resultA = computeJobMatch(resume1, jd1);
const resultB = computeJobMatch(resume1, jd1);
check(
  "computeJobMatch(resume, jd) called twice produces JSON-identical results",
  JSON.stringify(resultA) === JSON.stringify(resultB)
);
check("engineVersion is the expected constant", resultA.engineVersion === JOB_MATCH_ENGINE_VERSION);

// ---- 3. Normalization: JS <-> JavaScript, Postgres <-> PostgreSQL ----
console.log("\n=== 3. Normalization (synonym groups) ===");
const jd2 = `Backend Developer

Required Skills:
- JavaScript
- PostgreSQL
`;
const resume2 = {
  summary: "",
  education: [],
  skills: [{ name: "JS" }, { name: "Postgres" }],
  projects: [],
  experience: [],
  certifications: [],
};
const result2 = computeJobMatch(resume2, jd2);
console.log("matchedSkills:", result2.matchedSkills);
console.log("missingRequiredSkills:", result2.missingRequiredSkills);
check(
  "resume skill 'JS' satisfies JD requirement 'JavaScript'",
  !includesCI(result2.missingRequiredSkills, normalizeTerm("javascript")) &&
    includesCI(result2.matchedSkills, normalizeTerm("javascript"))
);
check(
  "resume skill 'Postgres' satisfies JD requirement 'PostgreSQL'",
  !includesCI(result2.missingRequiredSkills, normalizeTerm("postgresql")) &&
    includesCI(result2.matchedSkills, normalizeTerm("postgresql"))
);
check("no missing required skills remain for JD2", result2.missingRequiredSkills.length === 0, JSON.stringify(result2.missingRequiredSkills));

// ---- 4. Unrelated terms must never match (Java != JavaScript) ----
console.log("\n=== 4. Unrelated-terms-must-not-match check (Java vs JavaScript) ===");
const jd3 = `Frontend Developer

Required Skills:
- JavaScript
`;
const resume3 = {
  summary: "",
  education: [],
  skills: [{ name: "Java" }],
  projects: [],
  experience: [],
  certifications: [],
};
const result3 = computeJobMatch(resume3, jd3);
console.log("matchedSkills:", result3.matchedSkills);
console.log("missingRequiredSkills:", result3.missingRequiredSkills);
check(
  "resume skill 'Java' does NOT satisfy JD requirement 'JavaScript'",
  includesCI(result3.missingRequiredSkills, normalizeTerm("javascript")) && !includesCI(result3.matchedSkills, normalizeTerm("javascript")),
  JSON.stringify({ matched: result3.matchedSkills, missing: result3.missingRequiredSkills })
);

// ---- Summary ----
console.log(`\n=== SUMMARY: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
