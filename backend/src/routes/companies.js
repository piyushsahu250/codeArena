const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

// Company Master — reused wherever a student would otherwise type a free-text employer name (Resume Builder's Experience section,
// placement offers, interview prep). ONE shared catalogue that every institute can read and use, with explicit ownership of who may
// change an entry (audit item T-3):
//   * platform-level admins (no institute) may create, edit and (de)activate any entry;
//   * an institute-bound ADMIN/CLERK may add a company (it is stamped with their institute) and may edit the details (name, logo,
//     type, website) of the companies THEIR institute created -- never a platform entry or another institute's;
//   * only platform-level admins may deactivate/reactivate, because that hides the company from every institute.
const canEditCompany = (req, c) => !req.requesterInstituteId || (!!c.instituteId && c.instituteId === req.requesterInstituteId);
const canToggleCompany = (req) => !req.requesterInstituteId;

router.get("/", authenticate, attachRequesterInstitute, async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 2000,
    });
    // `editable` / `canToggle` are computed here so the UI can hide actions the server would refuse; the server still enforces them.
    res.json(companies.map((c) => ({ ...c, editable: canEditCompany(req, c), canToggle: canToggleCompany(req) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load companies" });
  }
});

router.post("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { name, logoUrl, companyType, website } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Company name is required" });

    const existing = await prisma.company.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(409).json({ error: "A company with this name already exists in the shared catalogue — pick it from the list instead." });

    const company = await prisma.company.create({
      data: {
        name: name.trim(), logoUrl: logoUrl || null, companyType: companyType || null, website: website || null,
        createdByUserId: req.user.id, createdByName: req.user.name, instituteId: req.requesterInstituteId || null,
      },
    });
    await logAudit({ req, action: AUDIT_ACTIONS.COMPANY_MASTER_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { operation: "create", companyId: company.id, companyName: company.name } });
    res.json(company);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create company" });
  }
});

router.patch("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Company not found" });
    if (!canEditCompany(req, existing)) {
      return res.status(403).json({ error: existing.instituteId ? "This company was added by another institute. Ask a platform administrator to change it." : "This company is part of the platform catalogue. Ask a platform administrator to change it." });
    }

    const { name, logoUrl, companyType, website, isActive } = req.body;
    if (isActive !== undefined && isActive !== existing.isActive && !canToggleCompany(req)) {
      return res.status(403).json({ error: "Only a platform administrator can activate or deactivate a company, because it affects every institute." });
    }
    if (name && name.trim() !== existing.name) {
      const dup = await prisma.company.findUnique({ where: { name: name.trim() } });
      if (dup) return res.status(409).json({ error: "A company with this name already exists" });
    }

    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: {
        name: name?.trim() ?? existing.name,
        logoUrl: logoUrl !== undefined ? (logoUrl || null) : existing.logoUrl,
        companyType: companyType !== undefined ? (companyType || null) : existing.companyType,
        website: website !== undefined ? (website || null) : existing.website,
        isActive: isActive ?? existing.isActive,
      },
    });
    await logAudit({ req, action: AUDIT_ACTIONS.COMPANY_MASTER_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { operation: "update", companyId: company.id, companyName: company.name } });
    res.json(company);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update company" });
  }
});

module.exports = router;
