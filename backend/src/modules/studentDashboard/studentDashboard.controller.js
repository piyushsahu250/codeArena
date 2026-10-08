// Controller: HTTP in, HTTP out. Everything is keyed by req.user.id; no id is ever accepted from the client.
const { buildDashboard } = require("./studentDashboard.service");

async function getDashboard(req, res) {
  try {
    const payload = await buildDashboard(req.user.id);
    if (!payload) return res.status(404).json({ error: "Student not found" });
    res.json(payload);
  } catch (err) {
    console.error("[student/dashboard] failed", { userId: req.user?.id, error: err.message, stack: err.stack });
    res.status(500).json({ error: "Failed to load dashboard" });
  }
}

module.exports = { getDashboard };
