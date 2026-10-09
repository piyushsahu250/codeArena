// In-process metrics collection for the admin monitoring page. Deliberately limited to what a
// single Node process can honestly measure without adding new infrastructure (no APM/Redis/
// external monitoring service) — everything here resets on restart and reflects only this
// process, which is the only process this platform currently runs (single Render instance).

const RING_SIZE = 200;
const responseTimes = []; // rolling window of recent request durations (ms)
const recentErrors = []; // rolling window of the most severe, process-level failures

// Event-loop lag: how much later than expected a periodic timer actually fires. A healthy
// process shows a few ms; a process struggling to keep up (CPU-bound work blocking the loop,
// e.g. many judge submissions running synchronously) shows this climbing into the hundreds+.
// This is the same technique Node's own `perf_hooks` monitor / most APM agents use.
let lastEventLoopLagMs = 0;
const LAG_SAMPLE_MS = 500;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  lastEventLoopLagMs = Math.max(0, now - lastTick - LAG_SAMPLE_MS);
  lastTick = now;
}, LAG_SAMPLE_MS).unref();

function recordRequestTime(ms) {
  responseTimes.push(ms);
  if (responseTimes.length > RING_SIZE) responseTimes.shift();
}

// Only uncaught exceptions / unhandled rejections land here — routes that catch their own
// errors and respond with a handled 500 are, by definition, not process-level failures, and
// surfacing every one of those would require touching every route file. This log is for the
// failures that would otherwise crash the process silently.
function recordProcessError(err, context) {
  recentErrors.push({ time: new Date().toISOString(), context: context || "unknown", message: err?.message || String(err) });
  if (recentErrors.length > 50) recentErrors.shift();
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Per-route breakdown (added in the 2026-10 platform audit: the overall percentiles above cannot say WHICH endpoint is slow or failing). Keyed by
// "METHOD /mounted/path/:pattern" (the route pattern, never the real URL, so ids and query strings do not create new keys). Memory is bounded: at most
// MAX_ROUTE_KEYS keys, each holding counters and a 50-sample ring. Costs a map lookup and a few additions per request.
const MAX_ROUTE_KEYS = 400;
const ROUTE_RING = 50;
const routeStats = new Map();
function recordRoute(req, res, ms) {
  const pattern = req.route ? `${req.baseUrl || ""}${req.route.path === "/" ? "" : req.route.path}` || "/" : "(unmatched)";
  const key = `${req.method} ${pattern}`;
  let s = routeStats.get(key);
  if (!s) {
    if (routeStats.size >= MAX_ROUTE_KEYS) return;
    s = { count: 0, totalMs: 0, maxMs: 0, over1s: 0, errors5xx: 0, ring: [] };
    routeStats.set(key, s);
  }
  s.count++; s.totalMs += ms; if (ms > s.maxMs) s.maxMs = ms;
  if (ms > 1000) s.over1s++;
  if (res.statusCode >= 500) s.errors5xx++;
  s.ring.push(ms); if (s.ring.length > ROUTE_RING) s.ring.shift();
}
function routeTimingSnapshot() {
  const rows = [...routeStats.entries()].map(([route, s]) => {
    const sorted = [...s.ring].sort((a, b) => a - b);
    return { route, count: s.count, avgMs: Math.round(s.totalMs / s.count), p95Ms: percentile(sorted, 95) === null ? null : Math.round(percentile(sorted, 95)), maxMs: Math.round(s.maxMs), over1s: s.over1s, errors5xx: s.errors5xx };
  });
  return {
    trackedRoutes: rows.length,
    slowest: rows.filter((r) => r.count >= 5).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)).slice(0, 15),
    failing: rows.filter((r) => r.errors5xx > 0).sort((a, b) => b.errors5xx - a.errors5xx).slice(0, 15),
  };
}

function getSnapshot() {
  const sorted = [...responseTimes].sort((a, b) => a - b);
  const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null;
  return {
    requestTimingMs: {
      sampleSize: sorted.length,
      avg,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    },
    eventLoopLagMs: lastEventLoopLagMs,
    recentErrors: [...recentErrors].reverse(),
    routeTiming: routeTimingSnapshot(),
  };
}

// Express middleware — times every request and records it into the rolling window.
function timingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    recordRequestTime(ms);
    try { recordRoute(req, res, ms); } catch { /* metrics must never affect a request */ }
  });
  next();
}

module.exports = { timingMiddleware, recordProcessError, getSnapshot };
