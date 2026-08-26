// Real-world-shaped validation dataset + measured extraction accuracy (spec: "Do not use only
// one sample resume" / "Calculate actual accuracy percentages. Do NOT claim 100% unless
// measured."). Honest scope: these are diverse, realistic SYNTHETIC resumes (fresher/experienced,
// technical/non-technical, short/long, sparse/dense) covering all 5 templates — not resumes
// sourced from real external candidates, since no such corpus exists on this platform and
// scraping/fabricating one would raise its own provenance and privacy concerns. Each one is
// pushed through the REAL pipeline this platform actually ships: generateResumePdf/DocX (the
// exact code path a student's download uses) -> parseResumeFile (the exact code path a student's
// upload uses) -> compared field-by-field against the known ground truth that generated it.
const { PassThrough } = require("stream");
const { generateResumePdf, TEMPLATE_META } = require("../src/utils/resumePdf");
const { generateResumeDocx } = require("../src/utils/resumeDocx");
const { parseResumeFile } = require("../src/utils/resumeParser");

// ---------------------------------------------------------------------------
// Ground-truth dataset — 6 distinct resumes, one per distinct real-world shape, each assigned a
// different template so all 5 layouts get exercised (professional gets two: short AND long).
// ---------------------------------------------------------------------------
const DATASET = [
  {
    label: "Fresher, technical, one-page, minimal template",
    template: "minimal",
    truth: {
      fullName: "Aarav Sharma", email: "aarav.sharma@example.com", mobile: "9876543210",
      summary: "Final-year Computer Science student with hands-on project experience in full-stack web development and a strong foundation in data structures and algorithms.",
      education: [{ degree: "B.TECH", specialization: "Computer Science", institution: "Sample Institute of Technology", startYear: "2021", endYear: "2025", score: "8.4 CGPA", status: "Pursuing" }],
      skills: [{ category: "Programming Languages", name: "Java" }, { category: "Programming Languages", name: "Python" }, { category: "Frameworks", name: "React" }, { category: "Databases", name: "MySQL" }, { category: "Tools", name: "Git" }],
      projects: [{ title: "Library Management System", description: "Built a full-stack library management system with issue/return tracking and fine calculation.", technologies: "Java, MySQL, Spring Boot", githubUrl: "https://github.com/aaravsharma/library-mgmt" }],
      experience: [], certifications: [{ name: "Java Programming Certification", org: "Coursera", issueDate: "2023" }], achievements: [], languages: [],
    },
  },
  {
    label: "Experienced (3 roles), technical, two-page, professional template",
    template: "professional",
    truth: {
      fullName: "Priya Nair", email: "priya.nair@example.com", mobile: "9123456780",
      summary: "Backend engineer with 4+ years of experience building scalable REST APIs and microservices in Java and Node.js, with a track record of improving system reliability.",
      education: [{ degree: "B.E", specialization: "Information Technology", institution: "Sample College of Engineering", startYear: "2016", endYear: "2020", score: "78%", status: "Completed" }],
      skills: [{ category: "Programming Languages", name: "Java" }, { category: "Programming Languages", name: "JavaScript" }, { category: "Frameworks", name: "Spring Boot" }, { category: "Frameworks", name: "Express" }, { category: "Cloud", name: "AWS" }, { category: "DevOps", name: "Docker" }, { category: "Databases", name: "PostgreSQL" }],
      projects: [{ title: "Order Processing Pipeline", description: "Designed an asynchronous order processing pipeline handling 10k+ orders per day.", technologies: "Java, Kafka, PostgreSQL" }],
      experience: [
        { title: "Senior Backend Engineer", company: "NimbusTech Solutions", employmentType: "Full-Time", startDate: "Jan 2023", endDate: "Present", responsibilities: "Led the migration of a monolithic order service to microservices, reducing average response time by 40 percent." },
        { title: "Backend Engineer", company: "NimbusTech Solutions", employmentType: "Full-Time", startDate: "Jun 2021", endDate: "Dec 2022", responsibilities: "Built and maintained REST APIs for the payments module using Spring Boot." },
        { title: "Software Engineer", company: "Devora Systems", employmentType: "Full-Time", startDate: "Jul 2020", endDate: "May 2021", responsibilities: "Developed internal tooling for QA automation using Node.js and Express." },
      ],
      certifications: [{ name: "AWS Certified Developer – Associate", org: "Amazon Web Services", issueDate: "2022", credentialId: "AWS-DEV-2022-9981" }],
      achievements: [{ category: "Award", text: "Received the 'Engineer of the Quarter' award at NimbusTech Solutions, Q2 2023." }],
      languages: [{ name: "English", proficiency: "Fluent" }, { name: "Hindi", proficiency: "Native" }],
    },
  },
  {
    label: "Non-technical (business/marketing), modern template",
    template: "modern",
    truth: {
      fullName: "Kavya Iyer", email: "kavya.iyer@example.com", mobile: "9988776655",
      summary: "Marketing graduate with internship experience in digital campaign management and social media analytics, seeking an entry-level marketing analyst role.",
      education: [{ degree: "BBA", specialization: "Marketing", institution: "Sample School of Business", startYear: "2021", endYear: "2024", score: "7.9 CGPA", status: "Completed" }],
      skills: [{ category: "Tools", name: "Excel" }, { category: "Other", name: "SEO" }, { category: "Other", name: "Content Strategy" }, { category: "Other", name: "Google Analytics" }],
      projects: [{ title: "Campus Brand Awareness Campaign", description: "Led a student-run social media campaign that grew a college club's Instagram following by 3x in one semester." }],
      experience: [{ title: "Marketing Intern", company: "Bloomline Retail", employmentType: "Internship", startDate: "May 2023", endDate: "Jul 2023", responsibilities: "Assisted in planning and executing email marketing campaigns, analyzing open rates and click-through rates." }],
      certifications: [{ name: "Google Analytics Individual Qualification", org: "Google", issueDate: "2023" }], achievements: [], languages: [],
    },
  },
  {
    label: "Technical, project-heavy, executive template",
    template: "executive",
    truth: {
      fullName: "Rohan Mehta", email: "rohan.mehta@example.com", mobile: "9001122334",
      summary: "Machine learning enthusiast with multiple applied projects spanning computer vision and NLP, seeking a data science role.",
      education: [{ degree: "M.TECH", specialization: "Data Science", institution: "Sample Institute of Technology", startYear: "2022", endYear: "2024", score: "8.9 CGPA", status: "Completed" }],
      skills: [{ category: "Programming Languages", name: "Python" }, { category: "Libraries", name: "TensorFlow" }, { category: "Libraries", name: "PyTorch" }, { category: "Libraries", name: "Pandas" }, { category: "Tools", name: "Jupyter" }],
      projects: [
        { title: "Handwritten Digit Recognition", description: "Trained a convolutional neural network achieving 98.7 percent accuracy on the MNIST dataset.", technologies: "Python, TensorFlow" },
        { title: "Resume Screening NLP Tool", description: "Built an NLP pipeline to rank resumes against a job description using TF-IDF and cosine similarity.", technologies: "Python, scikit-learn, NLTK" },
        { title: "Chatbot for Course Queries", description: "Developed a rule-based chatbot to answer common student queries about course registration.", technologies: "Python, Flask" },
      ],
      experience: [{ title: "Research Intern", company: "DataForge Labs", employmentType: "Internship", startDate: "Jan 2024", endDate: "Jun 2024", responsibilities: "Assisted in building and evaluating NLP models for document classification." }],
      certifications: [{ name: "Deep Learning Specialization", org: "Coursera", issueDate: "2023" }], achievements: [], languages: [],
    },
  },
  {
    label: "Sparse resume (many empty sections), creative template",
    template: "creative",
    truth: {
      fullName: "Sana Sheikh", email: "sana.sheikh@example.com", mobile: "9345678901",
      summary: "", // deliberately empty — tests that "not applicable" is scored differently from "extraction failed"
      education: [{ degree: "BCA", specialization: "", institution: "Sample Degree College", startYear: "2022", endYear: "2025", score: "", status: "Pursuing" }],
      skills: [{ category: "Programming Languages", name: "C++" }, { category: "Programming Languages", name: "Python" }],
      projects: [], experience: [], certifications: [], achievements: [], languages: [],
    },
  },
  {
    label: "Dense resume (many skills/certifications), professional template",
    template: "professional",
    truth: {
      fullName: "Vikram Desai", email: "vikram.desai@example.com", mobile: "9012345678",
      summary: "Full-stack developer with broad exposure across languages, frameworks, and cloud platforms, and a strong certification portfolio.",
      education: [{ degree: "B.TECH", specialization: "Computer Engineering", institution: "Sample University", startYear: "2019", endYear: "2023", score: "8.1 CGPA", status: "Completed" }],
      skills: [
        { category: "Programming Languages", name: "JavaScript" }, { category: "Programming Languages", name: "TypeScript" }, { category: "Programming Languages", name: "Go" },
        { category: "Frameworks", name: "React" }, { category: "Frameworks", name: "Node.js" }, { category: "Frameworks", name: "Django" },
        { category: "Databases", name: "MongoDB" }, { category: "Databases", name: "Redis" },
        { category: "Cloud", name: "Azure" }, { category: "DevOps", name: "Kubernetes" }, { category: "Tools", name: "Postman" },
      ],
      projects: [{ title: "Real-Time Chat Application", description: "Built a real-time chat app supporting group messaging and file sharing.", technologies: "Node.js, Socket.io, MongoDB", liveUrl: "https://chatapp-demo.example.com" }],
      experience: [{ title: "Full Stack Developer", company: "Brightwave Softworks", employmentType: "Full-Time", startDate: "Aug 2023", endDate: "Present", responsibilities: "Building and maintaining customer-facing dashboards used by 200+ enterprise clients." }],
      certifications: [
        { name: "Microsoft Certified: Azure Fundamentals", org: "Microsoft", issueDate: "2022" },
        { name: "Certified Kubernetes Application Developer", org: "CNCF", issueDate: "2023" },
        { name: "MongoDB Certified Developer", org: "MongoDB Inc.", issueDate: "2023" },
      ],
      achievements: [], languages: [],
    },
  },
];

