// Live check of GET /api/student/dashboard using two throwaway institutes + students.
// Covers: auth/role gating, payload shape, "no fabricated zero" rules, institute isolation (tasks,
// notifications, announcements, certificates), no hidden-test leakage, and latency. Cleans up.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body) {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json, ms: Date.now() - t };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify SD " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { email: { startsWith: "verify-sd-", endsWith: "@example.invalid" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.certificate.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: uids } } });
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify SD A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify SD B ${ts}` } });
  const mk = async (name, role, instituteId) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-sd-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } }); return { ...u, pw }; };
  const sa = await mk("Asha Rao", "STUDENT", A.id), sb = await mk("Bimal Das", "STUDENT", B.id), ia = await mk("Inst Admin", "INSTITUTE_ADMIN", A.id);
  try {
    const TA = await login(sa.email, sa.pw), TB = await login(sb.email, sb.pw), TI = await login(ia.email, ia.pw);

    // seed data that belongs ONLY to institute B's student
    const now = Date.now();
    await prisma.test.create({ data: { title: "B-only exam", durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 3600000), isPublished: true, requireFullscreen: false, createdById: ia.id, instituteId: B.id } });
    await prisma.test.create({ data: { title: "A-expired exam", durationMin: 30, startTime: new Date(now - 7200000), endTime: new Date(now - 3600000), isPublished: true, requireFullscreen: false, createdById: ia.id, instituteId: A.id } });
    await prisma.test.create({ data: { title: "A-open exam", durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 3600000), isPublished: true, requireFullscreen: false, createdById: ia.id, instituteId: A.id } });
    await prisma.notification.create({ data: { recipientId: sb.id, type: "SYSTEM_ANNOUNCEMENT", message: "B-only announcement" } });
    await prisma.notification.create({ data: { recipientId: sa.id, type: "SYSTEM_ANNOUNCEMENT", message: "A announcement" } });
    await prisma.certificate.create({ data: { certificateCode: `CA-ZZ-${ts}`, type: "MANUAL", studentId: sb.id, title: "B-only certificate", programName: "B workshop" } });

    check("unauthenticated request is refused", (await call("GET", "/student/dashboard")).status === 401);
    check("institute admin cannot use the student endpoint", (await call("GET", "/student/dashboard", TI)).status === 403);

    const a = await call("GET", "/student/dashboard", TA);
    const b = await call("GET", "/student/dashboard", TB);
    check("student A loads the dashboard", a.status === 200, `${a.ms}ms (server ${a.body?.ms}ms)`);
    check("student B loads the dashboard", b.status === 200);
    const d = a.body;
    check("welcome uses a real first name", d.profile.firstName === "Asha");
    check("all sections present", ["kpis", "trend", "recentResults", "learning", "tasks", "coding", "readiness", "interview", "career", "certificates", "notifications", "activity", "recommendations"].every((k) => k in d));
    check("no section failed for a brand-new student", Object.entries(d).every(([k, v]) => !(v && typeof v === "object" && v.error === true)), JSON.stringify(Object.entries(d).filter(([, v]) => v && v.error).map(([k]) => k)));
    check("no fabricated zeros: average / rank / attendance are null when there is no data", d.kpis.averageScorePercent === null && d.kpis.rank === null && d.kpis.attendancePercent === null, JSON.stringify(d.kpis));
    check("readiness shows 8 categories, all 'not assessed' (null)", d.readiness.categories.length === 8 && d.readiness.categories.every((c) => c.score === null) && d.readiness.overall === null);
    check("interview is an honest empty state", d.interview.last === null);
    check("coding starts at zero solved with a difficulty split", d.coding.solved === 0 && d.coding.byDifficulty && d.coding.byDifficulty.EASY === 0);

    // isolation
    const aTasks = d.tasks.items.map((t) => t.title);
    check("A sees its open exam in next tasks", aTasks.includes("A-open exam"));
    check("expired never-attempted exams are NOT listed", !aTasks.includes("A-expired exam"));
    check("A does not see institute B's exam", !aTasks.includes("B-only exam"));
    check("B sees its own exam and not A's", b.body.tasks.items.some((t) => t.title === "B-only exam") && !b.body.tasks.items.some((t) => t.title.startsWith("A-")));
    check("A's announcements exclude B's", d.notifications.announcements.every((x) => x.message === "A announcement") && d.notifications.announcements.length === 1);
    check("A's unread count counts only A's rows", d.notifications.unreadCount === 1);
    check("A sees no certificates of B", d.certificates.total === 0 && d.certificates.items.length === 0);
    check("B sees its certificate with verify + download links", b.body.certificates.items.length === 1 && /\/certificate\/verify\/CA-ZZ-/.test(b.body.certificates.items[0].verifyUrl) && /^\/certificates\/.+\/download$/.test(b.body.certificates.items[0].downloadPath));

    // the client cannot ask for someone else's data
    const spoof = await call("GET", `/student/dashboard?studentId=${sb.id}&instituteId=${B.id}`, TA);
    check("query-string studentId/instituteId is ignored (no IDOR)", spoof.status === 200 && spoof.body.profile.firstName === "Asha" && !spoof.body.tasks.items.some((t) => t.title === "B-only exam"));

    // data leakage scan
    const raw = JSON.stringify(d);
    check("payload carries no secrets / hidden test-case fields", !/passwordHash|testCases|correctAnswer|expectedOutput|isHidden|token/i.test(raw));

    // latency over repeated loads
    const times = [];
    for (let i = 0; i < 10; i++) times.push((await call("GET", "/student/dashboard", TA)).ms);
    times.sort((x, y) => x - y);
    console.log(`latency (10 sequential, local): min ${times[0]}ms  median ${times[5]}ms  max ${times[9]}ms`);
    check("median latency under 1500ms", times[5] < 1500);

    // payload size
    console.log(`payload size: ${Buffer.byteLength(raw)} bytes`);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nSTUDENT DASHBOARD VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
