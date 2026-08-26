// One-off diagnostic: why did validationDatasetAccuracy.js measure 0% URL round-trip accuracy on
// BOTH PDF and DOCX? Generates the exact "Fresher" resume (minimal template, has a githubUrl on
// its one project) and prints the raw extracted project object so we can see whether the URL is
// missing entirely, present but reformatted, or the project just didn't come through at all.
const { PassThrough } = require("stream");
const { generateResumePdf } = require("../src/utils/resumePdf");
const { generateResumeDocx } = require("../src/utils/resumeDocx");
const { parseResumeFile, extractTextFromFile } = require("../src/utils/resumeParser");

const truth = {
  fullName: "Aarav Sharma", email: "aarav.sharma@example.com", mobile: "9876543210",
  summary: "Final-year Computer Science student.",
  education: [{ degree: "B.TECH", institution: "Sample Institute", startYear: "2021", endYear: "2025" }],
  skills: [{ category: "Programming Languages", name: "Java" }],
  projects: [{ title: "Library Management System", description: "Built a full-stack library management system.", technologies: "Java, MySQL", githubUrl: "https://github.com/aaravsharma/library-mgmt" }],
  experience: [], certifications: [], achievements: [], languages: [],
};

async function streamToBuffer(writeFn) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { stream.on("end", resolve); stream.on("error", reject); });
  writeFn(stream);
  await done;
  return Buffer.concat(chunks);
}

async function main() {
  const pdfBuffer = await streamToBuffer((s) => generateResumePdf({ ...truth, template: "minimal" }, s));
  const pdfRawText = await extractTextFromFile(pdfBuffer, "application/pdf", "t.pdf");
  console.log("=== PDF raw lines (JSON, so blank lines are visible as \"\") ===");
  console.log(JSON.stringify(pdfRawText.split(/\r?\n/), null, 0));
  const extractedFromPdf = await parseResumeFile(pdfBuffer, "application/pdf", "t.pdf");
  console.log("PDF projects:", JSON.stringify(extractedFromPdf.projects, null, 2));

  const docxBuffer = await generateResumeDocx({ ...truth, template: "minimal" });
  const docxRawText = await extractTextFromFile(docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "t.docx");
  console.log("\n=== DOCX raw lines (JSON, so blank lines are visible as \"\") ===");
  console.log(JSON.stringify(docxRawText.split(/\r?\n/), null, 0));
  const extractedFromDocx = await parseResumeFile(docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "t.docx");
  console.log("DOCX projects:", JSON.stringify(extractedFromDocx.projects, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
