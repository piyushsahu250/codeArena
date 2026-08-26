// Verify the ATS-honesty + duplicate-link fixes against REAL data reconstructed from an actual
// CodeArena-generated resume PDF the user reported problems with (Tejal Gadakh's resume) — not a
// synthetic test case. Reproduces the exact project entry that had the duplicate-URL bug
// (Portfolio Website: same URL in githubUrl and liveUrl) and checks the ATS score this specific,
// real resume actually gets (proving it is NOT a blind 100%, since this is a fresher resume with
// only 1 experience entry, 2 projects, no LinkedIn-verified-strength content beyond what's shown).
const { computeAtsScore, ATS_ENGINE_VERSION } = require("../src/utils/resumeAts");
const { generateResumePdf } = require("../src/utils/resumePdf");
const { PassThrough } = require("stream");
const pdfParse = require("pdf-parse");

const resume = {
  fullName: "Tejal Gadakh",
  email: "tejalgadakh779@gmail.com",
  mobile: "9604571994",
  linkedin: "https://www.linkedin.com/in/tejal-gadakh-316520384",
  github: "https://github.com/tejalgadakh779-cloud",
  portfolio: "https://tejalgadakh779-cloud.github.io/Portfolio/",
  summary: "Motivated AIML student with a strong interest in software development, web technologies, and problem-solving. Experienced in leading hackathon teams and building real-world projects. Quick learner with hands-on knowledge of Python, C, HTML, CSS, Git, and GitHub, seeking opportunities to contribute and grow.",
  education: [{ degree: "Integrated M.Tech in AIML", institution: "Sanjivani University", startYear: "2025", endYear: "2030", score: "8.02" }],
  experience: [{ title: "Python Intern", company: "Code Alpha", employmentType: "Internship", startDate: "10th August 2026", endDate: "10th September 2026", responsibilities: "Internship scheduled to begin on 10 August 2026. Responsibilities will include developing Python applications, completing assigned projects, debugging code, and learning industry best practices." }],
  projects: [
    {
      title: "Portfolio Website", technologies: "HTML5 CSS3 Git GitHub GitHub Pages Visual Studio Code",
      description: "Developed a responsive personal portfolio website using HTML5, CSS3. The website showcases my skills, projects, achievements, certifications, and contact information. Deployed the website using GitHub Pages with version control through Git and GitHub.",
      githubUrl: "https://tejalgadakh779-cloud.github.io/Portfolio/", liveUrl: "https://tejalgadakh779-cloud.github.io/Portfolio/", // the exact duplicate seen live
    },
    {
      title: "Smart Waste Segregation and recycling System", role: "Team Leader",
      technologies: "Arduino Uno, Sensors (Moisture/Metal/IR as applicable), Embedded C/Arduino IDE, HTML, CSS, JavaScript, Git & GitHub",
      description: "Developed a Smart Waste Segregation and Recycling System that automatically classifies waste using sensors. Led the team in project planning, coordination, and presentation. The project was presented at Smart India Hackathon (College Level) and DIPEX 2026.",
    },
  ],
  skills: [
    { name: "Python (Intermediate)" }, { name: "C (Intermediate)" }, { name: "HTML,CSS (Intermediate)" }, { name: "Java (Beginner)" },
    { name: "Team leadership" }, { name: "Communication (Intermediate)" },
    { name: "Visual Studio Code (Intermediate)" }, { name: "Git, Github (Intermediate)" },
  ],
  certifications: [
    { name: "SIH Certificate", org: "Sanjivani university", issueDate: "14 September 2025", credentialId: "SIH-CERT-2025-581" },
    { name: "Dipex", org: "Srijan", issueDate: "14/02/2026" },
    { name: "CTF Event", org: "Sanjivani university", credentialId: "CSBC-95SSNT" },
  ],
  achievements: ["Served as Team Leader for a team in the Smart India Hackathon (College Level), coordinating project development and presentation"],
  languages: [{ name: "English (Fluent)" }, { name: "Hindi (Native)" }, { name: "Marathi (Native)" }, { name: "Japanese (Beginner)" }],
  template: "modern",
};

async function main() {
  // 1. ATS score honesty check — must NOT be a blind 100, must show real breakdown
  const ats = computeAtsScore(resume);
  console.log("=== ATS SCORE (real resume data) ===");
  console.log("Score:", ats.score, "/ 100 —", ats.status);
  console.log("Engine version:", ats.engineVersion, "(expect", ATS_ENGINE_VERSION + ")");
  console.log("Breakdown:");
  for (const b of ats.breakdown) console.log(`  ${b.label}: ${b.score}/${b.max}`);
  console.log("Matched keywords:", ats.matchedKeywords.join(", ") || "(none)");
  console.log("Suggestions:", ats.suggestions.length);
  for (const s of ats.suggestions) console.log(`  - ${s.issue}`);
  console.log("Methodology text present:", !!ats.methodology);

  // 2. Duplicate-link fix check — generate the actual PDF, parse it back, confirm the URL appears
  //    exactly once in the Projects section, not twice.
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => stream.on("end", resolve));
  await generateResumePdf(resume, stream);
  stream.end();
  await done;
  const buf = Buffer.concat(chunks);
  const text = (await pdfParse(buf)).text;
  const occurrences = (text.match(/tejalgadakh779-cloud\.github\.io\/Portfolio\//g) || []).length;
  console.log("\n=== DUPLICATE-LINK FIX CHECK ===");
  console.log("Portfolio URL occurrences in generated PDF:", occurrences, "(expect exactly 1 in the Projects section's link line — header/portfolio-field mentions add more, so check the raw link line specifically below)");
  const linkLineMatch = text.match(/https:\/\/tejalgadakh779-cloud\.github\.io\/Portfolio\/[^\n]*/g);
  console.log("Raw link line(s) found:", JSON.stringify(linkLineMatch));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
