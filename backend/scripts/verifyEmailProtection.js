// Live, database-backed check of the e-mail protections in utils/mailer.js (2026-10 audit):
//  * the sweeper that corrects EmailLog rows left PENDING by a restart (2,768 of them sat "pending" for weeks after one restart on 2026-10-07);
//  * the rolling 24-hour allowance for non-critical e-mail, which keeps a share of the provider account's daily limit for password-reset and credential e-mails.
// No e-mail can be sent: every send here uses an invalid recipient address, which sendMail refuses before any mail transport is touched, so a "send" only leaves its log row. Every row it
// writes has a recipient name starting "ZZ EP " and is deleted afterwards. The sweep is global (it changes every stale PENDING row), so the script refuses to run against a database that
// already holds stale PENDING rows of its own: use a throwaway database, as CI does.
const prisma = require("../src/prisma");
const { sendMailLogged, sweepStalePendingEmails, resetBudgetCacheForTests, BULK_EMAIL_DAILY_BUDGET, CRITICAL_EMAIL_TYPES } = require("../src/utils/mailer");

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const MARK = "ZZ EP ";
const HOUR = 3600 * 1000;
const cleanup = () => prisma.emailLog.deleteMany({ where: { recipientName: { startsWith: MARK } } });
const rowOf = (name) => prisma.emailLog.findFirst({ where: { recipientName: name }, orderBy: { createdAt: "desc" } });
async function quiet(fn) {
  const { log, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, error, warn }); }
}
// A send that goes through the real sendMailLogged. The invalid address means that when it is ATTEMPTED the row ends FAILED with "Invalid recipient email address"; when it is REFUSED by the
// allowance the row is FAILED with the allowance message instead. The two outcomes are told apart by that text.
async function send(name, emailType) {
  const result = await quiet(() => sendMailLogged(prisma, { to: "not-an-email", name: `${MARK}${name}`, subject: "ZZ EP", html: "<p>x</p>", emailType }));
  const row = await rowOf(`${MARK}${name}`);
  return { result, row, attempted: !!row && row.status === "FAILED" && /Invalid recipient email address/.test(row.errorMessage || ""), refused: !!row && row.status === "FAILED" && /daily allowance/.test(row.errorMessage || "") && result.skipped === true };
}
const filler = (count, extra = {}) => Array.from({ length: count }, () => ({ recipientName: `${MARK}filler`, recipientEmail: "zz-ep-filler@example.invalid", emailType: "ZZ_EP_FILLER", status: "PENDING", ...extra }));
const windowCount = () => prisma.emailLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * HOUR) }, status: { in: ["SENT", "PENDING", "RETRYING"] }, emailType: { notIn: [...CRITICAL_EMAIL_TYPES] } } });

