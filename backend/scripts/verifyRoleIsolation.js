// Live cross-institute / cross-role isolation probe. Creates disposable CLERK, STAFF, INSTITUTE_ADMIN
// (each attached to institute A) and a STUDENT, then tries to read/modify resources that belong to a
// DIFFERENT institute (B) and to use endpoints above each role's privilege. Anything other than a
// 401/403/404 (or an empty/own-institute-only result for lists) is reported as a leak.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
let fails = 0;
const check = (l, ok, x = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  -> " + x : ""}`); };
const denied = (s) => s === 401 || s === 403 || s === 404;

(async () => {
  const insts = await prisma.institute.findMany({ where: { isActive: true }, take: 5 });
  if (insts.length < 2) { console.log("Need >=2 institutes for this probe; found", insts.length); process.exit(0); }
  // A = institute of the actors, B = a different institute that owns the target resources.
  const examB = await prisma.resultExamination.findFirst({ where: { NOT: { instituteId: insts[0].id } } });
  let A = insts[0], B = examB ? insts.find((i) => i.id === examB.instituteId) : insts[1];
  if (!B || B.id === A.id) B = insts[1];
  const testB = await prisma.test.findFirst({ where: { instituteId: B.id } });
  const studentB = await prisma.user.findFirst({ where: { role: "STUDENT", instituteId: B.id } });
  const subjectB = await prisma.readinessSubject.findFirst({ where: { instituteId: B.id } });
  const examB2 = await prisma.resultExamination.findFirst({ where: { instituteId: B.id } });
  console.log(`Actors in "${A.name}"; targets in "${B.name}" (exam=${!!examB2} test=${!!testB} student=${!!studentB} readinessSubject=${!!subjectB})`);

  const made = [];
  const mk = async (role) => {
    const email = `verify-iso-${role.toLowerCase()}-${Date.now()}@example.invalid`;
    const pw = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name: `Verify ${role}`, email, passwordHash: await bcrypt.hash(pw, 6), role, instituteId: A.id, mustChangePassword: false } });
    made.push(u.id);
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json();
    return { u, h: { Authorization: `Bearer ${l.token}`, "Content-Type": "application/json" } };
  };
  const req = async (a, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: a.h, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  try {
    const clerk = await mk("CLERK"), staff = await mk("STAFF"), iadmin = await mk("INSTITUTE_ADMIN"), student = await mk("STUDENT");

    for (const [name, actor] of [["CLERK", clerk], ["STAFF", staff], ["INSTITUTE_ADMIN", iadmin]]) {
      if (examB2) {
        const r1 = await req(actor, "GET", `/results/admin/examinations/${examB2.id}`);
        check(`${name}: other-institute result exam read denied`, denied(r1.status), String(r1.status));
        const r2 = await req(actor, "GET", `/results/admin/examinations/${examB2.id}/entries`);
        check(`${name}: other-institute result entries denied`, denied(r2.status), String(r2.status));
        const r3 = await req(actor, "POST", `/results/admin/examinations/${examB2.id}/entries`, { studentId: studentB?.id, obtainedMarks: 1, status: "PRESENT" });
        check(`${name}: cannot write marks into other institute's exam`, denied(r3.status) || r3.status === 400, String(r3.status));
      }
      if (testB) {
        const r4 = await req(actor, "GET", `/tests/${testB.id}/results`);
        check(`${name}: other-institute test results denied`, denied(r4.status), String(r4.status));
        const r5 = await req(actor, "GET", `/tests/${testB.id}/results/export`);
        check(`${name}: other-institute results export denied`, denied(r5.status), String(r5.status));
      }
      if (studentB) {
        const r6 = await req(actor, "GET", `/users/${studentB.id}/performance`);
        check(`${name}: other-institute student performance denied`, denied(r6.status), String(r6.status));
        const r7 = await req(actor, "GET", `/profile/${studentB.id}`);
        check(`${name}: other-institute student profile denied`, denied(r7.status), String(r7.status));
      }
      const users = await req(actor, "GET", "/users");
      const leaked = Array.isArray(users.body) ? users.body.filter((u) => u.instituteId && u.instituteId !== A.id).length : (users.body?.users || []).filter((u) => u.instituteId && u.instituteId !== A.id).length;
      check(`${name}: GET /users never lists other institutes' users`, denied(users.status) || leaked === 0, `status ${users.status}, foreign=${leaked}`);
    }

    // Privilege ceilings
    const up = (a, m, p, b) => req(a, m, p, b);
    check("CLERK cannot create users", denied((await up(clerk, "POST", "/users", { name: "x", email: "x@example.invalid", role: "STUDENT" })).status));
    check("CLERK cannot delete users", denied((await up(clerk, "DELETE", `/users/${student.u.id}`)).status));
    check("STAFF cannot create INSTITUTE_ADMIN", denied((await up(staff, "POST", "/users", { name: "x", email: `x${Date.now()}@example.invalid`, role: "INSTITUTE_ADMIN", instituteId: A.id })).status));
    check("STUDENT cannot read admin analytics", denied((await up(student, "GET", "/admin/analytics")).status));
    check("STUDENT cannot export results", denied((await up(student, "GET", testB ? `/tests/${testB.id}/results/export` : "/tests/x/results/export")).status));
    check("STUDENT cannot list Staff/Clerk accounts", denied((await up(student, "GET", "/staff-clerk")).status));
    check("STAFF cannot reach Staff/Clerk management", denied((await up(staff, "GET", "/staff-clerk")).status));
    check("CLERK cannot reach platform health", denied((await up(clerk, "GET", "/platform-health")).status));
    check("INSTITUTE_ADMIN cannot reach platform health (SUPER_ADMIN only)", denied((await up(iadmin, "GET", "/platform-health")).status));
    check("INSTITUTE_ADMIN cannot create a SUPER_ADMIN", ((s) => s === 400 || denied(s))((await up(iadmin, "POST", "/users", { name: "x", email: `s${Date.now()}@example.invalid`, role: "SUPER_ADMIN" })).status));
    check("INSTITUTE_ADMIN cannot create user in another institute", (await up(iadmin, "POST", "/users", { name: "x", email: `y${Date.now()}@example.invalid`, role: "STUDENT", instituteId: B.id })).status !== 201);
    if (subjectB) check("STAFF cannot edit another institute's readiness subject", denied((await up(staff, "PATCH", `/readiness/admin/subjects/${subjectB.id}`, { description: "pwn" })).status));
    const probe = await prisma.user.findFirst({ where: { email: { startsWith: "x" }, role: { in: ["STUDENT", "INSTITUTE_ADMIN", "SUPER_ADMIN"] } }, select: { id: true, email: true } });
    // Defensive cleanup if any of the "must be denied" creates unexpectedly succeeded
    await prisma.user.deleteMany({ where: { email: { endsWith: "@example.invalid" }, OR: [{ email: { startsWith: "x" } }, { email: { startsWith: "y" } }, { email: { startsWith: "s1" } }] } }).catch(() => {});
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: { in: made } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made } } }).catch((e) => console.log("cleanup:", e.message));
  }
  console.log(fails ? `\n${fails} ISOLATION PROBLEM(S)` : "\nALL ISOLATION CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.stack || e); process.exit(1); });
