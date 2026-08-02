const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { computeCompletion, computeAtsScore } = require("../utils/resumeAts");
const { generateResumePdf } = require("../utils/resumePdf");
const { generateResumeDocx } = require("../utils/resumeDocx");
const { buildAutofillData } = require("../utils/resumeAutofill");
const { parseResumeFile } = require("../utils/resumeParser");
const { improveText } = require("../utils/resumeImprove");
const { askClaudeJson, isConfigured: aiIsConfigured } = require("../utils/aiClient");
const { ROLE_KEYWORDS, analyzeForRole } = require("../utils/resumeJobRoles");
const { cached } = require("../utils/cache");

const router = express.Router();
// Real, billed Claude API calls — tighter than the global per-user limiter, same rationale as
// learning.js's hintLimiter.
const aiReviewLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });
// Separate, more generous bucket from aiReviewLimiter — a student calling "Improve with AI" once
// per section while editing is a much smaller/cheaper call (short text, low max_tokens) than the
// whole-resume review, and sharing one counter across both routes would make routine per-section
// use hit the whole-resume review's limit almost immediately.
const improveLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, keyGenerator: (req) => req.user.id });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// fullName/photoUrl/email/mobile/address are independently editable here — Resume Builder does
// not pull these from Profile (Profile has its own, separate copy of the same kind of fields for
// the institutional record). A student's resume contact details can differ from their Profile.
const ALLOWED_FIELDS = [
  "fullName", "email", "mobile", "photoUrl", "address",
  "template", "linkedin", "github", "portfolio", "summary",
  "education", "skills", "projects", "experience", "certifications", "achievements", "languages",
];
const DEFAULT_MANDATORY = ["personal", "summary", "education", "skills", "projects", "certifications"];

async function getFieldConfig() {
  let config = await prisma.resumeFieldConfig.findUnique({ where: { id: "default" } });
  if (!config) {
    config = await prisma.resumeFieldConfig.create({ data: { id: "default", mandatorySections: DEFAULT_MANDATORY } });
  }
  return config;
}

function resumeFilename(resume, ext) {
  return `${(resume.fullName || "resume").replace(/[^a-z0-9]+/gi, "-")}-resume.${ext}`;
}
function pdfFilename(resume) {
  return resumeFilename(resume, "pdf");
}

// Snapshots the resume's current field values as a new ResumeVersion, then prunes anything
// beyond the 20 most recent for this resume — "automatically save every major edit" without
// unbounded growth from an active editing session.
async function saveVersion(resumeId, resumeSnapshot) {
  const atsScore = computeAtsScore(resumeSnapshot).score;
  const version = await prisma.resumeVersion.create({ data: { resumeId, snapshot: resumeSnapshot, atsScore } });
  const versions = await prisma.resumeVersion.findMany({
    where: { resumeId }, orderBy: { createdAt: "desc" }, select: { id: true }, skip: 20,
  });
  if (versions.length) {
    await prisma.resumeVersion.deleteMany({ where: { id: { in: versions.map((v) => v.id) } } });
  }
  return version.id;
}

// =========================== Student-facing ===========================

// STUDENT: fetch (auto-creating an empty draft on first call) their own resume, plus computed
// completion status and any admin feedback notes left on it.
router.get("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    let resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) {
      resume = await prisma.resume.create({ data: { studentId: req.user.id } });
    }
    const config = await getFieldConfig();
    const feedback = await prisma.resumeFeedback.findMany({ where: { studentId: req.user.id }, orderBy: { createdAt: "desc" }, take: 20 });
    res.json({ resume, completion: computeCompletion(resume, config.mandatorySections), feedback });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load resume" });
  }
});

