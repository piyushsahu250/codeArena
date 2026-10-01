const fs = require("fs");
const path = require("path");

// Structured JSON logging — every line is one JSON object, so Render's log viewer (and any log
// drain pointed at it later) can filter by level/route/status/requestId instead of grepping free
// -form text. Deliberately dependency-free rather than pulling in pino: this environment has no
// way to run `npm install` and regenerate package-lock.json for a new package, and CI's `npm ci`
// step would fail on a lockfile that doesn't match package.json. The line shape below ({level,
// time, msg, ...fields}) mirrors pino's own default output, so swapping in pino later — if a
// fuller-featured logger is ever actually needed — is a drop-in replacement, not a rewrite.
//
// File persistence (added 2026-10-01): console.log/error alone is captured by Docker's json-file
// driver, but that driver's log file lives under /var/lib/docker/containers/<container-id>/ and is
// deleted the moment that container is removed -- `docker rm` during a routine redeploy silently
// destroys every log line from the container's entire lifetime. Confirmed live: the exact logs
// needed to root-cause students' "site not working / page not found" reports from TCS Codevita 9's
// exam day were gone by the time anyone went looking, because a redeploy had happened in between.
// Writing the same lines to a file under LOG_DIR (a Docker named volume mounted at /app/logs,
// outside any one container's lifecycle -- see docs/DEPLOYMENT.md) means a future incident's
// evidence survives however many redeploys happen before someone investigates. One file per UTC
// day (app-YYYY-MM-DD.log) keeps any single file bounded without needing a rotation library; files
// older than LOG_RETENTION_DAYS are pruned lazily, once per day boundary crossed, not on every line.
const LOG_DIR = process.env.LOG_DIR || "/app/logs";
const RETENTION_DAYS = Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 30);

let currentDateStr = null;
let currentStream = null;
// File logging is a best-effort addition, never a requirement -- if LOG_DIR doesn't exist or isn't
// writable (e.g. running outside Docker, or the volume mount was dropped), every write silently
// no-ops after one console.error so the app never crashes or floods the console over a logging
// side-channel failing.
let fileLoggingBroken = false;

function pruneOldLogs() {
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      fs.stat(full, (statErr, stat) => {
        if (!statErr && stat.mtimeMs < cutoff) fs.unlink(full, () => {});
      });
    }
  });
}

function getStream() {
  const dateStr = new Date().toISOString().slice(0, 10);
  if (dateStr === currentDateStr && currentStream) return currentStream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (currentStream) currentStream.end();
    currentStream = fs.createWriteStream(path.join(LOG_DIR, `app-${dateStr}.log`), { flags: "a" });
    currentStream.on("error", (err) => {
      if (!fileLoggingBroken) console.error("logger: file stream error, disabling file logging:", err.message);
      fileLoggingBroken = true;
    });
    currentDateStr = dateStr;
    pruneOldLogs();
  } catch (err) {
    if (!fileLoggingBroken) console.error("logger: failed to open log file, disabling file logging:", err.message);
    fileLoggingBroken = true;
  }
  return currentStream;
}

function emit(level, msg, fields) {
  const line = { level, time: new Date().toISOString(), msg, ...fields };
  const json = JSON.stringify(line);
  (level === "error" || level === "warn" ? console.error : console.log)(json);
  if (!fileLoggingBroken) {
    const stream = getStream();
    if (stream) stream.write(json + "\n");
  }
}

module.exports = {
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields),
};
