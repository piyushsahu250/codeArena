// Rules of the Test Management module, kept free of Prisma and Express so every one of them can be checked by test/testManagementRules.test.js.
//
// The words matter here, because the module deliberately keeps four different questions apart:
//   - PUBLISHED  (Test.isPublished / TestSeries.status): a person's decision that students may see it. Unpublished is never visible to a student.
//   - ACTIVE     (Test.isActive / TestSeries.isActive): switched on or off for NEW attempts. A published test can be inactive. Switching off deletes nothing.
//   - ARCHIVED   (archivedAt): parked away from the working lists and from students. Nothing is deleted and every result stays readable.
//   - WINDOW     (startTime/endTime, or an assignment's start/end): when it can be taken. A closed window is not "deleted" and not "inactive".
// A series assignment adds one more question: is this series available to THESE students right now (assignment active, in its window)?

const TEST_VIEWS = Object.freeze(["all", "active", "inactive", "published", "unpublished", "starred", "hidden", "archived"]);
const BULK_ACTIONS = Object.freeze(["move", "archive", "restore", "activate", "deactivate", "publish", "unpublish", "star", "unstar", "hide", "unhide"]);
const SORTS = Object.freeze({ updated: [{ updatedAt: "desc" }, { id: "asc" }], created: [{ createdAt: "desc" }, { id: "asc" }], title: [{ title: "asc" }, { id: "asc" }], start: [{ startTime: "desc" }, { id: "asc" }], end: [{ endTime: "desc" }, { id: "asc" }] });

// ---- listing ------------------------------------------------------------------------------------------------------------------------------------------------------------
// The Prisma `where` fragment for one named view, for one person. Starred and hidden are THAT PERSON's own marks (TestUserState), never a property of the test.
function viewWhere(view, userId) {
  switch (view) {
    case "active": return { isActive: true, archivedAt: null, userStates: { none: { userId, hidden: true } } };
    case "inactive": return { isActive: false, archivedAt: null, userStates: { none: { userId, hidden: true } } };
    case "published": return { isPublished: true, archivedAt: null, userStates: { none: { userId, hidden: true } } };
    case "unpublished": return { isPublished: false, archivedAt: null, userStates: { none: { userId, hidden: true } } };
    case "starred": return { archivedAt: null, userStates: { some: { userId, starred: true } } };
    case "hidden": return { userStates: { some: { userId, hidden: true } } };
    case "archived": return { archivedAt: { not: null } };
    case "all":
    default: return { archivedAt: null, userStates: { none: { userId, hidden: true } } }; // the default working view: not archived, not hidden by this person
  }
}

// What a test is, in four separate words. `window` is about time only.
function lifecycleOf(test, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const start = test.startTime ? new Date(test.startTime).getTime() : null;
  const end = test.endTime ? new Date(test.endTime).getTime() : null;
  let window = "OPEN";
  if (start !== null && t < start) window = "UPCOMING";
  else if (end !== null && t > end) window = "CLOSED";
  return {
    published: !!test.isPublished,
    active: test.isActive !== false,
    archived: !!test.archivedAt,
    window,
    // The one place the four are combined: can a student begin a NEW attempt right now?
    studentsCanStart: !!test.isPublished && test.isActive !== false && !test.archivedAt && window === "OPEN",
  };
}

// ---- bulk operations ----------------------------------------------------------------------------------------------------------------------------------------------
// Which bulk actions need an explicit confirmation from the person (they change what students can reach, or are hard to notice).
const NEEDS_CONFIRMATION = Object.freeze(new Set(["archive", "deactivate", "unpublish", "publish"]));
function bulkNeedsConfirmation(action) { return NEEDS_CONFIRMATION.has(action); }

// Why an action cannot be applied to one test, or null when it can. `ctx.owns(test)` says whether the person may change the test itself (owner or admin of the institute);
// star, hide and move are the person's own marks and are allowed on any test they can see.
const PERSONAL = Object.freeze(new Set(["star", "unstar", "hide", "unhide", "move"]));
function bulkBlockReason(action, test, ctx) {
  if (!BULK_ACTIONS.includes(action)) return "Unknown action.";
  if (PERSONAL.has(action)) return null;
  if (!ctx.owns(test)) return "Only the owner of the test (or an administrator of the institute) can change this.";
  if (action === "archive" && test.archivedAt) return "Already archived.";
  if (action === "restore" && !test.archivedAt) return "Not archived.";
  if (action === "activate" && test.isActive !== false) return "Already active.";
  if (action === "deactivate" && test.isActive === false) return "Already inactive.";
  if (action === "publish" && test.isPublished) return "Already published.";
  if (action === "unpublish" && !test.isPublished) return "Already unpublished.";
  if ((action === "publish" || action === "activate") && test.archivedAt) return "Restore the test from the archive first.";
  return null;
}