// STUDENT: save any subset of resume fields (personal details, template choice, or a whole
// section array). The frontend sends only what changed; whole-array sections are replaced
// wholesale (add/edit/delete within a section all happen client-side, then the full array is
// saved), matching "save the whole resume as one draft" rather than per-item CRUD endpoints.
router.patch("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const data = {};
    for (const f of ALLOWED_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f];

    const existing = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    const latestVersion = existing
      ? await prisma.resumeVersion.findFirst({ where: { resumeId: existing.id }, orderBy: { createdAt: "desc" } })
      : null;
    const previousScore = latestVersion ? latestVersion.atsScore : existing ? computeAtsScore(existing).score : null;
    const previousBreakdown = latestVersion ? computeAtsScore(latestVersion.snapshot).breakdown : existing ? computeAtsScore(existing).breakdown : null;

    const resume = await prisma.resume.upsert({
      where: { studentId: req.user.id },
      update: data,
      create: { studentId: req.user.id, ...data },
    });

    const atsScore = computeAtsScore(resume);
    await saveVersion(resume.id, resume);
    const config = await getFieldConfig();

    // "Previous score -> current score, what improved" — only present once there's a prior
    // score to compare against (first save on a brand-new resume has nothing to diff).
    let scoreDelta = null;
    if (previousScore !== null) {
      const byCategory = atsScore.breakdown
        .map((b) => {
          const prev = previousBreakdown?.find((p) => p.key === b.key);
          return { label: b.label, delta: b.score - (prev ? prev.score : 0) };
        })
        .filter((d) => d.delta !== 0);
      scoreDelta = { previous: previousScore, current: atsScore.score, overall: atsScore.score - previousScore, byCategory };
    }

    res.json({ resume, completion: computeCompletion(resume, config.mandatorySections), atsScore, scoreDelta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save resume" });
  }
});

// STUDENT: upload an existing resume (.pdf or .docx, max 10MB) and have it parsed + populated
// into this editable resume record. Overwrites the current draft's fields with whatever was
// successfully extracted (falling back to any existing value the parser didn't find one for) —
// the whole point of "Upload Existing Resume" is replacing/seeding the draft, not merging. The
// pre-upload state is snapshotted to version history first, so nothing is silently lost — it can
// be restored if the upload wasn't actually an improvement. The uploaded file itself is never
// stored — only the extracted structured data is saved, consistent with this platform having no
// object storage anywhere else (Resume.photoUrl, Lesson.videoUrl are external URLs only).
router.post(
  "/me/upload",
  authenticate,
  requireRole("STUDENT"),
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File is too large. Maximum size is 10 MB." });
        return res.status(400).json({ error: "Failed to upload file." });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = String(req.file.originalname || "").toLowerCase().split(".").pop();
      if (!["pdf", "docx"].includes(ext)) {
        return res.status(400).json({ error: "Unsupported file type. Please upload a .pdf or .docx file." });
      }

      let parsed;
      try {
        parsed = await parseResumeFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      } catch (parseErr) {
        return res.status(422).json({ error: parseErr.message || "Failed to parse this resume." });
      }

      const existing = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
      // Captured so the frontend can offer a one-click "Undo this upload" — restoring exactly
      // this snapshot — right after the parse, without the student needing to dig through
      // Version History manually.
      const previousVersionId = existing ? await saveVersion(existing.id, existing) : null;

      const data = {
        fullName: parsed.fullName || existing?.fullName || "",
        email: parsed.email || existing?.email || "",
        mobile: parsed.mobile || existing?.mobile || "",
        address: parsed.address || existing?.address || "",
        linkedin: parsed.linkedin || existing?.linkedin || "",
        github: parsed.github || existing?.github || "",
        portfolio: parsed.portfolio || existing?.portfolio || "",
        summary: parsed.summary || existing?.summary || "",
        education: parsed.education.length ? parsed.education : existing?.education || [],
        skills: parsed.skills.length ? parsed.skills : existing?.skills || [],
        projects: parsed.projects.length ? parsed.projects : existing?.projects || [],
        experience: parsed.experience.length ? parsed.experience : existing?.experience || [],
        certifications: parsed.certifications.length ? parsed.certifications : existing?.certifications || [],
        achievements: parsed.achievements.length ? parsed.achievements : existing?.achievements || [],
        languages: parsed.languages.length ? parsed.languages : existing?.languages || [],
      };

      const resume = await prisma.resume.upsert({
        where: { studentId: req.user.id },
        update: data,
        create: { studentId: req.user.id, ...data },
      });

      const atsScore = computeAtsScore(resume);
      await saveVersion(resume.id, resume);
      const config = await getFieldConfig();

      const COUNTABLE_FIELDS = ["fullName", "email", "mobile", "linkedin", "github", "portfolio", "address", "summary", "education", "skills", "projects", "experience", "certifications", "achievements", "languages"];
      const extractedCount = COUNTABLE_FIELDS.filter((k) => (Array.isArray(parsed[k]) ? parsed[k].length > 0 : !!parsed[k])).length;
      res.json({
        resume, completion: computeCompletion(resume, config.mandatorySections), atsScore,
        parsedFieldsCount: extractedCount,
        confidence: parsed.confidence, lowConfidenceFields: parsed.lowConfidenceFields,
        rawText: parsed.rawText,
        previousVersionId,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to process uploaded resume" });
    }
  }
);

