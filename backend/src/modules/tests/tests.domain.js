// Pure rules for test authoring and attempt layout: no database, no req/res. Moved out of routes/tests.js unchanged in behaviour, so they can be
// unit-tested and shared by the authoring module and the legacy attempt routes that still live in routes/tests.js.

const SELECTION_MODES = ["FIXED", "RANDOM"];

function questionCreateData(questionIds, questionTimeLimits, questionAiAllowed) {
  return (questionIds || []).map((qId, idx) => ({
    questionId: qId,
    order: idx,
    timeLimitSec: Number(questionTimeLimits?.[qId]) || 900,
    aiAllowed: !!questionAiAllowed?.[qId],
  }));
}

// Fisher-Yates: uniform, unbiased permutation in O(n), fine at exam scale.
function shuffledArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// RANDOM mode: draws randomQuestionsPerStudent TestQuestion rows out of the test's full bank. Honors difficultyDistribution when set by sampling each
// difficulty pool independently; any shortfall is topped up from whatever is left in the bank so the student still gets the promised count.
function pickRandomQuestions(bank, perStudent, distribution) {
  if (!distribution || (!distribution.easy && !distribution.medium && !distribution.hard)) {
    return shuffledArray(bank).slice(0, perStudent);
  }
  const byDifficulty = { EASY: [], MEDIUM: [], HARD: [] };
  for (const tq of bank) byDifficulty[tq.question.difficulty]?.push(tq);
  const picks = [
    ...shuffledArray(byDifficulty.EASY).slice(0, Number(distribution.easy) || 0),
    ...shuffledArray(byDifficulty.MEDIUM).slice(0, Number(distribution.medium) || 0),
    ...shuffledArray(byDifficulty.HARD).slice(0, Number(distribution.hard) || 0),
  ];
  if (picks.length < perStudent) {
    const pickedIds = new Set(picks.map((tq) => tq.questionId));
    const remaining = shuffledArray(bank.filter((tq) => !pickedIds.has(tq.questionId)));
    picks.push(...remaining.slice(0, perStudent - picks.length));
  }
  return picks.slice(0, perStudent);
}

// One student's question/option order for a fresh attempt, built once from the already-loaded test (no extra queries).
function buildAttemptOrder(test) {
  const bank = [...test.questions].sort((a, b) => a.order - b.order);
  const selected = test.questionSelectionMode === "RANDOM" && test.randomQuestionsPerStudent
    ? pickRandomQuestions(bank, test.randomQuestionsPerStudent, test.difficultyDistribution)
    : bank;

  const orderedIds = selected.map((tq) => tq.questionId);
  const questionOrder = test.shuffleQuestions ? shuffledArray(orderedIds) : orderedIds;

  let optionOrder = null;
  if (test.shuffleOptions) {
    optionOrder = {};
    for (const tq of selected) {
      const q = tq.question;
      if (q.questionType === "CODING" || !Array.isArray(q.options) || q.options.length === 0) continue;
      optionOrder[q.id] = shuffledArray(q.options.map((_, i) => i));
    }
  }
  return { questionOrder, optionOrder };
}

// Throws a plain Error (the routes answer 400 with its message) when a RANDOM test's configuration cannot work.
function validateRandomConfig(mode, randomQuestionsPerStudent, difficultyDistribution, bankSize) {
  if (mode !== "RANDOM") return;
  const perStudent = Number(randomQuestionsPerStudent);
  if (!perStudent || perStudent < 1) throw new Error("Set how many questions each student should receive");
  if (bankSize != null && perStudent > bankSize) {
    throw new Error(`Questions per student (${perStudent}) can't exceed the bank size (${bankSize})`);
  }
  if (difficultyDistribution) {
    const { easy = 0, medium = 0, hard = 0 } = difficultyDistribution;
    const sum = Number(easy) + Number(medium) + Number(hard);
    if (sum !== perStudent) {
      throw new Error(`Difficulty distribution (${sum}) must add up to questions per student (${perStudent})`);
    }
  }
}

