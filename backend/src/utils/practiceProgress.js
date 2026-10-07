// Progress + unlock state for level-based Practice tracks (Course.kind === "PRACTICE"), e.g. JAVA Practice:
//   Course > Section (CourseModule) > Topic (Chapter) > Level (ModuleCodingTest with chapterId) > Questions
//
// Everything is derived from rows the admin already manages (publish state, unlockRule fields, attempts) --
// no level count, pass mark, attempt cap or unlock order is hard-coded here. Only items whose whole ancestor chain
// is Published exist in this state, so a Draft/Archived level can never be reached through it.
//
// Level state, in priority order:
//   PASSED          a graded attempt passed
//   IN_PROGRESS     an attempt is open (still resumable even if the level was unpublished mid-attempt is NOT handled
//                   here -- unpublished levels are absent; moduleCoding.js keeps resume working separately)
//   LOCKED          the level's unlockRule (or its topic/section rule) is not satisfied yet
//   COMING_SOON     published but has no Published questions yet
//   FAILED          attempts exhausted without passing (staff can reset an attempt)
//   RETAKE_AVAILABLE attempted, not passed, attempts remain
//   AVAILABLE       can be started

const { LIVE } = require("./publishState");

async function loadPracticeState(prisma, studentId, courseId) {
  const modules = await prisma.courseModule.findMany({
    where: { courseId, ...LIVE },
    orderBy: { order: "asc" },
    include: {
      chapters: {
        where: LIVE,
        orderBy: { order: "asc" },
        include: {
          levels: {
            where: LIVE,
            orderBy: { order: "asc" },
            include: { _count: { select: { questions: { where: { questionStatus: "PUBLISHED" } } } } },
          },
        },
      },
    },
  });
  const levelIds = modules.flatMap((m) => m.chapters.flatMap((c) => c.levels.map((l) => l.id)));
  const attempts = levelIds.length && studentId
    ? await prisma.moduleCodingAttempt.findMany({
        where: { studentId, moduleCodingTestId: { in: levelIds } },
        select: { id: true, moduleCodingTestId: true, status: true, passed: true, score: true },
      })
    : [];
  const byLevel = new Map();
  for (const a of attempts) {
    if (!byLevel.has(a.moduleCodingTestId)) byLevel.set(a.moduleCodingTestId, []);
    byLevel.get(a.moduleCodingTestId).push(a);
  }

  const sections = [];
  let prevSection = null;
  for (const m of modules) {
    const sectionLocked = m.unlockRule === "SEQUENTIAL" && prevSection && !prevSection.complete;
    const topics = [];
    let prevTopic = null;
    for (const c of m.chapters) {
      const topicLocked = !!sectionLocked || (c.unlockRule === "SEQUENTIAL" && prevTopic && !prevTopic.complete);
      const lockReason = sectionLocked
        ? `Complete "${prevSection.title}" first`
        : topicLocked ? `Pass every level in "${prevTopic.title}" first` : null;
      const levels = [];
      let prevLevel = null;
      for (const l of c.levels) {
        const mine = byLevel.get(l.id) || [];
        const passed = mine.some((a) => a.passed);
        const open = mine.some((a) => a.status === "IN_PROGRESS");
        const finalized = mine.filter((a) => a.status !== "IN_PROGRESS");
        const best = finalized.length ? Math.max(...finalized.map((a) => a.score || 0)) : null;
        const attemptsLeft = l.maxAttempts == null ? null : Math.max(0, l.maxAttempts - finalized.length);

        let locked = topicLocked;
        let reason = lockReason;
        if (!locked && prevLevel && l.unlockRule !== "NONE") {
          if (l.unlockRule === "PASS_PREVIOUS") {
            const need = l.unlockMinPercent;
            if (!prevLevel.passed || (need != null && (prevLevel.best ?? 0) < need)) {
              locked = true; reason = `Pass "${prevLevel.title}"${need != null ? ` with at least ${need}%` : ""} to unlock`;
            }
          } else if (l.unlockRule === "COMPLETE_PREVIOUS") {
            if (!prevLevel.attempted) { locked = true; reason = `Complete "${prevLevel.title}" to unlock`; }
          }
        }
        let status;
        if (passed) status = "PASSED";
        else if (open) status = "IN_PROGRESS";
        else if (locked) status = "LOCKED";
        else if (l._count.questions === 0) status = "COMING_SOON";
        else if (finalized.length && attemptsLeft === 0) status = "FAILED";
        else if (finalized.length) status = "RETAKE_AVAILABLE";
        else status = "AVAILABLE";

        const row = {
          id: l.id, title: l.title, description: l.description, difficulty: l.difficulty, order: l.order,
          questionCount: Math.min(l.questionCount, l._count.questions), timeLimitMin: l.timeLimitMin, passingPercent: l.passingPercent,
          maxAttempts: l.maxAttempts, attemptsUsed: finalized.length, attemptsLeft, bestScore: best,
          status, locked, lockReason: locked ? reason : null, passed, attempted: finalized.length > 0 || open,
          startable: !locked && !passed && (open || (l._count.questions > 0 && (attemptsLeft === null || attemptsLeft > 0))),
        };
        // `best`/`title` shortcuts the NEXT level's unlock rule reads
        row.best = best;
        levels.push(row);
        prevLevel = row;
      }
      const passedCount = levels.filter((x) => x.passed).length;
      const complete = levels.length === 0 ? true : passedCount === levels.length;
      const started = levels.some((x) => x.attempted);
      const topic = {
        id: c.id, title: c.title, description: c.description, order: c.order, durationLabel: c.durationLabel, outline: Array.isArray(c.outline) ? c.outline : [],
        levelCount: levels.length, passedCount, progress: levels.length ? Math.round((passedCount / levels.length) * 100) : 0,
        locked: !!topicLocked, lockReason, complete, levels,
        status: topicLocked ? "LOCKED" : levels.length && complete ? "COMPLETED" : started ? "IN_PROGRESS" : "NOT_STARTED",
      };
      topics.push(topic);
      prevTopic = topic;
    }
    const levelTotal = topics.reduce((n, t) => n + t.levelCount, 0);
    const passedTotal = topics.reduce((n, t) => n + t.passedCount, 0);
    const section = {
      id: m.id, title: m.title, description: m.description, order: m.order,
      topicCount: topics.length, levelCount: levelTotal, passedCount: passedTotal,
      progress: levelTotal ? Math.round((passedTotal / levelTotal) * 100) : 0,
      locked: !!sectionLocked, lockReason: sectionLocked ? `Complete "${prevSection.title}" first` : null,
      complete: topics.length > 0 && topics.every((t) => t.complete) && levelTotal > 0,
      status: sectionLocked ? "LOCKED" : levelTotal && passedTotal === levelTotal ? "COMPLETED" : topics.some((t) => t.status === "IN_PROGRESS" || t.passedCount > 0) ? "IN_PROGRESS" : "NOT_STARTED",
      topics,
    };
    // A section with no content yet must not dead-lock the next sequential section.
    const gate = levelTotal === 0 ? { ...section, complete: true } : section;
    sections.push(section);
    prevSection = gate;
  }

  const total = sections.reduce((n, s) => n + s.levelCount, 0);
  const passed = sections.reduce((n, s) => n + s.passedCount, 0);
  return { sections, overall: { levelCount: total, passedCount: passed, progress: total ? Math.round((passed / total) * 100) : 0 }, resume: findResume(sections) };
}