// STUDENT: wipe the entire resume back to a blank draft (keeps the row itself and its template
// choice). The pre-clear state is snapshotted to version history first, so this is undoable via
// the same Restore mechanism as everything else — "Clear All Resume Data" / "Delete Uploaded
// Resume" are the same operation under the hood, since no separate uploaded file is ever stored
// to delete in the first place (only ever the extracted structured data).
router.post("/me/clear-all", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const existing = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!existing) return res.status(404).json({ error: "No resume found" });
    await saveVersion(existing.id, existing);

    const blank = {
      fullName: "", email: "", mobile: "", photoUrl: "", address: "",
      linkedin: "", github: "", portfolio: "", summary: "",
      education: [], skills: [], projects: [], experience: [], certifications: [], achievements: [], languages: [],
      targetRole: null,
    };
    const resume = await prisma.resume.update({ where: { studentId: req.user.id }, data: blank });
    await saveVersion(resume.id, resume);
    const config = await getFieldConfig();
    res.json({ resume, completion: computeCompletion(resume, config.mandatorySections), atsScore: computeAtsScore(resume) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear resume" });
  }
});

const CLEARABLE_SECTIONS = {
  summary: { summary: "" },
  education: { education: [] },
  skills: { skills: [] },
  projects: { projects: [] },
  experience: { experience: [] },
  certifications: { certifications: [] },
  achievements: { achievements: [] },
  languages: { languages: [] },
};

// STUDENT: clear just one section (e.g. "start Projects over from scratch") without touching
// anything else — same undo-via-version-history safety net as clear-all.
router.post("/me/clear-section", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const data = CLEARABLE_SECTIONS[req.body.section];
    if (!data) return res.status(400).json({ error: "Unknown or non-clearable section" });
    const existing = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!existing) return res.status(404).json({ error: "No resume found" });
    await saveVersion(existing.id, existing);

    const resume = await prisma.resume.update({ where: { studentId: req.user.id }, data });
    const atsScore = computeAtsScore(resume);
    await saveVersion(resume.id, resume);
    const config = await getFieldConfig();
    res.json({ resume, completion: computeCompletion(resume, config.mandatorySections), atsScore });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear section" });
  }
});

