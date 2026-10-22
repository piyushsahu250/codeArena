// Bulk e-mail protection (2026-10 audit). REGRESSION: every e-mail leaves through one provider account, and several notices fanned out as `Promise.all(people.map(emailStudent))` -- assigning a
// course to 3,000 students began 3,000 sends at once. That tripped the provider's login throttle (which failed password-reset and credential e-mails in the same window) and left thousands
// of log rows PENDING for ever when the server restarted mid-flight. Now: one-per-person fan-outs are bounded, critical e-mail has a reserved share of the daily allowance, and PENDING
// rows that can no longer change are corrected. The decision logic is tested here with a fake database; the real-database behaviour is checked by scripts/verifyEmailProtection.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { mapWithConcurrency } = require("../src/utils/queue");
const { emailEach, notifyInBackground } = require("../src/utils/notifications");
const mailer = require("../src/utils/mailer");

const { sendMailLogged, isCriticalEmailType, CRITICAL_EMAIL_TYPES, BULK_EMAIL_DAILY_BUDGET, sweepStalePendingEmails, resetBudgetCacheForTests } = mailer;
const SRC = path.join(__dirname, "..", "src");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FANOUT_LIMIT = Number(process.env.EMAIL_CONCURRENCY) || 5;

function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// ---- the bounded fan-out ---------------------------------------------------------------------------------------------------------------------------------

function tracker(delayMs = 2) {
  const state = { current: 0, peak: 0, started: 0 };
  const work = async (item) => {
    state.started += 1;
    state.current += 1;
    state.peak = Math.max(state.peak, state.current);
    await sleep(delayMs);
    state.current -= 1;
    return item * 2;
  };
  return { state, work };
}

test("mapWithConcurrency never has more than `limit` calls in flight, and keeps result order", async () => {
  const { state, work } = tracker();
  const items = Array.from({ length: 50 }, (_, i) => i);
  const results = await mapWithConcurrency(items, 5, work);
  assert.equal(state.peak, 5);
  assert.deepEqual(results, items.map((i) => i * 2));
});

test("a limit of 1 runs strictly one after another", async () => {
  const { state, work } = tracker();
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 1, work);
  assert.equal(state.peak, 1);
});

test("emailEach (used by every one-e-mail-per-person notice) is bounded by the e-mail concurrency setting", async () => {
  const { state, work } = tracker();
  const people = Array.from({ length: 60 }, (_, i) => i);
  await emailEach(people, work);
  assert.equal(state.started, 60, "every person is still processed");
  assert.equal(state.peak, Math.min(FANOUT_LIMIT, 60), `at most ${FANOUT_LIMIT} at once`);
});

test("notifyInBackground returns at once, stays bounded, and one person's failure does not stop the others", async () => {
  const people = Array.from({ length: 30 }, (_, i) => i);
  const finished = [];
  const logged = [];
  let current = 0;
  let peak = 0;
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const returned = notifyInBackground("test.label", people, async (person) => {
      current += 1;
      peak = Math.max(peak, current);
      await sleep(2);
      current -= 1;
      if (person === 3) throw new Error("boom");
      finished.push(person);
    });
    assert.equal(returned, undefined, "nothing for the request to wait on");
    assert.equal(finished.length, 0, "no work has completed at the moment it returns");
    const deadline = Date.now() + 5000;
    while ((finished.length < 29 || logged.length === 0) && Date.now() < deadline) await sleep(5);
  } finally {
    console.error = realError;
  }
  assert.equal(finished.length, 29, "everyone except the failing person was processed");
  assert.ok(peak <= FANOUT_LIMIT, `peak ${peak} exceeds ${FANOUT_LIMIT}`);
  assert.ok(logged.some((line) => line.includes("[test.label] 1 of 30 background notifications failed")), `the failure is reported once: ${JSON.stringify(logged)}`);
});

test("notifyInBackground does nothing for an empty or missing list", () => {
  let called = false;
  assert.equal(notifyInBackground("x", [], () => { called = true; }), undefined);
  assert.equal(notifyInBackground("x", null, () => { called = true; }), undefined);
  assert.equal(notifyInBackground("x", undefined, () => { called = true; }), undefined);
  assert.equal(called, false);
});

// A source scan, as for e-mail escaping: the same mistake is one copy-and-paste away. Only a callback that calls the sender directly is recognised (`.map((s) => emailStudent(...))`), which
// is exactly how every earlier instance was written; a longer block body would need a human reviewer.
const SENDER = "(?:emailStudent|sendMailLogged|sendMail|notify[A-Z]\\w*)";
const ARROW = "(?:async\\s*)?\\(?\\s*\\w+(?:\\s*,\\s*\\w+)?\\s*\\)?\\s*=>\\s*";
const UNBOUNDED_MAP = new RegExp(`\\.map\\(\\s*${ARROW}${SENDER}\\(`);
const UNBOUNDED_FOREACH = new RegExp(`\\.forEach\\(\\s*${ARROW}${SENDER}\\(`);

