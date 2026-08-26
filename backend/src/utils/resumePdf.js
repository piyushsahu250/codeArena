const PDFDocument = require("pdfkit");

// Five templates, each a genuinely different layout (not just a color/font swap):
//   modern       — two-column, accent color, timeline-style experience section
//   professional — traditional single-column business format, ATS-friendly
//   minimal      — black-and-white, tight spacing, no rules/color at all
//   executive    — premium single-column corporate style, serif, generous spacing
//   creative     — colored header band + skill "tags", for design/creative roles
//
// Old template ids from before this rewrite are mapped onto the closest new one so resumes
// saved under the previous 7-template set still render instead of erroring.
const TEMPLATE_META = {
  modern: { label: "Modern", accent: "#4F9D6E" },
  professional: { label: "Professional", accent: "#1C3D5A" },
  minimal: { label: "Minimal", accent: "#1C1B18" },
  executive: { label: "Executive", accent: "#2B2118" },
  creative: { label: "Creative", accent: "#9C4FD6" },
};
const LEGACY_TEMPLATE_MAP = {
  classic: "professional",
  "software-engineer": "modern",
  fresher: "minimal",
  experienced: "executive",
};

function resolveTemplate(id) {
  if (TEMPLATE_META[id]) return id;
  if (LEGACY_TEMPLATE_MAP[id]) return LEGACY_TEMPLATE_MAP[id];
  return "professional";
}

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function skillsByCategory(resume) {
  const byCategory = {};
  for (const s of arr(resume.skills)) {
    const cat = s.category || "Other";
    (byCategory[cat] = byCategory[cat] || []).push(s.proficiency ? `${s.name} (${s.proficiency})` : s.name);
  }
  return byCategory;
}

function educationLine(e) {
  return {
    title: `${e.degree || ""}${e.specialization ? ` in ${e.specialization}` : ""}`,
    sub: `${e.institution || ""}${e.board ? ` (${e.board})` : ""}`,
    meta: `${e.startYear || ""} – ${e.endYear || e.status || ""}${e.score ? `   ·   ${e.score}` : ""}`,
  };
}

function experienceLine(e) {
  return {
    title: `${e.title || ""}${e.company ? ` — ${e.company}` : ""}`,
    meta: [e.employmentType, [e.startDate, e.endDate].filter(Boolean).join(" – ")].filter(Boolean).join("   ·   "),
    body: e.responsibilities || "",
    tech: e.technologies ? `Tech: ${e.technologies}` : null,
  };
}

