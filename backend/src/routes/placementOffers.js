const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { validateOfferInput } = require("../utils/placementOfferValidation");
const { generatePlacementPdf } = require("../utils/placementPdf");

const router = express.Router();

const OFFER_FIELDS = ["companyId", "companyName", "offerType", "source", "offeredPackage", "offerStatus", "joiningStatus", "proofLink"];

function pickOfferData(body) {
  const data = {};
  for (const key of OFFER_FIELDS) if (body[key] !== undefined) data[key] = body[key];
  if (data.offeredPackage !== undefined) data.offeredPackage = Number(data.offeredPackage);
  return data;
}

// =========================== Student-facing ===========================

router.get("/offers/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const offers = await prisma.placementOffer.findMany({ where: { studentId: req.user.id }, orderBy: { createdAt: "desc" } });
    res.json(offers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load offers" });
  }
});

router.post("/offers", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const error = validateOfferInput(req.body);
    if (error) return res.status(400).json({ error });
    const data = pickOfferData(req.body);
    const offer = await prisma.placementOffer.create({ data: { studentId: req.user.id, ...data } });
    res.json(offer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save offer" });
  }
});

// Editing any field of a VERIFIED or REJECTED offer resets it to PENDING — re-verification on
// edit, so a student can't silently change an already-verified offer's numbers.
router.patch("/offers/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const existing = await prisma.placementOffer.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.studentId !== req.user.id) return res.status(404).json({ error: "Offer not found" });

    const merged = { ...existing, ...req.body };
    const error = validateOfferInput(merged);
    if (error) return res.status(400).json({ error });

    const data = pickOfferData(req.body);
    if (existing.verificationStatus !== "PENDING") {
      data.verificationStatus = "PENDING";
      data.verifiedByUserId = null;
      data.verifiedByName = null;
      data.verifiedAt = null;
      data.rejectionReason = null;
    }
    const offer = await prisma.placementOffer.update({ where: { id: req.params.id }, data });
    res.json(offer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update offer" });
  }
});

router.delete("/offers/:id", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const existing = await prisma.placementOffer.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.studentId !== req.user.id) return res.status(404).json({ error: "Offer not found" });
    await prisma.placementOffer.delete({ where: { id: req.params.id } });
    res.json({ message: "Offer deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete offer" });
  }
});

function summarizeOffers(offers) {
  const internships = offers.filter((o) => o.offerType === "INTERNSHIP");
  const placements = offers.filter((o) => o.offerType === "PLACEMENT");
  const accepted = offers.filter((o) => o.offerStatus === "ACCEPTED");
  const rejected = offers.filter((o) => o.offerStatus === "REJECTED");
  const holding = offers.filter((o) => o.offerStatus === "HOLDING");
  const current = accepted.find((o) => o.joiningStatus === "Joined");
  const highest = offers.reduce((max, o) => (!max || o.offeredPackage > max.offeredPackage ? o : max), null);
  const latest = offers[0] || null; // already ordered desc by createdAt by callers

  return {
    totalOffers: offers.length,
    internshipOffers: internships.length,
    placementOffers: placements.length,
    acceptedOffers: accepted.length,
    rejectedOffers: rejected.length,
    holdingOffers: holding.length,
    currentlyWorking: !!current,
    currentEmployer: current?.companyName || null,
    highestOffer: highest ? { companyName: highest.companyName, offeredPackage: highest.offeredPackage } : null,
    latestOffer: latest ? { companyName: latest.companyName, offeredPackage: latest.offeredPackage, createdAt: latest.createdAt } : null,
  };
}

router.get("/offers/summary/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const offers = await prisma.placementOffer.findMany({ where: { studentId: req.user.id }, orderBy: { createdAt: "desc" } });
    res.json(summarizeOffers(offers));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load offer summary" });
  }
});

// =========================== Staff/Clerk/Admin ===========================

