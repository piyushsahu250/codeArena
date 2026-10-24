// Pure calculation behind GET /api/interview/admin/analytics (summary cards + charts), kept free of Prisma and Express so that every number can be checked against hand-computed
// expectations in test/interviewAnalytics.test.js.
//
// Fixes over the inline version it replaces:
//  - The weekly and monthly trends were returned in whatever order the database produced the sessions, so a line chart could run backwards. Both are now sorted oldest to newest.
//  - The weekly bucket was "year-W<day of month / 7>-<month>": week 1 of March and week 1 of November were different strings that sorted wrongly, and a bucket could straddle
//    two calendar weeks. A week is now the Monday (UTC) it starts on, written as an ISO date.
//  - Math.max(...scores) / Math.min(...scores) spread every score into the call stack; with tens of thousands of interviews that throws RangeError. Plain loops now.
//  - Dates were bucketed in the server's local time zone; they are now bucketed in UTC so the same interview never moves buckets when the server's zone changes.

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOfUtcWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  return new Date(d.getTime() - sinceMonday * DAY_MS);
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function computeInterviewAnalytics(sessions, { now = Date.now(), typeLabel = () => null, defaultDateRangeApplied = null } = {}) {
  const withScore = sessions.filter((s) => s.report && typeof s.report.overallScore === "number");
  let sum = 0, highest = -Infinity, lowest = Infinity;
  for (const s of withScore) {
    const v = s.report.overallScore;
    sum += v;
    if (v > highest) highest = v;
    if (v < lowest) lowest = v;
  }
  const hasScores = withScore.length > 0;

  let completedCount = 0, thisWeekCount = 0, thisMonthCount = 0;
  const weekMs = 7 * DAY_MS, monthMs = 30 * DAY_MS;
  for (const s of sessions) {
    if (s.status === "COMPLETED") completedCount++;
    if (s.submittedAt) {
      const age = now - new Date(s.submittedAt).getTime();
      if (age <= weekMs) thisWeekCount++;
      if (age <= monthMs) thisMonthCount++;
    }
  }

  function groupAvg(keyFn) {
    const sums = new Map(), counts = new Map();
    for (const s of withScore) {
      const key = keyFn(s);
      if (!key) continue;
      sums.set(key, (sums.get(key) || 0) + s.report.overallScore);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...sums.entries()]
      .map(([key, total]) => ({ key, count: counts.get(key), averageScore: Math.round(total / counts.get(key)) }))
      // most interviews first; equal counts alphabetical so the order never depends on database row order
      .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  }

  const weekly = new Map(), monthly = new Map();
  for (const s of withScore) {
    if (!s.submittedAt) continue;
    const d = new Date(s.submittedAt);
    for (const [map, key] of [[weekly, isoDay(mondayOfUtcWeek(d))], [monthly, monthKey(d)]]) {
      const cur = map.get(key) || { total: 0, count: 0 };
      cur.total += s.report.overallScore;
      cur.count++;
      map.set(key, cur);
    }
  }
  const toSeries = (map) => [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) // ISO dates and YYYY-MM sort correctly as text
    .map(([period, { total, count }]) => ({ period, averageScore: Math.round(total / count), count }));

  // Rule-based score buckets for a quick-glance chart (>= 75 ready, 50-74 needs improvement, < 50 not ready): a heuristic threshold, not a predictive model.
  const placementReadiness = { ready: 0, needsImprovement: 0, notReady: 0 };
  for (const s of withScore) {
    const v = s.report.overallScore;
    if (v >= 75) placementReadiness.ready++;
    else if (v >= 50) placementReadiness.needsImprovement++;
    else placementReadiness.notReady++;
  }

  return {
    totalInterviews: sessions.length,
    completedCount,
    averageScore: hasScores ? Math.round(sum / withScore.length) : 0,
    highestScore: hasScores ? highest : 0,
    lowestScore: hasScores ? lowest : 0,
    thisWeekCount,
    thisMonthCount,
    companyWise: groupAvg((s) => s.config?.company || null),
    byGroup: groupAvg((s) => {
      const g = s.student?.academicGroup;
      return g ? `${g.department?.name || "—"} - ${g.section}` : null;
    }),
    byBatch: groupAvg((s) => s.student?.academicGroup?.batch || s.student?.batchYear || null),
    byType: groupAvg((s) => typeLabel(s)),
    weeklyTrend: toSeries(weekly),
    monthlyTrend: toSeries(monthly),
    placementReadiness,
    defaultDateRangeApplied,
  };
}

module.exports = { computeInterviewAnalytics, mondayOfUtcWeek };