// STUDENT: rewrite suggestion for one block of text (summary / project description / experience
// responsibilities / achievement). Returns a suggestion only — never auto-saves, so the student
// explicitly accepts or rejects it in the editor. Uses a real Claude call when the server has
// ANTHROPIC_API_KEY configured, falling back to the deterministic rule-based rewrite otherwise —
// same graceful-degradation posture as every other AI feature on this platform (this endpoint
// must keep working even when AI isn't configured, since it predates the AI integration). The
// response's `source` field tells the frontend which path produced the suggestion so it can be
// honest about it rather than always implying a real AI rewrite happened.
router.post("/me/improve", authenticate, requireRole("STUDENT"), improveLimiter, async (req, res) => {
  try {
    const { text, section } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
    const original = String(text).trim();

    if (aiIsConfigured()) {
      try {
        const ai = await askClaudeJson({
          system:
            "You are a resume-writing coach helping a student rewrite one section of their resume to be concise, " +
            "ATS-friendly, and impactful. Use strong action verbs and active voice. NEVER invent facts, technologies, " +
            "companies, or metrics that are not already present in the original text — if there's no quantifiable " +
            "outcome in the original, do not add a fake one; you may suggest the student add a real one instead. " +
            "Return only JSON.",
          prompt:
            `Section: ${section || "general"}\nOriginal text:\n"""${original}"""\n\n` +
            'Return JSON exactly shaped: {"improved": string (the rewritten text, same underlying facts, no invented content), ' +
            '"changes": string[] (2-4 short bullet points explaining what changed and why)}.',
          maxTokens: 500,
          temperature: 0.4,
        });
        if (ai && typeof ai.improved === "string" && ai.improved.trim()) {
          return res.json({
            original,
            improved: ai.improved.trim(),
            changes: Array.isArray(ai.changes) && ai.changes.length ? ai.changes : ["Rewritten for clarity and impact."],
            source: "ai",
          });
        }
      } catch (aiErr) {
        console.error("AI improve failed, falling back to rule-based rewrite:", aiErr.message);
      }
    }

    res.json({ ...improveText(original, section || "general"), source: "rule-based" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate improvement" });
  }
});

// STUDENT: whole-resume qualitative review via Claude — augments the existing rule-based
// completion/ATS scoring above rather than replacing it (that heuristic system stays the
// always-available default; this is an optional richer pass on top, same graceful-degradation
// posture as every other AI feature on this platform). Read-only — never saves anything.
router.post("/me/ai-review", authenticate, requireRole("STUDENT"), aiReviewLimiter, async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found — build one first" });

    const { id, studentId, createdAt, updatedAt, photoUrl, ...content } = resume;
    const review = await askClaudeJson({
      system: "You are a career coach reviewing a student's resume for placement readiness. Be specific and concrete — reference their actual content, don't give generic advice. Return only JSON matching the requested schema.",
      prompt: `Review this resume${resume.targetRole ? ` for a ${resume.targetRole} role` : ""}:\n\n${JSON.stringify(content, null, 2)}\n\nReturn JSON exactly shaped: {"overallFeedback": string (2-3 sentences), "strengths": string[] (2-4 items), "improvements": string[] (3-5 specific, actionable items referencing actual resume content)}.`,
      maxTokens: 1200,
      temperature: 0.4,
    });
    res.json(review);
  } catch (err) {
    if (err.notConfigured) return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "AI review failed — try again later" });
  }
});

router.get("/job-roles", authenticate, requireRole("STUDENT"), (req, res) => {
  res.json(Object.keys(ROLE_KEYWORDS));
});

// STUDENT: set (or clear) the target job role, returning the keyword-gap analysis for it.
router.patch("/me/target-role", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const role = req.body.role || null;
    if (role && !ROLE_KEYWORDS[role]) return res.status(400).json({ error: "Unknown role" });
    const resume = await prisma.resume.upsert({
      where: { studentId: req.user.id },
      update: { targetRole: role },
      create: { studentId: req.user.id, targetRole: role },
    });
    res.json({ resume, roleAnalysis: role ? analyzeForRole(resume, role) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to set target role" });
  }
});

router.get("/me/role-analysis", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found — save your resume first" });
    const role = req.query.role || resume.targetRole;
    if (!role) return res.status(400).json({ error: "No target role selected" });
    const analysis = analyzeForRole(resume, role);
    if (!analysis) return res.status(400).json({ error: "Unknown role" });
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute role analysis" });
  }
});

// STUDENT: version history — list, fetch one (for viewing/comparing), and restore.
router.get("/me/versions", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.json([]);
    const versions = await prisma.resumeVersion.findMany({
      where: { resumeId: resume.id }, orderBy: { createdAt: "desc" },
      select: { id: true, atsScore: true, createdAt: true },
    });
    res.json(versions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load version history" });
  }
});

router.get("/me/versions/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found" });
    const version = await prisma.resumeVersion.findUnique({ where: { id: req.params.id } });
    if (!version || version.resumeId !== resume.id) return res.status(404).json({ error: "Version not found" });
    res.json(version);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load version" });
  }
});

