// Test Management: URLs, authentication, permission and rate limits only. The rules live in the services next to this file. Mounted at /api/test-management.
//   staff.console  ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF   (the same permission the test authoring routes use)
//   student.portal STUDENT                                      (the student's own series)
// Every route re-derives who the caller is and which institute they belong to on the server; no institute, owner or student id from the browser is trusted.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requirePermission } = require("../../utils/permissions");
const { ServiceError } = require("../../utils/serviceError");
const M = require("./testManagement.service");
const S = require("./testSeries.service");
const Rep = require("./testSeries.report");
const Stu = require("./testSeries.student");

const router = express.Router();
const staff = [authenticate, requirePermission("staff.console"), attachRequesterInstitute];
const student = [authenticate, requirePermission("student.portal")];
const byUser = (req) => req.user.id;
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, keyGenerator: byUser });
const bulkLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: byUser });
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: byUser });
const actor = (req) => ({ user: req.user, requesterInstituteId: req.requesterInstituteId, req });

// A ServiceError is an expected refusal (its status and message go to the caller); anything else is logged and answered with a generic 500.
const wrap = (fallback, fn, status = 200) => async (req, res) => {
  try { res.status(status).json(await fn(req)); }
  catch (e) {
    if (e instanceof ServiceError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    console.error("[test-management]", req.method, req.originalUrl, e);
    return res.status(500).json({ error: fallback });
  }
};

// ---- tests, folders, bulk --------------------------------------------------------------------------------------------------------------------------------------
router.get("/overview", ...staff, wrap("Could not load the overview.", (req) => M.overview(actor(req))));
router.get("/tests", ...staff, wrap("Could not load tests.", (req) => M.listTests(actor(req), req.query)));
router.post("/tests/bulk", ...staff, bulkLimiter, wrap("Could not apply that action.", (req) => M.bulk(actor(req), req.body || {})));
router.get("/tests/:id/results-by-group", ...staff, wrap("Could not load the results.", (req) => M.testResultsByGroup(actor(req), req.params.id)));

router.get("/folders", ...staff, wrap("Could not load folders.", (req) => M.listFolders(actor(req), req.query)));
router.post("/folders", ...staff, writeLimiter, wrap("Could not create the folder.", (req) => M.createFolder(actor(req), req.body || {}), 201));
router.patch("/folders/:id", ...staff, writeLimiter, wrap("Could not update the folder.", (req) => M.updateFolder(actor(req), req.params.id, req.body || {})));
router.delete("/folders/:id", ...staff, writeLimiter, wrap("Could not delete the folder.", (req) => M.deleteFolder(actor(req), req.params.id)));

// ---- series ---------------------------------------------------------------------------------------------------------------------------------------------------------
router.get("/assignment-options", ...staff, wrap("Could not load the groups and pools.", (req) => S.assignmentOptions(actor(req), req.query)));
router.get("/assignments", ...staff, wrap("Could not load assignments.", (req) => S.listAssignments(actor(req), req.query)));
router.get("/series", ...staff, wrap("Could not load series.", (req) => S.listSeries(actor(req), req.query)));
router.post("/series", ...staff, writeLimiter, wrap("Could not create the series.", (req) => S.createSeries(actor(req), req.body || {}), 201));
router.get("/series/:id", ...staff, wrap("Could not load the series.", (req) => S.getSeries(actor(req), req.params.id)));
router.put("/series/:id", ...staff, writeLimiter, wrap("Could not save the series.", (req) => S.updateSeries(actor(req), req.params.id, req.body || {})));
router.post("/series/:id/action/:action", ...staff, writeLimiter, wrap("Could not change the series.", (req) => S.seriesAction(actor(req), req.params.id, req.params.action)));

router.post("/series/:id/assignments/preview", ...staff, wrap("Could not prepare the assignment.", (req) => S.previewAssignment(actor(req), req.params.id, req.body || {})));
router.post("/series/:id/assignments", ...staff, writeLimiter, wrap("Could not assign the series.", (req) => S.createAssignments(actor(req), req.params.id, req.body || {}), 201));
router.patch("/series/:id/assignments/:aid", ...staff, writeLimiter, wrap("Could not update the assignment.", (req) => S.updateAssignment(actor(req), req.params.id, req.params.aid, req.body || {})));
router.delete("/series/:id/assignments/:aid", ...staff, writeLimiter, wrap("Could not remove the assignment.", (req) => S.removeAssignment(actor(req), req.params.id, req.params.aid)));

router.get("/series/:id/report", ...staff, wrap("Could not load the report.", (req) => Rep.seriesReport(actor(req), req.params.id, req.query)));
router.get("/series/:id/report.csv", ...staff, exportLimiter, async (req, res) => {
  try {
    const out = await Rep.seriesCsv(actor(req), req.params.id, req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("Access-Control-Expose-Headers", "X-Export-Truncated");
    if (out.truncated) res.setHeader("X-Export-Truncated", "true");
    res.send(out.body);
  } catch (e) {
    if (e instanceof ServiceError) return res.status(e.status).json({ error: e.message });
    console.error("[test-management] export", e);
    res.status(500).json({ error: "Could not export the report." });
  }
});

// ---- the student's series -------------------------------------------------------------------------------------------------------------------------------------
router.get("/student/series", ...student, wrap("Could not load your test series.", (req) => Stu.listForStudent(req.user.id)));
router.get("/student/series/:id", ...student, wrap("Could not load this series.", (req) => Stu.detailForStudent(req.user.id, req.params.id)));

module.exports = router;
