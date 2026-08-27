// READ-ONLY impact report — spec section 25: "Before changing progression logic: audit existing
// student progress... first create a read-only report." Makes NO writes at all. For every course
// with at least one active Coding Assessment/Level, finds every student who has completed a
// module's lessons but has NOT passed that module's required Coding Assessment, where that module
// is not the last one in the course (i.e., a real "next module" exists whose access changes under
// the corrected rule). This is exactly the population whose modules-after-this-one flip from
// "unlocked" (old, buggy) to "locked" (new, correct) once the fix is live.
const prisma = require("../src/prisma");

async function main() {
  const courses = await prisma.course.findMany({
    select: {
      id: true, name: true, slug: true,
      modules: {
        orderBy: { order: "asc" },
        select: {
          id: true, title: true, order: true,
          lessons: { select: { id: true } },
          codingTest: { select: { id: true, isActive: true, passingPercent: true } },
          chapters: { select: { levels: { select: { id: true, isActive: true, passingPercent: true } } } },
        },
      },
    },
  });

  let totalAffectedStudents = 0;
  const perCourse = [];

  for (const course of courses) {
    const gatingByModule = new Map(); // moduleId -> [testId,...]
    for (const m of course.modules) {
      const ids = [];
      if (m.codingTest?.isActive) ids.push(m.codingTest.id);
      for (const c of m.chapters) for (const l of c.levels) if (l.isActive) ids.push(l.id);
      gatingByModule.set(m.id, ids);
    }
    const anyGating = [...gatingByModule.values()].some((ids) => ids.length > 0);
    if (!anyGating) continue; // no coding assessment anywhere in this course -> behavior is identical old vs new

    // Only modules that are NOT last (i.e. there's a real "next module" whose lock state changes).
    const modulesWithSuccessor = course.modules.slice(0, -1).filter((m) => (gatingByModule.get(m.id) || []).length > 0);
    if (modulesWithSuccessor.length === 0) continue;

    const allTestIds = [...gatingByModule.values()].flat();
    const allLessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));

    // Students who have ANY LessonProgress or ModuleCodingAttempt touching this course — the
    // real, existing population this course could possibly affect (never a platform-wide scan).
    const candidateStudentIds = new Set();
    if (allLessonIds.length) {
      const rows = await prisma.lessonProgress.findMany({ where: { lessonId: { in: allLessonIds }, status: "COMPLETED" }, select: { studentId: true } });
      rows.forEach((r) => candidateStudentIds.add(r.studentId));
    }

    let affectedThisCourse = 0;
    const affectedSamples = [];
    for (const studentId of candidateStudentIds) {
      const progress = await prisma.lessonProgress.findMany({ where: { studentId, lessonId: { in: allLessonIds }, status: "COMPLETED" }, select: { lessonId: true } });
      const completedSet = new Set(progress.map((p) => p.lessonId));
      const passedRows = allTestIds.length
        ? await prisma.moduleCodingAttempt.findMany({ where: { studentId, moduleCodingTestId: { in: allTestIds }, passed: true }, select: { moduleCodingTestId: true } })
        : [];
      const passedSet = new Set(passedRows.map((r) => r.moduleCodingTestId));

      let studentAffected = false;
      for (const m of modulesWithSuccessor) {
        const lessonsComplete = m.lessons.length > 0 && m.lessons.every((l) => completedSet.has(l.id));
        const testIds = gatingByModule.get(m.id) || [];
        const codingPassed = testIds.every((id) => passedSet.has(id));
        if (lessonsComplete && testIds.length > 0 && !codingPassed) { studentAffected = true; break; }
      }
      if (studentAffected) {
        affectedThisCourse++;
        if (affectedSamples.length < 5) affectedSamples.push(studentId);
      }
    }

    if (affectedThisCourse > 0) {
      totalAffectedStudents += affectedThisCourse;
      perCourse.push({ course: course.name, slug: course.slug, candidatesChecked: candidateStudentIds.size, affected: affectedThisCourse, sampleStudentIds: affectedSamples });
    }
  }

  console.log("=== READ-ONLY MODULE-UNLOCK IMPACT REPORT ===");
  console.log(`Courses with at least one active Coding Assessment: checked ${courses.length} course(s) total.`);
  if (perCourse.length === 0) {
    console.log("\nNo students currently have lesson-complete-but-assessment-not-passed on a module with a successor.");
    console.log("The fix changes behavior going forward with ZERO students newly locked out right now.");
  } else {
    for (const c of perCourse) {
      console.log(`\nCourse: ${c.course} (${c.slug})`);
      console.log(`  Students checked (touched this course): ${c.candidatesChecked}`);
      console.log(`  Students who will see a LATER module newly reported as locked: ${c.affected}`);
      console.log(`  Sample student id(s): ${c.sampleStudentIds.join(", ")}`);
    }
    console.log(`\nTOTAL students across all courses whose later-module access will change from "unlocked" to "locked": ${totalAffectedStudents}`);
    console.log("These students' underlying data (LessonProgress, ModuleCodingAttempt rows, Certificates) is completely untouched —");
    console.log("this is a computed-on-read value, so nothing is deleted/reset. They regain access the moment they pass the outstanding assessment.");
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