// Scheduled publishing: only for a test that is not already live and only ever a future moment; null clears it. Returns { value } or { error }.
function resolveScheduledPublishAt(existing, scheduledPublishAt, now = Date.now()) {
  if (scheduledPublishAt === undefined) return { value: existing.scheduledPublishAt };
  if (scheduledPublishAt === null) return { value: null };
  if (existing.isPublished) return { error: "This test is already published — unpublish it first if you want to schedule a re-publish." };
  const parsed = new Date(scheduledPublishAt);
  if (isNaN(parsed.getTime()) || parsed.getTime() <= now) return { error: "Scheduled publish time must be a valid moment in the future." };
  return { value: parsed };
}

// The new selection mode on edit: an invalid or missing value keeps the current one.
function selectionModeForUpdate(existing, questionSelectionMode) {
  if (questionSelectionMode === undefined) return existing.questionSelectionMode;
  return SELECTION_MODES.includes(questionSelectionMode) ? questionSelectionMode : existing.questionSelectionMode;
}

// Data written by "create a test". `sec` is the parsed exam-security fields, `subject` the resolved Subject/Unit ids.
function buildCreateData(body, { mode, resolvedQuestionIds, sec, subject, instituteId, userId }) {
  const {
    title, code, description, instructions, durationMin, passingMarks, showResults, startTime, endTime, questionTimeLimits, questionAiAllowed, academicGroupIds,
    requireFullscreen, requireWebcam, requireMicrophone, attendanceMandatory, shuffleQuestions, shuffleOptions, randomBankFolderId, randomQuestionsPerStudent,
    difficultyDistribution, company, subject: subjectText, unit, program,
  } = body;
  return {
    title,
    code: code?.trim() || null,
    description,
    instructions: instructions?.trim() || null,
    company: company?.trim() || null,
    durationMin: durationMin || 60,
    passingMarks: passingMarks !== undefined && passingMarks !== "" ? Number(passingMarks) : null,
    showResults: showResults === undefined ? true : !!showResults,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    requireFullscreen: requireFullscreen === undefined ? true : !!requireFullscreen,
    ...sec.data,
    requireWebcam: !!requireWebcam,
    requireMicrophone: !!requireMicrophone,
    attendanceMandatory: !!attendanceMandatory,
    shuffleQuestions: shuffleQuestions === undefined ? true : !!shuffleQuestions,
    shuffleOptions: !!shuffleOptions,
    questionSelectionMode: mode,
    randomBankFolderId: mode === "RANDOM" ? randomBankFolderId : null,
    randomQuestionsPerStudent: mode === "RANDOM" ? Number(randomQuestionsPerStudent) : null,
    difficultyDistribution: mode === "RANDOM" ? difficultyDistribution || null : null,
    subject: subjectText?.trim() || null,
    unit: unit?.trim() || null,
    subjectId: subject.subjectId,
    unitId: subject.unitId,
    program: program?.trim() || null,
    createdById: userId,
    instituteId,
    questions: { create: questionCreateData(resolvedQuestionIds, questionTimeLimits, questionAiAllowed) },
    academicGroups: { create: (academicGroupIds || []).map((academicGroupId) => ({ academicGroupId })) },
  };
}