// ---- series -------------------------------------------------------------------------------------------------------------------------------------------------------------
// -> { ok, errors[], value } for an assignment's dates. "No Expiry" means exactly that: no end date is required and none is stored.
function validateAssignmentWindow({ startAt, endAt, noExpiry, completionDeadline }) {
  const errors = [];
  const start = startAt ? new Date(startAt) : null;
  if (!start || Number.isNaN(start.getTime())) errors.push({ field: "startAt", message: "Choose when the series opens." });
  let end = null;
  if (noExpiry) {
    if (endAt) errors.push({ field: "endAt", message: "Remove the end date, or switch off No Expiry." });
  } else {
    end = endAt ? new Date(endAt) : null;
    if (!end || Number.isNaN(end.getTime())) errors.push({ field: "endAt", message: "Choose an end date, or turn on No Expiry." });
    else if (start && !Number.isNaN(start.getTime()) && end <= start) errors.push({ field: "endAt", message: "The end must be after the start." });
  }
  let deadline = null;
  if (completionDeadline) {
    deadline = new Date(completionDeadline);
    if (Number.isNaN(deadline.getTime())) errors.push({ field: "completionDeadline", message: "The completion deadline is not a valid date." });
    else if (start && deadline <= start) errors.push({ field: "completionDeadline", message: "The completion deadline must be after the start." });
    else if (end && deadline > end) errors.push({ field: "completionDeadline", message: "The completion deadline cannot be after the end." });
  }
  return { ok: errors.length === 0, errors, value: errors.length ? null : { startAt: start, endAt: noExpiry ? null : end, noExpiry: !!noExpiry, completionDeadline: deadline } };
}

// Is this series open to the students of ONE assignment at this moment, and if not, why not. Order matters: the reason given is the first thing a person would need to fix.
function seriesAvailability(series, assignment, now = new Date()) {
  const t = now.getTime();
  if (series.archivedAt) return { available: false, reason: "ARCHIVED" };
  if (series.status !== "PUBLISHED") return { available: false, reason: "UNPUBLISHED" };
  if (series.isActive === false) return { available: false, reason: "INACTIVE" };
  if (assignment.isActive === false) return { available: false, reason: "ASSIGNMENT_INACTIVE" };
  if (t < new Date(assignment.startAt).getTime()) return { available: false, reason: "NOT_STARTED" };
  if (!assignment.noExpiry && assignment.endAt && t > new Date(assignment.endAt).getTime()) return { available: false, reason: "EXPIRED" }; // only when a real end exists
  return { available: true, reason: null };
}

const DONE = new Set(["SUBMITTED", "AUTO_SUBMITTED"]);
// One student's state per test of a series, from the attempts that already exist (the attempts remain the source of truth; nothing here is stored or recomputed into a result).
// items: [{ testId, position }] in order. tests: Map(testId -> test). attempts: Map(testId -> { status, totalScore }). rule: "ATTEMPTED" | "PASSED". mode: "SEQUENTIAL" | "FLEXIBLE".
function seriesProgress({ items, tests, attempts, mode, rule, now = new Date() }) {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  let previousSatisfied = true;
  const rows = ordered.map((it) => {
    const test = tests.get(it.testId);
    const attempt = attempts.get(it.testId);
    const completed = !!attempt && DONE.has(attempt.status);
    const passed = completed && (!test || test.passingMarks == null || attempt.totalScore >= test.passingMarks);
    const satisfied = rule === "PASSED" ? passed : completed;
    let state;
    let reason = null;
    if (completed) state = "COMPLETED";
    else if (attempt) state = "IN_PROGRESS"; // an attempt that is running always stays reachable, whatever the series rules say
    else if (mode === "SEQUENTIAL" && !previousSatisfied) { state = "LOCKED"; reason = rule === "PASSED" ? "Pass the previous test to unlock this one." : "Complete the previous test to unlock this one."; }
    else if (!test) { state = "UNAVAILABLE"; reason = "This test is no longer available."; }
    else if (test.eligible === false) { state = "UNAVAILABLE"; reason = "This test has not been assigned to you."; } // a series never opens a test the student is not eligible for
    else {
      const life = lifecycleOf(test, now);
      if (life.studentsCanStart) state = "AVAILABLE";
      else { state = "UNAVAILABLE"; reason = !life.published ? "Not published." : !life.active ? "Switched off." : life.archived ? "Archived." : life.window === "UPCOMING" ? "Not open yet." : "The test window has closed."; }
    }
    previousSatisfied = previousSatisfied && satisfied;
    return { testId: it.testId, position: it.position, state, reason, completed, passed };
  });
  const total = rows.length;
  const completedCount = rows.filter((r) => r.completed).length;
  return { rows, total, completed: completedCount, pending: total - completedCount, percent: total ? Math.round((completedCount / total) * 100) : 0 };
}

// Sequential access is enforced when a test is opened: this says whether `testId` is locked for a student by ONE series (by position), given the same inputs as seriesProgress.
function isLockedBySeries(progress, testId) {
  const row = progress.rows.find((r) => r.testId === testId);
  return !!row && row.state === "LOCKED";
}

module.exports = { TEST_VIEWS, BULK_ACTIONS, SORTS, viewWhere, lifecycleOf, bulkNeedsConfirmation, bulkBlockReason, validateAssignmentWindow, seriesAvailability, seriesProgress, isLockedBySeries };
