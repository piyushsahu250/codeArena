// Live tenant-isolation checks for surfaces found by the 2026-10 platform audit. Two throwaway institutes; cleans up after itself.
//   - GET /gamification/leaderboard: department / group / institute scopes must never cross institutes (they did: department matched
//     by name across every institute, and staff could pass another institute's academicGroupId / instituteId); the cache key must be
//     per resolved scope (it was identical for every student).
//   - public verification endpoints are rate limited per IP.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify TI " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-ti-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify TI A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify TI B ${ts}` } });
  const deptA = await prisma.department.create({ data: { name: "ZZ Shared Dept", instituteId: A.id } });
  const deptB = await prisma.department.create({ data: { name: "ZZ Shared Dept", instituteId: B.id } });
  const gA1 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: deptA.id, section: "Section A" } });
  const gA2 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: deptA.id, section: "Section B" } });
  const gB = await prisma.academicGroup.create({ data: { instituteId: B.id, batch: "2026", departmentId: deptB.id, section: "Section A" } });
  const mk = async (name, role, instituteId, extra = {}) => { const pw = crypto.randomBytes(18).toString("base64url"); const u = await prisma.user.create({ data: { name, email: `verify-ti-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false, ...extra } }); return { ...u, token: await login(u.email, pw) }; };
  try {
    const sA1 = await mk("Alice One", "STUDENT", A.id, { department: "ZZ Shared Dept", academicGroupId: gA1.id });
    const sA2 = await mk("Alice Two", "STUDENT", A.id, { department: "ZZ Shared Dept", academicGroupId: gA2.id });
    const sB = await mk("Bob Other", "STUDENT", B.id, { department: "ZZ Shared Dept", academicGroupId: gB.id });
    const stfA = await mk("Staff A", "STAFF", A.id);
    const plat = await mk("Platform Admin", "ADMIN", null);
    for (const [s, xp] of [[sA1, 50], [sA2, 40], [sB, 90]]) await prisma.xpEvent.create({ data: { studentId: s.id, activity: "TEST", label: "verify", xp } });
    const names = (r) => (r.body || []).map((x) => x.name);

    // ---- department scope: same department NAME exists in both institutes
    const dep = await call("GET", "/gamification/leaderboard?scope=department&metric=xp", sA1.token);
    check("student department leaderboard contains only their own institute (same department name exists elsewhere)", dep.status === 200 && names(dep).includes("Alice One") && names(dep).includes("Alice Two") && !names(dep).includes("Bob Other"), JSON.stringify(names(dep)));
    const depB = await call("GET", "/gamification/leaderboard?scope=department&metric=xp", sB.token);
    check("the other institute's student sees only theirs", depB.status === 200 && names(depB).includes("Bob Other") && !names(depB).includes("Alice One"), JSON.stringify(names(depB)));

    // ---- group scope: the student's own group, and the cache must not be shared between groups
    const g1 = await call("GET", "/gamification/leaderboard?scope=group&metric=xp", sA1.token);
    const g2 = await call("GET", "/gamification/leaderboard?scope=group&metric=xp", sA2.token);
    check("group leaderboards are per group (cache key is per resolved scope, not shared)", names(g1).join() === "Alice One" && names(g2).join() === "Alice Two", `${names(g1)} | ${names(g2)}`);

    // ---- staff passing another institute's identifiers
    const fgrp = await call("GET", `/gamification/leaderboard?scope=group&metric=xp&academicGroupId=${gB.id}`, stfA.token);
    check("staff of institute A cannot read institute B's group by passing its academicGroupId", fgrp.status === 200 && names(fgrp).length === 0, JSON.stringify(names(fgrp)));
    const finst = await call("GET", `/gamification/leaderboard?scope=institute&metric=xp&instituteId=${B.id}`, stfA.token);
    check("staff of institute A asking for institute B's leaderboard gets institute A", finst.status === 200 && names(finst).includes("Alice One") && !names(finst).includes("Bob Other"), JSON.stringify(names(finst)));
    const fdep = await call("GET", "/gamification/leaderboard?scope=department&metric=xp&department=ZZ%20Shared%20Dept", stfA.token);
    check("staff department leaderboard is limited to their institute", fdep.status === 200 && !names(fdep).includes("Bob Other") && names(fdep).includes("Alice One"), JSON.stringify(names(fdep)));
    const pInst = await call("GET", `/gamification/leaderboard?scope=institute&metric=xp&instituteId=${B.id}`, plat.token);
    check("a platform-level admin can still choose any institute", pInst.status === 200 && names(pInst).join() === "Bob Other", JSON.stringify(names(pInst)));

    // ---- "overall" scope no longer spans institutes
    const ovA = await call("GET", "/gamification/leaderboard?scope=overall&metric=xp", sA1.token);
    check("overall leaderboard for a student contains only their own institute", ovA.status === 200 && names(ovA).includes("Alice One") && !names(ovA).includes("Bob Other"), JSON.stringify(names(ovA)));
    const ovS = await call("GET", "/gamification/leaderboard?scope=overall&metric=xp", stfA.token);
    check("overall leaderboard for institute staff is limited to their institute", ovS.status === 200 && !names(ovS).includes("Bob Other"), JSON.stringify(names(ovS)));
    const ovP = await call("GET", "/gamification/leaderboard?scope=overall&metric=xp", plat.token);
    check("a platform-level admin still gets the platform-wide list", ovP.status === 200 && names(ovP).includes("Bob Other") && names(ovP).includes("Alice One"));
    const iov = await call("GET", "/interview/leaderboard?scope=overall", sA1.token);
    check("the interview leaderboard 'overall' is limited to the student's institute", iov.status === 200 && !JSON.stringify(iov.body).includes("Bob Other"));

    // ---- public verification endpoints are rate limited per IP
    // one shared per-IP budget across all public verification endpoints: the first path is driven to its limit, the rest then share it
    let limited = false, first = 0;
    for (let i = 0; i < 45; i++) { const r = await call("GET", "/certificates/verify/CA-ZZ-NOPE"); if (i === 0) first = r.status; if (r.status === 429) { limited = true; break; } }
    check("public certificate verification answers normally, then is rate limited per IP", first !== 429 && limited);
    for (const path of ["/results/verify/ZZ-NOPE", "/interview/certificate/verify/ZZ-NOPE", "/learning/certificate/verify/ZZ-NOPE"]) {
      check(`the same budget protects ${path.split("/").slice(0, 3).join("/")}`, (await call("GET", path)).status === 429);
    }
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nTENANT ISOLATION (audit fixes) VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
