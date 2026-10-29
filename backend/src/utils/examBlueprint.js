// Section-wise examination: the configuration ("blueprint") rules. Pure functions, no database, so they are unit-tested (test/examBlueprint.test.js) and can be called
// by the admin API before anything is saved or published. The four sections are fixed and ordered:
//   A APTITUDE -> B TECHNICAL -> C CODING -> D AI_INTERVIEW
// One examination, one attempt, one timer policy, one result. An invalid blueprint can be saved as a draft but never published (canPublish).

const SECTION_KEYS = Object.freeze(["APTITUDE", "TECHNICAL", "CODING", "AI_INTERVIEW"]);
const SECTION_LABELS = Object.freeze({ APTITUDE: "Section A: Aptitude", TECHNICAL: "Section B: Technical Assessment", CODING: "Section C: Coding Assessment", AI_INTERVIEW: "Section D: AI Mock Interview" });
const MODES = Object.freeze(["PRACTICE", "PROCTORED"]);
const TIMING_POLICIES = Object.freeze(["OVERALL_ONLY", "OVERALL_AND_SECTION"]);
const NAVIGATION_POLICIES = Object.freeze(["FREE", "FORWARD_ONLY"]);
const ANSWER_EDIT_POLICIES = Object.freeze(["EDITABLE_UNTIL_SECTION_SUBMIT", "LOCKED_AFTER_SAVE", "LOCKED_AFTER_NEXT"]);
const INTERVIEW_CATEGORIES = Object.freeze(["HR", "TECHNICAL", "BEHAVIORAL", "SITUATIONAL", "PROJECT", "ROLE_SPECIFIC"]);
const INTERVIEW_INPUTS = Object.freeze(["TYPED", "SPEECH", "TYPED_OR_SPEECH"]);
const DIFFICULTIES = Object.freeze(["EASY", "MEDIUM", "HARD"]);
const CAMERA_LOSS_POLICIES = Object.freeze(["WARN", "STRIKE", "BLOCK_UNTIL_RESTORED"]);
const NEGATIVE_MARKING_SECTIONS = Object.freeze(["APTITUDE", "TECHNICAL"]); // multiple choice only: coding and interview scores are never negative
const MAX_QUESTIONS = Object.freeze({ APTITUDE: 200, TECHNICAL: 200, CODING: 10, AI_INTERVIEW: 30 });

const toCents = (n) => Math.round(Number(n) * 100);
const isPositiveNumber = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 && Math.abs(toCents(n) / 100 - n) < 1e-9; // at most 2 decimals
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

