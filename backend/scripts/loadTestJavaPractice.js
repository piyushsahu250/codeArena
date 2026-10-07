// Synthetic "whole class opens the same level at once" load test for JAVA Practice, against the live API on this host.
// N disposable students (throwaway group temporarily assigned to the course): concurrent login -> course home -> topic ->
// start Level 0 -> autosave -> submit one Java solution -> finalize, all at the same time. Reports latency percentiles and
// error counts per step, then removes everything. Usage: N=100 node scripts/loadTestJavaPractice.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
const N = Number(process.env.N || 50);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const HELLO = 'public class Main { public static void main(String[] a) { System.out.println("Hello, Java!"); } }';

(async () => {
  const course = await prisma.course.findUnique({ where: { slug: "java-practice" } });
  const groups = await prisma.academicGroup.findMany({ where: { isActive: true } });
  const real = groups[0];
  const stamp = Date.now();
  const grp = await prisma.academicGroup.create({ data: { instituteId: real.instituteId, departmentId: real.departmentId, batch: "ZZ-VERIFY-JP", section: `LOAD-${stamp}` } });
  const pw = crypto.randomBytes(18).toString("base64url");
  const hash = await bcrypt.hash(pw, 4); // throwaway credential; login latency is not what is measured here
  const admin = await prisma.user.create({ data: { name: "Load Admin", email: `verify-jp-load-admin-${stamp}@example.invalid`, passwordHash: hash, role: "ADMIN", mustChangePassword: false } });
  await prisma.courseAcademicGroupAssignment.create({ data: { courseId: course.id, academicGroupId: grp.id, assignedByUserId: admin.id, assignedByName: admin.name } });
  await prisma.user.createMany({ data: Array.from({ length: N }, (_, i) => ({ name: `Load ${i}`, email: `verify-jp-load-${stamp}-${i}@example.invalid`, passwordHash: hash, role: "STUDENT", instituteId: real.instituteId, academicGroupId: grp.id, mustChangePassword: false })) });
  const users = await prisma.user.findMany({ where: { email: { startsWith: `verify-jp-load-${stamp}-` } }, select: { id: true, email: true } });
  const lat = {}; const errs = {};
  const timed = async (name, fn) => { const t = Date.now(); let r; try { r = await fn(); } catch (e) { r = { status: 0 }; } (lat[name] ||= []).push(Date.now() - t); if (!(r.status >= 200 && r.status < 300)) errs[name] = (errs[name] || 0) + 1; return r; };
  const call = async (token, method, path, body) => { const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await res.json(); } catch {} return { status: res.status, body: b }; };
  try {
    const wall0 = Date.now();
    const tokens = await Promise.all(users.map(async (u) => (await timed("login", async () => { const r = await call(null, "POST", "/auth/login", { email: u.email, password: pw }); return r; })).body?.token));
    const homes = await Promise.all(tokens.map((t) => timed("course home", () => call(t, "GET", "/practice/java-practice"))));
    const sec = homes[0].body.sections[0];
    const secR = await call(tokens[0], "GET", `/practice/java-practice/sections/${sec.id}`);
    const topicId = secR.body.topics[0].id;
    const topics = await Promise.all(tokens.map((t) => timed("topic + levels", () => call(t, "GET", `/practice/java-practice/topics/${topicId}`))));
    const levelId = topics[0].body.topic.levels[0].id;
    const starts = await Promise.all(tokens.map((t) => timed("start level (create attempt)", () => call(t, "POST", `/module-coding/level/${levelId}/start`))));
    await Promise.all(tokens.map((t, i) => timed("autosave", () => call(t, "POST", `/module-coding/attempts/${starts[i].body.attemptId}/autosave`, { questionId: starts[i].body.questions[0].id, language: "java", code: HELLO, seq: Date.now() }))));
    await Promise.all(tokens.map((t, i) => timed("submit one Java solution", () => call(t, "POST", `/module-coding/attempts/${starts[i].body.attemptId}/submit-code`, { questionId: starts[i].body.questions[0].id, language: "java", code: HELLO }))));
    const fins = await Promise.all(tokens.map((t, i) => timed("finalize + grade", () => call(t, "POST", `/module-coding/attempts/${starts[i].body.attemptId}/finalize`, { reason: "manual" }))));
    const graded = fins.filter((f) => f.status === 200 && typeof f.body?.score === "number").length;
    const rows = await prisma.moduleCodingAttempt.count({ where: { studentId: { in: users.map((u) => u.id) }, status: { not: "IN_PROGRESS" } } });
    console.log(`N=${N}  wall=${((Date.now() - wall0) / 1000).toFixed(1)}s  finalized-in-db=${rows}/${N}  graded-responses=${graded}/${N}`);
    for (const [k, v] of Object.entries(lat)) console.log(`  ${k.padEnd(30)} p50=${pct(v, 50)}ms p95=${pct(v, 95)}ms max=${Math.max(...v)}ms  errors=${errs[k] || 0}`);
  } finally {
    await prisma.courseAcademicGroupAssignment.deleteMany({ where: { academicGroupId: grp.id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "verify-jp-load-" } } });
    await prisma.academicGroup.deleteMany({ where: { id: grp.id } });
  }
  process.exit(0);
})().catch(async (e) => { console.error(e); await prisma.user.deleteMany({ where: { email: { startsWith: "verify-jp-load-" } } }).catch(() => {}); process.exit(1); });
