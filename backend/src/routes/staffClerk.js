const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { notifyAccountStatusChanged } = require("../utils/notifications");
const cache = require("../utils/cache");

const router = express.Router();

// INSTITUTE_ADMIN added so it appears in the same management directory as Staff/Clerk (per spec:
// "The UI should clearly show: Staff, Institute Admin, Clerk"), reusing this file's existing
// activate/deactivate/session-management pipeline rather than building a parallel one. Mutating an
// INSTITUTE_ADMIN target is additionally gated to SUPER_ADMIN-only actors below (see
// requireSuperAdminForInstituteAdminTarget) — an Institute Admin viewing this directory can see a
// peer Institute Admin in their own institute, but cannot deactivate/reactivate one; only Super
// Admin can, matching "Only Super Admin should be able to create/change... Institute Admin."
const DIRECTORY_ROLES = ["STAFF", "CLERK", "INSTITUTE_ADMIN"];

const LIST_SELECT_FIELDS = {
  id: true, name: true, email: true, mobile: true, role: true, employeeId: true, designation: true,
  department: true, accountStatus: true, isActive: true, profilePhotoUrl: true, createdAt: true, lastLoginAt: true,
  institute: { select: { id: true, name: true } },
};

const PROFILE_SELECT_FIELDS = { ...LIST_SELECT_FIELDS, mustChangePassword: true, gender: true };

// Every route below is admin-tier-only and institute-scoped — Staff/Clerk accounts cannot reach
// any route in this file (requireRole rejects them outright). Applied per-route (not via
// router.use) to match this platform's established convention. Every route already scopes via
// attachRequesterInstitute (institute-filtered queries, loadTarget()'s ownership check), so
// SUPER_ADMIN/INSTITUTE_ADMIN are safe to include here the same way they were added everywhere
// else in the rollout — no separate hardcoded role check exists in this file to trap them.
const guard = [authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute];

// Shared load-authorize-scope helper for every route below that targets one Staff/Clerk account —
// mirrors the authorizeStudentAccess()-style helpers used elsewhere on this platform
// (studentDocuments.js, etc.). Returns null (and has already sent the response) on failure.
async function loadTarget(req, res, select = LIST_SELECT_FIELDS) {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select });
  if (!user || !DIRECTORY_ROLES.includes(user.role)) {
    res.status(404).json({ error: "Staff or Clerk account not found" });
    return null;
  }
  if (req.requesterInstituteId && user.institute?.id !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only manage accounts under your own institute" });
    return null;
  }
  return user;
}