// "Continue" target: an open attempt first, else the first unlocked, unfinished level in course order.
function findResume(sections) {
  let fallback = null;
  for (const s of sections) {
    if (s.locked) continue;
    for (const t of s.topics) {
      if (t.locked) continue;
      for (const l of t.levels) {
        if (l.status === "IN_PROGRESS") return { sectionId: s.id, topicId: t.id, levelId: l.id, reason: "IN_PROGRESS" };
        if (!fallback && l.startable) fallback = { sectionId: s.id, topicId: t.id, levelId: l.id, reason: "NEXT" };
      }
      if (!fallback && t.levels.length === 0) continue;
    }
  }
  if (fallback) return fallback;
  const firstOpen = sections.find((s) => !s.locked && s.topics.length);
  return firstOpen ? { sectionId: firstOpen.id, topicId: firstOpen.topics[0]?.id || null, levelId: null, reason: "REVIEW" } : null;
}

// Used by moduleCoding.js: may this student start (or resume) this chapter Level of a PRACTICE course?
async function levelUnlockState(prisma, studentId, courseId, levelId) {
  const { sections } = await loadPracticeState(prisma, studentId, courseId);
  for (const s of sections) for (const t of s.topics) for (const l of t.levels) {
    if (l.id === levelId) return { found: true, locked: l.locked, reason: l.lockReason, level: l };
  }
  return { found: false, locked: true, reason: "Not available" };
}

module.exports = { loadPracticeState, levelUnlockState };
