// Counts formal-test attempts that are LIVE: stored as IN_PROGRESS AND still inside the student's own time. An attempt whose time has run out but has not been
// closed yet (the sweep closes it later) is not live, so it must not inflate "attempts in progress" on the admin dashboards. Uses the same rule as the results
// leaderboard (modules/tests/attemptLifecycle.js). Only IN_PROGRESS rows are read, which is a small set.
const { lifecycleOf, STATE } = require("../modules/tests/attemptLifecycle");

async function countLiveTestAttempts(prisma, extraWhere = {}) {
  const rows = await prisma.testAttempt.findMany({
    where: { ...extraWhere, status: "IN_PROGRESS" },
    select: { status: true, startedAt: true, test: { select: { durationMin: true } } },
  });
  const now = Date.now();
  return rows.filter((r) => lifecycleOf(r, r.test, now).state === STATE.IN_PROGRESS).length;
}

module.exports = { countLiveTestAttempts };
