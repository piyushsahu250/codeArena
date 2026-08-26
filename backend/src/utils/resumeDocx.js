const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = require("docx");

// Unlike resumePdf.js (5 genuinely distinct layouts), the DOCX export stays a single
// single-column, text-first structure across all templates — multi-column/table layouts are
// exactly what makes a .docx unreliable for ATS parsers, and this export exists specifically as
// the ATS-safe fallback. Colors here are kept in sync with resumePdf.js's TEMPLATE_META so a
// DOCX download at least matches its PDF counterpart's accent, even though the layout doesn't.
const TEMPLATE_COLORS = {
  modern: "4F9D6E", professional: "1C3D5A", minimal: "1C1B18", executive: "2B2118", creative: "9C4FD6",
};

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function heading(text, color) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { color, space: 2, style: BorderStyle.SINGLE, size: 4 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color, size: 22 })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 60 },
    children: [new TextRun({ text: text || "", bold: !!opts.bold, italics: !!opts.italics, size: opts.size ?? 20, color: opts.color })],
  });
}

// Renders several lines as ONE paragraph (using a manual line break before every line after the
// first) instead of one paragraph per line. mammoth's extractRawText() inserts a blank line
// BETWEEN paragraphs but not between manual line-breaks within a single paragraph — building a
// project/experience entry out of several separate Paragraph objects (the old approach) meant its
// own title/description/tech/link lines each came back from a round-trip upload as if they were
// blank-line-separated, which is exactly the signal resumeParser.js's entry-splitter uses to mean
// "these are two different projects." Confirmed live (scripts/debugUrlRoundTrip.js): a single
// project with a tech line and a link line was coming back as 2-4 fragmented bogus entries with
// most fields empty. One multi-line paragraph per entry preserves the visual line breaks while
// keeping the entry as a single block on round-trip, matching how a real blank line ONLY appears
// between genuinely different entries (added separately, after this paragraph, by the caller).
function multiLineParagraph(lines, afterSpacing = 40) {
  const runs = [];
  lines.forEach((line, i) => {
    runs.push(new TextRun({
      text: line.text || "", bold: !!line.bold, italics: !!line.italics,
      size: line.size ?? 20, color: line.color, break: i === 0 ? 0 : 1,
    }));
  });
  return new Paragraph({ spacing: { after: afterSpacing }, children: runs });
}

async function generateResumeDocx(resume) {
  const color = TEMPLATE_COLORS[resume.template] || TEMPLATE_COLORS.modern;
  const children = [];

  children.push(new Paragraph({ children: [new TextRun({ text: resume.fullName || "Your Name", bold: true, color, size: 40 })] }));
  const contactLine = [resume.email, resume.mobile, resume.address].filter(Boolean).join("   |   ");
  if (contactLine) children.push(body(contactLine, { size: 18, color: "333333" }));
  const linksLine = [resume.linkedin, resume.github, resume.portfolio].filter(Boolean).join("   |   ");
  if (linksLine) children.push(body(linksLine, { size: 18, color: "333333", after: 200 }));

  if (resume.summary) {
    children.push(heading("Professional Summary", color));
    children.push(body(resume.summary));
  }

  const education = arr(resume.education);
  if (education.length) {
    children.push(heading("Education", color));
    for (const e of education) {
      children.push(body(`${e.degree || ""}${e.specialization ? ` in ${e.specialization}` : ""}`, { bold: true, after: 20 }));
      children.push(body(`${e.institution || ""}${e.board ? ` (${e.board})` : ""}`, { after: 20 }));
      children.push(body(`${e.startYear || ""} – ${e.endYear || e.status || ""}${e.score ? `   ·   ${e.score}` : ""}`, { size: 18, color: "555555" }));
    }
  }

  const skills = arr(resume.skills);
  if (skills.length) {
    children.push(heading("Skills", color));
    const byCategory = {};
    for (const s of skills) {
      const cat = s.category || "Other";
      (byCategory[cat] = byCategory[cat] || []).push(s.proficiency ? `${s.name} (${s.proficiency})` : s.name);
    }
    for (const [cat, names] of Object.entries(byCategory)) {
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: `${cat}: `, bold: true, size: 19 }),
          new TextRun({ text: names.join(", "), size: 19 }),
        ],
      }));
    }
  }

  const projects = arr(resume.projects);
  if (projects.length) {
    children.push(heading("Projects", color));
    for (const p of projects) {
      const lines = [{ text: p.title || "", bold: true, size: 20 }];
      const meta = [p.role, p.duration].filter(Boolean).join("   ·   ");
      if (meta) lines.push({ text: meta, size: 18, color: "555555" });
      if (p.description) lines.push({ text: p.description, size: 20 });
      if (p.technologies) lines.push({ text: `Tech: ${p.technologies}`, size: 18, color: "555555" });
      // Deduplicated for the same reason as resumePdf.js's projectLine() — a student can enter the
      // same URL into both githubUrl and liveUrl, which previously printed it twice.
      const rawLinks = [p.githubUrl, p.liveUrl].filter(Boolean);
      const links = rawLinks.filter((url, i) => rawLinks.indexOf(url) === i).join("   |   ");
      if (links) lines.push({ text: links, size: 18, color: "555555" });
      children.push(multiLineParagraph(lines));
      // A real blank paragraph between entries — this is the ONLY blank-line signal between
      // projects now that each project's own lines are one combined paragraph (see
      // multiLineParagraph's comment above for why that combining was necessary).
      children.push(body("", { after: 40 }));
    }
  }

  const experience = arr(resume.experience);
  if (experience.length) {
    children.push(heading("Experience", color));
    for (const e of experience) {
      const lines = [{ text: `${e.title || ""}${e.company ? ` — ${e.company}` : ""}`, bold: true, size: 20 }];
      const meta = [e.employmentType, [e.startDate, e.endDate].filter(Boolean).join(" – ")].filter(Boolean).join("   ·   ");
      if (meta) lines.push({ text: meta, size: 18, color: "555555" });
      if (e.responsibilities) lines.push({ text: e.responsibilities, size: 20 });
      if (e.technologies) lines.push({ text: `Tech: ${e.technologies}`, size: 18, color: "555555" });
      children.push(multiLineParagraph(lines));
      children.push(body("", { after: 40 })); // see the matching comment in the Projects loop above
    }
  }

  const certifications = arr(resume.certifications);
  if (certifications.length) {
    children.push(heading("Certifications", color));
    for (const c of certifications) {
      children.push(body(`${c.name || ""}${c.org ? ` — ${c.org}` : ""}`, { bold: true, after: 20 }));
      const meta = [c.issueDate, c.credentialId ? `ID: ${c.credentialId}` : null].filter(Boolean).join("   ·   ");
      if (meta) children.push(body(meta, { size: 18, color: "555555" }));
      children.push(body("", { after: 40 }));
    }
  }

  const achievements = arr(resume.achievements);
  if (achievements.length) {
    children.push(heading("Achievements", color));
    for (const a of achievements) children.push(body(`•  ${a.text || a}`, { after: 20 }));
  }

  const languages = arr(resume.languages);
  if (languages.length) {
    children.push(heading("Languages", color));
    children.push(body(languages.map((l) => `${l.name} (${l.proficiency})`).join(", ")));
  }

  children.push(new Paragraph({
    spacing: { before: 300 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Created with CodeArena", size: 16, color: "999999" })],
  }));

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { generateResumeDocx };