async function authorizeStudentAccess(req, res, studentId) {
  const student = await prisma.user.findUnique({ where: { id: studentId } });
  if (!student || student.role !== "STUDENT") {
    res.status(404).json({ error: "Student not found" });
    return null;
  }
  if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only access students under your own institute" });
    return null;
  }
  return student;
}

router.get("/offers/student/:studentId", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const student = await authorizeStudentAccess(req, res, req.params.studentId);
    if (!student) return;
    const offers = await prisma.placementOffer.findMany({ where: { studentId: req.params.studentId }, orderBy: { createdAt: "desc" } });
    res.json({ offers, summary: summarizeOffers(offers) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student offers" });
  }
});

router.patch("/offers/:id/verify", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    if (!["VERIFIED", "REJECTED"].includes(status)) return res.status(400).json({ error: "status must be VERIFIED or REJECTED" });

    const offer = await prisma.placementOffer.findUnique({ where: { id: req.params.id } });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    const student = await authorizeStudentAccess(req, res, offer.studentId);
    if (!student) return;

    const updated = await prisma.placementOffer.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: status,
        verifiedByUserId: req.user.id,
        verifiedByName: req.user.name,
        verifiedAt: new Date(),
        rejectionReason: status === "REJECTED" ? (rejectionReason || null) : null,
      },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.PLACEMENT_OFFER_VERIFIED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: offer.studentId, instituteId: student.instituteId,
      details: { offerId: offer.id, companyName: offer.companyName, status },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify offer" });
  }
});

// STAFF: only for students in an AcademicGroup the staff member is actually assigned to (same
// ownership check as attendance.js's resolveAssignmentAccess) — Department Eligibility is meant
// to represent that specific staff member's academic judgement, not any staff at the institute.
// ADMIN: institute-scoped only, no group-ownership requirement.
router.patch("/students/:studentId/department-eligibility", authenticate, requireRole("STAFF", "ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["ELIGIBLE", "NOT_ELIGIBLE"].includes(status)) return res.status(400).json({ error: "status must be ELIGIBLE or NOT_ELIGIBLE" });

    const student = await authorizeStudentAccess(req, res, req.params.studentId);
    if (!student) return;

    if (req.user.role === "STAFF") {
      if (!student.academicGroupId) return res.status(403).json({ error: "This student isn't assigned to an academic group yet" });
      const owns = await prisma.staffClassAssignment.count({ where: { staffId: req.user.id, academicGroupId: student.academicGroupId } });
      if (!owns) return res.status(403).json({ error: "You are not assigned to this student's group" });
    }

    const profile = await prisma.studentProfile.upsert({
      where: { studentId: req.params.studentId },
      create: { studentId: req.params.studentId, departmentEligibility: status, departmentEligibilitySetBy: req.user.name, departmentEligibilitySetAt: new Date() },
      update: { departmentEligibility: status, departmentEligibilitySetBy: req.user.name, departmentEligibilitySetAt: new Date() },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: req.params.studentId, instituteId: student.instituteId,
      details: { type: "department", status },
    });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update department eligibility" });
  }
});

router.patch("/students/:studentId/clerk-eligibility", authenticate, requireRole("CLERK", "ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["ELIGIBLE", "NOT_ELIGIBLE"].includes(status)) return res.status(400).json({ error: "status must be ELIGIBLE or NOT_ELIGIBLE" });

    const student = await authorizeStudentAccess(req, res, req.params.studentId);
    if (!student) return;

    const profile = await prisma.studentProfile.upsert({
      where: { studentId: req.params.studentId },
      create: { studentId: req.params.studentId, clerkEligibility: status, clerkEligibilitySetBy: req.user.name, clerkEligibilitySetAt: new Date() },
      update: { clerkEligibility: status, clerkEligibilitySetBy: req.user.name, clerkEligibilitySetAt: new Date() },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: req.params.studentId, instituteId: student.instituteId,
      details: { type: "clerk", status },
    });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update clerk eligibility" });
  }
});

