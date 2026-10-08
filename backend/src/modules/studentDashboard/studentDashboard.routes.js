// GET /api/student/dashboard — authentication and permission only; the work lives in the controller and service next to this file.
const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { requirePermission } = require("../../utils/permissions");
const { getDashboard } = require("./studentDashboard.controller");

const router = express.Router();
router.get("/dashboard", authenticate, requirePermission("student.portal"), getDashboard);

module.exports = router;