async function streamToBuffer(writeFn) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { stream.on("end", resolve); stream.on("error", reject); });
  writeFn(stream);
  await done;
  return Buffer.concat(chunks);
}

function namesMatch(a, b) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}
function digitsMatch(a, b) {
  return (a || "").replace(/\D/g, "") === (b || "").replace(/\D/g, "");
}
function scoreOf(hits, total) {
  return total === 0 ? null : Math.round((hits / total) * 100);
}

// Compares one ground-truth resume against what parseResumeFile actually extracted from a
// generated document, returning per-category accuracy percentages (null = not applicable, e.g.
// ground truth had no certifications so there's nothing to measure).
function scoreExtraction(truth, extracted) {
  const results = {};

  results.name = namesMatch(truth.fullName, extracted.fullName) ? 100 : 0;
  results.email = truth.email ? (namesMatch(truth.email, extracted.email) ? 100 : 0) : null;
  results.phone = truth.mobile ? (digitsMatch(truth.mobile, extracted.mobile) ? 100 : 0) : null;

  // Section presence: did the parser find *something* in every section the ground truth has
  // *something* in, and correctly find *nothing* in every section the ground truth has nothing in.
  const sectionKeys = ["education", "skills", "projects", "experience", "certifications"];
  let sectionHits = 0;
  for (const k of sectionKeys) {
    const truthHas = (truth[k] || []).length > 0;
    const extractedHas = (extracted[k] || []).length > 0;
    if (truthHas === extractedHas) sectionHits++;
  }
  results.sectionAccuracy = scoreOf(sectionHits, sectionKeys.length);

  // Education: per-entry field match rate (degree substring, institution substring, both years).
  if (truth.education.length) {
    let hits = 0, total = 0;
    truth.education.forEach((t, i) => {
      const e = extracted.education[i] || {};
      total += 4;
      if (e.degree && t.degree && e.degree.toUpperCase().includes(t.degree.toUpperCase().split(" ")[0])) hits++;
      if (e.institution && t.institution && e.institution.toLowerCase().includes(t.institution.toLowerCase().split(",")[0].trim())) hits++;
      if (t.startYear && e.startYear === t.startYear) hits++;
      if (t.endYear ? e.endYear === t.endYear : true) hits++;
    });
    results.education = scoreOf(hits, total);
  } else results.education = null;

  // Experience: per-entry field match rate (title, company, both dates present-ness).
  if (truth.experience.length) {
    let hits = 0, total = 0;
    truth.experience.forEach((t, i) => {
      const e = extracted.experience[i] || {};
      total += 3;
      if (e.title && t.title && e.title.toLowerCase().includes(t.title.toLowerCase())) hits++;
      if (e.company && t.company && e.company.toLowerCase().includes(t.company.toLowerCase())) hits++;
      if (e.startDate && e.endDate) hits++;
    });
    results.experience = scoreOf(hits, total);
  } else results.experience = null;

  // Skills: fraction of ground-truth skill names found anywhere in the extracted skill list.
  if (truth.skills.length) {
    const extractedNames = new Set((extracted.skills || []).map((s) => (s.name || "").toLowerCase()));
    const hits = truth.skills.filter((s) => extractedNames.has(s.name.toLowerCase())).length;
    results.skills = scoreOf(hits, truth.skills.length);
  } else results.skills = null;

  // Certifications: fraction of ground-truth cert names found (substring match, case-insensitive).
  if (truth.certifications.length) {
    const extractedNames = (extracted.certifications || []).map((c) => (c.name || "").toLowerCase());
    const hits = truth.certifications.filter((c) => extractedNames.some((n) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n))).length;
    results.certifications = scoreOf(hits, truth.certifications.length);
  } else results.certifications = null;

  // Dates: every education/experience entry that had a start+end year in the ground truth, does
  // the extracted entry have SOME non-empty date value in the corresponding fields.
  let dateHits = 0, dateTotal = 0;
  truth.education.forEach((t, i) => {
    if (t.startYear) { dateTotal++; if (extracted.education[i]?.startYear) dateHits++; }
    if (t.endYear) { dateTotal++; if (extracted.education[i]?.endYear) dateHits++; }
  });
  truth.experience.forEach((t, i) => {
    dateTotal++; if (extracted.experience[i]?.startDate) dateHits++;
  });
  results.dates = scoreOf(dateHits, dateTotal);

  // URLs: every githubUrl/liveUrl/credentialUrl present in ground truth, is it present (possibly
  // reformatted, e.g. missing "https://") in the corresponding extracted entry.
  let urlHits = 0, urlTotal = 0;
  truth.projects.forEach((t, i) => {
    if (t.githubUrl) { urlTotal++; if (extracted.projects[i]?.githubUrl && extracted.projects[i].githubUrl.includes(t.githubUrl.replace(/^https?:\/\//, ""))) urlHits++; }
    if (t.liveUrl) { urlTotal++; if (extracted.projects[i]?.liveUrl && extracted.projects[i].liveUrl.includes(t.liveUrl.replace(/^https?:\/\//, ""))) urlHits++; }
  });
  results.urls = scoreOf(urlHits, urlTotal);

  return results;
}

function average(nums) {
  const valid = nums.filter((n) => n !== null && n !== undefined);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
}

async function main() {
  console.log(`Validation dataset: ${DATASET.length} distinct synthetic resumes (fresher/experienced, technical/non-technical, sparse/dense), across formats: PDF (5 templates) and DOCX.\n`);

  const allPdfScores = [], allDocxScores = [];

  for (const entry of DATASET) {
    console.log(`\n=== ${entry.label} (template: ${entry.template}) ===`);

    // --- PDF round trip: generate -> parse -> score ---
    try {
      const pdfBuffer = await streamToBuffer((stream) => generateResumePdf({ ...entry.truth, template: entry.template }, stream));
      const extractedFromPdf = await parseResumeFile(pdfBuffer, "application/pdf", "test.pdf");
      const pdfScores = scoreExtraction(entry.truth, extractedFromPdf);
      allPdfScores.push(pdfScores);
      console.log(`  PDF  : ${JSON.stringify(pdfScores)}`);
    } catch (err) {
      console.log(`  PDF  : FAILED — ${err.message}`);
    }

    // --- DOCX round trip: generate -> parse -> score ---
    try {
      const docxBuffer = await generateResumeDocx({ ...entry.truth, template: entry.template });
      const extractedFromDocx = await parseResumeFile(docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "test.docx");
      const docxScores = scoreExtraction(entry.truth, extractedFromDocx);
      allDocxScores.push(docxScores);
      console.log(`  DOCX : ${JSON.stringify(docxScores)}`);
    } catch (err) {
      console.log(`  DOCX : FAILED — ${err.message}`);
    }
  }

  console.log("\n\n=== AGGREGATE MEASURED ACCURACY (average across all validation resumes) ===");
  const categories = ["name", "email", "phone", "sectionAccuracy", "education", "experience", "skills", "certifications", "dates", "urls"];
  console.log("\nPDF upload -> parse accuracy:");
  for (const c of categories) console.log(`  ${c}: ${average(allPdfScores.map((s) => s[c]))}% (n=${allPdfScores.filter((s) => s[c] !== null && s[c] !== undefined).length})`);
  console.log("\nDOCX upload -> parse accuracy:");
  for (const c of categories) console.log(`  ${c}: ${average(allDocxScores.map((s) => s[c]))}% (n=${allDocxScores.filter((s) => s[c] !== null && s[c] !== undefined).length})`);

  console.log("\nNote: this measures extraction accuracy on CodeArena-generated documents across all 5 templates —");
  console.log("real-world resumes from arbitrary external tools (Canva, LaTeX, Word) may score lower; see resumeParser.js's own documented limitations.");
}

main().catch((e) => { console.error("Script crashed:", e); process.exit(1); });
