const express = require("express");
const { spawn } = require("child_process");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

// On-demand full database backup — platform-level Super Admin only (an ADMIN account with no
// instituteId, see attachRequesterInstitute's comment on the "Platform Admin" convention). An
// institute-scoped ADMIN never sees other institutes' data anywhere else in this platform, so a
// full-DB dump has to stay out of their reach too. Shells out to `pg_dump` (installed via the
// Dockerfile) against DATABASE_URL and buffers the whole dump in memory before responding —
// simpler and safer than streaming for a dataset this platform's size, and it means a mid-dump
// failure can still be reported as a clean error instead of a truncated download.
router.get("/database", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), attachRequesterInstitute, async (req, res) => {
  if (req.requesterInstituteId) {
    return res.status(403).json({ error: "Database backups are restricted to platform-level Super Admin accounts (not tied to a specific institute)." });
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: "DATABASE_URL is not configured on this server" });

  try {
    // Parsed into components rather than passed as one argv string — process arguments are
    // readable by any other process on the host (e.g. /proc/<pid>/cmdline), which would otherwise
    // briefly expose the DB password outside this Node process. The password goes via PGPASSWORD
    // in the child's environment instead, the standard libpq-recommended way to avoid that.
    const parsed = new URL(dbUrl);
    const pgEnv = {
      ...process.env,
      PGPASSWORD: decodeURIComponent(parsed.password || ""),
      PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
    };
    const pgArgs = [
      "-h", parsed.hostname,
      "-p", parsed.port || "5432",
      "-U", decodeURIComponent(parsed.username || ""),
      "-d", decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      "--no-owner", "--no-privileges",
    ];

    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn("pg_dump", pgArgs, { env: pgEnv });

    child.stdout.on("data", (d) => stdoutChunks.push(d));
    child.stderr.on("data", (d) => stderrChunks.push(d));

    child.on("error", (err) => {
      console.error("pg_dump spawn failed:", err);
      if (!res.headersSent) res.status(500).json({ error: "Backup tool is unavailable on this server" });
    });

    child.on("close", async (code) => {
      if (res.headersSent) return;
      if (code !== 0) {
        console.error(`pg_dump exited with code ${code}:`, Buffer.concat(stderrChunks).toString());
        return res.status(500).json({ error: "Database backup failed — see server logs" });
      }
      const dump = Buffer.concat(stdoutChunks);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await logAudit({
        req, action: AUDIT_ACTIONS.DATABASE_BACKUP_DOWNLOADED, actorId: req.user.id,
        actorName: req.user.name, actorRole: req.user.role, details: { sizeBytes: dump.length },
      });
      res.setHeader("Content-Type", "application/sql");
      res.setHeader("Content-Disposition", `attachment; filename="codearena-backup-${stamp}.sql"`);
      res.send(dump);
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Database backup failed" });
  }
});

module.exports = router;