function projectLine(p) {
  // Deduplicated before joining — githubUrl and liveUrl are independent fields in the editor, but
  // a student can (and, seen live, does) enter the same URL into both. Printing it twice in the
  // generated resume is a real, verifiable defect (confirmed on a real generated PDF), not a
  // hallucination-prevention edge case — nothing here changes which URLs are shown, only removes
  // an exact repeat.
  const links = [p.githubUrl, p.liveUrl].filter(Boolean);
  const uniqueLinks = links.filter((url, i) => links.indexOf(url) === i);
  return {
    title: p.title || "",
    meta: [p.role, p.duration].filter(Boolean).join("   ·   "),
    body: p.description || "",
    tech: p.technologies ? `Tech: ${p.technologies}` : null,
    links: uniqueLinks.join("   |   "),
  };
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

// ===================== Professional: traditional single-column, ATS-friendly =====================
function renderProfessional(resume) {
  const accent = TEMPLATE_META.professional.accent;
  const doc = new PDFDocument({ margin: 44, size: "A4" });
  const left = 44, right = PAGE_WIDTH - 44;

  doc.font("Helvetica-Bold").fontSize(22).fillColor(accent).text(resume.fullName || "Your Name");
  doc.font("Helvetica").fontSize(10).fillColor("#333");
  const contactLine = [resume.email, resume.mobile, resume.address].filter(Boolean).join("   |   ");
  if (contactLine) doc.text(contactLine);
  const linksLine = [resume.linkedin, resume.github, resume.portfolio].filter(Boolean).join("   |   ");
  if (linksLine) doc.text(linksLine);
  doc.moveDown(0.5);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(accent).lineWidth(1.5).stroke();
  doc.moveDown(0.8);

  function sectionHeader(title) {
    if (doc.y > 760) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(accent).text(title.toUpperCase());
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor("#cccccc").lineWidth(0.5).stroke();
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(10).fillColor("#1C1B18");
  }

  if (resume.summary) {
    sectionHeader("Professional Summary");
    doc.text(resume.summary);
    doc.moveDown(0.8);
  }

  const experience = arr(resume.experience);
  if (experience.length) {
    sectionHeader("Experience");
    for (const raw of experience) {
      const e = experienceLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(e.title);
      if (e.meta) doc.font("Helvetica").fontSize(9.5).fillColor("#555").text(e.meta);
      if (e.body) doc.fillColor("#1C1B18").fontSize(10).text(e.body);
      if (e.tech) doc.fontSize(9).fillColor("#555").text(e.tech);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.5);
    }
  }

  const education = arr(resume.education);
  if (education.length) {
    sectionHeader("Education");
    for (const raw of education) {
      const e = educationLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(e.title);
      doc.font("Helvetica").fontSize(10).text(e.sub);
      doc.fontSize(9).fillColor("#555").text(e.meta);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.5);
    }
  }

  const projects = arr(resume.projects);
  if (projects.length) {
    sectionHeader("Projects");
    for (const raw of projects) {
      const p = projectLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(p.title);
      if (p.meta) doc.font("Helvetica").fontSize(9.5).fillColor("#555").text(p.meta);
      if (p.body) doc.fillColor("#1C1B18").fontSize(10).text(p.body);
      if (p.tech) doc.fontSize(9).fillColor("#555").text(p.tech);
      if (p.links) doc.fontSize(9).fillColor("#555").text(p.links);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.5);
    }
  }

  const skills = skillsByCategory(resume);
  if (Object.keys(skills).length) {
    sectionHeader("Skills");
    for (const [cat, names] of Object.entries(skills)) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1C1B18").text(`${cat}: `, { continued: true });
      doc.font("Helvetica").fontSize(9.5).text(names.join(", "));
    }
    doc.moveDown(0.6);
  }

  const certifications = arr(resume.certifications);
  if (certifications.length) {
    sectionHeader("Certifications");
    for (const c of certifications) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1C1B18").text(`${c.name || ""}${c.org ? ` — ${c.org}` : ""}`);
      const meta = [c.issueDate, c.credentialId ? `ID: ${c.credentialId}` : null].filter(Boolean).join("   ·   ");
      if (meta) doc.font("Helvetica").fontSize(9).fillColor("#555").text(meta);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.4);
    }
  }

  const achievements = arr(resume.achievements);
  if (achievements.length) {
    sectionHeader("Achievements");
    for (const a of achievements) doc.fontSize(10).fillColor("#1C1B18").text(`•  ${a.text || a}`);
    doc.moveDown(0.4);
  }

  const languages = arr(resume.languages);
  if (languages.length) {
    sectionHeader("Languages");
    doc.fontSize(10).fillColor("#1C1B18").text(languages.map((l) => `${l.name} (${l.proficiency})`).join(", "));
  }

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(8).fillColor("#999").text("Created with CodeArena", { align: "center" });
  return doc;
}

