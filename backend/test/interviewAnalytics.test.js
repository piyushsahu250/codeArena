// Accuracy checks for the interview analytics summary: every expected number below is worked out by hand from the fixture, not copied from the code's own output.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeInterviewAnalytics, mondayOfUtcWeek } = require("../src/utils/interviewAnalytics");

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0); // Sat 2026-10-24 12:00 UTC
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000);
const group = (dept, section, batch) => ({ batch, section, department: { name: dept } });
const mk = (over) => ({ status: "COMPLETED", submittedAt: daysAgo(1), config: null, isMock: true, student: { batchYear: 2025, academicGroup: null }, report: { overallScore: 50 }, ...over });
const label = (s) => (s.isMock ? "Mock Interview" : "Company Round");

// Deliberately NOT in date order, as a database may return them.
const sessions = [
  mk({ submittedAt: daysAgo(40), report: { overallScore: 80 }, config: { company: "TCS" }, isMock: false, student: { batchYear: 2025, academicGroup: group("CSE", "A", "2025") } }),
  mk({ submittedAt: daysAgo(2), report: { overallScore: 100 }, config: { company: "TCS" }, isMock: false, student: { batchYear: 2025, academicGroup: group("CSE", "A", "2025") } }),
  mk({ submittedAt: daysAgo(10), report: { overallScore: 0 }, status: "TERMINATED", student: { batchYear: 2024, academicGroup: group("AIML", "B", "2024") } }),
  mk({ submittedAt: daysAgo(20), report: { overallScore: 60 }, config: { company: "Infosys" }, isMock: false, student: { batchYear: 2025, academicGroup: group("CSE", "A", "2025") } }),
  mk({ submittedAt: daysAgo(3), report: null, status: "IN_PROGRESS" }),
];

test("summary cards are exact", () => {
  const r = computeInterviewAnalytics(sessions, { now: NOW, typeLabel: label });
  assert.equal(r.totalInterviews, 5);
  assert.equal(r.completedCount, 3);          // the 80, 100 and 60 sessions; the 0 is TERMINATED and the last is IN_PROGRESS
  assert.equal(r.averageScore, 60);           // (80 + 100 + 0 + 60) / 4 = 60: the session without a report is not counted
  assert.equal(r.highestScore, 100);
  assert.equal(r.lowestScore, 0);
  assert.equal(r.thisWeekCount, 2);           // 2 and 3 days ago
  assert.equal(r.thisMonthCount, 4);          // 2, 3, 10, 20 days ago (40 days ago is outside 30 days)
});

test("with no scored interviews the cards are zero, not -Infinity or NaN", () => {
  const r = computeInterviewAnalytics([mk({ report: null })], { now: NOW });
  assert.deepEqual([r.averageScore, r.highestScore, r.lowestScore], [0, 0, 0]);
  const empty = computeInterviewAnalytics([], { now: NOW });
  assert.equal(empty.totalInterviews, 0);
  assert.deepEqual(empty.weeklyTrend, []);
});

test("grouped averages and ordering are exact and do not depend on row order", () => {
  const r = computeInterviewAnalytics(sessions, { now: NOW, typeLabel: label });
  assert.deepEqual(r.companyWise, [{ key: "TCS", count: 2, averageScore: 90 }, { key: "Infosys", count: 1, averageScore: 60 }]);
  assert.deepEqual(r.byGroup, [{ key: "CSE - A", count: 3, averageScore: 80 }, { key: "AIML - B", count: 1, averageScore: 0 }]);
  assert.deepEqual(r.byBatch, [{ key: "2025", count: 3, averageScore: 80 }, { key: "2024", count: 1, averageScore: 0 }]);
  assert.deepEqual(r.byType, [{ key: "Company Round", count: 3, averageScore: 80 }, { key: "Mock Interview", count: 1, averageScore: 0 }]);
  const reversed = computeInterviewAnalytics([...sessions].reverse(), { now: NOW, typeLabel: label });
  assert.deepEqual(reversed, r);
});