// =========================== Analytics ===========================
// All three follow institutes.js's profile-completion-stats pattern: batch-fetch students +
// related rows into Maps, aggregate in one in-memory pass, institute-scope via requesterInstituteId.

async function loadInstituteStudents(req, extraWhere) {
  const instituteId = req.requesterInstituteId || req.query.instituteId;
  const where = { role: "STUDENT", ...(instituteId ? { instituteId } : {}), ...extraWhere };
  return prisma.user.findMany({
    where,
    select: { id: true, name: true, academicGroup: { select: { department: { select: { id: true, name: true } }, batch: true } } },
  });
}

const DECLINE_LABELS = {
  HIGHER_STUDIES: "Higher Studies", GOVT_EXAM: "Government Exam Preparation", ENTREPRENEURSHIP: "Entrepreneurship / Startup",
  FAMILY_BUSINESS: "Family Business", EMPLOYED: "Already Employed", NOT_INTERESTED: "Not Interested", OTHER: "Other",
};

async function computeRegistrationAnalytics(req) {
  const { departmentId, batch } = req.query;
  const academicGroupFilter = { ...(departmentId ? { departmentId } : {}), ...(batch ? { batch } : {}) };
  const students = await loadInstituteStudents(req, Object.keys(academicGroupFilter).length ? { academicGroup: academicGroupFilter } : {});
  if (students.length === 0) return { total: 0, registered: 0, notRegistered: 0, percentRegistered: 0, declineBreakdown: [] };

  const profiles = await prisma.studentProfile.findMany({ where: { studentId: { in: students.map((s) => s.id) } } });
  const profileByStudent = new Map(profiles.map((p) => [p.studentId, p]));

  let registered = 0;
  const declineCounts = {};
  for (const s of students) {
    const p = profileByStudent.get(s.id);
    if (p?.placementParticipation === "INTERESTED") registered++;
    else if (p?.placementParticipation === "NOT_INTERESTED") {
      const reason = p.placementDeclineReason || "OTHER";
      declineCounts[reason] = (declineCounts[reason] || 0) + 1;
    }
  }
  const notRegistered = students.length - registered;
  const declineBreakdown = Object.entries(declineCounts).map(([reason, count]) => ({
    reason, label: DECLINE_LABELS[reason] || reason, count, percent: Math.round((count / students.length) * 100),
  }));

  return {
    total: students.length, registered, notRegistered,
    percentRegistered: Math.round((registered / students.length) * 100),
    declineBreakdown,
  };
}

router.get("/analytics/registration", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    res.json(await computeRegistrationAnalytics(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load registration analytics" });
  }
});

async function computeOfferAnalytics(req) {
  const verifiedOnly = req.query.verifiedOnly === "true";
  const students = await loadInstituteStudents(req);
  if (students.length === 0) {
    return { totalStudents: 0, placed: 0, unplaced: 0, activeOffers: 0, multipleOffers: 0, totalOffers: 0, averageOffersPerStudent: 0, onCampus: 0, offCampus: 0, highestPackage: 0, averagePackage: 0, verifiedOnly };
  }

  const offers = await prisma.placementOffer.findMany({
    where: { studentId: { in: students.map((s) => s.id) }, ...(verifiedOnly ? { verificationStatus: "VERIFIED" } : {}) },
  });

  const byStudent = new Map();
  for (const o of offers) {
    if (!byStudent.has(o.studentId)) byStudent.set(o.studentId, []);
    byStudent.get(o.studentId).push(o);
  }

  let placed = 0, multipleOffers = 0, activeOffers = 0, onCampus = 0, offCampus = 0;
  for (const studentOffers of byStudent.values()) {
    if (studentOffers.some((o) => o.offerStatus === "ACCEPTED")) placed++;
    if (studentOffers.length > 1) multipleOffers++;
  }
  let highestPackage = 0, packageSum = 0;
  for (const o of offers) {
    if (o.offerStatus === "HOLDING") activeOffers++;
    if (o.source === "ON_CAMPUS") onCampus++; else if (o.source === "OFF_CAMPUS") offCampus++;
    if (o.offerType === "PLACEMENT") {
      if (o.offeredPackage > highestPackage) highestPackage = o.offeredPackage;
      packageSum += o.offeredPackage;
    }
  }
  const placementOfferCount = offers.filter((o) => o.offerType === "PLACEMENT").length;

  return {
    totalStudents: students.length,
    placed, unplaced: students.length - placed,
    activeOffers, multipleOffers,
    totalOffers: offers.length,
    averageOffersPerStudent: byStudent.size ? Math.round((offers.length / byStudent.size) * 100) / 100 : 0,
    onCampus, offCampus,
    highestPackage,
    averagePackage: placementOfferCount ? Math.round((packageSum / placementOfferCount) * 100) / 100 : 0,
    verifiedOnly,
  };
}