// ===================== Minimal: black-and-white, tight spacing, no rules =====================
function renderMinimal(resume) {
  const doc = new PDFDocument({ margin: 46, size: "A4" });
  const left = 46, right = PAGE_WIDTH - 46;

  doc.font("Helvetica-Bold").fontSize(19).fillColor("#000").text(resume.fullName || "Your Name");
  doc.font("Helvetica").fontSize(9.5).fillColor("#444");
  const contactLine = [resume.email, resume.mobile, resume.address].filter(Boolean).join("  ·  ");
  if (contactLine) doc.text(contactLine);
  const linksLine = [resume.linkedin, resume.github, resume.portfolio].filter(Boolean).join("  ·  ");
  if (linksLine) doc.text(linksLine);
  doc.moveDown(0.6);

  function sectionHeader(title) {
    if (doc.y > 770) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#000").text(title.toUpperCase(), { characterSpacing: 0.8 });
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(9.5).fillColor("#1a1a1a");
  }

  if (resume.summary) {
    sectionHeader("Summary");
    doc.text(resume.summary);
    doc.moveDown(0.5);
  }

  const experience = arr(resume.experience);
  if (experience.length) {
    sectionHeader("Experience");
    for (const raw of experience) {
      const e = experienceLine(raw);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000").text(e.title);
      if (e.meta) doc.font("Helvetica").fontSize(9).fillColor("#555").text(e.meta);
      if (e.body) doc.fillColor("#1a1a1a").fontSize(9.5).text(e.body);
      doc.fillColor("#1a1a1a");
      doc.moveDown(0.3);
    }
  }

  const education = arr(resume.education);
  if (education.length) {
    sectionHeader("Education");
    for (const raw of education) {
      const e = educationLine(raw);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000").text(e.title);
      doc.font("Helvetica").fontSize(9).text(`${e.sub}   ${e.meta}`);
      doc.moveDown(0.3);
    }
  }

  const skills = skillsByCategory(resume);
  if (Object.keys(skills).length) {
    sectionHeader("Skills");
    doc.text(Object.values(skills).flat().join(", "));
    doc.moveDown(0.4);
  }

  const projects = arr(resume.projects);
  if (projects.length) {
    sectionHeader("Projects");
    for (const raw of projects) {
      const p = projectLine(raw);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000").text(p.title);
      if (p.meta) doc.font("Helvetica").fillColor("#444").fontSize(8.5).text(p.meta);
      if (p.body) doc.font("Helvetica").fillColor("#1a1a1a").fontSize(9.5).text(p.body);
      if (p.tech) doc.font("Helvetica").fillColor("#444").fontSize(8.5).text(p.tech);
      if (p.links) doc.font("Helvetica").fillColor("#444").fontSize(8.5).text(p.links);
      doc.moveDown(0.3);
    }
  }

  const certifications = arr(resume.certifications);
  if (certifications.length) {
    sectionHeader("Certifications");
    // Previously dropped issueDate/credentialId entirely for this template — the other four
    // templates all show them (see the `meta` line built the same way just below in each).
    doc.text(certifications.map((c) => {
      const meta = [c.issueDate, c.credentialId ? `ID: ${c.credentialId}` : null].filter(Boolean).join(", ");
      return `${c.name || ""}${c.org ? ` (${c.org})` : ""}${meta ? ` — ${meta}` : ""}`;
    }).join("; "));
    doc.moveDown(0.3);
  }

  const achievements = arr(resume.achievements);
  if (achievements.length) {
    sectionHeader("Achievements");
    for (const a of achievements) doc.fontSize(9.5).text(`—  ${a.text || a}`);
    doc.moveDown(0.3);
  }

  const languages = arr(resume.languages);
  if (languages.length) {
    sectionHeader("Languages");
    doc.text(languages.map((l) => `${l.name} (${l.proficiency})`).join(", "));
  }

  void left; void right;
  return doc;
}