test("trends run oldest to newest and weeks start on Monday (UTC)", () => {
  const r = computeInterviewAnalytics(sessions, { now: NOW, typeLabel: label });
  // submitted: 40d ago = 2026-09-14 (Mon), 20d = 2026-10-04 (Sun, week of 09-28), 10d = 2026-10-14 (Wed, week of 10-12), 2d = 2026-10-22 (Thu, week of 10-19)
  assert.deepEqual(r.weeklyTrend.map((w) => w.period), ["2026-09-14", "2026-09-28", "2026-10-12", "2026-10-19"]);
  assert.deepEqual(r.weeklyTrend.map((w) => w.averageScore), [80, 60, 0, 100]);
  assert.deepEqual(r.monthlyTrend, [{ period: "2026-09", averageScore: 80, count: 1 }, { period: "2026-10", averageScore: 53, count: 3 }]); // Oct: (60 + 0 + 100) / 3 = 53.3
});

test("mondayOfUtcWeek handles Sunday, Monday and a year boundary", () => {
  assert.equal(mondayOfUtcWeek(new Date(Date.UTC(2026, 9, 25, 23, 59))).toISOString().slice(0, 10), "2026-10-19"); // Sunday
  assert.equal(mondayOfUtcWeek(new Date(Date.UTC(2026, 9, 19, 0, 0))).toISOString().slice(0, 10), "2026-10-19");  // Monday
  assert.equal(mondayOfUtcWeek(new Date(Date.UTC(2027, 0, 1, 10, 0))).toISOString().slice(0, 10), "2026-12-28"); // Friday 1 Jan 2027
});

test("placement readiness buckets use the documented thresholds at their boundaries", () => {
  const edge = [75, 74, 50, 49, 100, 0].map((v) => mk({ report: { overallScore: v } }));
  const r = computeInterviewAnalytics(edge, { now: NOW });
  assert.deepEqual(r.placementReadiness, { ready: 2, needsImprovement: 2, notReady: 2 });
});

test("a very large result set does not overflow the call stack", () => {
  const many = Array.from({ length: 150000 }, (_, i) => mk({ report: { overallScore: i % 101 } }));
  const r = computeInterviewAnalytics(many, { now: NOW });
  assert.equal(r.highestScore, 100);
  assert.equal(r.lowestScore, 0);
  assert.equal(r.totalInterviews, 150000);
});

test("weeks and months start at midnight India time, not midnight UTC", () => {
  // Sun 2026-10-18 19:00 UTC = Mon 2026-10-19 00:30 IST -> the week of Monday 19 Oct (UTC alone would put it in the week of 12 Oct)
  // Sun 2026-10-18 18:00 UTC = Sun 2026-10-18 23:30 IST -> still the week of Monday 12 Oct
  // Wed 2026-09-30 19:00 UTC = Thu 2026-10-01 00:30 IST -> October (UTC alone would say September)
  const edge = [
    mk({ submittedAt: new Date("2026-10-18T19:00:00Z"), report: { overallScore: 70 } }),
    mk({ submittedAt: new Date("2026-10-18T18:00:00Z"), report: { overallScore: 50 } }),
    mk({ submittedAt: new Date("2026-09-30T19:00:00Z"), report: { overallScore: 90 } }),
  ];
  const r = computeInterviewAnalytics(edge, { now: NOW });
  assert.deepEqual(r.weeklyTrend, [
    { period: "2026-09-28", averageScore: 90, count: 1 },   // 2026-10-01 00:30 IST is a Thursday, week of Monday 28 Sep
    { period: "2026-10-12", averageScore: 50, count: 1 },
    { period: "2026-10-19", averageScore: 70, count: 1 },
  ]);
  assert.deepEqual(r.monthlyTrend, [{ period: "2026-10", averageScore: 70, count: 3 }]); // (70 + 50 + 90) / 3
});

test("the cards say how many interviews they average and how many were terminated", () => {
  const r = computeInterviewAnalytics(sessions, { now: NOW, typeLabel: label });
  assert.equal(r.scoredCount, 4);      // the 80, 100, 0 and 60 sessions have a report; the IN_PROGRESS one does not
  assert.equal(r.terminatedCount, 1);  // the 0 session
  assert.equal(r.completedCount + r.terminatedCount + 1, r.totalInterviews); // + the one in progress
  const none = computeInterviewAnalytics([mk({ report: null })], { now: NOW });
  assert.equal(none.scoredCount, 0);
});
