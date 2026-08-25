const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { generateTempPassword, recordPasswordChange } = require("../utils/password");
const { cached, invalidate } = require("../utils/cache");

const router = express.Router();

// ADMIN/STAFF: list classes/programs, with a student headcount per class. Institute-scoped
// accounts always see only their own institute; platform-level accounts (no instituteId)
// may optionally filter via ?instituteId=. Cached per scope key — classes change rarely but
// this list is read on nearly every test-creation/bulk-upload/student-management page load.
router.get("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const where = {};
  if (req.requesterInstituteId) {
    where.instituteId = req.requesterInstituteId;
  } else if (req.query.instituteId) {
    where.instituteId = req.query.instituteId;
  }
  const cacheKey = `classes:list:${req.requesterInstituteId || req.query.instituteId || "all"}`;
  const classes = await cached(cacheKey, 2 * 60 * 1000, () =>
    prisma.class.findMany({
      where,
      orderBy: [{ name: "asc" }, { batchYear: "asc" }],
      include: {
        institute: { select: { id: true, name: true } },
        division: { include: { department: true } },
        _count: { select: { users: true } },
      },
    })
  );
  res.json(classes);
});

// ADMIN: add a class/program + batch year under an institute. Institute-scoped admins can
// only add classes under their own institute (their instituteId wins over anything in the
// body). A class is uniquely identified by institute + name + batch year, so the same
// program name can recur across batches (e.g. MCA 2025, MCA 2026).
router.post("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { name, code, batchYear } = req.body;
    if (req.requesterInstituteId && req.body.instituteId && req.body.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only add classes under your own institute" });
    }
    const instituteId = req.requesterInstituteId || req.body.instituteId;
    if (!name || !name.trim()) return res.status(400).json({ error: "Class name is required" });
    if (!batchYear || !String(batchYear).trim()) return res.status(400).json({ error: "Batch year is required" });
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });

    const institute = await prisma.institute.findUnique({ where: { id: instituteId } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    const existing = await prisma.class.findFirst({
      where: { instituteId, name: name.trim(), batchYear: String(batchYear).trim() },
    });
    if (existing) return res.status(409).json({ error: "This class already exists for this institute and batch year" });

    const cls = await prisma.class.create({
      data: { name: name.trim(), code: code?.trim() || null, batchYear: String(batchYear).trim(), instituteId },
      include: { institute: { select: { id: true, name: true } }, _count: { select: { users: true } } },
    });
    invalidate("classes:");
    res.json(cls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create class" });
  }
});

// ADMIN: edit name/code/batchYear/institute, or toggle active/inactive. Institute-scoped
// admins can only touch classes already under their own institute, and can't move a class
// elsewhere.
router.patch("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.class.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Class not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage classes under your own institute" });
    }

    const { name, code, isActive, instituteId, batchYear } = req.body;
    if (req.requesterInstituteId && instituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only assign classes to your own institute" });
    }
    if (batchYear !== undefined && !String(batchYear).trim()) {
      return res.status(400).json({ error: "Batch year is required" });
    }

    const nextInstituteId = instituteId ?? existing.instituteId;
    const nextName = name?.trim() ?? existing.name;
    const nextBatchYear = batchYear !== undefined ? String(batchYear).trim() : existing.batchYear;
    if (
      (name && name.trim() !== existing.name) ||
      (instituteId && instituteId !== existing.instituteId) ||
      (batchYear !== undefined && String(batchYear).trim() !== existing.batchYear)
    ) {
      const dup = await prisma.class.findFirst({
        where: { instituteId: nextInstituteId, name: nextName, batchYear: nextBatchYear, NOT: { id: existing.id } },
      });
      if (dup) return res.status(409).json({ error: "This class already exists for this institute and batch year" });
    }

    const cls = await prisma.class.update({
      where: { id: req.params.id },
      data: {
        name: nextName,
        code: code !== undefined ? (code?.trim() || null) : existing.code,
        batchYear: nextBatchYear,
        isActive: isActive ?? existing.isActive,
        instituteId: nextInstituteId,
      },
      include: { institute: { select: { id: true, name: true } }, _count: { select: { users: true } } },
    });
    invalidate("classes:");
    res.json(cls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update class" });
  }
});

// ADMIN: delete a class. Institute-scoped admins can only delete classes under their own institute.
router.delete("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.class.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Class not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage classes under your own institute" });
    }

    await prisma.class.delete({ where: { id: req.params.id } });
    invalidate("classes:");
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This class has students or tests linked to it and can't be deleted." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete class" });
  }
});

// ADMIN/STAFF: full student roster for one class (roll number, name, email, mobile).
router.get("/:id/students", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const cls = await prisma.class.findUnique({ where: { id: req.params.id }, include: { institute: { select: { id: true, name: true } } } });
    if (!cls) return res.status(404).json({ error: "Class not found" });
    if (req.requesterInstituteId && cls.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view classes under your own institute" });
    }

    const students = await prisma.user.findMany({
      where: { classId: req.params.id, role: "STUDENT" },
      select: { id: true, name: true, email: true, rollNumber: true, mobile: true },
      orderBy: { name: "asc" },
    });
    res.json({ class: cls, students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load class roster" });
  }
});

// ADMIN: reset every student in a class to their own new, unique random temporary password —
// NOT the same password for the whole class (a shared reset password would be exactly the kind
// of reused-across-many-accounts secret that gets a class collectively compromised if any one
// student's password leaks). Each account is flagged to force a password change on next login.
// Individual per-row updates (not a single updateMany) since each student needs a distinct hash.
router.post("/:id/bulk-reset-password", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const cls = await prisma.class.findUnique({ where: { id: req.params.id } });
    if (!cls) return res.status(404).json({ error: "Class not found" });
    if (req.requesterInstituteId && cls.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage classes under your own institute" });
    }

    const students = await prisma.user.findMany({
      where: { classId: req.params.id, role: "STUDENT" },
      select: { id: true, name: true, email: true, rollNumber: true },
    });

    const reset = [];
    for (const student of students) {
      const newPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(newPassword, 10);
      // Hash write + passwordChangedAt/PasswordHistory write must be atomic — see auth.js's
      // reset-password route for why.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: student.id }, data: { passwordHash, mustChangePassword: true } });
        await recordPasswordChange(tx, student.id, passwordHash, null);
      });
      reset.push({ id: student.id, name: student.name, email: student.email, rollNumber: student.rollNumber, newPassword });
    }

    res.json({ resetCount: reset.length, students: reset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to bulk-reset passwords" });
  }
});

module.exports = router;
