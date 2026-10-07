// Live check of the Feature Management API using two throwaway institutes (no real institute is touched):
// catalog without an institute, role access, bulk (atomic, scoped), copy, audit role accuracy. Cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify FM " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.featureSetting.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-fm-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify FM A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify FM B ${ts}` } });
  const mk = async (name, role, instituteId) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-fm-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } }); return { ...u, pw }; };
  const admin = await mk("Admin", "ADMIN", null), iadmin = await mk("Inst Admin", "INSTITUTE_ADMIN", A.id), stu = await mk("Student", "STUDENT", A.id);
  try {
    const TA = await login(admin.email, admin.pw), TI = await login(iadmin.email, iadmin.pw), TS = await login(stu.email, stu.pw);

    const cat = await call("GET", "/features/catalog", TA);
    check("catalog loads WITHOUT choosing an institute (the bulk picker bug)", cat.status === 200 && cat.body.features.length >= 10 && cat.body.features.every((f) => f.key && f.label && f.category));
    check("institute admin can read the catalog", (await call("GET", "/features/catalog", TI)).status === 200);
    check("students cannot read the catalog or the settings", (await call("GET", "/features/catalog", TS)).status === 403 && (await call("GET", `/features?instituteId=${A.id}`, TS)).status === 403);
    const comp = cat.body.features.find((f) => f.key === "coding_challenge");
    check("catalog carries dependency info", comp?.dependsOn === "compiler");

    // bulk, platform admin, both temp institutes
    const bulk = await call("POST", "/features/bulk", TA, { instituteIds: [A.id, B.id], featureKey: "resume_builder", enabled: false });
    check("platform admin can bulk-change two institutes at once", bulk.status === 200 && bulk.body.updated === 2);
    const rows = await prisma.featureSetting.findMany({ where: { featureKey: "resume_builder", instituteId: { in: [A.id, B.id] } } });
    check("both institutes are now OFF in the database", rows.length === 2 && rows.every((r) => r.enabled === false));
    const audits = await prisma.auditLog.findMany({ where: { instituteId: { in: [A.id, B.id] }, action: "FEATURE_BULK_TOGGLED" } });
    check("audit rows record the real actor role and previous value", audits.length === 2 && audits.every((a) => a.actorRole === "ADMIN" && a.details?.previous === true && a.details?.new === false), JSON.stringify(audits[0]?.actorRole));
    check("bulk with an unknown feature is refused", (await call("POST", "/features/bulk", TA, { instituteIds: [A.id], featureKey: "nope", enabled: true })).status === 400);
    check("bulk with an empty list is refused", (await call("POST", "/features/bulk", TA, { instituteIds: [], featureKey: "resume_builder", enabled: true })).status === 400);
    const missing = await call("POST", "/features/bulk", TA, { instituteIds: [A.id, "00000000-0000-0000-0000-000000000000"], featureKey: "resume_builder", enabled: true });
    check("unknown institute ids are reported, valid ones still applied", missing.status === 200 && missing.body.updated === 1 && missing.body.missing.length === 1);

    // institute admin scoping
    const cross = await call("POST", "/features/bulk", TI, { instituteIds: [A.id, B.id], featureKey: "resume_builder", enabled: true });
    check("institute admin cannot bulk-change another institute (403)", cross.status === 403);
    check("...and nothing changed for B", (await prisma.featureSetting.findUnique({ where: { instituteId_featureKey: { instituteId: B.id, featureKey: "resume_builder" } } })).enabled === false);
    check("institute admin cannot read another institute's settings", (await call("GET", `/features?instituteId=${B.id}`, TI)).status === 403);
    const own = await call("PATCH", "/features", TI, { instituteId: A.id, featureKey: "resume_builder", enabled: true });
    check("institute admin can change their own institute", own.status === 200);
    const ownAudit = await prisma.auditLog.findFirst({ where: { instituteId: A.id, action: "FEATURE_TOGGLED" }, orderBy: { createdAt: "desc" } });
    check("audit shows INSTITUTE_ADMIN (not a hard-coded ADMIN) for their change", ownAudit?.actorRole === "INSTITUTE_ADMIN", String(ownAudit?.actorRole));
    const instList = await call("GET", "/institutes", TI);
    check("an institute admin's institute list contains only their own institute", instList.status === 200 && instList.body.length === 1 && instList.body[0].id === A.id);

    // dependency warning
    await call("PATCH", "/features", TA, { instituteId: B.id, featureKey: "compiler", enabled: true });
    await call("PATCH", "/features", TA, { instituteId: B.id, featureKey: "coding_challenge", enabled: true });
    const off = await call("PATCH", "/features", TA, { instituteId: B.id, featureKey: "compiler", enabled: false });
    check("turning off a dependency returns a warning about what depends on it", off.status === 200 && /Coding Challenge/.test(off.body.warning || ""));

    // copy
    const prev = await call("GET", `/features/copy-preview?fromInstituteId=${A.id}&toInstituteId=${B.id}`, TA);
    check("copy preview lists the differences", prev.status === 200 && prev.body.changeCount >= 1);
    const cp = await call("POST", "/features/copy", TA, { fromInstituteId: A.id, toInstituteId: B.id });
    check("copy applies", cp.status === 200);
    const prev2 = await call("GET", `/features/copy-preview?fromInstituteId=${A.id}&toInstituteId=${B.id}`, TA);
    check("after the copy the two institutes match", prev2.body.changeCount === 0);
    check("copy to itself is refused", (await call("POST", "/features/copy", TA, { fromInstituteId: A.id, toInstituteId: A.id })).status === 400);
    check("institute admin cannot copy across institutes", (await call("POST", "/features/copy", TI, { fromInstituteId: A.id, toInstituteId: B.id })).status === 403);
    const hist = await call("GET", `/features/audit?instituteId=${B.id}`, TA);
    check("history returns the changes", hist.status === 200 && hist.body.logs.length >= 3);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nFEATURE MANAGEMENT VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