function validateExamBlueprint(def) {
  const errors = [];
  const warnings = [];
  const err = (path, code, message) => errors.push({ path, code, message });
  const warn = (path, code, message) => warnings.push({ path, code, message });

  if (!def || typeof def !== "object") return { valid: false, errors: [{ path: "", code: "INVALID", message: "The examination configuration is missing." }], warnings };

  // ---- general ----
  if (typeof def.title !== "string" || !def.title.trim()) err("title", "TITLE_REQUIRED", "Enter an examination title.");
  else if (def.title.trim().length > 200) err("title", "TITLE_TOO_LONG", "The title can be at most 200 characters.");
  if (!MODES.includes(def.mode)) err("mode", "MODE_INVALID", `The mode must be one of ${MODES.join(", ")}.`);
  const proctored = def.mode === "PROCTORED";

  const start = new Date(def.startAt).getTime();
  const end = new Date(def.endAt).getTime();
  const hasStart = Number.isFinite(start);
  const hasEnd = Number.isFinite(end);
  if (!hasStart) err("startAt", "START_REQUIRED", "Set the start date and time.");
  if (!hasEnd) err("endAt", "END_REQUIRED", "Set the end date and time.");
  if (hasStart && hasEnd && end <= start) err("endAt", "END_BEFORE_START", "The end must be after the start.");

  const durationOk = isInt(def.durationMin, 5, 600);
  if (!durationOk) err("durationMin", "DURATION_INVALID", "The examination duration must be a whole number of minutes between 5 and 600.");
  if (durationOk && hasStart && hasEnd && end > start && def.durationMin > (end - start) / 60000) {
    err("durationMin", "DURATION_EXCEEDS_WINDOW", "The duration is longer than the time between the start and the end, so no student could finish.");
  }
  if (def.graceSec !== undefined && !isInt(def.graceSec, 0, 600)) err("graceSec", "GRACE_INVALID", "The grace period must be between 0 and 600 seconds.");

  // ---- marks ----
  if (!isPositiveNumber(def.totalMarks)) err("totalMarks", "TOTAL_MARKS_INVALID", "Total marks must be a positive number with at most two decimals.");

  // ---- sections ----
  const sections = Array.isArray(def.sections) ? def.sections : [];
  if (!Array.isArray(def.sections)) err("sections", "SECTIONS_REQUIRED", "The four sections are required.");
  const byKey = new Map();
  for (const [i, s] of sections.entries()) {
    const path = `sections[${i}]`;
    if (!s || !SECTION_KEYS.includes(s.key)) { err(`${path}.key`, "SECTION_KEY_INVALID", `A section must be one of ${SECTION_KEYS.join(", ")}.`); continue; }
    if (byKey.has(s.key)) { err(`${path}.key`, "SECTION_DUPLICATE", `${SECTION_LABELS[s.key]} appears more than once.`); continue; }
    byKey.set(s.key, { s, i });
  }
  for (const key of SECTION_KEYS) if (!byKey.has(key)) err("sections", "SECTION_MISSING", `${SECTION_LABELS[key]} is required and cannot be left out.`);

  // order: unique whole numbers; a proctored examination uses the fixed A-D order
  const orders = [];
  for (const { s, i } of byKey.values()) {
    if (!isInt(s.order, 1, 4)) err(`sections[${i}].order`, "ORDER_INVALID", "The section order must be 1 to 4.");
    else orders.push(s.order);
  }
  if (new Set(orders).size !== orders.length) err("sections", "ORDER_DUPLICATE", "Two sections have the same order.");
  if (proctored) {
    for (const { s, i } of byKey.values()) {
      if (isInt(s.order, 1, 4) && s.order !== SECTION_KEYS.indexOf(s.key) + 1) err(`sections[${i}].order`, "ORDER_NOT_FIXED", "A proctored examination runs the sections in the fixed order A, B, C, D.");
    }
  }

  let marksCents = 0;
  let marksComplete = true;
  const timing = def.timingPolicy;
  if (!TIMING_POLICIES.includes(timing)) err("timingPolicy", "TIMING_POLICY_INVALID", `The timing policy must be one of ${TIMING_POLICIES.join(", ")}.`);
  let sectionMinutes = 0;

  for (const { s, i } of byKey.values()) {
    const p = `sections[${i}]`;
    if (!isPositiveNumber(s.maxMarks)) { err(`${p}.maxMarks`, "SECTION_MARKS_INVALID", `${SECTION_LABELS[s.key]}: maximum marks must be a positive number with at most two decimals.`); marksComplete = false; }
    else marksCents += toCents(s.maxMarks);
    if (!isInt(s.questionCount, 1, MAX_QUESTIONS[s.key])) err(`${p}.questionCount`, "QUESTION_COUNT_INVALID", `${SECTION_LABELS[s.key]}: the number of questions must be between 1 and ${MAX_QUESTIONS[s.key]}.`);
    if (!NAVIGATION_POLICIES.includes(s.navigation)) err(`${p}.navigation`, "NAVIGATION_INVALID", `${SECTION_LABELS[s.key]}: choose a question navigation policy (${NAVIGATION_POLICIES.join(", ")}).`);
    if (!ANSWER_EDIT_POLICIES.includes(s.answerEditing)) err(`${p}.answerEditing`, "ANSWER_EDITING_INVALID", `${SECTION_LABELS[s.key]}: choose an answer modification policy.`);

    // section durations: only with OVERALL_AND_SECTION, and then every section needs one
    if (timing === "OVERALL_ONLY") {
      if (s.durationMin !== undefined && s.durationMin !== null) err(`${p}.durationMin`, "SECTION_DURATION_CONFLICT", `${SECTION_LABELS[s.key]} has its own duration, but the timing policy is "overall only". Remove it or change the policy.`);
    } else if (timing === "OVERALL_AND_SECTION") {
      if (!isInt(s.durationMin, 1, 600)) err(`${p}.durationMin`, "SECTION_DURATION_REQUIRED", `${SECTION_LABELS[s.key]}: set the section duration in whole minutes.`);
      else sectionMinutes += s.durationMin;
    }

    // negative marking is for multiple-choice sections, and a wrong answer cannot cost more than a right one earns
    const nm = s.negativeMarking;
    if (nm && nm.enabled) {
      if (!NEGATIVE_MARKING_SECTIONS.includes(s.key)) err(`${p}.negativeMarking`, "NEGATIVE_MARKING_NOT_ALLOWED", `${SECTION_LABELS[s.key]} cannot use negative marking.`);
      else if (typeof nm.perWrong !== "number" || !(nm.perWrong > 0)) err(`${p}.negativeMarking.perWrong`, "NEGATIVE_MARKING_INVALID", "Enter the marks deducted for a wrong answer (more than 0).");
      else if (isPositiveNumber(s.maxMarks) && isInt(s.questionCount, 1, 1000) && nm.perWrong > s.maxMarks / s.questionCount + 1e-9) {
        err(`${p}.negativeMarking.perWrong`, "NEGATIVE_MARKING_TOO_LARGE", "A wrong answer would cost more than a right answer earns.");
      }
    }

    if (s.key === "CODING" && s.maxSubmissionsPerProblem !== undefined && s.maxSubmissionsPerProblem !== null && !isInt(s.maxSubmissionsPerProblem, 1, 50)) {
      err(`${p}.maxSubmissionsPerProblem`, "SUBMISSION_LIMIT_INVALID", "The submission limit per problem must be between 1 and 50.");
    }

    if (s.key === "AI_INTERVIEW") {
      const iv = s.interview || {};
      if (!INTERVIEW_CATEGORIES.includes(iv.category)) err(`${p}.interview.category`, "INTERVIEW_CATEGORY_INVALID", `Choose the interview category (${INTERVIEW_CATEGORIES.join(", ")}).`);
      if (!DIFFICULTIES.includes(iv.difficulty)) err(`${p}.interview.difficulty`, "INTERVIEW_DIFFICULTY_INVALID", "Choose the interview difficulty.");
      if (!INTERVIEW_INPUTS.includes(iv.answerInput)) err(`${p}.interview.answerInput`, "INTERVIEW_INPUT_INVALID", "Choose how students answer (typed, speech, or either).");
      if (typeof iv.cameraRequired !== "boolean") err(`${p}.interview.cameraRequired`, "INTERVIEW_CAMERA_INVALID", "State whether the camera is required for the interview.");
      if (typeof iv.speechToText !== "boolean") err(`${p}.interview.speechToText`, "INTERVIEW_STT_INVALID", "State whether speech-to-text is available.");
      if (iv.speechToText === true && iv.answerInput === "TYPED") err(`${p}.interview`, "INTERVIEW_STT_CONFLICT", "Speech-to-text is switched on, but the answer input is typed only.");
      if (iv.speechToText === false && iv.answerInput === "SPEECH") err(`${p}.interview`, "INTERVIEW_STT_CONFLICT", "The answer input is speech only, but speech-to-text is switched off.");
      if (!iv.rubricVersion || typeof iv.rubricVersion !== "string") err(`${p}.interview.rubricVersion`, "INTERVIEW_RUBRIC_REQUIRED", "Choose the evaluation rubric (its version is stored with every score).");
    }
  }

  if (marksComplete && isPositiveNumber(def.totalMarks) && byKey.size === SECTION_KEYS.length && marksCents !== toCents(def.totalMarks)) {
    err("totalMarks", "MARKS_MISMATCH", `The section marks add up to ${marksCents / 100}, but the total is ${def.totalMarks}. They must be equal.`);
  }
  if (timing === "OVERALL_AND_SECTION" && durationOk && sectionMinutes > def.durationMin) {
    err("sections", "SECTION_TIME_EXCEEDS_TOTAL", `The section durations add up to ${sectionMinutes} minutes, more than the examination duration of ${def.durationMin} minutes.`);
  } else if (timing === "OVERALL_AND_SECTION" && durationOk && sectionMinutes > 0 && sectionMinutes < def.durationMin) {
    warn("sections", "UNALLOCATED_TIME", `${def.durationMin - sectionMinutes} minutes of the examination are not given to any section.`);
  }

  // ---- passing criteria ----
  const hasMarks = def.passingMarks !== undefined && def.passingMarks !== null;
  const hasPercent = def.passingPercent !== undefined && def.passingPercent !== null;
  if (hasMarks && hasPercent) err("passingMarks", "PASSING_AMBIGUOUS", "Set either passing marks or a passing percentage, not both.");
  else if (!hasMarks && !hasPercent) err("passingMarks", "PASSING_REQUIRED", "Set the passing criteria (passing marks or a percentage).");
  else if (hasMarks && (typeof def.passingMarks !== "number" || def.passingMarks < 0 || (isPositiveNumber(def.totalMarks) && def.passingMarks > def.totalMarks))) err("passingMarks", "PASSING_MARKS_INVALID", "Passing marks must be between 0 and the total marks.");
  else if (hasPercent && (typeof def.passingPercent !== "number" || def.passingPercent < 0 || def.passingPercent > 100)) err("passingPercent", "PASSING_PERCENT_INVALID", "The passing percentage must be between 0 and 100.");

  // ---- proctoring ----
  const pr = def.proctoring;
  if (proctored) {
    if (!pr || typeof pr !== "object") err("proctoring", "PROCTORING_REQUIRED", "A proctored examination needs its proctoring settings.");
    else {
      for (const k of ["cameraRequired", "microphoneRequired", "fullscreenRequired", "autoSubmitOnExpiry", "reviewRequired"]) {
        if (typeof pr[k] !== "boolean") err(`proctoring.${k}`, "PROCTORING_FLAG_INVALID", `Proctoring setting "${k}" must be on or off.`);
      }
      if (!isInt(pr.maxWarnings, 1, 10)) err("proctoring.maxWarnings", "WARNING_THRESHOLD_INVALID", "The warning threshold must be between 1 and 10.");
      if (!isInt(pr.networkGraceSec, 0, 600)) err("proctoring.networkGraceSec", "NETWORK_GRACE_INVALID", "The network-recovery grace period must be between 0 and 600 seconds.");
      if (!CAMERA_LOSS_POLICIES.includes(pr.cameraLossPolicy)) err("proctoring.cameraLossPolicy", "CAMERA_POLICY_INVALID", `Choose what happens when the camera disconnects (${CAMERA_LOSS_POLICIES.join(", ")}).`);
      if (!isInt(pr.evidenceRetentionDays, 0, 3650)) err("proctoring.evidenceRetentionDays", "RETENTION_INVALID", "The evidence retention period must be between 0 and 3650 days.");
      const iv = byKey.get("AI_INTERVIEW")?.s?.interview;
      if (iv?.cameraRequired === true && pr.cameraRequired === false) err("sections", "CAMERA_INCONSISTENT", "The interview section needs the camera, but the examination's proctoring does not check it in the readiness test.");
      if (iv?.speechToText === true && pr.microphoneRequired === false) warn("proctoring.microphoneRequired", "MIC_NOT_REQUIRED", "Speech-to-text is available in the interview, but the microphone is not part of the readiness check.");
      if (pr.autoSubmitOnExpiry === false) warn("proctoring.autoSubmitOnExpiry", "NO_AUTO_SUBMIT", "Without auto-submit, an attempt that runs out of time must be closed by the server's expiry sweep.");
    }
    if (def.official === false) err("official", "PROCTORED_NOT_OFFICIAL", "A proctored examination always counts as an official result.");
  } else if (def.mode === "PRACTICE") {
    // Practice never contaminates official results: it is always flagged unofficial, whatever the caller sent.
    if (def.official === true) err("official", "PRACTICE_OFFICIAL", "A practice examination can never count toward official results.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Publishing is allowed only for a valid blueprint, and not again for an examination that already has attempts started under the published version: a published version
// is immutable for them (an edit becomes a new version instead).
function canPublish(def, { activeAttemptCount = 0 } = {}) {
  const v = validateExamBlueprint(def);
  if (!v.valid) return { ok: false, reason: "INVALID_CONFIGURATION", errors: v.errors };
  if (activeAttemptCount > 0) return { ok: false, reason: "ACTIVE_ATTEMPTS_EXIST", errors: [] };
  return { ok: true, reason: null, errors: [], warnings: v.warnings };
}

// An edit of a published examination with attempts under way must not touch what those attempts depend on. Anything in the list below changes the questions, marks,
// timing or rules a student is already working under; the rest (for example the description) may be edited in place.
const LOCKED_WHEN_ATTEMPTS_EXIST = Object.freeze(["mode", "durationMin", "totalMarks", "passingMarks", "passingPercent", "timingPolicy", "graceSec", "sections", "proctoring"]);
function lockedFieldsChanged(published, edited) {
  return LOCKED_WHEN_ATTEMPTS_EXIST.filter((k) => JSON.stringify(published?.[k] ?? null) !== JSON.stringify(edited?.[k] ?? null));
}

module.exports = {
  SECTION_KEYS, SECTION_LABELS, MODES, TIMING_POLICIES, NAVIGATION_POLICIES, ANSWER_EDIT_POLICIES, INTERVIEW_CATEGORIES, INTERVIEW_INPUTS, DIFFICULTIES, CAMERA_LOSS_POLICIES,
  MAX_QUESTIONS, LOCKED_WHEN_ATTEMPTS_EXIST, validateExamBlueprint, canPublish, lockedFieldsChanged,
};