(async () => {
  await cleanup();
  const unrelated = await prisma.emailLog.count({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } } });
  if (unrelated > 0) {
    console.log(`BLOCKED  ${unrelated} stale PENDING e-mail row(s) already exist that this script did not create; the sweep would change them. Run it against a throwaway database.`);
    await prisma.$disconnect().catch(() => {});
    process.exit(3);
  }

  try {
    // ---- the sweeper
    const old = new Date(Date.now() - 2 * HOUR);
    const base = { recipientEmail: "zz-ep-sweep@example.invalid", emailType: "ZZ_EP_TEST" };
    await prisma.emailLog.createMany({ data: [
      { ...base, recipientName: `${MARK}sweep stale-pending`, status: "PENDING", createdAt: old },
      { ...base, recipientName: `${MARK}sweep fresh-pending`, status: "PENDING", createdAt: new Date(Date.now() - 60 * 1000) },
      { ...base, recipientName: `${MARK}sweep stale-sent`, status: "SENT", createdAt: old, sentAt: old },
      { ...base, recipientName: `${MARK}sweep stale-failed`, status: "FAILED", errorMessage: "the original reason", createdAt: old },
    ] });
    const swept = await sweepStalePendingEmails(prisma);
    // The API server this runs beside has its own sweeper on a ten-minute timer, so in the rare case it ticks between the insert above and this call it has already done the work: 0 is then correct.
    check("the sweep changes at most one row: the PENDING row that is two hours old", swept <= 1, `${swept} row(s)`);
    const stale = await rowOf(`${MARK}sweep stale-pending`);
    check("that row is now FAILED, with the reason and the way to retry it", stale.status === "FAILED" && /restarted|interrupted/.test(stale.errorMessage || "") && /Email Logs/.test(stale.errorMessage || ""), `${stale.status} / ${stale.errorMessage}`);
    check("its retry count and sent time are untouched", stale.retryCount === 0 && stale.sentAt === null);
    const fresh = await rowOf(`${MARK}sweep fresh-pending`);
    check("a PENDING row from a minute ago (a send that may still be in flight) is left alone", fresh.status === "PENDING" && fresh.errorMessage === null, fresh.status);
    const sent = await rowOf(`${MARK}sweep stale-sent`);
    check("an old SENT row is left alone", sent.status === "SENT" && sent.errorMessage === null && sent.sentAt !== null, sent.status);
    const failed = await rowOf(`${MARK}sweep stale-failed`);
    check("an old FAILED row keeps its own original reason", failed.status === "FAILED" && failed.errorMessage === "the original reason", failed.errorMessage);
    check("sweeping again changes nothing", (await sweepStalePendingEmails(prisma)) === 0);
    await cleanup();

    // ---- the allowance
    if (!(BULK_EMAIL_DAILY_BUDGET > 0)) {
      console.log("NOT RUN  the e-mail allowance checks: BULK_EMAIL_DAILY_BUDGET is 0 (turned off) in this environment.");
    } else {
      const existing = await windowCount();
      const fill = BULK_EMAIL_DAILY_BUDGET - 1 - existing;
      if (fill < 0) {
        check(`the database has room to run the allowance checks (${existing} counted e-mails already, allowance ${BULK_EMAIL_DAILY_BUDGET})`, false);
      } else {
        await prisma.emailLog.createMany({ data: filler(fill) });
        check(`set-up: the last 24 hours now hold ${BULK_EMAIL_DAILY_BUDGET - 1} counted e-mails, one below the allowance of ${BULK_EMAIL_DAILY_BUDGET}`, (await windowCount()) === BULK_EMAIL_DAILY_BUDGET - 1, `${await windowCount()}`);

        resetBudgetCacheForTests();
        const critical = await send("critical 1", "PASSWORD_RESET");
        check("a password-reset e-mail is attempted", critical.attempted && critical.result.skipped !== true, `${critical.row && critical.row.errorMessage}`);
        const bulk1 = await send("bulk 1", "COURSE_ASSIGNED");
        check("the last allowed bulk e-mail is attempted", bulk1.attempted, `${bulk1.row && bulk1.row.errorMessage}`);
        const bulk2 = await send("bulk 2", "COURSE_ASSIGNED");
        check("the next bulk e-mail is refused: logged FAILED with the allowance message, and not attempted", bulk2.refused, `${bulk2.row && bulk2.row.errorMessage}`);
        check("the refusal says what to do and that in-app notices are unaffected", /password-reset and credential e-mails/.test(bulk2.row.errorMessage) && /in-app notification is unaffected/.test(bulk2.row.errorMessage));

        // the 30-second cache is dropped, as it would be after half a minute: the count now comes from the log table itself
        await prisma.emailLog.createMany({ data: filler(1) });
        resetBudgetCacheForTests();
        const bulk3 = await send("bulk 3 from the table", "TEST_ASSIGNED");
        check("with the table at the allowance, a bulk e-mail is refused on the table's own count", bulk3.refused, `${await windowCount()} counted`);
        const critical2 = await send("critical 2", "CREDENTIALS");
        check("while a credentials e-mail is still attempted", critical2.attempted && critical2.result.skipped !== true);
        const announce = await send("announcement", "SYSTEM_ANNOUNCEMENT");
        check("and an announcement e-mail is refused like any other bulk e-mail", announce.refused);

        // what does and does not use the allowance
        await prisma.emailLog.deleteMany({ where: { recipientName: `${MARK}filler` } });
        await prisma.emailLog.createMany({ data: filler(BULK_EMAIL_DAILY_BUDGET, { status: "SENT", emailType: "CREDENTIALS", sentAt: new Date() }) });
        resetBudgetCacheForTests();
        const bulk4 = await send("bulk 4 after credentials", "COURSE_ASSIGNED");
        check(`${BULK_EMAIL_DAILY_BUDGET} credential e-mails sent today do not use the bulk allowance`, bulk4.attempted, `${bulk4.row && bulk4.row.errorMessage}`);

        await prisma.emailLog.deleteMany({ where: { recipientName: `${MARK}filler` } });
        await prisma.emailLog.createMany({ data: filler(BULK_EMAIL_DAILY_BUDGET, { status: "SENT", sentAt: new Date(Date.now() - 25 * HOUR), createdAt: new Date(Date.now() - 25 * HOUR) }) });
        resetBudgetCacheForTests();
        const bulk5 = await send("bulk 5 after a day", "COURSE_ASSIGNED");
        check(`${BULK_EMAIL_DAILY_BUDGET} e-mails sent more than 24 hours ago do not count: the allowance is rolling`, bulk5.attempted, `${bulk5.row && bulk5.row.errorMessage}`);

        await prisma.emailLog.deleteMany({ where: { recipientName: `${MARK}filler` } });
        await prisma.emailLog.createMany({ data: filler(BULK_EMAIL_DAILY_BUDGET, { status: "FAILED", errorMessage: "provider said no" }) });
        resetBudgetCacheForTests();
        const bulk6 = await send("bulk 6 after failures", "COURSE_ASSIGNED");
        check(`${BULK_EMAIL_DAILY_BUDGET} FAILED e-mails do not use the allowance (they were never delivered)`, bulk6.attempted, `${bulk6.row && bulk6.row.errorMessage}`);
      }
    }
  } finally {
    await cleanup();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(failures === 0 ? "\nEMAIL PROTECTION VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
