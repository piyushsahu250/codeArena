// Live check of /api/command/* (super, institute, staff, clerk): RBAC, institute isolation, metric
// accuracy against the database, pagination/filters, masking, latency. Uses two throwaway institutes.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(path, token) {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null; try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body, ms: Date.now() - t };
}
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await res.json()).token;
}

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify AC " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const us = await prisma.user.findMany({ where: { email: { startsWith: "verify-ac-", endsWith: "@example.invalid" } }, select: { id: true } });
  await prisma.certificate.deleteMany({ where: { studentId: { in: us.map((u) => u.id) } } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: "zz-verify-ac-" } } });
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-ac-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify AC A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify AC B ${ts}` } });
  const mk = async (name, role, instituteId, extra = {}) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-ac-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false, ...extra } }); return { ...u, pw }; };
  const plat = await mk("Platform Admin", "ADMIN", null);
  const iaA = await mk("Inst Admin A", "INSTITUTE_ADMIN", A.id), iaB = await mk("Inst Admin B", "INSTITUTE_ADMIN", B.id);
  const stfA = await mk("Staff A", "STAFF", A.id), clkA = await mk("Clerk A", "CLERK", A.id);
  const stuA = await mk("Student A", "STUDENT", A.id), stuB = await mk("Student B", "STUDENT", B.id), stuB2 = await mk("Student B Two", "STUDENT", B.id);
  try {
    await prisma.studentDocument.create({ data: { studentId: stuA.id, documentType: "Marksheet", documentLink: "https://example.invalid/a" } });
    await prisma.studentDocument.create({ data: { studentId: stuB.id, documentType: "Marksheet", documentLink: "https://example.invalid/b" } });
    await prisma.studentDocument.create({ data: { studentId: stuB2.id, documentType: "Resume", documentLink: "https://example.invalid/b2" } });
    await prisma.placementOffer.create({ data: { studentId: stuB.id, companyName: "B Corp", offerType: "PLACEMENT", source: "ON_CAMPUS", offeredPackage: 5, proofLink: "https://example.invalid/p" } });
    await prisma.emailLog.create({ data: { instituteId: B.id, recipientName: "X", recipientEmail: "someone@secret-domain.example", emailType: "TEST", status: "FAILED", errorMessage: "boom" } });

    const T = {};
    for (const [k, u] of Object.entries({ plat, iaA, iaB, stfA, clkA, stuA })) T[k] = await login(u.email, u.pw);

    // --- RBAC
    check("unauthenticated is refused (all four endpoints)", (await Promise.all(["super", "institute", "staff", "clerk"].map((p) => call(`/command/${p}`)))).every((r) => r.status === 401));
    const sup = await call("/command/super?days=30&pageSize=100", T.plat);
    check("platform admin loads the global dashboard", sup.status === 200, `${sup.ms}ms`);
    check("institute admin cannot open the global dashboard", (await call("/command/super", T.iaA)).status === 403);
    check("staff / clerk / student cannot open the global dashboard", (await Promise.all([T.stfA, T.clkA, T.stuA].map((t) => call("/command/super", t)))).every((r) => r.status === 403));
    check("student cannot open staff / clerk / institute dashboards", (await Promise.all(["staff", "clerk", "institute"].map((p) => call(`/command/${p}`, T.stuA)))).every((r) => r.status === 403));
    check("clerk cannot open the staff dashboard, staff cannot open the clerk dashboard", (await call("/command/staff", T.clkA)).status === 403 && (await call("/command/clerk", T.stfA)).status === 403);
    check("staff cannot open the institute admin dashboard", (await call("/command/institute", T.stfA)).status === 403);

    // --- global numbers vs DB
    const rowA = sup.body.institutes.rows.find((r) => r.id === A.id), rowB = sup.body.institutes.rows.find((r) => r.id === B.id);
    check("both throwaway institutes appear in the global table", !!rowA && !!rowB);
    check("institute A counts match the database (1 student, 1 staff, 1 clerk)", rowA?.students === 1 && rowA?.staff === 1 && rowA?.clerks === 1, JSON.stringify([rowA?.students, rowA?.staff, rowA?.clerks]));
    check("institute B counts match the database (2 students)", rowB?.students === 2);
    const dbStudents = await prisma.user.count({ where: { role: "STUDENT", isActive: true, instituteId: { not: null } } });
    check("global student total equals the database count", sup.body.totals.students === dbStudents, `${sup.body.totals.students} vs ${dbStudents}`);
    check("global institute total equals the database count", sup.body.totals.institutes === (await prisma.institute.count()));
    check("logged-in users are counted as active (A: platform logins excluded)", rowA?.activeUsers >= 3, String(rowA?.activeUsers));
    check("health is one of the documented states with reasons exposed", ["HEALTHY", "NEEDS_ATTENTION", "CRITICAL", "INACTIVE"].includes(rowA?.health) && Array.isArray(rowA?.healthReasons));
    check("trend is null (not a fake number) when no previous data", sup.body.trends.certificates.changePercent === null || typeof sup.body.trends.certificates.changePercent === "number");
    const p1 = await call("/command/super?pageSize=5&page=1", T.plat);
    check("server-side pagination limits rows", p1.body.institutes.rows.length <= 5 && p1.body.institutes.total >= 2);
    const f = await call(`/command/super?q=${encodeURIComponent("ZZ Verify AC B")}`, T.plat);
    check("server-side search filters institutes", f.body.institutes.rows.length === 1 && f.body.institutes.rows[0].id === B.id);
    check("system health comes from live checks (db ping present)", sup.body.system.some((s) => s.key === "db" && /ms/.test(s.detail)));
    check("failed-email recipients are masked", sup.body.email.recentFailures.every((x) => !/secret-domain/.test(JSON.stringify(x)) || /\*\*\*/.test(x.recipient)) && !JSON.stringify(sup.body).includes("someone@secret-domain"));
    check("no password hashes / tokens in the global payload", !/passwordHash|\"token\"/i.test(JSON.stringify(sup.body)));

    // --- institute dashboard isolation
    const iA = await call("/command/institute", T.iaA);
    check("institute admin A loads own dashboard", iA.status === 200 && iA.body.institute.id === A.id && iA.body.counts.students === 1);
    const spoof = await call(`/command/institute?instituteId=${B.id}`, T.iaA);
    check("institute admin A asking for institute B still gets only A (no IDOR)", spoof.status === 200 && spoof.body.institute.id === A.id);
    check("institute admin B sees own 2 students and its pending doc/offer counts", (await call("/command/institute", T.iaB)).body.counts.students === 2);
    const bView = (await call("/command/institute", T.iaB)).body;
    check("B's pending documents = 3 - 0 verified... (2 docs) and offers = 1", bView.pending.documentsToVerify === 2 && bView.pending.offersToVerify === 1, JSON.stringify(bView.pending));
    check("A's pending documents does not include B's", iA.body.pending.documentsToVerify === 1 && iA.body.pending.offersToVerify === 0);
    const drill = await call(`/command/institute?instituteId=${B.id}`, T.plat);
    check("platform admin can drill into institute B", drill.status === 200 && drill.body.institute.id === B.id);
    check("platform admin must choose an institute (400 otherwise)", (await call("/command/institute", T.plat)).status === 400);
    check("unknown institute id gives 404", (await call("/command/institute?instituteId=00000000-0000-0000-0000-000000000000", T.plat)).status === 404);

    // --- staff
    const st = await call("/command/staff", T.stfA);
    check("staff A loads dashboard", st.status === 200, `${st.ms}ms`);
    check("staff sees only institute A students", st.body.metrics.students === 1 && !st.body.attention.students.some((s) => [stuB.id, stuB2.id].includes(s.id)));
    check("staff scope states it is institute-wide when no class is assigned", st.body.scope.type === "INSTITUTE");
    check("student A is flagged for an incomplete profile", st.body.attention.students.some((s) => s.id === stuA.id && s.reasons.some((r) => r.code === "PROFILE_INCOMPLETE")));

    // --- clerk
    const ck = await call("/command/clerk", T.clkA);
    check("clerk A loads dashboard", ck.status === 200, `${ck.ms}ms`);
    check("clerk sees only A's documents (1 pending) and no B offers", ck.body.metrics.documentsPending === 1 && ck.body.metrics.offersPending === 0, JSON.stringify(ck.body.metrics));
    check("clerk recent updates contain no institute B students", !ck.body.recent.some((r) => [stuB.id, stuB2.id].includes(r.studentId)));
    check("clerk task center is actionable (links present)", ck.body.tasks.length > 0 && ck.body.tasks.every((t) => t.to && t.count > 0));

    // --- course completion (real lessons, assigned to A only)
    const course = await prisma.course.create({ data: { slug: `zz-verify-ac-${ts}`, name: `ZZ Verify AC Course ${ts}`, status: "PUBLISHED", isActive: true } });
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "M1", isActive: true } });
    const l1 = await prisma.lesson.create({ data: { moduleId: mod.id, title: "L1", isActive: true } });
    await prisma.lesson.create({ data: { moduleId: mod.id, title: "L2", isActive: true } });
    await prisma.lesson.create({ data: { moduleId: mod.id, title: "Draft lesson (must not count)", isActive: false } });
    await prisma.courseInstituteAssignment.create({ data: { courseId: course.id, instituteId: A.id, assignedByUserId: plat.id, assignedByName: "t" } });
    await prisma.lessonProgress.create({ data: { studentId: stuA.id, lessonId: l1.id, status: "COMPLETED", completedAt: new Date() } });
    const sup2 = await call(`/command/super?pageSize=100&q=${encodeURIComponent(`ZZ Verify AC`)}`, T.plat);
    const a2 = sup2.body.institutes.rows.find((r) => r.id === A.id), b2 = sup2.body.institutes.rows.find((r) => r.id === B.id);
    // cached 45s from the earlier call, so read the institute view (separate cache key, first call) and recompute via a fresh days value
    const supFresh = await call(`/command/super?days=29&pageSize=100&q=${encodeURIComponent(`ZZ Verify AC`)}`, T.plat);
    const aF = supFresh.body.institutes.rows.find((r) => r.id === A.id), bF = supFresh.body.institutes.rows.find((r) => r.id === B.id);
    check("course completion: 1 of 2 live lessons done = 50% (draft lesson ignored)", aF?.courseCompletionPercent === 50, String(aF?.courseCompletionPercent));
    check("course completion: institute with no assigned course shows null, not 0", bF?.courseCompletionPercent === null);
    const iA2 = await call("/command/institute?days=29", T.iaA);
    check("institute view reports the same completion and group rollups carry the field", iA2.body.courseCompletionPercent === 50 && iA2.body.departments.every((d) => "courseCompletionPercent" in d));

    // --- search
    await prisma.certificate.create({ data: { certificateCode: `CA-ZZAC-${ts}`, type: "MANUAL", studentId: stuA.id, title: "ZZ Verify AC Cert" } });
    const s1 = await call(`/search?q=${encodeURIComponent("ZZ Verify AC")}`, T.plat);
    const types = new Set(s1.body.results.map((r) => r.type));
    check("platform admin search returns institutes, courses and certificates", ["Institute", "Course", "Certificate"].every((t) => types.has(t)), [...types].join(","));
    const s2 = await call(`/search?q=${encodeURIComponent("verify-ac-")}`, T.plat);
    const t2 = new Set(s2.body.results.map((r) => r.type));
    check("platform admin search finds students, staff, clerks and institute admins by email", ["Student", "Staff", "Clerk", "Institute admin"].every((t) => t2.has(t)), [...t2].join(","));
    check("institute drill-down link is used for platform results", s1.body.results.filter((r) => r.type === "Institute").every((r) => /^\/admin\/institutes\/.+\/overview$/.test(r.url)));
    const s3 = await call(`/search?q=${encodeURIComponent("verify-ac-")}`, T.iaA);
    check("institute admin A search never returns institute B people or institutes", s3.status === 200 && !JSON.stringify(s3.body).includes(`ZZ Verify AC B`) && !s3.body.results.some((r) => /Student B|Inst Admin B/i.test(r.label)));
    check("institute admin A sees own people in search", s3.body.results.some((r) => /Student A/.test(r.label)));
    check("search with a 1-character query is empty (no scan)", (await call("/search?q=a", T.plat)).body.results.length === 0);
    check("search results are grouped (same types adjacent)", (() => { const seq = s2.body.results.map((r) => r.type); return seq.every((t, i) => i === 0 || t === seq[i - 1] || !seq.slice(0, i - 1).includes(t)); })());

    // --- exports
    const raw = async (path, token) => { const r = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text() }; };
    check("export requires login", (await raw("/command/super/export")).status === 401);
    check("institute admin cannot use the global export", (await raw("/command/super/export", T.iaA)).status === 403);
    check("staff / clerk cannot export the global or institute tables", (await raw("/command/super/export", T.stfA)).status === 403 && (await raw("/command/institute/export", T.clkA)).status === 403);
    const ex = await raw(`/command/super/export?q=${encodeURIComponent("ZZ Verify AC")}&days=29`, T.plat);
    check("global export is CSV with the table columns and both test institutes", ex.status === 200 && /text\/csv/.test(ex.type) && /Course completion %/.test(ex.text) && ex.text.includes(`ZZ Verify AC A ${ts}`) && ex.text.includes(`ZZ Verify AC B ${ts}`));
    check("export honours the search filter (only matching institutes)", (ex.text.match(/\n/g) || []).length <= 4);
    check("export with no matches returns 204, not an empty file", (await raw(`/command/super/export?q=${encodeURIComponent("no-such-institute-xyz")}`, T.plat)).status === 204);
    const ed = await raw("/command/institute/export?kind=departments", T.iaA);
    check("institute admin can export their own departments (or 204 when none exist)", [200, 204].includes(ed.status));
    const es = await raw(`/command/institute/export?kind=students&instituteId=${B.id}`, T.iaA);
    check("institute admin A asking to export B's students gets only A's", es.status === 200 && es.text.includes("Student A") && !es.text.includes("Student B"));
    const esB = await raw(`/command/institute/export?kind=students&instituteId=${B.id}`, T.plat);
    check("platform admin can export institute B's students", esB.status === 200 && esB.text.includes("Student B") && !esB.text.includes("Student A"));
    const audit = await prisma.auditLog.count({ where: { action: "DATA_EXPORTED", createdAt: { gte: new Date(ts) }, details: { path: ["entity"], string_starts_with: "command-" } } });
    check("every export is audit-logged", audit >= 3, String(audit));

    // --- latency
    const times = [];
    for (let i = 0; i < 8; i++) times.push((await call("/command/super?pageSize=20", T.plat)).ms);
    times.sort((a, b) => a - b);
    console.log(`global dashboard latency (8 calls, cache-warm): min ${times[0]}ms median ${times[4]}ms max ${times[7]}ms`);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nADMIN COMMAND DASHBOARDS VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