// ADMIN: dashboard overview stat cards. Cached briefly (matches admin.js's own dashboard-stats
// cache pattern) since this aggregates across the whole Staff/Clerk directory on every load.
router.get("/overview", ...guard, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.query.instituteId || null;
    const cacheKey = `staff-clerk-overview:${instituteId || "all"}`;
    const overview = await cache.cached(cacheKey, 60000, async () => {
      const where = { role: { in: DIRECTORY_ROLES }, ...(instituteId ? { instituteId } : {}) };
      const [totalStaff, totalClerk, statusCounts, recentlyAdded, ids] = await Promise.all([
        prisma.user.count({ where: { ...where, role: "STAFF" } }),
        prisma.user.count({ where: { ...where, role: "CLERK" } }),
        prisma.user.groupBy({ by: ["accountStatus"], where, _count: { _all: true } }),
        prisma.user.count({ where: { ...where, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
        prisma.user.findMany({ where, select: { id: true } }),
      ]);
      const idList = ids.map((u) => u.id);
      const statusByKey = Object.fromEntries(statusCounts.map((s) => [s.accountStatus, s._count._all]));

      const [currentlyLoggedIn, loggedInLast24h, passwordResetRequests, recentActivity] = idList.length === 0
        ? [0, 0, 0, []]
        : await Promise.all([
            prisma.loginSession.count({ where: { userId: { in: idList }, isActive: true } }),
            prisma.user.count({ where: { id: { in: idList }, lastLoginAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
            prisma.auditLog.count({ where: { action: "PASSWORD_RESET", studentId: { in: idList }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
            prisma.auditLog.findMany({
              where: { studentId: { in: idList } },
              orderBy: { createdAt: "desc" },
              take: 10,
              select: { id: true, action: true, adminName: true, studentId: true, details: true, createdAt: true },
            }),
          ]);

      return {
        totalStaff, totalClerk,
        active: statusByKey.ACTIVE || 0, inactive: statusByKey.INACTIVE || 0,
        locked: statusByKey.LOCKED || 0, suspended: statusByKey.SUSPENDED || 0,
        recentlyAdded, currentlyLoggedIn, loggedInLast24h, passwordResetRequests, recentActivity,
      };
    });
    res.json(overview);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// ADMIN: searchable/filterable/paginated Staff & Clerk directory.
router.get("/", ...guard, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.query.instituteId || undefined;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

    const where = {
      role: { in: req.query.role && DIRECTORY_ROLES.includes(req.query.role) ? [req.query.role] : DIRECTORY_ROLES },
      ...(instituteId ? { instituteId } : {}),
      ...(req.query.department ? { department: { equals: String(req.query.department), mode: "insensitive" } } : {}),
      ...(req.query.designation ? { designation: { contains: String(req.query.designation), mode: "insensitive" } } : {}),
      ...(req.query.accountStatus ? { accountStatus: req.query.accountStatus } : {}),
      ...(req.query.hasActiveSession === "true" ? { loginSessions: { some: { isActive: true } } } : {}),
      ...(req.query.hasActiveSession === "false" ? { loginSessions: { none: { isActive: true } } } : {}),
      ...(req.query.dateJoinedFrom || req.query.dateJoinedTo ? {
        createdAt: {
          ...(req.query.dateJoinedFrom ? { gte: new Date(req.query.dateJoinedFrom) } : {}),
          ...(req.query.dateJoinedTo ? { lte: new Date(req.query.dateJoinedTo) } : {}),
        },
      } : {}),
      ...(req.query.lastLoginFrom || req.query.lastLoginTo ? {
        lastLoginAt: {
          ...(req.query.lastLoginFrom ? { gte: new Date(req.query.lastLoginFrom) } : {}),
          ...(req.query.lastLoginTo ? { lte: new Date(req.query.lastLoginTo) } : {}),
        },
      } : {}),
      ...(req.query.q ? {
        OR: [
          { name: { contains: String(req.query.q), mode: "insensitive" } },
          { email: { contains: String(req.query.q), mode: "insensitive" } },
          { mobile: { contains: String(req.query.q), mode: "insensitive" } },
          { employeeId: { contains: String(req.query.q), mode: "insensitive" } },
        ],
      } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where, select: LIST_SELECT_FIELDS, orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load Staff & Clerk directory" });
  }
});

// ADMIN: full profile for one Staff/Clerk account.
router.get("/:id", ...guard, async (req, res) => {
  try {
    const user = await loadTarget(req, res, PROFILE_SELECT_FIELDS);
    if (!user) return;
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load account" });
  }
});

const TRANSITION_META = {
  ACTIVE: { action: AUDIT_ACTIONS.ACCOUNT_ACTIVATED, label: "activated" },
  INACTIVE: { action: AUDIT_ACTIONS.ACCOUNT_DEACTIVATED, label: "deactivated" },
  LOCKED: { action: AUDIT_ACTIONS.ACCOUNT_LOCKED, label: "locked" },
  SUSPENDED: { action: AUDIT_ACTIONS.ACCOUNT_SUSPENDED, label: "suspended" },
};

// ADMIN: the one Activate/Deactivate/Lock/Unlock/Suspend endpoint. LOCKED->ACTIVE is reported as
// "unlocked" rather than "activated" for a precise audit/notification message, everything else
// maps directly via TRANSITION_META.
router.patch("/:id/status", ...guard, async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!TRANSITION_META[status]) return res.status(400).json({ error: "status must be ACTIVE, INACTIVE, LOCKED, or SUSPENDED" });

    const existing = await loadTarget(req, res);
    if (!existing) return;
    // A peer (or the same institute's) INSTITUTE_ADMIN must never be able to deactivate/reactivate
    // another INSTITUTE_ADMIN — role changes to that tier are Super-Admin-only by design (see
    // DIRECTORY_ROLES's comment above and users.js's role-assignment whitelist, which already
    // enforces the equivalent rule for creation).
    if (existing.role === "INSTITUTE_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Only the Super Admin can change an Institute Admin's account status" });
    }

    const meta = TRANSITION_META[status];
    const label = status === "ACTIVE" && existing.accountStatus === "LOCKED" ? "unlocked" : meta.label;
    const action = status === "ACTIVE" && existing.accountStatus === "LOCKED" ? AUDIT_ACTIONS.ACCOUNT_UNLOCKED : meta.action;

    const revokedTokens = status === "ACTIVE" ? [] : (await prisma.loginSession.findMany({
      where: { userId: existing.id, isActive: true }, select: { token: true },
    })).map((s) => s.token);

    const [updated] = await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { accountStatus: status, isActive: status === "ACTIVE" }, select: LIST_SELECT_FIELDS }),
      ...(status === "ACTIVE" ? [] : [prisma.loginSession.updateMany({ where: { userId: existing.id, isActive: true }, data: { isActive: false, logoutAt: new Date() } })]),
    ]);
    for (const token of revokedTokens) cache.invalidate(`session-active:${token}`);

    await logAudit({
      req, action, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: existing.id, instituteId: existing.institute?.id,
      details: { targetName: existing.name, targetRole: existing.role, before: existing.accountStatus, after: status, reason: reason || null },
    });
    notifyAccountStatusChanged(prisma, existing, { type: action, label, adminName: req.user.name, reason }).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update account status" });
  }
});

// ADMIN: login history for one Staff/Clerk account — the admin-facing equivalent of the existing
// self-service GET /users/me/sessions, which deliberately only ever returns the caller's own rows.
router.get("/:id/sessions", ...guard, async (req, res) => {
  try {
    const user = await loadTarget(req, res);
    if (!user) return;

    const sessions = await prisma.loginSession.findMany({
      where: {
        userId: user.id,
        ...(req.query.from || req.query.to ? {
          loginAt: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: new Date(req.query.to) } : {}),
          },
        } : {}),
      },
      orderBy: { loginAt: "desc" },
      take: 200,
      select: { id: true, ip: true, device: true, browser: true, os: true, isActive: true, loginAt: true, logoutAt: true },
    });
    res.json(sessions.map((s) => ({ ...s, durationMs: s.logoutAt ? s.logoutAt.getTime() - s.loginAt.getTime() : null })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load login history" });
  }
});

