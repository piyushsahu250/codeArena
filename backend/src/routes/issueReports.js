// User-facing "Report a Problem" feature, part of the Daily Platform Health System spec. Any
// authenticated role can submit a report; SUPER_ADMIN/INSTITUTE_ADMIN/ADMIN see a review queue,
// institute-scoped the same way every other admin list on this platform is (attachRequesterInstitute).
// Deliberately NOT wired to any AI auto-classification or auto-fix pipeline — that was explicitly
// scoped out ("Detect + report only, no auto-deploy"). Triage (status/severity/notes) is manual.
const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");

const router = express.Router();

const MAX_DESCRIPTION_LENGTH = 4000;
const STATUSES = ["PENDING", "TRIAGED", "IN_PROGRESS", "RESOLVED", "DUPLICATE", "WONT_FIX"];

// Any authenticated user — this is the "Report a Problem" submission itself, no role gate beyond login.
router.post("/", authenticate, async (req, res) => {
  const { page, feature, description, errorId, browserInfo } = req.body || {};
  if (!description || typeof description !== "string" || !description.trim()) {
    return res.status(400).json({ error: "Please describe the problem." });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return res.status(400).json({ error: `Description must be under ${MAX_DESCRIPTION_LENGTH} characters.` });
  }
  // req.user comes straight from the JWT payload ({ id, role, email, jti }) — it never carries
  // instituteId, so it has to be looked up, same as every other route that needs the acting
  // user's own institute (see users.js:1289, attendance.js:1076, etc).
  const reporter = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
  const issue = await prisma.userReportedIssue.create({
    data: {
      reportedByUserId: req.user.id,
      reportedByRole: req.user.role,
      instituteId: reporter?.instituteId || null,
      page: typeof page === "string" ? page.slice(0, 300) : null,
      feature: typeof feature === "string" ? feature.slice(0, 200) : null,
      description: description.trim(),
      errorId: typeof errorId === "string" ? errorId.slice(0, 200) : null,
      browserInfo: typeof browserInfo === "string" ? browserInfo.slice(0, 500) : null,
    },
  });
  res.status(201).json({ id: issue.id, status: issue.status });
});

// The reporter can see their own submission history — not a review queue, just their own list.
router.get("/mine", authenticate, async (req, res) => {
  const issues = await prisma.userReportedIssue.findMany({
    where: { reportedByUserId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ issues });
});

const reviewGuard = [authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute];

// Review queue — same institute-scoping convention as every other admin list route: SUPER_ADMIN
// (req.requesterInstituteId === null) sees everything, INSTITUTE_ADMIN/ADMIN see only their own institute.
router.get("/", ...reviewGuard, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const where = {
    ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
    ...(req.query.status && STATUSES.includes(req.query.status) ? { status: req.query.status } : {}),
  };
  const [issues, total, openCount] = await Promise.all([
    prisma.userReportedIssue.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.userReportedIssue.count({ where }),
    prisma.userReportedIssue.count({ where: { ...where, status: { in: ["PENDING", "TRIAGED", "IN_PROGRESS"] } } }),
  ]);
  res.json({ issues, page, pageSize, total, totalPages: Math.ceil(total / pageSize), openCount });
});

router.patch("/:id", ...reviewGuard, async (req, res) => {
  const existing = await prisma.userReportedIssue.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Report not found" });
  if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  const { status, severity, reviewNotes, duplicateOfId } = req.body || {};
  const data = {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    data.status = status;
  }
  if (severity !== undefined) data.severity = typeof severity === "string" ? severity.slice(0, 20) : null;
  if (reviewNotes !== undefined) data.reviewNotes = typeof reviewNotes === "string" ? reviewNotes.slice(0, 4000) : null;
  if (duplicateOfId !== undefined) data.duplicateOfId = duplicateOfId || null;
  if (Object.keys(data).length > 0) {
    data.reviewedByAdminId = req.user.id;
    data.reviewedByName = req.user.name;
    data.reviewedAt = new Date();
  }
  const updated = await prisma.userReportedIssue.update({ where: { id: req.params.id }, data });
  res.json(updated);
});

module.exports = router;
