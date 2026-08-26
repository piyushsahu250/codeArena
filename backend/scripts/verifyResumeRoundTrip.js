// Round-trip validation (spec: Resume Data -> Generate PDF -> Parse PDF -> Compare with Resume
// Data) for all 5 resume templates. Confirms every project's title/meta/tech/links actually
// appears in the generated PDF's extracted text — this is exactly the check that would have
// caught the modern/executive/minimal template content-loss bug found this session before it
// shipped, and is the regression guard against it recurring.
const { generateResumePdf, TEMPLATE_META } = require("../src/utils/resumePdf");
const { PassThrough } = require("stream");
const pdfParse = require("pdf-parse");

const baseResume = {
  fullName: "Round Trip Test", email: "roundtrip@example.com", mobile: "9999999999",
  summary: "A summary long enough to render in every template without being empty.",
  education: [{ degree: "B.Tech Computer Science", institution: "Test University", startYear: "2021", endYear: "2025" }],
  experience: [{ title: "Software Intern", company: "TestCorp", employmentType: "Internship", startDate: "2024", endDate: "2024", responsibilities: "Built internal tools." }],
  projects: [{
    title: "UNIQUE_PROJECT_TITLE_XYZ", role: "UNIQUE_ROLE_ABC", duration: "UNIQUE_DURATION_123",
    description: "UNIQUE_DESCRIPTION_TEXT_FOR_ROUNDTRIP_CHECK",
    technologies: "UNIQUE_TECH_STACK_MARKER",
    githubUrl: "https://github.com/uniquegithubmarker/repo",
    liveUrl: "https://uniquelivedemomarker.example.com",
  }],
  skills: [{ name: "Python" }, { name: "SQL" }],
  certifications: [{ name: "UNIQUE_CERT_NAME", org: "UNIQUE_CERT_ORG", issueDate: "2024", credentialId: "UNIQUE-CRED-ID-999" }],
};

const FIELDS_TO_CHECK = [
  { label: "Project title", marker: "UNIQUE_PROJECT_TITLE_XYZ" },
  { label: "Project role/duration (meta)", marker: "UNIQUE_ROLE_ABC" },
  { label: "Project description", marker: "UNIQUE_DESCRIPTION_TEXT_FOR_ROUNDTRIP_CHECK" },
  { label: "Project tech stack", marker: "UNIQUE_TECH_STACK_MARKER" },
  { label: "Project GitHub link", marker: "uniquegithubmarker" },
  { label: "Project live-demo link", marker: "uniquelivedemomarker" },
  { label: "Certification credential ID", marker: "UNIQUE-CRED-ID-999" },
];

async function generateAndExtract(template) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => stream.on("end", resolve));
  await generateResumePdf({ ...baseResume, template }, stream);
  stream.end();
  await done;
  const buf = Buffer.concat(chunks);
  return (await pdfParse(buf)).text;
}

async function main() {
  let anyFail = false;
  for (const template of Object.keys(TEMPLATE_META)) {
    console.log(`\n=== Template: ${template} ===`);
    const text = await generateAndExtract(template);
    for (const f of FIELDS_TO_CHECK) {
      const present = text.includes(f.marker);
      if (!present) anyFail = true;
      console.log(`  [${present ? "PASS" : "FAIL"}] ${f.label}`);
    }
    // Duplicate-link regression check: githubUrl and liveUrl are DIFFERENT URLs here, so both
    // markers should appear; separately confirm a resume with the SAME url in both fields doesn't
    // print it twice (the actual bug found on the real reported resume).
  }

  // Duplicate-URL specific regression check across all 5 templates
  console.log("\n=== Duplicate-URL regression check (same URL in githubUrl and liveUrl) ===");
  const dupResume = { ...baseResume, projects: [{ ...baseResume.projects[0], githubUrl: "https://sameurl.example.com/x", liveUrl: "https://sameurl.example.com/x" }] };
  for (const template of Object.keys(TEMPLATE_META)) {
    const stream = new PassThrough();
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    const done = new Promise((resolve) => stream.on("end", resolve));
    await generateResumePdf({ ...dupResume, template }, stream);
    stream.end();
    await done;
    const text = (await pdfParse(Buffer.concat(chunks))).text;
    const occurrences = (text.match(/sameurl\.example\.com\/x/g) || []).length;
    const ok = occurrences <= 1;
    if (!ok) anyFail = true;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${template}: URL appears ${occurrences} time(s) (expect 0 or 1, never 2+)`);
  }

  console.log(anyFail ? "\nSOME CHECKS FAILED." : "\nAll round-trip checks passed across all 5 templates.");
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
