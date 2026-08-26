// Isolate why generateResumePdf({template:"modern"}) with a fuller resume produced a PDF that
// pdf-parse rejects with "bad XRef entry" (a real malformed-PDF signal, not just missing text).
// Write the raw bytes to disk so we can inspect the actual PDF structure directly, and try
// sections one at a time to find the trigger.
const fs = require("fs");
const { generateResumePdf } = require("../src/utils/resumePdf");
const { PassThrough } = require("stream");

const full = {
  fullName: "Round Trip Test", email: "roundtrip@example.com", mobile: "9999999999",
  summary: "A summary long enough to render in every template without being empty.",
  education: [{ degree: "B.Tech Computer Science", institution: "Test University", startYear: "2021", endYear: "2025" }],
  experience: [{ title: "Software Intern", company: "TestCorp", employmentType: "Internship", startDate: "2024", endDate: "2024", responsibilities: "Built internal tools." }],
  projects: [{ title: "X", role: "Y", duration: "Z", description: "D", technologies: "T", githubUrl: "https://a.example.com", liveUrl: "https://b.example.com" }],
  skills: [{ name: "Python" }, { name: "SQL" }],
  certifications: [{ name: "C", org: "O", issueDate: "2024", credentialId: "ID-1" }],
  template: "modern",
};

async function gen(resume, label) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const errP = new Promise((resolve) => stream.on("error", (e) => resolve(e)));
  const endP = new Promise((resolve) => stream.on("end", () => resolve(null)));
  const genErr = await generateResumePdf(resume, stream).then(() => null).catch((e) => e);
  stream.end();
  const err = await Promise.race([errP, endP]);
  const buf = Buffer.concat(chunks);
  const path = `/tmp/isolate-${label}.pdf`;
  fs.writeFileSync(path, buf);
  console.log(`${label}: genErr=${genErr?.message || "none"} streamErr=${err?.message || "none"} bytes=${buf.length} savedTo=${path}`);
  return buf;
}

async function main() {
  await gen(full, "full");
  await gen({ ...full, certifications: [] }, "no-certs");
  await gen({ ...full, skills: [] }, "no-skills");
  await gen({ ...full, experience: [] }, "no-experience");
  await gen({ ...full, education: [] }, "no-education");
  await gen({ ...full, projects: [] }, "no-projects");
  await gen({ fullName: "X", email: "x@example.com", mobile: "1", template: "modern" }, "minimal-modern");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL", e); process.exit(1); });
