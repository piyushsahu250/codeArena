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
// One dump at a time, and a ceiling on how much of it is held in memory: this API process also serves exam traffic, so a second click (or a database that has outgrown this
// approach) must not be able to take it down. BACKUP_MAX_BYTES overrides the ceiling (default 1 GiB).
let backupInProgress = false;
const BACKUP_MAX_BYTES = Number(process.env.BACKUP_MAX_BYTES) || 1024 * 1024 * 1024;

router.get("/database", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), attachRequesterInstitute, async (req, res) => {
  if (req.requesterInstituteId) {
    return res.status(403).json({ error: "Database backups are restricted to platform-level Super Admin accounts (not tied to a specific institute)." });
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: "DATABASE_URL is not configured on this server" });
  if (backupInProgress) return res.status(429).json({ error: "A database backup is already running. Wait for it to finish, then try again." });
  backupInProgress = true;
  let released = false;
  const release = () => { if (!released) { released = true; backupInProgress = false; } };

  try {
    // Parsed into components rather than passed as one argv string — process arguments are
    // readable by any other process on the host (e.g. /proc/<pid>/cmdline), which would otherwise
    // briefly expose the DB password outside this Node process. The password goes via PGPASSWORD
    // in the child's environment instead, the standard libpq-recommended way to avoid that.
    const parsed = new URL(dbUrl);
    const pgEnv = {
      // Only what pg_dump needs. It used to inherit the whole server environment (JWT secret, API keys, ...), none of which it has any use for.
      PATH: process.env.PATH,
      ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
      PGPASSWORD: decodeURIComponent(parsed.password || ""),
      PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
      // libpq (this container's newer postgresql-client-18, since the pg_dump-v15-can't-dump-
      // v18-server fix) looks for a client cert at $HOME/.postgresql/postgresql.crt by default --
      // sslmode=require only needs an encrypted connection, no client cert, but libpq still tries
      // to open that path if it exists/is configured, and this process's real HOME resolves to
      // /root (a leftover from the container's brief real-root phase before docker-entrypoint.sh
      // drops to the unprivileged `app` user — see Dockerfile's own comment on that), which `app`
      // can't read. Caught live: pg_dump failed with "could not open certificate file
      // /root/.postgresql/postgresql.crt: Permission denied" the first time this ran after that
      // version fix. /tmp is always readable/writable by every user in a standard container.
      HOME: "/tmp",
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
    let stdoutBytes = 0, stderrBytes = 0, tooLarge = false;
    const child = spawn("pg_dump", pgArgs, { env: pgEnv });

    child.stdout.on("data", (d) => {
      if (tooLarge) return;
      stdoutBytes += d.length;
      if (stdoutBytes > BACKUP_MAX_BYTES) { tooLarge = true; stdoutChunks.length = 0; child.kill(); return; } // stop dumping and free what was buffered
      stdoutChunks.push(d);
    });
    child.stderr.on("data", (d) => { if (stderrBytes < 64 * 1024) { stderrBytes += d.length; stderrChunks.push(d); } }); // error text only; never grows without bound
    // The admin closed the tab or the connection dropped: stop the dump instead of finishing a download nobody will receive.
    res.on("close", () => { if (!res.writableEnded && child.exitCode === null) child.kill(); });

    child.on("error", (err) => {
      release();
      console.error("pg_dump spawn failed:", err);
      if (!res.headersSent) res.status(500).json({ error: "Backup tool is unavailable on this server" });
    });

    child.on("close", async (code) => {
      release();
      if (res.headersSent) return;
      if (tooLarge) {
        console.error(`pg_dump output exceeded the in-memory ceiling (${BACKUP_MAX_BYTES} bytes); aborted`);
        return res.status(413).json({ error: `The database is larger than this download can hold in memory (limit ${Math.round(BACKUP_MAX_BYTES / (1024 * 1024))} MB). Use a server-side backup instead.` });
      }
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
    release();
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Database backup failed" });
  }
});

module.exports = router;