router.get("/me/versions/:id/pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found" });
    const version = await prisma.resumeVersion.findUnique({ where: { id: req.params.id } });
    if (!version || version.resumeId !== resume.id) return res.status(404).json({ error: "Version not found" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${resumeFilename(version.snapshot, "pdf")}"`);
    generateResumePdf(version.snapshot, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate PDF for this version" });
  }
});

// Delete one saved version — does not touch the active resume or any other version.
router.delete("/me/versions/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found" });
    const version = await prisma.resumeVersion.findUnique({ where: { id: req.params.id } });
    if (!version || version.resumeId !== resume.id) return res.status(404).json({ error: "Version not found" });
    await prisma.resumeVersion.delete({ where: { id: version.id } });
    res.json({ message: "Resume version deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete version" });
  }
});

// Clear every saved version for this student's resume — the active resume itself is untouched
// (ResumeVersion is a separate table; deleting rows here never affects the Resume record).
router.delete("/me/versions", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found" });
    await prisma.resumeVersion.deleteMany({ where: { resumeId: resume.id } });
    res.json({ message: "All resume versions cleared successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear version history" });
  }
});

router.post("/me/versions/:id/restore", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found" });
    const version = await prisma.resumeVersion.findUnique({ where: { id: req.params.id } });
    if (!version || version.resumeId !== resume.id) return res.status(404).json({ error: "Version not found" });

    await saveVersion(resume.id, resume); // current state becomes restorable too

    const snap = version.snapshot;
    const data = {};
    for (const f of ALLOWED_FIELDS) if (snap[f] !== undefined) data[f] = snap[f];
    const restored = await prisma.resume.update({ where: { studentId: req.user.id }, data });
    const config = await getFieldConfig();
    res.json({ resume: restored, completion: computeCompletion(restored, config.mandatorySections), atsScore: computeAtsScore(restored) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to restore version" });
  }
});

router.get("/me/docx", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found — save your resume first" });
    const buffer = await generateResumeDocx(resume);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${resumeFilename(resume, "docx")}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate DOCX" });
  }
});

// STUDENT: fill in whichever fields/sections are still empty using platform data (profile,
// class/institute, solved-language skills, course certificates, gamification badges). Never
// overwrites something the student has already filled in themselves.
router.post("/me/autofill", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const auto = await buildAutofillData(req.user.id);
    if (!auto) return res.status(404).json({ error: "Student not found" });
    const existing = await prisma.resume.findUnique({ where: { studentId: req.user.id } });

    // fullName/email/mobile are independently editable on Resume Builder now — autofill only
    // touches genuinely resume-specific content here, leaving contact details to the student.
    const data = {};
    if ((!existing?.education || existing.education.length === 0) && auto.education.length) data.education = auto.education;
    if ((!existing?.skills || existing.skills.length === 0) && auto.skills.length) data.skills = auto.skills;
    if ((!existing?.certifications || existing.certifications.length === 0) && auto.certifications.length) data.certifications = auto.certifications;
    if ((!existing?.achievements || existing.achievements.length === 0) && auto.achievements.length) data.achievements = auto.achievements;

    const resume = await prisma.resume.upsert({
      where: { studentId: req.user.id },
      update: data,
      create: { studentId: req.user.id, ...data },
    });
    const config = await getFieldConfig();
    res.json({ resume, filledFields: Object.keys(data), completion: computeCompletion(resume, config.mandatorySections) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to auto-fill resume" });
  }
});

// STUDENT: recompute the ATS score on demand ("regenerate after making improvements").
router.get("/me/ats-score", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found — save your resume first" });
    res.json(computeAtsScore(resume));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute ATS score" });
  }
});

