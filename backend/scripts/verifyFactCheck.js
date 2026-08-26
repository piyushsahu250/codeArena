// Pure-function verification for resumeFactCheck.js — no DB, no server, no network. Run with:
//   node scripts/verifyFactCheck.js
// from the backend/ directory. Reproduces the spec's own worked example first, then a clean
// realistic resume (must produce zero warnings — the false-positive guard), then one dedicated
// fixture per one of the 10 documented checks, asserting both that the expected warning fires
// AND that nothing unrelated fires alongside it.
const { checkResumeFacts, FACT_CHECK_ENGINE_VERSION, CATEGORIES } = require("../src/utils/resumeFactCheck");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    failures++;
    console.log(`  [FAIL] ${label}`);
  }
}

function warningsOfCategory(warnings, category) {
  return warnings.filter((w) => w.category === category);
}

// ---------------------------------------------------------------------------------------------
console.log("=== Worked example from the spec (education 2023-2025, experience 2020-2019) ===");
{
  const resume = {
    education: [{ degree: "B.Tech", institution: "Sanjivani University", startYear: "2023", endYear: "2025" }],
    experience: [{ title: "Intern", company: "Acme Corp", startDate: "2020", endDate: "2019" }],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced");
  const w = result.warnings[0];
  assert(!!w && w.severity === "error", "severity is 'error'");
  assert(!!w && w.category === CATEGORIES.IMPOSSIBLE_DATE_RANGE, "category is impossible_date_range");
  assert(!!w && /experience dates/i.test(w.message), 'message is about "the experience dates"');
  assert(!!w && /verify/i.test(w.message), "message is phrased as a request to verify, not an accusation");
  assert(result.engineVersion === FACT_CHECK_ENGINE_VERSION && result.engineVersion === "v1.0", 'engineVersion is "v1.0"');
  assert(typeof result.checkedAt === "string" && !isNaN(Date.parse(result.checkedAt)), "checkedAt is a valid ISO timestamp");
}

// ---------------------------------------------------------------------------------------------
console.log("\n=== Clean, entirely valid resume (must produce zero warnings) ===");
{
  const resume = {
    fullName: "Asha Kulkarni",
    email: "asha.kulkarni@example.com",
    mobile: "+91 98765 43210",
    linkedin: "https://www.linkedin.com/in/asha-kulkarni",
    github: "https://github.com/ashak",
    portfolio: "https://ashak.dev",
    summary: "Final-year Computer Science student with hands-on experience building full-stack web applications.",
    education: [{ degree: "B.Tech Computer Science", institution: "Sanjivani University", startYear: "2019", endYear: "2023" }],
    skills: [{ name: "Python", category: "Language" }, { name: "JavaScript", category: "Language" }, { name: "React", category: "Framework" }],
    projects: [{
      title: "Portfolio Site", description: "A personal portfolio built with React and deployed via GitHub Pages.",
      technologies: "React, CSS", githubUrl: "https://github.com/ashak/portfolio", liveUrl: "https://ashak.dev",
    }],
    experience: [{ title: "Software Engineer", company: "Acme Corp", startDate: "2023", endDate: "present", employmentType: "Full-time" }],
    certifications: [{ name: "AWS Certified Developer", org: "Amazon", issueDate: "2022", credentialUrl: "https://www.credly.com/badges/xyz" }],
    languages: [{ name: "English" }, { name: "Hindi" }],
    achievements: ["Won inter-college hackathon, 2022"],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(Array.isArray(result.warnings) && result.warnings.length === 0, "warnings is an empty array (no false positives)");
}

// ---------------------------------------------------------------------------------------------
console.log("\n=== Defensive input handling (malformed/missing fields must never throw) ===");
{
  const cases = [
    ["undefined resume", undefined],
    ["null resume", null],
    ["empty object", {}],
    ["non-array education/experience/skills/projects/certifications", { education: "oops", experience: 42, skills: null, projects: {}, certifications: "x" }],
  ];
  for (const [label, input] of cases) {
    let threw = false;
    let result;
    try {
      result = checkResumeFacts(input);
    } catch (e) {
      threw = true;
    }
    assert(!threw, `does not throw on ${label}`);
    assert(!threw && Array.isArray(result.warnings), `returns a warnings array for ${label}`);
  }
}

// ---------------------------------------------------------------------------------------------
// One dedicated fixture per documented check (#1 is covered by the worked example above).
// ---------------------------------------------------------------------------------------------

console.log("\n=== Check #2: overlapping employment (different companies, genuinely overlapping dates) ===");
{
  const resume = {
    experience: [
      { title: "Backend Intern", company: "Company A", startDate: "2021", endDate: "2022" },
      { title: "Frontend Intern", company: "Company B", startDate: "2021", endDate: "2023" },
    ],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced (nothing unrelated triggered)");
  const overlap = warningsOfCategory(result.warnings, CATEGORIES.OVERLAPPING_EMPLOYMENT);
  assert(overlap.length === 1, "overlapping_employment warning present");
  assert(!!overlap[0] && overlap[0].severity === "warning", "severity is 'warning'");
}

console.log("\n=== Check #3: education timeline conflict (fully overlapping degrees) ===");
{
  const resume = {
    education: [
      { degree: "B.Sc Physics", institution: "University X", startYear: "2019", endYear: "2023" },
      { degree: "BA Economics", institution: "University Y", startYear: "2020", endYear: "2022" },
    ],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced");
  const conflict = warningsOfCategory(result.warnings, CATEGORIES.EDUCATION_TIMELINE_CONFLICT);
  assert(conflict.length === 1, "education_timeline_conflict warning present");
  assert(!!conflict[0] && conflict[0].severity === "warning", "severity is 'warning'");
}

console.log("\n=== Check #4: duplicate skills (case-insensitive, trimmed) ===");
{
  const resume = { skills: [{ name: "Python" }, { name: " python " }, { name: "SQL" }] };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced");
  const dup = warningsOfCategory(result.warnings, CATEGORIES.DUPLICATE_SKILL);
  assert(dup.length === 1, "duplicate_skill warning present");
  assert(!!dup[0] && dup[0].severity === "warning", "severity is 'warning'");
}

console.log("\n=== Check #5: duplicate projects (case-insensitive, trimmed) ===");
{
  const resume = {
    projects: [
      { title: "Portfolio Website", description: "First entry." },
      { title: "portfolio website ", description: "Second entry, same title." },
    ],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced");
  const dup = warningsOfCategory(result.warnings, CATEGORIES.DUPLICATE_PROJECT);
  assert(dup.length === 1, "duplicate_project warning present");
  assert(!!dup[0] && dup[0].severity === "warning", "severity is 'warning'");
}

console.log("\n=== Check #6: contradictory job title (same company, fully overlapping, different title) ===");
{
  const resume = {
    experience: [
      { title: "Software Engineer", company: "Acme Corp", startDate: "2020", endDate: "2022" },
      { title: "Senior Software Engineer", company: "Acme Corp", startDate: "2020", endDate: "2022" },
    ],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced (not also a generic overlap warning for the same pair)");
  const contradiction = warningsOfCategory(result.warnings, CATEGORIES.CONTRADICTORY_JOB_TITLE);
  assert(contradiction.length === 1, "contradictory_job_title warning present");
  assert(!!contradiction[0] && contradiction[0].severity === "warning", "severity is 'warning'");
}

console.log("\n=== Check #7: invalid email format ===");
{
  const resume = { email: "not-an-email" };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced");
  const invalid = warningsOfCategory(result.warnings, CATEGORIES.INVALID_EMAIL);
  assert(invalid.length === 1, "invalid_email warning present");
  assert(!!invalid[0] && invalid[0].field === "email", "field is 'email'");
}

console.log("\n=== Check #8: invalid phone format (too few / too many digits) ===");
{
  const tooFew = checkResumeFacts({ mobile: "12345" });
  console.log("  too-few warnings:", JSON.stringify(tooFew.warnings));
  assert(tooFew.warnings.length === 1, "too-few-digits: exactly one warning produced");
  assert(warningsOfCategory(tooFew.warnings, CATEGORIES.INVALID_PHONE).length === 1, "too-few-digits: invalid_phone warning present");

  const tooMany = checkResumeFacts({ mobile: "1234567890123456" }); // 16 digits
  console.log("  too-many warnings:", JSON.stringify(tooMany.warnings));
  assert(tooMany.warnings.length === 1, "too-many-digits: exactly one warning produced");
  assert(warningsOfCategory(tooMany.warnings, CATEGORIES.INVALID_PHONE).length === 1, "too-many-digits: invalid_phone warning present");

  const valid = checkResumeFacts({ mobile: "+91 98765 43210" });
  assert(valid.warnings.length === 0, "valid 12-digit number produces no warning");
}

console.log("\n=== Check #9: invalid URLs (linkedin/github domain, portfolio/project/cert syntax) ===");
{
  const resume = {
    linkedin: "https://facebook.com/asha", // valid URL, wrong domain
    github: "https://gitlab.com/asha", // valid URL, wrong domain
    portfolio: "this is not a url", // fails new URL() even with https:// prepended
    projects: [{ title: "P1", githubUrl: "also not a valid url", liveUrl: "https://good-demo.example.com" }],
    certifications: [{ name: "Cert1", credentialUrl: "definitely not a url" }],
  };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 5, "exactly five invalid-url warnings produced (valid liveUrl not flagged)");
  const byField = Object.fromEntries(result.warnings.map((w) => [w.field, w]));
  assert(!!byField.linkedin && byField.linkedin.category === CATEGORIES.INVALID_URL, "linkedin flagged (not a linkedin.com link)");
  assert(!!byField.github && byField.github.category === CATEGORIES.INVALID_URL, "github flagged (not a github.com link)");
  assert(!!byField.portfolio && byField.portfolio.category === CATEGORIES.INVALID_URL, "portfolio flagged (not a valid URL)");
  assert(!!byField["projects[0].githubUrl"], "project githubUrl flagged (not a valid URL)");
  assert(!byField["projects[0].liveUrl"], "project liveUrl NOT flagged (it is a valid URL)");
  assert(!!byField["certifications[0].credentialUrl"], "certification credentialUrl flagged (not a valid URL)");
  assert(result.warnings.every((w) => w.severity === "warning"), "all invalid-url warnings are severity 'warning'");
}

console.log("\n=== Check #10: duplicate certifications (case-insensitive) ===");
{
  const resume = { certifications: [{ name: "AWS Certified Developer" }, { name: "aws certified developer" }] };
  const result = checkResumeFacts(resume);
  console.log("  warnings:", JSON.stringify(result.warnings));
  assert(result.warnings.length === 1, "exactly one warning produced");
  const dup = warningsOfCategory(result.warnings, CATEGORIES.DUPLICATE_CERTIFICATION);
  assert(dup.length === 1, "duplicate_certification warning present");
  assert(!!dup[0] && dup[0].severity === "warning", "severity is 'warning'");
}

// ---------------------------------------------------------------------------------------------
console.log("\n=== Tone check: every message across all fixtures above reads as a request to verify ===");
{
  const allResumes = [
    { education: [{ startYear: "2023", endYear: "2025" }], experience: [{ startDate: "2020", endDate: "2019", company: "A", title: "B" }] },
    { experience: [{ title: "a", company: "Company A", startDate: "2021", endDate: "2022" }, { title: "b", company: "Company B", startDate: "2021", endDate: "2023" }] },
  ];
  let allPhrasedAsRequest = true;
  for (const r of allResumes) {
    for (const w of checkResumeFacts(r).warnings) {
      if (!/please|verify|confirm/i.test(w.message)) allPhrasedAsRequest = false;
    }
  }
  assert(allPhrasedAsRequest, 'every message contains "please"/"verify"/"confirm" wording, never a bare accusation');
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