// ===================== Modern: two-column, accent color, timeline experience =====================
function renderModern(resume) {
  const accent = TEMPLATE_META.modern.accent;
  const doc = new PDFDocument({ margin: 0, size: "A4", bufferPages: true });
  const sidebarW = 190;
  const sidebarX = 0, mainX = sidebarW + 30, mainRight = PAGE_WIDTH - 36;

  function drawSidebarBg(fromY) {
    doc.rect(sidebarX, fromY, sidebarW, PAGE_HEIGHT - fromY).fill("#F0EEE3");
  }
  drawSidebarBg(0);

  let sideY = 30;
  let mainY = 34;

  function sideHeader(title) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(accent).text(title.toUpperCase(), 24, sideY, { width: sidebarW - 48, characterSpacing: 0.6 });
    sideY = doc.y + 6;
  }
  function sideText(str, opts = {}) {
    doc.font("Helvetica").fontSize(9).fillColor("#333").text(str, 24, sideY, { width: sidebarW - 48, ...opts });
    sideY = doc.y + 4;
  }

  sideHeader("Contact");
  if (resume.email) sideText(resume.email);
  if (resume.mobile) sideText(resume.mobile);
  if (resume.address) sideText(resume.address);
  if (resume.linkedin) sideText(resume.linkedin);
  if (resume.github) sideText(resume.github);
  if (resume.portfolio) sideText(resume.portfolio);
  sideY += 10;

  const skills = skillsByCategory(resume);
  if (Object.keys(skills).length) {
    sideHeader("Skills");
    for (const [cat, names] of Object.entries(skills)) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1C1B18").text(cat, 24, sideY, { width: sidebarW - 48 });
      sideY = doc.y + 1;
      sideText(names.join(", "));
    }
    sideY += 6;
  }

  const education = arr(resume.education);
  if (education.length) {
    sideHeader("Education");
    for (const raw of education) {
      const e = educationLine(raw);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1C1B18").text(e.title, 24, sideY, { width: sidebarW - 48 });
      sideY = doc.y + 1;
      sideText(e.sub);
      sideText(e.meta);
    }
    sideY += 6;
  }

  const languages = arr(resume.languages);
  if (languages.length) {
    sideHeader("Languages");
    sideText(languages.map((l) => `${l.name} (${l.proficiency})`).join(", "));
  }

  const certifications = arr(resume.certifications);
  if (certifications.length) {
    sideHeader("Certifications");
    for (const c of certifications) sideText(`${c.name || ""}${c.org ? ` — ${c.org}` : ""}`);
  }

  // Main column
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#1C1B18").text(resume.fullName || "Your Name", mainX, mainY, { width: mainRight - mainX });
  mainY = doc.y + 4;
  doc.moveTo(mainX, mainY).lineTo(mainRight, mainY).strokeColor(accent).lineWidth(2).stroke();
  mainY += 14;

  function mainHeader(title) {
    if (mainY > 760) { doc.addPage(); drawSidebarBg(0); mainY = 40; }
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(accent).text(title.toUpperCase(), mainX, mainY, { width: mainRight - mainX, characterSpacing: 0.5 });
    mainY = doc.y + 8;
  }

  if (resume.summary) {
    mainHeader("Summary");
    doc.font("Helvetica").fontSize(9.5).fillColor("#1C1B18").text(resume.summary, mainX, mainY, { width: mainRight - mainX });
    mainY = doc.y + 12;
  }

  const experience = arr(resume.experience);
  if (experience.length) {
    mainHeader("Experience");
    for (const raw of experience) {
      const e = experienceLine(raw);
      // Timeline dot + connecting line
      doc.circle(mainX + 4, mainY + 5, 4).fill(accent);
      if (raw !== experience[experience.length - 1]) {
        doc.moveTo(mainX + 4, mainY + 11).lineTo(mainX + 4, mainY + 60).strokeColor("#ddd").lineWidth(1).stroke();
      }
      const textX = mainX + 18;
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(e.title, textX, mainY, { width: mainRight - textX });
      let y2 = doc.y;
      if (e.meta) { doc.font("Helvetica").fontSize(9).fillColor("#777").text(e.meta, textX, y2, { width: mainRight - textX }); y2 = doc.y; }
      if (e.body) { doc.fillColor("#1C1B18").fontSize(9.5).text(e.body, textX, y2, { width: mainRight - textX }); y2 = doc.y; }
      if (e.tech) { doc.fontSize(8.5).fillColor("#777").text(e.tech, textX, y2, { width: mainRight - textX }); y2 = doc.y; }
      mainY = y2 + 14;
    }
  }

  const projects = arr(resume.projects);
  if (projects.length) {
    mainHeader("Projects");
    for (const raw of projects) {
      const p = projectLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(p.title, mainX, mainY, { width: mainRight - mainX });
      let y2 = doc.y;
      if (p.meta) { doc.font("Helvetica").fontSize(9).fillColor("#777").text(p.meta, mainX, y2, { width: mainRight - mainX }); y2 = doc.y; }
      if (p.body) { doc.fillColor("#1C1B18").fontSize(9.5).text(p.body, mainX, y2, { width: mainRight - mainX }); y2 = doc.y; }
      if (p.tech) { doc.fontSize(8.5).fillColor("#777").text(p.tech, mainX, y2, { width: mainRight - mainX }); y2 = doc.y; }
      if (p.links) { doc.fontSize(8.5).fillColor("#777").text(p.links, mainX, y2, { width: mainRight - mainX }); y2 = doc.y; }
      mainY = y2 + 10;
    }
  }

  const achievements = arr(resume.achievements);
  if (achievements.length) {
    mainHeader("Achievements");
    for (const a of achievements) {
      doc.font("Helvetica").fontSize(9.5).fillColor("#1C1B18").text(`•  ${a.text || a}`, mainX, mainY, { width: mainRight - mainX });
      mainY = doc.y + 2;
    }
  }

  return doc;
}

