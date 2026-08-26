const { generateResumePdf } = require("../src/utils/resumePdf");
const { PassThrough } = require("stream");
const pdfParse = require("pdf-parse");

const resume = {
  fullName: "Tejal Gadakh", email: "t@example.com", mobile: "9604571994",
  projects: [
    { title: "Portfolio Website", technologies: "HTML5 CSS3", description: "Test project description here long enough.",
      githubUrl: "https://tejalgadakh779-cloud.github.io/Portfolio/", liveUrl: "https://tejalgadakh779-cloud.github.io/Portfolio/" },
  ],
  template: "modern",
};

async function main() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => stream.on("end", resolve));
  await generateResumePdf(resume, stream);
  stream.end();
  await done;
  const buf = Buffer.concat(chunks);
  const text = (await pdfParse(buf)).text;
  console.log("=== FULL EXTRACTED TEXT ===");
  console.log(text);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