// Fields written by "edit a test": each one falls back to the stored value when the request does not send it. Bumps the optimistic-concurrency version.
function buildUpdateData(existing, body, r) {
  const { title, code, description, instructions, durationMin, passingMarks, showResults, startTime, endTime, requireFullscreen, requireWebcam, requireMicrophone,
    attendanceMandatory, shuffleQuestions, shuffleOptions, company, subject, unit, program } = body;
  return {
    instituteId: r.instituteId,
    title: title ?? existing.title,
    code: code !== undefined ? (code?.trim() || null) : existing.code,
    description: description ?? existing.description,
    instructions: instructions !== undefined ? (instructions?.trim() || null) : existing.instructions,
    company: company !== undefined ? (company?.trim() || null) : existing.company,
    subject: subject !== undefined ? (subject?.trim() || null) : existing.subject,
    unit: unit !== undefined ? (unit?.trim() || null) : existing.unit,
    subjectId: r.subject.subjectId,
    unitId: r.subject.unitId,
    program: program !== undefined ? (program?.trim() || null) : existing.program,
    durationMin: durationMin !== undefined ? Number(durationMin) : existing.durationMin,
    passingMarks: passingMarks !== undefined ? (passingMarks === "" ? null : Number(passingMarks)) : existing.passingMarks,
    showResults: showResults === undefined ? existing.showResults : !!showResults,
    startTime: startTime ? new Date(startTime) : existing.startTime,
    endTime: endTime ? new Date(endTime) : existing.endTime,
    requireFullscreen: requireFullscreen === undefined ? existing.requireFullscreen : !!requireFullscreen,
    ...r.sec.data,
    requireWebcam: requireWebcam === undefined ? existing.requireWebcam : !!requireWebcam,
    requireMicrophone: requireMicrophone === undefined ? existing.requireMicrophone : !!requireMicrophone,
    attendanceMandatory: attendanceMandatory === undefined ? existing.attendanceMandatory : !!attendanceMandatory,
    shuffleQuestions: shuffleQuestions === undefined ? existing.shuffleQuestions : !!shuffleQuestions,
    shuffleOptions: shuffleOptions === undefined ? existing.shuffleOptions : !!shuffleOptions,
    questionSelectionMode: r.mode,
    randomBankFolderId: r.bankFolderId,
    randomQuestionsPerStudent: r.perStudent != null ? Number(r.perStudent) : null,
    difficultyDistribution: r.distribution || null,
    scheduledPublishAt: r.scheduledPublishAt,
    version: { increment: 1 },
  };
}

// A copy starts unpublished, is owned by whoever ran the duplicate action, and keeps questions (with their time limits) and group assignments.
function buildDuplicateData(original, userId) {
  return {
    title: `Copy of ${original.title}`,
    code: original.code,
    description: original.description,
    instructions: original.instructions,
    durationMin: original.durationMin,
    passingMarks: original.passingMarks,
    showResults: original.showResults,
    startTime: original.startTime,
    endTime: original.endTime,
    isPublished: false,
    subject: original.subject,
    unit: original.unit,
    program: original.program,
    createdById: userId,
    instituteId: original.instituteId,
    questions: { create: original.questions.map((q) => ({ questionId: q.questionId, order: q.order, timeLimitSec: q.timeLimitSec })) },
    academicGroups: { create: original.academicGroups.map((g) => ({ academicGroupId: g.academicGroupId })) },
  };
}

// What a publish/unpublish call changed, which decides the audit entry and whether students are notified.
function publishTransition(wasPublished, isPublished) {
  if (isPublished && !wasPublished) return "PUBLISHED";
  if (!isPublished && wasPublished) return "UNPUBLISHED";
  return null;
}

// Recipient preview: per-academic-group counts, plus the students with no group (open-to-everyone tests) so the total still adds up.
function recipientBreakdown(recipientCount, groupCounts, groupInfoById) {
  const breakdown = groupCounts.filter((g) => g.academicGroupId).map((g) => {
    const info = groupInfoById.get(g.academicGroupId);
    return {
      academicGroupId: g.academicGroupId, count: g._count,
      institute: info?.institute?.name || null, batch: info?.batch || null,
      branch: info?.department?.name || null, section: info?.section || null,
    };
  });
  return { breakdown, ungroupedCount: recipientCount - breakdown.reduce((s, g) => s + g.count, 0) };
}

// Is this test outside the requester's institute? `strict` routes treat a platform-wide test (no institute) as outside an institute-bound requester;
// the other routes let an institute-bound requester act on platform-wide tests (the two behaviours existed before this module and are preserved).
function outsideInstitute(actor, test, strict) {
  if (!actor.requesterInstituteId) return false;
  return strict ? test.instituteId !== actor.requesterInstituteId : !!test.instituteId && test.instituteId !== actor.requesterInstituteId;
}

module.exports = {
  SELECTION_MODES, questionCreateData, shuffledArray, pickRandomQuestions, buildAttemptOrder, validateRandomConfig, resolveScheduledPublishAt, selectionModeForUpdate,
  buildCreateData, buildUpdateData, buildDuplicateData, publishTransition, recipientBreakdown, outsideInstitute,
};
