// Regression coverage for utils/readinessBlueprint.js's near-duplicate filtering, added 2026-09-23
// during a Readiness Tests audit: buildAssessmentBlueprint already prevented the SAME Question row
// from being picked twice within one assessment, but two DIFFERENT rows that are the same question
// reworded (the exact case utils/textSimilarity.js exists to catch — see its own header comment
// about "Java File Extension" appearing twice) were still both eligible and could both land in one
// student's blueprint. Uses real, disposable Prisma data (no in-process app to boot — see
// learningCourses.integration.test.js's header comment for why this codebase's tests hit either a
// live server or, as here, the real DB directly) rather than mocking Prisma.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/prisma");
const { buildAssessmentBlueprint } = require("../src/utils/readinessBlueprint");

const SUBJECT_NAME = `Regression Blueprint Subject ${Date.now()}`;

let dbReachable = false;
test.before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

test.after(async () => {
  await prisma.$disconnect();
});

test("buildAssessmentBlueprint never includes two near-duplicate questions in the same assessment", async (t) => {
  if (!dbReachable) return t.skip("no live database reachable");
  let subjectId, q1Id, q2Id, q3Id;
  try {
    const subject = await prisma.readinessSubject.create({
      data: {
        name: SUBJECT_NAME,
        instituteId: null,
        topics: [{ name: "DSA", subtopics: [] }],
        questionTypesAllowed: ["MCQ"],
        defaultBtlDistribution: { "3": 100 },
        assessmentModes: [{ key: "TEST", label: "Test", btlMin: 3, btlMax: 3 }],
        readinessThresholds: [{ label: "JOB_READY", min: 75 }, { label: "FOUNDATION_REQUIRED", min: 0 }],
      },
    });
    subjectId = subject.id;

    // Q1 and Q2 share the exact same title (checkNearDuplicate's conclusive "identical title"
    // path) but different bodies -- exactly the reworded-duplicate shape this fix targets. Q3 is
    // genuinely distinct and must always be includable.
    const dup1 = await prisma.question.create({
      data: {
        title: "Two Sum Problem", description: "Given an array of integers, return the indices of the two numbers that add up to a target value.",
        subject: SUBJECT_NAME, topic: "Arrays", btlLevel: 3, questionType: "MCQ", questionStatus: "PUBLISHED", instituteId: null,
      },
    });
    q1Id = dup1.id;
    const dup2 = await prisma.question.create({
      data: {
        title: "Two Sum Problem", description: "You are given a list of numbers; find two entries whose sum equals a given value and return their positions.",
        subject: SUBJECT_NAME, topic: "Arrays", btlLevel: 3, questionType: "MCQ", questionStatus: "PUBLISHED", instituteId: null,
      },
    });
    q2Id = dup2.id;
    const distinct = await prisma.question.create({
      data: {
        title: "Reverse a Linked List", description: "Write a function that reverses a singly linked list in place and returns the new head.",
        subject: SUBJECT_NAME, topic: "Linked List", btlLevel: 3, questionType: "MCQ", questionStatus: "PUBLISHED", instituteId: null,
      },
    });
    q3Id = distinct.id;

    const { items, shortfallLevels } = await buildAssessmentBlueprint({
      subject, assessmentMode: "TEST", questionCount: 3, studentInstituteId: null, excludeStudentId: null,
    });

    const pickedIds = items.map((q) => q.id);
    assert.ok(!(pickedIds.includes(q1Id) && pickedIds.includes(q2Id)), "the two near-duplicate questions (identical title) must never both appear in one assessment");
    assert.ok(pickedIds.includes(q1Id) || pickedIds.includes(q2Id), "one of the two near-duplicate questions should still be usable");
    assert.ok(pickedIds.includes(q3Id), "the genuinely distinct question must be included");
    // Only 2 of the 3 eligible questions are usable together (the duplicate pair collapses to 1),
    // so a target of 3 must honestly report a shortfall rather than silently returning fewer than
    // requested with no signal.
    assert.deepEqual(shortfallLevels, ["3"], "requesting 3 when only 2 non-duplicate questions exist must report a shortfall");
  } finally {
    if (q1Id) await prisma.question.delete({ where: { id: q1Id } }).catch(() => {});
    if (q2Id) await prisma.question.delete({ where: { id: q2Id } }).catch(() => {});
    if (q3Id) await prisma.question.delete({ where: { id: q3Id } }).catch(() => {});
    if (subjectId) await prisma.readinessSubject.delete({ where: { id: subjectId } }).catch(() => {});
  }
});

test("buildAssessmentBlueprint fills the full count when questions are genuinely distinct", async (t) => {
  if (!dbReachable) return t.skip("no live database reachable");
  let subjectId, q1Id, q2Id;
  try {
    const subject = await prisma.readinessSubject.create({
      data: {
        name: `${SUBJECT_NAME} distinct`,
        instituteId: null,
        topics: [{ name: "DSA", subtopics: [] }],
        questionTypesAllowed: ["MCQ"],
        defaultBtlDistribution: { "3": 100 },
        assessmentModes: [{ key: "TEST", label: "Test", btlMin: 3, btlMax: 3 }],
        readinessThresholds: [{ label: "JOB_READY", min: 75 }, { label: "FOUNDATION_REQUIRED", min: 0 }],
      },
    });
    subjectId = subject.id;

    const q1 = await prisma.question.create({
      data: {
        title: "Binary Search", description: "Implement binary search over a sorted array and return the index of the target, or -1.",
        subject: `${SUBJECT_NAME} distinct`, topic: "Searching", btlLevel: 3, questionType: "MCQ", questionStatus: "PUBLISHED", instituteId: null,
      },
    });
    q1Id = q1.id;
    const q2 = await prisma.question.create({
      data: {
        title: "Merge Sort", description: "Implement merge sort and analyze its time complexity.",
        subject: `${SUBJECT_NAME} distinct`, topic: "Sorting", btlLevel: 3, questionType: "MCQ", questionStatus: "PUBLISHED", instituteId: null,
      },
    });
    q2Id = q2.id;

    const { items, shortfallLevels } = await buildAssessmentBlueprint({
      subject, assessmentMode: "TEST", questionCount: 2, studentInstituteId: null, excludeStudentId: null,
    });

    assert.equal(items.length, 2, "two genuinely distinct questions must both be included when the target is 2");
    assert.deepEqual(shortfallLevels, [], "no shortfall should be reported when the pool fully covers the target");
  } finally {
    if (q1Id) await prisma.question.delete({ where: { id: q1Id } }).catch(() => {});
    if (q2Id) await prisma.question.delete({ where: { id: q2Id } }).catch(() => {});
    if (subjectId) await prisma.readinessSubject.delete({ where: { id: subjectId } }).catch(() => {});
  }
});
