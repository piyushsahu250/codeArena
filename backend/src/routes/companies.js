const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

// Company Master — reused wherever a student would otherwise type a free-text employer name
// (currently: Resume Builder's Experience section). Any authenticated role can read the list
// (students need it for the dropdown); only ADMIN/CLERK maintain it.
router.get("/", authenticate, async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 2000,
    });
    res.json(companies);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load companies" });
  }
});

router.post("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "CLERK"), async (req, res) => {
  try {
    const { name, logoUrl, companyType, website } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Company name is required" });

    const existing = await prisma.company.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(409).json({ error: "A company with this name already exists" });

    const company = await prisma.company.create({
      data: {
        name: name.trim(), logoUrl: logoUrl || null, companyType: companyType || null, website: website || null,
        createdByUserId: req.user.id, createdByName: req.user.name,
      },
    });
    await logAudit({ req, action: AUDIT_ACTIONS.COMPANY_MASTER_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, details: { operation: "create", companyId: company.id, companyName: company.name } });
    res.json(company);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create company" });
  }
});

router.patch("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "CLERK"), async (req, res) => {
  try {
    const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Company not found" });

    const { name, logoUrl, companyType, website, isActive } = req.body;
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