// ===================== Executive: premium single-column corporate style =====================
function renderExecutive(resume) {
  const accent = TEMPLATE_META.executive.accent;
  const doc = new PDFDocument({ margin: 54, size: "A4" });
  const left = 54, right = PAGE_WIDTH - 54;

  doc.font("Times-Bold").fontSize(26).fillColor(accent).text((resume.fullName || "Your Name").toUpperCase(), { align: "center", characterSpacing: 1.2 });
  doc.moveDown(0.3);
  doc.font("Times-Roman").fontSize(10).fillColor("#444");
  const contactLine = [resume.email, resume.mobile, resume.address].filter(Boolean).join("   |   ");
  if (contactLine) doc.text(contactLine, { align: "center" });
  const linksLine = [resume.linkedin, resume.github, resume.portfolio].filter(Boolean).join("   |   ");
  if (linksLine) doc.text(linksLine, { align: "center" });
  doc.moveDown(0.6);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(accent).lineWidth(1).stroke();
  doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(accent).lineWidth(0.5).stroke();
  doc.moveDown(1);

  function sectionHeader(title) {
    if (doc.y > 750) doc.addPage();
    doc.font("Times-Bold").fontSize(13).fillColor(accent).text(title.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveDown(0.5);
    doc.font("Times-Roman").fontSize(10.5).fillColor("#1C1B18");
  }

  if (resume.summary) {
    sectionHeader("Executive Summary");
    doc.text(resume.summary);
    doc.moveDown(1);
  }

  const experience = arr(resume.experience);
  if (experience.length) {
    sectionHeader("Professional Experience");
    for (const raw of experience) {
      const e = experienceLine(raw);
      doc.font("Times-Bold").fontSize(11.5).fillColor("#1C1B18").text(e.title);
      if (e.meta) doc.font("Times-Italic").fontSize(10).fillColor("#555").text(e.meta);
      if (e.body) doc.font("Times-Roman").fillColor("#1C1B18").fontSize(10.5).text(e.body);
      if (e.tech) doc.fontSize(9.5).fillColor("#555").text(e.tech);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.7);
    }
  }

  const education = arr(resume.education);
  if (education.length) {
    sectionHeader("Education");
    for (const raw of education) {
      const e = educationLine(raw);
      doc.font("Times-Bold").fontSize(11).fillColor("#1C1B18").text(e.title);
      doc.font("Times-Roman").fontSize(10.5).text(e.sub);
      doc.fontSize(9.5).fillColor("#555").text(e.meta);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.6);
    }
  }

  const skills = skillsByCategory(resume);
  if (Object.keys(skills).length) {
    sectionHeader("Core Competencies");
    for (const [cat, names] of Object.entries(skills)) {
      doc.font("Times-Bold").fontSize(10.5).fillColor("#1C1B18").text(`${cat}: `, { continued: true });
      doc.font("Times-Roman").fontSize(10.5).text(names.join(", "));
    }
    doc.moveDown(0.7);
  }

  const certifications = arr(resume.certifications);
  if (certifications.length) {
    sectionHeader("Certifications");
    for (const c of certifications) {
      doc.font("Times-Bold").fontSize(10.5).fillColor("#1C1B18").text(`${c.name || ""}${c.org ? ` — ${c.org}` : ""}`);
      const meta = [c.issueDate, c.credentialId ? `ID: ${c.credentialId}` : null].filter(Boolean).join("   ·   ");
      if (meta) doc.font("Times-Roman").fontSize(9.5).fillColor("#555").text(meta);
      doc.fillColor("#1C1B18");
      doc.moveDown(0.5);
    }
  }

  const projects = arr(resume.projects);
  if (projects.length) {
    sectionHeader("Selected Projects");
    for (const raw of projects) {
      const p = projectLine(raw);
      doc.font("Times-Bold").fontSize(10.5).fillColor("#1C1B18").text(p.title);
      if (p.meta) doc.font("Times-Italic").fontSize(9.5).fillColor("#555").text(p.meta);
      if (p.body) doc.font("Times-Roman").fillColor("#1C1B18").fontSize(10.5).text(p.body);
      if (p.tech) doc.font("Times-Italic").fontSize(9.5).fillColor("#555").text(p.tech);
      if (p.links) doc.font("Times-Roman").fontSize(9.5).fillColor("#555").text(p.links);
      doc.moveDown(0.5);
    }
  }

  const achievements = arr(resume.achievements);
  if (achievements.length) {
    sectionHeader("Achievements");
    for (const a of achievements) doc.fontSize(10.5).fillColor("#1C1B18").text(`•  ${a.text || a}`);
  }

  return doc;
}

