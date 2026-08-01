// Structured JSON logging — every line is one JSON object, so Render's log viewer (and any log
// drain pointed at it later) can filter by level/route/status/requestId instead of grepping free
// -form text. Deliberately dependency-free rather than pulling in pino: this environment has no
// way to run `npm install` and regenerate package-lock.json for a new package, and CI's `npm ci`
// step would fail on a lockfile that doesn't match package.json. The line shape below ({level,
// time, msg, ...fields}) mirrors pino's own default output, so swapping in pino later — if a
// fuller-featured logger is ever actually needed — is a drop-in replacement, not a rewrite.
function emit(level, msg, fields) {
  const line = { level, time: new Date().toISOString(), msg, ...fields };
  (level === "error" || level === "warn" ? console.error : console.log)(JSON.stringify(line));
}

module.exports = {
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields),
};