test("no code path starts one e-mail per person all at once", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*")) return;
      if (UNBOUNDED_FOREACH.test(code)) offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${code.slice(0, 110)}`);
      if (/Promise\.all\(/.test(code) && UNBOUNDED_MAP.test(lines.slice(i, i + 3).join(" "))) offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${code.slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [], "use emailEach / notifyInBackground (utils/notifications.js) for one e-mail per person:\n" + offenders.join("\n"));
});

test("the scan itself recognises the patterns it exists to catch", () => {
  assert.ok(UNBOUNDED_MAP.test("await Promise.all(toAdd.map((s) => notifyPoolAdded(prisma, s, pool)));"));
  assert.ok(UNBOUNDED_MAP.test("Promise.all(students.map(s => emailStudent(prisma, s, subject, body, 'X')))"));
  assert.ok(UNBOUNDED_MAP.test("Promise.all(courses.map(async (course) => notifyCourseAssigned(prisma, students, course)))"));
  assert.ok(UNBOUNDED_FOREACH.test("students.forEach((s) => sendMailLogged(prisma, { to: s.email }));"));
  assert.ok(!UNBOUNDED_MAP.test("notifyMany(prisma, members.map((m) => m.id), { type: 'X' })"), "mapping to ids is not a send");
  assert.ok(!UNBOUNDED_MAP.test("emailEach(students, (s) => emailStudent(prisma, s, 'x', 'y', 'Z'))"), "the bounded helper is the approved form");
});

// ---- critical e-mail keeps a reserved share of the daily allowance -------------------------------------------------------------------------------------------

test("credential, password-reset and verification e-mails are critical; notices and bulk e-mail are not", () => {
  for (const type of ["PASSWORD_RESET", "PASSWORD_RESET_BY_ADMIN", "CREDENTIALS", "CREDENTIALS_RESEND", "EMAIL_VERIFICATION"]) assert.equal(isCriticalEmailType(type), true, type);
  for (const type of ["COURSE_ASSIGNED", "TEST_ASSIGNED", "READINESS_TEST_ASSIGNED", "SYSTEM_ANNOUNCEMENT", "RESULT_PUBLISHED", "TALENT_POOL_ADDED", "LOGIN_ALERT", "INTERVIEW_REPORT_READY", "OTHER_SYSTEM_EMAIL"]) {
    assert.equal(isCriticalEmailType(type), false, type);
  }
  assert.equal(isCriticalEmailType(undefined), false);
  assert.equal(isCriticalEmailType(null), false);
  assert.equal(isCriticalEmailType(""), false);
});

test("every critical type is one the code really sends (a rename cannot leave the exemption dead)", () => {
  const everything = sourceFiles().filter((file) => path.basename(file) !== "mailer.js").map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const type of CRITICAL_EMAIL_TYPES) assert.ok(everything.includes(`"${type}"`), `${type} is listed as critical but no code sends an e-mail of that type`);
});

// A fake database: just the calls sendMailLogged makes. `to` is always an invalid address, so sendMail refuses it before any mail transport is touched -- nothing can be sent from a test.
function fakePrisma({ count = 0, countThrows = false } = {}) {
  const db = { created: [], updated: [], countCalls: 0 };
  db.emailLog = {
    count: async () => { db.countCalls += 1; if (countThrows) throw new Error("database down"); return count; },
    create: async ({ data }) => { db.created.push(data); return { id: `log-${db.created.length}`, ...data }; },
    update: async ({ where, data }) => { db.updated.push({ where, data }); return {}; },
  };
  return db;
}
async function quiet(fn) {
  const { log, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, error, warn }); }
}
const send = (prisma, emailType) => quiet(() => sendMailLogged(prisma, { to: "not-an-email", name: "Test", subject: "s", html: "<p>x</p>", emailType }));
const budgetOn = BULK_EMAIL_DAILY_BUDGET > 0;

test("once the daily allowance is used up, a bulk e-mail is not attempted: it is logged FAILED with the reason", { skip: !budgetOn }, async () => {
  resetBudgetCacheForTests();
  const prisma = fakePrisma({ count: BULK_EMAIL_DAILY_BUDGET });
  const result = await send(prisma, "COURSE_ASSIGNED");
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(prisma.created.length, 1);
  assert.equal(prisma.created[0].status, "FAILED");
  assert.match(prisma.created[0].errorMessage, /daily allowance for non-essential e-mails/);
  assert.equal(prisma.created[0].emailType, "COURSE_ASSIGNED");
  assert.equal(prisma.updated.length, 0, "no send was attempted, so nothing is updated afterwards");
});

test("a critical e-mail is attempted even when the allowance is used up, and never reads or uses the count", { skip: !budgetOn }, async () => {
  resetBudgetCacheForTests();
  const prisma = fakePrisma({ count: BULK_EMAIL_DAILY_BUDGET * 10 });
  for (const type of CRITICAL_EMAIL_TYPES) {
    const result = await send(prisma, type);
    assert.notEqual(result.skipped, true, type);
  }
  assert.equal(prisma.countCalls, 0, "the budget is never even consulted for critical types");
  assert.ok(prisma.created.every((row) => row.status === "PENDING"), "each was logged PENDING and went on to the send");
  assert.equal(prisma.updated.length, CRITICAL_EMAIL_TYPES.size);
  assert.ok(prisma.updated.every((u) => !/daily allowance/.test(u.data.errorMessage || "")));
});

test("e-mails sent between two re-reads of the count are counted, critical ones are not, and the last allowed one is the one that reaches the limit", { skip: !budgetOn }, async () => {
  resetBudgetCacheForTests();
  const prisma = fakePrisma({ count: BULK_EMAIL_DAILY_BUDGET - 1 });
  assert.notEqual((await send(prisma, "PASSWORD_RESET")).skipped, true, "a critical e-mail does not use the allowance");
  assert.notEqual((await send(prisma, "COURSE_ASSIGNED")).skipped, true, "one allowed e-mail left, so this one goes");
  assert.equal((await send(prisma, "COURSE_ASSIGNED")).skipped, true, "and now the allowance is used up");
  assert.equal((await send(prisma, "TEST_ASSIGNED")).skipped, true);
  assert.notEqual((await send(prisma, "CREDENTIALS")).skipped, true, "critical mail still goes");
  assert.equal(prisma.countCalls, 1, "the count is read once and then served from the short-lived cache");
});

test("if the count itself cannot be read, e-mail is NOT held back", { skip: !budgetOn }, async () => {
  resetBudgetCacheForTests();
  const prisma = fakePrisma({ countThrows: true });
  const result = await send(prisma, "COURSE_ASSIGNED");
  assert.notEqual(result.skipped, true);
  assert.equal(prisma.created[0].status, "PENDING");
});

test("BULK_EMAIL_DAILY_BUDGET=0 turns the allowance off", async () => {
  const modulePath = require.resolve("../src/utils/mailer");
  const saved = process.env.BULK_EMAIL_DAILY_BUDGET;
  process.env.BULK_EMAIL_DAILY_BUDGET = "0";
  delete require.cache[modulePath];
  try {
    const fresh = require("../src/utils/mailer");
    assert.equal(fresh.BULK_EMAIL_DAILY_BUDGET, 0);
    const prisma = fakePrisma({ count: 999999 });
    const result = await quiet(() => fresh.sendMailLogged(prisma, { to: "not-an-email", name: "Test", subject: "s", html: "<p>x</p>", emailType: "COURSE_ASSIGNED" }));
    assert.notEqual(result.skipped, true);
    assert.equal(prisma.countCalls, 0);
  } finally {
    if (saved === undefined) delete process.env.BULK_EMAIL_DAILY_BUDGET; else process.env.BULK_EMAIL_DAILY_BUDGET = saved;
    delete require.cache[modulePath];
  }
});

// ---- PENDING rows that can no longer change ------------------------------------------------------------------------------------------------------------------

test("the sweeper fails only PENDING rows older than the cutoff, changes nothing else about them, and says why", async () => {
  let call = null;
  const prisma = { emailLog: { updateMany: async (args) => { call = args; return { count: 7 }; } } };
  const expectedAge = Number(process.env.MAIL_STALE_PENDING_MS) || 30 * 60 * 1000;
  const before = Date.now();
  assert.equal(await sweepStalePendingEmails(prisma), 7);
  assert.equal(call.where.status, "PENDING");
  assert.ok(Math.abs(call.where.createdAt.lt.getTime() - (before - expectedAge)) < 5000, "the default cutoff is the stale-pending age");
  assert.deepEqual(Object.keys(call.data).sort(), ["errorMessage", "status"], "no other column (retry count, sent time ...) is touched");
  assert.equal(call.data.status, "FAILED");
  assert.match(call.data.errorMessage, /restarted|interrupted/);
  assert.match(call.data.errorMessage, /retried from Email Logs/);

  await sweepStalePendingEmails(prisma, { olderThanMs: 60 * 1000 });
  assert.ok(Math.abs(call.where.createdAt.lt.getTime() - (Date.now() - 60 * 1000)) < 5000, "a different age can be passed");
});

test("the sweeper is started at boot, and is exported by the scheduler module", () => {
  const index = fs.readFileSync(path.join(SRC, "index.js"), "utf8");
  assert.match(index, /startStaleEmailSweeper\(\);/);
  assert.match(fs.readFileSync(path.join(SRC, "utils", "emailRetryScheduler.js"), "utf8"), /module\.exports = \{[^}]*startStaleEmailSweeper/);
});
