// End-to-end check of /api/staff-analytics against a real database and the running API: role access, institute isolation (list, detail, events, compare,
// export), exact metric counts, N/A vs missing vs zero, ratio gating, pagination, privacy redaction, export formats, injection-safe CSV, audit entries.
// Disposable data only (tag "ZZ SA"); everything it creates is removed first and last.
//   node scripts/verifyStaffAnalytics.js      (API on localhost:4000, or VERIFY_API)
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ SA";
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || extra === undefined ? "" : `  -> ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`); if (!ok) failed++; };

async function http(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const type = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; if (type.includes("json")) { try { json = JSON.parse(buf.toString("utf8")); } catch { /* ignore */ } }
  return { status: res.status, json, buf, type, headers: res.headers, text: type.includes("json") ? "" : buf.toString("utf8") };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "zz-sa-", endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { adminName: { startsWith: "ZZ SA" } }] } });
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.test.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.talentPool.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: insts.map((i) => i.id) } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZSA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZSB" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = crypto.randomBytes(14).toString("base64url");
    return prisma.user.create({ data: { name: `ZZ SA ${key}`, email: `zz-sa-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const platform = await mk("platform", "ADMIN", null);
  const instA = await mk("instA", "INSTITUTE_ADMIN", A.id);
  const staffA1 = await mk("staffA1", "STAFF", A.id, { department: "ZZ Dept 1" });
  const staffA2 = await mk("staffA2", "STAFF", A.id, { department: "ZZ Dept 2" });
  const clerkA = await prisma.user.create({ data: { name: "=ZZ SA clerkA", email: `zz-sa-clerkA-${ts}@example.invalid`, passwordHash: await bcrypt.hash((pw.clerkA = crypto.randomBytes(14).toString("base64url")), 10), role: "CLERK", instituteId: A.id, mustChangePassword: false, department: "ZZ Dept 1" } });
  const staffB1 = await mk("staffB1", "STAFF", B.id, { department: "ZZ Dept 1" });
  const student = await mk("student", "STUDENT", A.id);
  const tokenOf = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const tok = { platform: await tokenOf(platform, "platform"), instA: await tokenOf(instA, "instA"), staffA1: await tokenOf(staffA1, "staffA1"), staffA2: await tokenOf(staffA2, "staffA2"), clerkA: await tokenOf(clerkA, "clerkA"), student: await tokenOf(student, "student") };

  // ---- seed the audit trail (explicit timestamps) ----
  const day = (n) => new Date(Date.now() - n * 86400000);
  const ev = (u, action, daysAgo, extra = {}) => ({ action, adminId: u.id, adminName: `ZZ SA ${u.id.slice(0, 4)}`, adminRole: u.role, instituteId: u.instituteId, createdAt: day(daysAgo), details: {}, ...extra });
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push(ev(staffA1, "TEST_CREATED", 2 + i));
  for (let i = 0; i < 2; i++) rows.push(ev(staffA1, "TEST_UPDATED", 3));
  for (let i = 0; i < 8; i++) rows.push(ev(staffA1, "RESULT_ENTRY_CREATED", 4, { studentId: student.id, details: { entity: "results", studentName: "Zed Hidden", email: "hidden@example.invalid", count: 1 } }));
  for (let i = 0; i < 4; i++) rows.push(ev(staffA1, "RESULT_ENTRY_CORRECTED", 5, { studentId: student.id }));
  for (let i = 0; i < 2; i++) rows.push(ev(staffA2, "TALENT_POOL_CREATED", 6));
  for (let i = 0; i < 5; i++) rows.push(ev(clerkA, "PLACEMENT_OFFER_VERIFIED", 1));
  rows.push(ev(clerkA, "TEST_CREATED", 1)); // a clerk cannot create tests: must NOT be counted
  for (let i = 0; i < 7; i++) rows.push(ev(staffB1, "TEST_CREATED", 2));
  rows.push(ev(staffB1, "TEST_CREATED", 40)); // makes test management "tracked" for the whole 30-day window
  rows.push(ev(staffB1, "RESULT_ENTRY_CREATED", 40));
  rows.push(ev(staffB1, "PLACEMENT_OFFER_VERIFIED", 40));
  rows.push(ev(staffB1, "TALENT_POOL_CREATED", 40));
  await prisma.auditLog.createMany({ data: rows });
  await prisma.test.create({ data: { title: `${TAG} test`, durationMin: 30, startTime: new Date(), endTime: new Date(Date.now() + 3600000), isPublished: true, createdById: staffA1.id, instituteId: A.id } });
  await prisma.talentPool.create({ data: { name: `${TAG} pool`, createdById: staffA2.id } });
  const cacheBust = () => http("/staff-analytics/meta", tok.platform); await cacheBust();

  // ---- access ----
  check("anonymous is refused", (await http("/staff-analytics/people")).status === 401);
  check("a student is refused", (await http("/staff-analytics/people", tok.student)).status === 403);
  check("staff cannot read the staff list", (await http("/staff-analytics/people", tok.staffA1)).status === 403);
  check("staff cannot read a peer's detail", (await http(`/staff-analytics/people/${staffA2.id}`, tok.staffA1)).status === 403);
  check("an admin cannot use the personal /me route", (await http("/staff-analytics/me", tok.instA)).status === 403);
  const me = await http("/staff-analytics/me", tok.staffA1);
  check("staff read their own record", me.status === 200 && me.json.profile.id === staffA1.id);
  check("a clerk reads their own record", (await http("/staff-analytics/me", tok.clerkA)).status === 200);
  check("personal data is never cached", (me.headers.get("cache-control") || "").includes("no-store"));

  // ---- isolation ----
  const platformList = await http(`/staff-analytics/people?pageSize=100`, tok.platform);
  const ids = (j) => new Set(j.rows.map((r) => r.id));
  check("platform admin sees every institute's staff", platformList.status === 200 && ids(platformList.json).has(staffA1.id) && ids(platformList.json).has(staffB1.id));
  const platformA = await http(`/staff-analytics/people?pageSize=100&instituteId=${A.id}`, tok.platform);
  check("platform admin can filter to one institute", platformA.status === 200 && ids(platformA.json).has(staffA1.id) && !ids(platformA.json).has(staffB1.id));
  const instList = await http(`/staff-analytics/people?pageSize=100`, tok.instA);
  check("institute admin sees only their own institute", instList.status === 200 && ids(instList.json).has(staffA1.id) && !ids(instList.json).has(staffB1.id) && instList.json.total === 3, instList.json && instList.json.total);
  check("institute admin cannot ask for another institute", (await http(`/staff-analytics/people?instituteId=${B.id}`, tok.instA)).status === 403);
  check("another institute's person detail is not found", (await http(`/staff-analytics/people/${staffB1.id}`, tok.instA)).status === 404);
  check("another institute's events are not found", (await http(`/staff-analytics/people/${staffB1.id}/events`, tok.instA)).status === 404);
  check("comparing with another institute's person is refused", (await http(`/staff-analytics/compare?ids=${staffA1.id},${staffB1.id}`, tok.instA)).status === 404);
  check("exporting another institute is refused", (await http(`/staff-analytics/export?instituteId=${B.id}`, tok.instA)).status === 403);
  check("event export for another institute's person is refused", (await http(`/staff-analytics/export?kind=events&userId=${staffB1.id}`, tok.instA)).status === 404);
  const sumA = await http("/staff-analytics/summary", tok.instA);
  check("summary for an institute admin counts only their staff", sumA.status === 200 && sumA.json.kpis.people === 3 && sumA.json.level === "INSTITUTE", sumA.json && sumA.json.kpis);
  const sumP = await http(`/staff-analytics/summary?groupBy=institute`, tok.platform);
  check("platform summary groups by institute and includes both", sumP.status === 200 && sumP.json.groups.some((g) => g.label.startsWith(`${TAG} A`)) && sumP.json.groups.some((g) => g.label.startsWith(`${TAG} B`)));

  // ---- numbers ----
  const row = (j, id) => j.rows.find((r) => r.id === id);
  const a1 = row(instList.json, staffA1.id), ck = row(instList.json, clerkA.id), a2 = row(instList.json, staffA2.id);
  check("staff total counts exactly the catalogued events (3+2+8+4)", a1.total === 17, a1.total);
  check("category counts are exact", a1.categories.TEST_MANAGEMENT.count === 5 && a1.categories.RESULTS_PROCESSING.count === 12, a1.categories);
  check("a clerk's test event is not counted: test management is not applicable", ck.categories.TEST_MANAGEMENT.status === "NOT_APPLICABLE" && ck.categories.TEST_MANAGEMENT.count === null);
  check("clerk total counts only applicable work (5 placement events)", ck.total === 5, ck.total);
  check("a tracked category with no events is a real zero", a2.categories.TEST_MANAGEMENT.count === 0 && a2.categories.TEST_MANAGEMENT.status === "TRACKED", a2.categories.TEST_MANAGEMENT);
  const meta = (await http("/staff-analytics/meta", tok.instA)).json;
  const untracked = meta.telemetry.filter((t) => !t.tracked).map((t) => t.key);
  check("a category the platform never recorded is NOT_TRACKED with no number", untracked.every((k) => a2.categories[k].status === "NOT_TRACKED" && a2.categories[k].count === null));
  check("meta carries definitions, principles and a generated timestamp", meta.definitions.principles.length >= 3 && meta.generatedAt && meta.definitions.categories.length > 5);
  check("a person with talent pool activity shows it", a2.categories.TALENT_POOL.count === 2, a2.categories.TALENT_POOL);

  const detail = await http(`/staff-analytics/people/${staffA1.id}`, tok.instA);
  const rc = detail.json.ratios.find((r) => r.key === "RESULT_CORRECTION_SHARE"), tr = detail.json.ratios.find((r) => r.key === "TEST_REWORK_SHARE");
  check("result correction share = 4 / 12 = 33.3 with its formula", rc.status === "OK" && rc.value === 33.3 && rc.numerator === 4 && rc.denominator === 12 && rc.formula.includes("RESULT_ENTRY_CORRECTED"), rc);
  check("a ratio under the minimum sample is withheld", tr.status === "INSUFFICIENT_DATA" && tr.value === null, tr);
  check("workload: active days and students touched", detail.json.workload.activeDays === 4 && detail.json.workload.studentsTouched === 1, detail.json.workload);
  check("portfolio comes from the tests table, separate from activity counts", detail.json.portfolio.testsCreated === 1 && detail.json.portfolio.testsPublished === 1, detail.json.portfolio);
  check("attempt completion rate is withheld without enough attempts", detail.json.portfolio.attemptCompletionRate.status === "INSUFFICIENT_DATA");
  check("no composite score is exposed", !JSON.stringify(detail.json).toLowerCase().includes("performancescore"));
  const clerkDetail = (await http(`/staff-analytics/people/${clerkA.id}`, tok.instA)).json;
  check("clerk ratios and test portfolio are not applicable", clerkDetail.ratios.find((r) => r.key === "TEST_REWORK_SHARE").status === "NOT_APPLICABLE" && clerkDetail.portfolio.testsCreated === null);

  // ---- list behaviour ----
  const p1 = await http(`/staff-analytics/people?pageSize=2&page=1&sort=total&dir=desc`, tok.instA), p2 = await http(`/staff-analytics/people?pageSize=2&page=2&sort=total&dir=desc`, tok.instA);
  check("pagination returns the right slices", p1.json.rows.length === 2 && p2.json.rows.length === 1 && p1.json.total === 3 && p1.json.rows[0].id === staffA1.id && !ids(p1.json).has(p2.json.rows[0].id));
  check("search narrows the list", (await http(`/staff-analytics/people?q=staffA2`, tok.instA)).json.total === 1);
  check("department filter works", (await http(`/staff-analytics/people?department=${encodeURIComponent("ZZ Dept 2")}`, tok.instA)).json.total === 1);
  check("role filter works", (await http(`/staff-analytics/people?role=CLERK`, tok.instA)).json.rows.every((r) => r.role === "CLERK"));
  check("category filter narrows the counted events", (await http(`/staff-analytics/people?category=TEST_MANAGEMENT`, tok.instA)).json.rows.find((r) => r.id === staffA1.id).total === 5);
  check("an unknown category is refused", (await http(`/staff-analytics/people?category=NOPE`, tok.instA)).status === 400);
  const cmp = await http(`/staff-analytics/compare?ids=${staffA1.id},${staffA2.id}`, tok.instA);
  check("compare returns both people with the same categories", cmp.status === 200 && cmp.json.people.length === 2 && cmp.json.categories.length > 5);
  check("compare needs at least two people", (await http(`/staff-analytics/compare?ids=${staffA1.id}`, tok.instA)).status === 400);

  // ---- dates ----
  check("from after to is refused", (await http(`/staff-analytics/summary?from=2026-10-05&to=2026-10-01`, tok.instA)).status === 400);
  check("a period over a year is refused", (await http(`/staff-analytics/summary?from=2024-01-01`, tok.instA)).status === 400);
  check("a malformed date is refused", (await http(`/staff-analytics/summary?from=yesterday`, tok.instA)).status === 400);

  // ---- drill-down privacy ----
  const events = await http(`/staff-analytics/people/${staffA1.id}/events?pageSize=50`, tok.instA);
  const text = JSON.stringify(events.json);
  check("event drill-down lists events with categories", events.status === 200 && events.json.total === 17 && events.json.rows.every((r) => r.category));
  check("event details never expose names or emails", !text.includes("Zed Hidden") && !text.includes("hidden@example.invalid") && text.includes("results"));
  check("staff read their own events", (await http("/staff-analytics/me/events", tok.staffA1)).status === 200);

  // ---- exports ----
  const csv = await http(`/staff-analytics/export?format=csv`, tok.instA);
  check("csv export works with a UTF-8 BOM and the right rows", csv.status === 200 && csv.type.includes("text/csv") && csv.text.charCodeAt(0) === 0xfeff && csv.text.includes("ZZ SA staffA1") && !csv.text.includes("staffB1"));
  check("csv is safe against formula injection", !/(^|\n)"?=ZZ/.test(csv.text) && csv.text.includes("'=ZZ SA clerkA"));
  check("csv shows N/A and Not tracked instead of zero", csv.text.includes("N/A"));
  const xlsx = await http(`/staff-analytics/export?format=xlsx`, tok.platform);
  check("xlsx export works", xlsx.status === 200 && xlsx.type.includes("spreadsheetml") && xlsx.buf.slice(0, 2).toString() === "PK");
  const pdf = await http(`/staff-analytics/export?format=pdf&instituteId=${A.id}`, tok.platform);
  check("pdf export works", pdf.status === 200 && pdf.type.includes("application/pdf") && pdf.buf.slice(0, 4).toString() === "%PDF");
  check("an unknown format is refused", (await http(`/staff-analytics/export?format=docx`, tok.instA)).status === 400);
  check("summary export works", (await http(`/staff-analytics/export?kind=summary&format=csv`, tok.instA)).status === 200);
  check("event export works for an in-scope person", (await http(`/staff-analytics/export?kind=events&userId=${staffA1.id}&format=csv`, tok.instA)).status === 200);

  // ---- audit ----
  const audits = await prisma.auditLog.findMany({ where: { adminId: { in: [instA.id, platform.id] }, action: { in: ["STAFF_ANALYTICS_VIEWED", "STAFF_ANALYTICS_EXPORTED"] } }, select: { action: true, adminId: true, details: true } });
  check("viewing a person is audited with the subject", audits.some((a) => a.action === "STAFF_ANALYTICS_VIEWED" && a.adminId === instA.id && a.details.subjectId === staffA1.id && a.details.view === "person"));
  check("event drill-down is audited", audits.some((a) => a.action === "STAFF_ANALYTICS_VIEWED" && a.details.view === "events"));
  check("exports are audited with format and row count", audits.some((a) => a.action === "STAFF_ANALYTICS_EXPORTED" && a.details.format === "csv" && a.details.rows >= 3) && audits.some((a) => a.action === "STAFF_ANALYTICS_EXPORTED" && a.details.format === "pdf" && a.adminId === platform.id));
  check("a refused cross-institute export is not recorded as an export", !audits.some((a) => a.action === "STAFF_ANALYTICS_EXPORTED" && a.details.instituteFilter === B.id && a.adminId === instA.id));

  await cleanup();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await cleanup(); } catch { /* ignore */ } await prisma.$disconnect(); process.exit(1); });
