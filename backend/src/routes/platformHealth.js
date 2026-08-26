// Read-only view of the daily automated health check's results (see backend/scripts/
// dailyHealthCheck.js for what actually runs the checks and writes these rows). Platform-wide,
// not institute-scoped — SUPER_ADMIN only, same as every other platform-aggregate view (audit log
// action list, migration-status, etc). Per-institute dashboards were explicitly scoped out — see
// docs/PLATFORM_HEALTH.md.
const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
const guard = [authenticate, requireRole("SUPER_ADMIN")];

router.get("/latest", ...guard, async (req, res) => {
  const report = await prisma.platformHealthReport.findFirst({ orderBy: { runAt: "desc" } });
  res.json({ report });
});

router.get("/", ...guard, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const [reports, total] = await Promise.all([
    prisma.platformHealthReport.findMany({ orderBy: { runAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.platformHealthReport.count(),
  ]);
  res.json({ reports, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

module.exports = router;