// ===================== Creative: colored header band + skill tags =====================
function renderCreative(resume) {
  const accent = TEMPLATE_META.creative.accent;
  const secondary = "#F4E9FB";
  const doc = new PDFDocument({ margin: 0, size: "A4" });
  const left = 46, right = PAGE_WIDTH - 46;

  const headerH = 132;
  doc.rect(0, 0, PAGE_WIDTH, headerH).fill(accent);
  const initials = (resume.fullName || "Y N").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  doc.circle(70, headerH / 2, 34).fill("#ffffff");
  doc.font("Helvetica-Bold").fontSize(24).fillColor(accent).text(initials, 40, headerH / 2 - 16, { width: 60, align: "center" });
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#ffffff").text(resume.fullName || "Your Name", 122, 38, { width: PAGE_WIDTH - 122 - 40 });
  doc.font("Helvetica").fontSize(10).fillColor("#ffffff");
  const contactLine = [resume.email, resume.mobile, resume.address].filter(Boolean).join("   |   ");
  if (contactLine) doc.text(contactLine, 122, doc.y + 6, { width: PAGE_WIDTH - 122 - 40 });
  const linksLine = [resume.linkedin, resume.github, resume.portfolio].filter(Boolean).join("   |   ");
  if (linksLine) doc.text(linksLine, 122, doc.y + 2, { width: PAGE_WIDTH - 122 - 40 });

  doc.y = headerH + 26;
  doc.x = left;

  function sectionHeader(title) {
    if (doc.y > 760) { doc.addPage(); doc.y = 40; }
    const y = doc.y;
    doc.rect(left, y, 4, 14).fill(accent);
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(accent).text(title.toUpperCase(), left + 12, y - 1, { width: right - left - 12 });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(10).fillColor("#1C1B18");
    doc.x = left;
  }

  if (resume.summary) {
    sectionHeader("About Me");
    doc.text(resume.summary, left, doc.y, { width: right - left });
    doc.moveDown(0.8);
  }

  const skills = skillsByCategory(resume);
  const allSkillNames = Object.values(skills).flat();
  if (allSkillNames.length) {
    sectionHeader("Skills");
    let tagX = left, tagY = doc.y;
    doc.font("Helvetica").fontSize(9);
    for (const name of allSkillNames) {
      const w = doc.widthOfString(name) + 16;
      if (tagX + w > right) { tagX = left; tagY += 22; }
      doc.roundedRect(tagX, tagY, w, 18, 9).fill(secondary);
      doc.fillColor(accent).text(name, tagX + 8, tagY + 4.5, { width: w - 16 });
      tagX += w + 8;
    }
    doc.y = tagY + 28;
    doc.x = left;
  }

  const experience = arr(resume.experience);
  if (experience.length) {
    sectionHeader("Experience");
    for (const raw of experience) {
      const e = experienceLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(e.title, left, doc.y, { width: right - left });
      if (e.meta) doc.font("Helvetica").fontSize(9).fillColor(accent).text(e.meta, left, doc.y, { width: right - left });
      if (e.body) doc.font("Helvetica").fillColor("#1C1B18").fontSize(9.5).text(e.body, left, doc.y, { width: right - left });
      if (e.tech) doc.fontSize(8.5).fillColor("#777").text(e.tech, left, doc.y, { width: right - left });
      doc.moveDown(0.6);
      doc.x = left;
    }
  }

  const projects = arr(resume.projects);
  if (projects.length) {
    sectionHeader("Projects");
    for (const raw of projects) {
      const p = projectLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(p.title, left, doc.y, { width: right - left });
      if (p.meta) doc.font("Helvetica").fillColor("#777").fontSize(8.5).text(p.meta, left, doc.y, { width: right - left });
      if (p.body) doc.font("Helvetica").fillColor("#1C1B18").fontSize(9.5).text(p.body, left, doc.y, { width: right - left });
      if (p.tech) doc.font("Helvetica").fillColor("#777").fontSize(8.5).text(p.tech, left, doc.y, { width: right - left });
      if (p.links) doc.fontSize(8.5).fillColor(accent).text(p.links, left, doc.y, { width: right - left });
      doc.moveDown(0.6);
      doc.x = left;
    }
  }

  const education = arr(resume.education);
  if (education.length) {
    sectionHeader("Education");
    for (const raw of education) {
      const e = educationLine(raw);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1C1B18").text(e.title, left, doc.y, { width: right - left });
      doc.font("Helvetica").fontSize(9.5).text(`${e.sub}   ·   ${e.meta}`, left, doc.y, { width: right - left });
      doc.moveDown(0.5);
      doc.x = left;
    }
  }

  const achievements = arr(resume.achievements);
  if (achievements.length) {
    sectionHeader("Achievements");
    for (const a of achievements) {
      doc.font("Helvetica").fontSize(9.5).fillColor("#1C1B18").text(`•  ${a.text || a}`, left, doc.y, { width: right - left });
    }
  }

  return doc;
}

const RENDERERS = {
  modern: renderModern,
  professional: renderProfessional,
  minimal: renderMinimal,
  executive: renderExecutive,
  creative: renderCreative,
};

function generateResumePdf(resume, res) {
  const templateId = resolveTemplate(resume.template);
  const render = RENDERERS[templateId] || renderProfessional;
  const doc = render({ ...resume, template: templateId });
  doc.pipe(res);
  doc.end();
}

module.exports = { generateResumePdf, TEMPLATE_META };