// ADMIN: force-logout one active session belonging to a Staff/Clerk account.
router.delete("/:id/sessions/:sessionId", ...guard, async (req, res) => {
  try {
    const user = await loadTarget(req, res);
    if (!user) return;

    const session = await prisma.loginSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session || session.userId !== user.id) return res.status(404).json({ error: "Session not found" });

    await prisma.loginSession.update({ where: { id: session.id }, data: { isActive: false, logoutAt: new Date() } });
    cache.invalidate(`session-active:${session.token}`);
    await logAudit({
      req, action: AUDIT_ACTIONS.SESSION_REVOKED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: user.id, instituteId: user.institute?.id,
      details: { targetName: user.name, revokedSessionId: session.id, forcedByAdmin: true, device: `${session.browser} on ${session.os}` },
    });
    res.json({ message: "Session signed out" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sign out session" });
  }
});

// ADMIN: Permission Overview read — reinterpreted per the existing RBAC architecture (role +
// institute/department scope + StaffClassAssignment rows), not a new fine-grained permission
// table. CLERK accounts never have StaffClassAssignment rows (attendance.js's own assignment
// route already rejects non-STAFF), so this always returns an empty array for CLERK.
router.get("/:id/permissions", ...guard, async (req, res) => {
  try {
    const user = await loadTarget(req, res);
    if (!user) return;

    const staffClassAssignments = user.role !== "STAFF" ? [] : await prisma.staffClassAssignment.findMany({
      where: { staffId: user.id },
      include: { academicGroup: { include: { department: true } }, class: true },
      orderBy: { semester: "desc" },
    });

    res.json({
      role: user.role, institute: user.institute, department: user.department,
      staffClassAssignments: staffClassAssignments.map((a) => ({
        id: a.id, semester: a.semester,
        groupLabel: a.academicGroup
          ? `${a.academicGroup.department.name} · ${a.academicGroup.section} (${a.academicGroup.batch})`
          : a.class?.name || "—",
        academicGroupId: a.academicGroupId,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load permissions" });
  }
});

module.exports = router;