router.get("/me/pdf", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { studentId: req.user.id } });
    if (!resume) return res.status(404).json({ error: "No resume found — save your resume first" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename(resume)}"`);
    generateResumePdf(resume, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// =========================== Admin/Staff ===========================

// Both routes below load every scoped student's full resume content to compute
// completion — cached briefly per institute scope, since this is otherwise a full
// load-everything-and-aggregate-in-JS pass on every dashboard/list load.
router.get("/admin/stats", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteKey = req.requesterInstituteId || "all";
    const stats = await cached(`resumeStats:${instituteKey}`, 60 * 1000, async () => {
      const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId, role: "STUDENT" } : { role: "STUDENT" };
      const students = await prisma.user.findMany({ where, select: { id: true } });
      const ids = students.map((s) => s.id);
      const resumes = ids.length ? await prisma.resume.findMany({ where: { studentId: { in: ids } } }) : [];
      const config = await getFieldConfig();
      const completions = resumes.map((r) => computeCompletion(r, config.mandatorySections).percent);
      return {
        totalStudents: ids.length,
        resumesStarted: resumes.length,
        averageCompletion: completions.length ? Math.round(completions.reduce((a, b) => a + b, 0) / completions.length) : 0,
        fullyComplete: completions.filter((c) => c === 100).length,
      };
    });
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load resume statistics" });
  }
});

router.get("/admin/students", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteKey = req.requesterInstituteId || "all";
    const rows = await cached(`resumeStudents:${instituteKey}`, 60 * 1000, async () => {
      const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId, role: "STUDENT" } : { role: "STUDENT" };
      const students = await prisma.user.findMany({ where, select: { id: true, name: true, email: true, rollNumber: true } });
      const resumes = students.length
        ? await prisma.resume.findMany({ where: { studentId: { in: students.map((s) => s.id) } } })
        : [];
      const resumeMap = new Map(resumes.map((r) => [r.studentId, r]));
      const config = await getFieldConfig();

      return students
        .map((s) => {
          const r = resumeMap.get(s.id);
          return {
            studentId: s.id, name: s.name, email: s.email, rollNumber: s.rollNumber,
            hasResume: !!r, completion: r ? computeCompletion(r, config.mandatorySections).percent : 0,
          };
        })
        .sort((a, b) => b.completion - a.completion);
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student resume list" });
  }
});

async function authorizeStudentResumeAccess(req, res) {
  const target = await prisma.user.findUnique({ where: { id: req.params.studentId } });
  if (!target || target.role !== "STUDENT") {
    res.status(404).json({ error: "Student not found" });
    return null;
  }
  if (req.requesterInstituteId && target.instituteId !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only manage students under your own institute" });
    return null;
  }
  return target;
}

router.get("/admin/:studentId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const target = await authorizeStudentResumeAccess(req, res);
    if (!target) return;
    const resume = await prisma.resume.findUnique({ where: { studentId: req.params.studentId } });
    if (!resume) return res.status(404).json({ error: "This student hasn't started a resume yet" });
    const config = await getFieldConfig();
    res.json({ resume, completion: computeCompletion(resume, config.mandatorySections), atsScore: computeAtsScore(resume) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student resume" });
  }
});

router.get("/admin/:studentId/pdf", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const target = await authorizeStudentResumeAccess(req, res);
    if (!target) return;
    const resume = await prisma.resume.findUnique({ where: { studentId: req.params.studentId } });
    if (!resume) return res.status(404).json({ error: "This student hasn't started a resume yet" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename(resume)}"`);
    generateResumePdf(resume, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ADMIN/STAFF: leave a feedback note on a student's resume ("Suggest improvements") — separate
// from the auto-generated ATS suggestions, visible to the student on their own resume page.
router.post("/admin/:studentId/feedback", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const target = await authorizeStudentResumeAccess(req, res);
    if (!target) return;
    const message = String(req.body.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required" });
    const author = await prisma.user.findUnique({ where: { id: req.user.id } });
    const feedback = await prisma.resumeFeedback.create({
      data: { studentId: req.params.studentId, authorName: author?.name || "Staff", message },
    });
    res.json(feedback);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

router.get("/field-config", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  res.json(await getFieldConfig());
});

router.patch("/field-config", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { mandatorySections } = req.body;
    if (!Array.isArray(mandatorySections)) return res.status(400).json({ error: "mandatorySections must be an array" });
    const config = await prisma.resumeFieldConfig.upsert({
      where: { id: "default" },
      update: { mandatorySections },
      create: { id: "default", mandatorySections },
    });
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update resume field configuration" });
  }
});

module.exports = router;
