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

// ================= batch 2: reading tests and the student attempt flow =================

const STAFF_ROLES = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"];
const isStaffRole = (role) => STAFF_ROLES.includes(role);
const MAX_TAB_VIOLATIONS = 3;
const TESTS_LIST_CAP = 2000;

// Staff list filter: institute scope (a group/class of the institute, or an open-to-all test that belongs to it or to nobody) ANDed with the
// creator-or-shared restriction that applies to STAFF only. `ownership` is staffTestAccessWhere(actor).
function staffListWhere(requesterInstituteId, ownership) {
  const instituteWhere = requesterInstituteId
    ? {
        OR: [
          { classes: { some: { class: { instituteId: requesterInstituteId } } } },
          { academicGroups: { some: { academicGroup: { instituteId: requesterInstituteId } } } },
          { classes: { none: {} }, academicGroups: { none: {} }, OR: [{ instituteId: null }, { instituteId: requesterInstituteId }] },
        ],
      }
    : {};
  return { AND: [instituteWhere, ownership] };
}

// A student sees summary figures only until their attempt is running (or finished and the window has closed): no question content before that.
function questionsVisible(attempt, test, now = new Date()) {
  return attempt?.status === "IN_PROGRESS" || (!!attempt && now > test.endTime);
}
function questionSummaryOf(test) {
  const pts = test.questions.map((tq) => tq.question?.points || 0);
  const random = test.questionSelectionMode === "RANDOM";
  return {
    count: random && test.randomQuestionsPerStudent ? test.randomQuestionsPerStudent : test.questions.length,
    maxMarks: random ? null : pts.reduce((a, b) => a + b, 0),
    types: [...new Set(test.questions.map((tq) => tq.question?.questionType).filter(Boolean))],
  };
}

// Applies one attempt's locked question order to the test's questions. Ids assigned to the attempt but no longer on the test are looked up through
// `extraById` (questions the admin removed after the student started stay visible to them). Returns the ordered list and the ids that no longer exist.
function orderForAttempt(testQuestions, questionOrder, extraById) {
  const byId = new Map(testQuestions.map((tq) => [tq.questionId, tq]));
  const missing = questionOrder.filter((qId) => !byId.has(qId));
  for (const q of extraById || []) byId.set(q.id, { questionId: q.id, question: q });
  const stillMissing = missing.filter((qId) => !byId.has(qId));
  return { ordered: questionOrder.map((qId) => byId.get(qId)).filter(Boolean), missing, stillMissing };
}
function applyOptionOrder(questions, optionOrder) {
  if (!optionOrder) return;
  for (const tq of questions) {
    const order = optionOrder[tq.questionId];
    if (order && Array.isArray(tq.question.options)) tq.question.options = order.map((origIdx) => tq.question.options[origIdx]);
  }
}

// Start window: a new attempt after the window closes needs a one-time reattempt grant; resuming an attempt after it closes is refused outright.
function startWindow(now, test, existing) {
  if (now < test.startTime) return { failure: "Test has not started yet" };
  if (now > test.endTime) return existing ? { failure: "Test window has closed" } : { needsGrant: true };
  return {};
}

// What a violation does to an attempt: severity and penalty from the shared classifier, the new strike count, and whether it forces a submit.
function violationOutcome(attempt, classification) {
  const { severity, penalized } = classification;
  const tabSwitchCount = penalized ? attempt.tabSwitchCount + 1 : attempt.tabSwitchCount;
  return { severity, penalized, tabSwitchCount, autoSubmitted: penalized && tabSwitchCount >= MAX_TAB_VIOLATIONS };
}

module.exports.STAFF_ROLES = STAFF_ROLES;
module.exports.isStaffRole = isStaffRole;
module.exports.MAX_TAB_VIOLATIONS = MAX_TAB_VIOLATIONS;
module.exports.TESTS_LIST_CAP = TESTS_LIST_CAP;
module.exports.staffListWhere = staffListWhere;
module.exports.questionsVisible = questionsVisible;
module.exports.questionSummaryOf = questionSummaryOf;
module.exports.orderForAttempt = orderForAttempt;
module.exports.applyOptionOrder = applyOptionOrder;
module.exports.startWindow = startWindow;
module.exports.violationOutcome = violationOutcome;
