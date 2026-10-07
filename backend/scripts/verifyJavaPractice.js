// End-to-end verification of the JAVA Practice track against the live API on this instance.
// Disposable data only (@example.invalid users, a throwaway academic group, a temporary course assignment to that group and a
// temporary Level 1 question); everything is removed or restored afterwards. Never prints credentials.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json, ms: Date.now() - t0 };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

const SOLUTIONS = {
  "Hello, Java": 'public class Main { public static void main(String[] a) { System.out.println("Hello, Java!"); } }',
  "Sum of Two Numbers": "import java.util.*; public class Main { public static void main(String[] a) { Scanner s = new Scanner(System.in); long x = s.nextLong(), y = s.nextLong(); System.out.println(x + y); } }",
  "Rectangle Area and Perimeter": "import java.util.*; public class Main { public static void main(String[] a) { Scanner s = new Scanner(System.in); long l = s.nextLong(), b = s.nextLong(); System.out.println(l * b + \" \" + 2 * (l + b)); } }",
};

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-jp-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { batch: "ZZ-VERIFY-JP" } });
}

(async () => {
  await cleanup();
  const course = await prisma.course.findUnique({ where: { slug: "java-practice" } });
  if (!course) throw new Error("java-practice course missing -- run seedJavaPractice.js first");
  const groups = await prisma.academicGroup.findMany({ where: { isActive: true } });
  const off = await prisma.featureSetting.findMany({ where: { featureKey: { in: ["lms", "compiler"] }, enabled: false } });
  const offIds = new Set(off.map((f) => f.instituteId));
  const real = groups.find((g) => !offIds.has(g.instituteId));
  const other = groups.find((g) => g.instituteId !== real.instituteId && !offIds.has(g.instituteId)) || null;
  const { instituteId, departmentId } = real;
  const before = { attempts: await prisma.moduleCodingAttempt.count(), progress: await prisma.lessonProgress.count(), questions: await prisma.question.count() };

  const ts = Date.now();
  const grp = await prisma.academicGroup.create({ data: { instituteId, departmentId, batch: "ZZ-VERIFY-JP", section: `ZZ-${ts}` } });
  const grp2 = await prisma.academicGroup.create({ data: { instituteId, departmentId, batch: "ZZ-VERIFY-JP", section: `ZZ2-${ts}` } });
  const mk = async (name, role, group) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-jp-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId: (role === "STUDENT" && group === null) || role === "ADMIN" ? null : instituteId, academicGroupId: group?.id || null, mustChangePassword: false } }); return { ...u, pw }; };
  const s1 = await mk("Student One", "STUDENT", grp);
  const s2 = await mk("Student Two", "STUDENT", grp);
  const outsider = await mk("Outsider", "STUDENT", grp2);   // same institute, group NOT assigned to the course
  const admin = await mk("Admin", "ADMIN", null);               // platform-level admin (owns global courses)
  const instAdmin = await mk("Inst Admin", "INSTITUTE_ADMIN", null); // scoped to one institute
  await prisma.courseAcademicGroupAssignment.create({ data: { courseId: course.id, academicGroupId: grp.id, assignedByUserId: admin.id, assignedByName: admin.name } });
  // The outsider belongs to the same institute; make sure the institute itself has no assignment to this course.
  const instAssigned = await prisma.courseInstituteAssignment.count({ where: { courseId: course.id, instituteId } });
  let tempQuestionId = null, level1Id = null, level1WasActive = null;

  try {
    const TI = await login(instAdmin.email, instAdmin.pw);
    const T1 = await login(s1.email, s1.pw), T2 = await login(s2.email, s2.pw), TO = await login(outsider.email, outsider.pw), TA = await login(admin.email, admin.pw);

    // ---- structure + visibility
    const home = await call("GET", "/practice/java-practice", T1);
    check("course home loads with 7 sections", home.status === 200 && home.body.sections.length === 7, `${home.status} ${home.ms}ms`);
    check("Basic Java is first and has 11 topics", home.body.sections[0].title === "Basic Java" && home.body.sections[0].topicCount === 11);
    check("Continue points at the first available level", !!home.body.resume?.levelId);
    const basic = home.body.sections[0];
    const sec = await call("GET", `/practice/java-practice/sections/${basic.id}`, T1);
    check("section lists 11 topics with durations", sec.body.topics.length === 11 && sec.body.topics[0].durationLabel === "13:48 hrs");
    check("later topics are locked (sequential) with a reason", sec.body.topics[1].locked && /Pass every level/.test(sec.body.topics[1].lockReason || ""));
    const topic0 = sec.body.topics[0];
    const top = await call("GET", `/practice/java-practice/topics/${topic0.id}`, T1);
    check("Draft levels are hidden: topic shows only the published Level 0", top.body.topic.levels.length === 1 && /Level 0/.test(top.body.topic.levels[0].title), JSON.stringify(top.body.topic.levels.map((l) => l.title)));
    const lvl0 = top.body.topic.levels[0];
    check("Level 0 is AVAILABLE for a fresh student", lvl0.status === "AVAILABLE" && lvl0.startable);

    // ---- institute isolation / IDOR
    const oHome = await call("GET", "/practice/java-practice", TO);
    check("unassigned student cannot load the course (404)", oHome.status === 404);
    const oLevel = await call("GET", `/module-coding/level/${lvl0.id}`, TO);
    check("unassigned student cannot read a level by id", oLevel.body?.exists === false, JSON.stringify(oLevel.body).slice(0, 80));
    const oStart = await call("POST", `/module-coding/level/${lvl0.id}/start`, TO);
    check("unassigned student cannot start a level by id", oStart.status === 404, String(oStart.status));
    check("unassigned student cannot read a topic by id", (await call("GET", `/practice/java-practice/topics/${topic0.id}`, TO)).status === 404);
    if (other) {
      const foreign = await mk("Foreign", "STUDENT", null); // no institute at all
      check("student with no institute/group sees nothing", (await call("GET", "/practice/java-practice", await login(foreign.email, foreign.pw))).status === 404);
    }

    // ---- instructions + config
    const cfg = await call("GET", `/module-coding/level/${lvl0.id}`, T1);
    check("instructions screen data: instructions, duration, attempts", cfg.body.exists && /up to 5 attempts/.test(cfg.body.test.instructions) && cfg.body.test.timeLimitMin === 90 && cfg.body.test.maxAttempts === 5);
    check("level response has practice context (back link)", cfg.body.practice?.chapterId === topic0.id);
    const staffStart = await call("POST", `/module-coding/level/${lvl0.id}/start`, TA);
    check("staff/admin cannot start a student attempt", staffStart.status === 403, String(staffStart.status));

    // ---- take the test
    const start = await call("POST", `/module-coding/level/${lvl0.id}/start`, T1);
    check("student starts Level 0", start.status === 200 && start.body.questions?.length === 3, `${start.status} ${start.ms}ms`);
    const leak = JSON.stringify(start.body);
    check("no hidden test cases in the start response", !/"isHidden":true/.test(leak) && !/100000 200000/.test(leak) && !/-5 -7/.test(leak) && !/"hiddenTestCases"/.test(leak));
    const attemptId = start.body.attemptId;
    const resume = await call("POST", `/module-coding/level/${lvl0.id}/start`, T1);
    check("second start resumes the same attempt (no duplicate)", resume.body.attemptId === attemptId);
    for (const lang of ["java", "python", "c", "cpp"]) {
      const code = { java: SOLUTIONS["Hello, Java"], python: "print('Hello, Java!')", c: `#include <stdio.h>
int main(){puts("Hello, Java!");return 0;}`, cpp: `#include <iostream>
int main(){std::cout<<"Hello, Java!"<<std::endl;return 0;}` }[lang];
      const rr = await call("POST", `/module-coding/attempts/${attemptId}/run`, T1, { questionId: start.body.questions.find((q) => q.title === "Hello, Java").id, language: lang, code });
      check(`Run executes sample cases in ${lang}`, rr.status === 200 && rr.body?.verdict === "ACCEPTED", `${rr.status} ${rr.body?.verdict || rr.body?.error} ${rr.ms}ms`);
    }
    check("Continue now says IN_PROGRESS", (await call("GET", "/practice/java-practice", T1)).body.resume.reason === "IN_PROGRESS");
    check("another student cannot touch this attempt", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T2, { questionId: start.body.questions[0].id, language: "java", code: "x" })).status >= 400);
    for (const q of start.body.questions) {
      const code = SOLUTIONS[q.title];
      const r = await call("POST", `/module-coding/attempts/${attemptId}/submit-code`, T1, { questionId: q.id, language: "java", code });
      check(`Java solution accepted: ${q.title}`, r.status === 200 && r.body?.verdict === "ACCEPTED", `${r.status} ${r.body?.verdict} ${r.ms}ms`);
    }
    const fin = await call("POST", `/module-coding/attempts/${attemptId}/finalize`, T1, { reason: "manual" });
    check("finalize grades the attempt as passed", fin.status === 200 && fin.body?.passed === true, JSON.stringify({ s: fin.status, passed: fin.body?.passed, score: fin.body?.score }));
    const again = await call("POST", `/module-coding/level/${lvl0.id}/start`, T1);
    check("cannot retake a passed level", again.status === 403, String(again.status));

    // ---- progress + unlocking
    const after = await call("GET", `/practice/java-practice/topics/${topic0.id}?after=${lvl0.id}`, T1);
    check("topic shows Level 0 PASSED and 100% (only live level)", after.body.topic.levels[0].status === "PASSED" && after.body.topic.progress === 100 && after.body.topic.status === "COMPLETED");
    const home2 = await call("GET", "/practice/java-practice", T1);
    check("course progress reflects the pass", home2.body.overall.passedCount === 1 && home2.body.overall.progress === 100 && home2.body.sections[0].progress === 100);
    const sec2 = await call("GET", `/practice/java-practice/sections/${basic.id}`, T1);
    check("next topic unlocks once the previous topic is fully passed", sec2.body.topics[1].locked === false);

    // Level 1: publish a temporary level-1 question + the level, then check PASS_PREVIOUS locking per student.
    level1Id = (await prisma.moduleCodingTest.findFirst({ where: { chapterId: topic0.id, order: 1 } })).id;
    level1WasActive = (await prisma.moduleCodingTest.findUnique({ where: { id: level1Id } })).isActive;
    const mkq = await call("POST", `/module-coding/admin/tests/${level1Id}/questions`, TA, { title: "ZZ Echo Temp", description: "Print the integer read.", testCases: [...Array(2).fill(0).map((_, i) => ({ input: String(i), expected: String(i), isHidden: false })), ...Array(5).fill(0).map((_, i) => ({ input: String(i + 9), expected: String(i + 9), isHidden: true }))] });
    tempQuestionId = mkq.body?.id;
    const iaq = await call("POST", `/module-coding/admin/tests/${level1Id}/questions`, TI, { title: "x", description: "x", testCases: [] });
    check("institute admin cannot edit a GLOBAL course's level (403)", iaq.status === 403, String(iaq.status));
    check("admin can add a Level 1 question (starts Draft)", !!tempQuestionId && mkq.body.questionStatus === "DRAFT");
    // validation of publish: a Draft question inside a Draft level stays hidden
    check("Level 1 stays hidden while Draft", (await call("GET", `/practice/java-practice/topics/${topic0.id}`, T2)).body.topic.levels.length === 1);
    await call("POST", `/learning/publish/question/${tempQuestionId}/publish`, TA);
    await call("POST", `/learning/publish/level/${level1Id}/publish`, TA);
    const t2 = await call("GET", `/practice/java-practice/topics/${topic0.id}`, T2);
    const l1s2 = t2.body.topic.levels.find((l) => l.id === level1Id);
    check("student who has NOT passed Level 0 sees Level 1 LOCKED with a reason", l1s2?.status === "LOCKED" && /Pass/.test(l1s2.lockReason || ""), JSON.stringify(l1s2 && { s: l1s2.status, r: l1s2.lockReason }));
    const lockedStart = await call("POST", `/module-coding/level/${level1Id}/start`, T2);
    check("locked level cannot be started by API", lockedStart.status === 403 && /Pass/.test(lockedStart.body?.error || ""), `${lockedStart.status} ${lockedStart.body?.error}`);
    const t1 = await call("GET", `/practice/java-practice/topics/${topic0.id}`, T1);
    const l1s1 = t1.body.topic.levels.find((l) => l.id === level1Id);
    check("student who PASSED Level 0 sees Level 1 AVAILABLE", l1s1?.status === "AVAILABLE" && l1s1.startable);
    check("topic progress drops to 50% when a new level is published", t1.body.topic.progress === 50);
    const unlocked = await call("POST", `/module-coding/level/${level1Id}/start`, T1);
    check("Level 1 starts for the student who unlocked it", unlocked.status === 200);
    await call("POST", `/module-coding/attempts/${unlocked.body.attemptId}/finalize`, T1, { reason: "manual" });

    // ---- attempt limit + staff reset
    const s2start = await call("POST", `/module-coding/level/${lvl0.id}/start`, T2);
    const s2fin = await call("POST", `/module-coding/attempts/${s2start.body.attemptId}/finalize`, T2, { reason: "manual" });
    check("student two fails with no answers", s2fin.status === 200 && s2fin.body?.passed === false);
    for (let n = 2; n <= 5; n++) {
      const again2 = await call("POST", `/module-coding/level/${lvl0.id}/start`, T2);
      if (again2.status !== 200) check(`attempt ${n} of 5 is allowed`, false, String(again2.status));
      else await call("POST", `/module-coding/attempts/${again2.body.attemptId}/finalize`, T2, { reason: "manual" });
    }
    const s2retry = await call("POST", `/module-coding/level/${lvl0.id}/start`, T2);
    check("attempt limit (5) enforced server-side: 6th start refused", s2retry.status === 403 && /attempts/i.test(s2retry.body?.error || ""), `${s2retry.status} ${s2retry.body?.error}`);
    const reset = await call("DELETE", `/module-coding/admin/tests/${lvl0.id}/students/${s2.id}/attempts`, TA, { reason: "verification reset" });
    const audited = await prisma.auditLog.count({ where: { action: "REATTEMPT_GRANTED", studentId: s2.id } });
    check("staff reset restores the attempt and is audited", reset.status === 200 && audited >= 1, `${reset.status} audit=${audited}`);
    check("student can start again after reset", (await call("POST", `/module-coding/level/${lvl0.id}/start`, T2)).status === 200);

    // ---- analytics + RBAC
    const an = await call("GET", "/practice/java-practice/analytics", TA);
    const row = an.body?.levels?.find((r) => r.levelId === lvl0.id);
    check("analytics: real per-level numbers", an.status === 200 && row && row.started >= 2 && row.passed >= 1, JSON.stringify(row && { started: row.started, passed: row.passed, passRate: row.passRate }));
    check("students cannot read analytics", (await call("GET", "/practice/java-practice/analytics", T1)).status === 403);
    check("students cannot call publish endpoints", (await call("POST", `/learning/publish/level/${level1Id}/unpublish`, T1)).status === 403);
    check("practice course does not leak into other tracks' lesson routes", (await call("GET", "/practice/java", T1)).status === 404);
  } finally {
    // restore everything we touched
    if (level1Id) await prisma.moduleCodingTest.update({ where: { id: level1Id }, data: { isActive: !!level1WasActive } }).catch(() => {});
    if (tempQuestionId) await prisma.question.delete({ where: { id: tempQuestionId } }).catch((e) => console.log("cleanup q:", e.message));
    await prisma.courseAcademicGroupAssignment.deleteMany({ where: { courseId: course.id, academicGroupId: grp.id } });
    await cleanup();
  }
  const after = { attempts: await prisma.moduleCodingAttempt.count(), progress: await prisma.lessonProgress.count(), questions: await prisma.question.count() };
  check("no pre-existing data changed (attempt/progress/question counts)", after.attempts === before.attempts && after.progress >= before.progress && after.questions === before.questions, JSON.stringify({ before, after }));
  check("course left unassigned to the institute as before", (await prisma.courseInstituteAssignment.count({ where: { courseId: course.id, instituteId } })) === instAssigned);
  console.log(failures === 0 ? "\nJAVA PRACTICE VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
