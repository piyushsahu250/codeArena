// Live check of the limits on the endpoints that message many people at once (2026-10 audit).
//  * POST /tests/:id/notify: an e-mail notification for the same test is now refused for a cooldown after the last one (the idempotency key only stopped a double click, and the mail
//    sender's daily allowance is shared with password and credential e-mails); an idempotency key that belongs to a different test is a 409, not another test's send details.
//  * POST /admin/announcements: the message and subject have length caps, a non-text message is a 400 (it used to be a 500), and each admin has an hourly limit of accepted announcements.
// No e-mail is sent: the "earlier e-mail send" is inserted directly, and announcements are in-app only. Throwaway institute, users and tests; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function post(path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await res.json().catch(() => ({}))).token;
}
const PREFIX = "zz-mg-";

async function cleanup() {
  await prisma.testNotificationSend.deleteMany({ where: { idempotencyKey: { startsWith: PREFIX } } });
  await prisma.test.deleteMany({ where: { title: { startsWith: "ZZ MG " } } });
  const users = await prisma.user.findMany({ where: { email: { startsWith: "verify-mg-", endsWith: "@example.invalid" } }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-mg-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ MG " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ MG A ${ts}` } });
  const mk = async (name, role, instituteId) => {
    const pw = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name, email: `verify-mg-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } });
    return { ...u, token: await login(u.email, pw) };
  };
  try {
    const staff = await mk("Staff One", "STAFF", A.id);
    const instAdmin = await mk("Inst Admin", "INSTITUTE_ADMIN", A.id);
    const instAdmin2 = await mk("Inst Admin Two", "INSTITUTE_ADMIN", A.id);
    await mk("Student One", "STUDENT", A.id); // the only recipient of a test with no group: every active student of the institute
    check("test users could sign in", !!staff.token && !!instAdmin.token && !!instAdmin2.token);

    const now = Date.now();
    const mkTest = (title) => prisma.test.create({ data: { title: `ZZ MG ${title} ${ts}`, startTime: new Date(now - 3600000), endTime: new Date(now + 3600000), createdById: staff.id, instituteId: A.id, isPublished: true } });
    const t1 = await mkTest("One"), t2 = await mkTest("Two");

    // ---- e-mail cooldown
    const key1 = `${PREFIX}key1-${ts}`;
    await prisma.testNotificationSend.create({ data: { testId: t1.id, idempotencyKey: key1, sendEmail: true, sendInApp: false, recipientCount: 1, sentById: staff.id, sentByName: staff.name } });
    const again = await post(`/tests/${t1.id}/notify`, staff.token, { sendEmail: true, idempotencyKey: `${PREFIX}new-${ts}` });
    check("a second e-mail notification for the same test within the cooldown is refused with 429", again.status === 429 && /already sent/i.test(String(again.body && again.body.error)), `${again.status} ${JSON.stringify(again.body)}`);
    const emailsFor = await prisma.testNotificationSend.count({ where: { testId: t1.id, sendEmail: true } });
    check("and no second e-mail send was recorded", emailsFor === 1, `${emailsFor} e-mail sends`);
    const inApp = await post(`/tests/${t1.id}/notify`, staff.token, { sendInApp: true, idempotencyKey: `${PREFIX}inapp-${ts}` });
    check("an in-app notification is still allowed during the e-mail cooldown", inApp.status === 200 && inApp.body && inApp.body.recipientCount === 1, `${inApp.status} ${JSON.stringify(inApp.body)}`);
    const replay = await post(`/tests/${t1.id}/notify`, staff.token, { sendEmail: true, idempotencyKey: key1 });
    check("replaying the SAME key for the same test still answers 'already sent' (idempotent, ahead of the cooldown)", replay.status === 200 && replay.body && replay.body.alreadySent === true, `${replay.status} ${JSON.stringify(replay.body)}`);

    // ---- an idempotency key that belongs to another test
    const collide = await post(`/tests/${t2.id}/notify`, staff.token, { sendInApp: true, idempotencyKey: key1 });
    check("a key used for another test is a 409, not that test's send details", collide.status === 409 && !(collide.body && collide.body.alreadySent), `${collide.status} ${JSON.stringify(collide.body)}`);
    const t2Sends = await prisma.testNotificationSend.count({ where: { testId: t2.id } });
    check("and nothing was recorded for the second test", t2Sends === 0, `${t2Sends} sends`);

    // ---- announcements: validation, then the hourly limit (only an ACCEPTED announcement uses it up: a refused request has sent nothing)
    const url = "/admin/announcements";
    const notText = await post(url, instAdmin.token, { audience: "ALL_STAFF", message: 12345 });
    check("a message that is not text is a 400 (it used to be a 500)", notText.status === 400, `${notText.status}`);
    const tooLong = await post(url, instAdmin.token, { audience: "ALL_STAFF", message: "x".repeat(2001) });
    check("a message over 2000 characters is a 400", tooLong.status === 400 && /at most 2000/.test(String(tooLong.body && tooLong.body.error)), `${tooLong.status}`);
    const badSubject = await post(url, instAdmin.token, { audience: "ALL_STAFF", message: "ok", subject: "s".repeat(151) });
    check("a subject over 150 characters is a 400", badSubject.status === 400, `${badSubject.status}`);
    const accepted = [];
    for (let n = 1; n <= 5; n++) accepted.push(await post(url, instAdmin.token, { audience: "ALL_STAFF", message: `ZZ verify announcement ${n}` }));
    check("five valid announcements are delivered, even after three refused requests (those did not use the limit)", accepted.every((r) => r.status === 200 && r.body && r.body.recipientCount === 1), accepted.map((r) => r.status).join("/") + " " + JSON.stringify(accepted[0].body));
    const limited = await post(url, instAdmin.token, { audience: "ALL_STAFF", message: "ZZ verify announcement six" });
    check("the sixth accepted announcement in the hour is refused with 429 and a clear message", limited.status === 429 && /wait before sending another/i.test(String(limited.body && limited.body.error)), `${limited.status} ${JSON.stringify(limited.body)}`);
    const otherAdmin = await post(url, instAdmin2.token, { audience: "ALL_STAFF", message: "ZZ verify announcement from another administrator" });
    check("the limit is per administrator: a second administrator of the same institute can still send", otherAdmin.status === 200 && otherAdmin.body && otherAdmin.body.recipientCount === 1, `${otherAdmin.status} ${JSON.stringify(otherAdmin.body)}`);
    const staffBlocked = await post(url, staff.token, { audience: "ALL_STAFF", message: "ZZ staff cannot announce" });
    check("a staff account cannot send announcements at all (403)", staffBlocked.status === 403, `${staffBlocked.status}`);
  } finally {
    await cleanup();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(failures === 0 ? "\nMESSAGING GUARDS VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