router.get("/analytics/offers", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    res.json(await computeOfferAnalytics(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load offer analytics" });
  }
});

async function computeDepartmentAnalytics(req) {
  const { batch } = req.query;
  const students = await loadInstituteStudents(req, batch ? { academicGroup: { batch } } : {});
  if (students.length === 0) return [];

  const profiles = await prisma.studentProfile.findMany({ where: { studentId: { in: students.map((s) => s.id) } } });
  const profileByStudent = new Map(profiles.map((p) => [p.studentId, p]));

  const byDept = new Map(); // deptId -> { name, total, registered, notRegistered, deptEligible, deptIneligible, clerkEligible, clerkIneligible }
  for (const s of students) {
    const dept = s.academicGroup?.department;
    const key = dept?.id || "unassigned";
    const label = dept?.name || "Unassigned";
    if (!byDept.has(key)) byDept.set(key, { departmentId: key, department: label, total: 0, registered: 0, notRegistered: 0, deptEligible: 0, deptIneligible: 0, clerkEligible: 0, clerkIneligible: 0 });
    const row = byDept.get(key);
    row.total++;
    const p = profileByStudent.get(s.id);
    if (p?.placementParticipation === "INTERESTED") row.registered++;
    else if (p?.placementParticipation === "NOT_INTERESTED") row.notRegistered++;
    if (p?.departmentEligibility === "ELIGIBLE") row.deptEligible++;
    else if (p?.departmentEligibility === "NOT_ELIGIBLE") row.deptIneligible++;
    if (p?.clerkEligibility === "ELIGIBLE") row.clerkEligible++;
    else if (p?.clerkEligibility === "NOT_ELIGIBLE") row.clerkIneligible++;
  }
  return [...byDept.values()].sort((a, b) => a.department.localeCompare(b.department));
}

router.get("/analytics/department", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    res.json(await computeDepartmentAnalytics(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load department analytics" });
  }
});

router.get("/analytics/report.pdf", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const [registration, offers, department] = await Promise.all([
      computeRegistrationAnalytics(req), computeOfferAnalytics(req), computeDepartmentAnalytics(req),
    ]);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="placement-summary-${new Date().toISOString().slice(0, 10)}.pdf"`);
    generatePlacementPdf({ registration, offers, department }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/analytics/documents", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const students = await loadInstituteStudents(req);
    if (students.length === 0) return res.json({ total: 0, pending: 0, verified: 0, rejected: 0, reuploadRequired: 0 });

    const documents = await prisma.studentDocument.findMany({ where: { studentId: { in: students.map((s) => s.id) } }, select: { verificationStatus: true } });
    const counts = { total: documents.length, pending: 0, verified: 0, rejected: 0, reuploadRequired: 0 };
    for (const d of documents) {
      if (d.verificationStatus === "PENDING") counts.pending++;
      else if (d.verificationStatus === "VERIFIED") counts.verified++;
      else if (d.verificationStatus === "REJECTED") counts.rejected++;
      else if (d.verificationStatus === "REUPLOAD_REQUIRED") counts.reuploadRequired++;
    }
    res.json(counts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load document analytics" });
  }
});

module.exports = router;
