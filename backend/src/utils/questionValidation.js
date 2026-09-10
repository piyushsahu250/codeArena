// Single authoritative "is this question complete" engine, shared by every caller that needs it:
// the VERIFIED-status gate below (PATCH /questions/:id) AND the platform-wide Question
// Completeness Audit (GET /admin/question-audit). Before this file grew the audit* functions,
// those two lived as two independently-hand-maintained implementations (admin.js's own
// auditQuestion() vs. validateQuestionForVerification() here) that had already drifted apart in
// real, meaningful ways — SQL questions were entirely invisible to the audit page (it only ever
// queried questionType: "CODING"), whitespace-only text passed every non-title field as "present"
// (title alone was `.trim()`-checked), and MCQ/TRUE_FALSE/MULTISELECT questions had no
// completeness check at all anywhere. Fixed here, once, rather than patched separately in each
// caller — see the AUDIT ROUTE'S own comment in admin.js for how the drift was found.
//
// CODING's hidden minimum was lowered from 10 to 5 (explicit product decision) — every question
// authored under the old 10-minimum keeps every one of its existing hidden cases; this only
// changes what's required of newly authored/edited ones going forward.
const MIN_CASES = { CODING: { visible: 2, hidden: 5 }, SQL: { visible: 1, hidden: 5 } };

// Null, undefined, and whitespace-only all count as "not really there" — a value of "   " must
// never read as present just because it isn't the empty string. Every text-field check below goes
// through this instead of a bare `!value`, which is exactly the gap that let whitespace-only
// content silently pass the audit before.
function isBlank(v) {
  return v === null || v === undefined || !String(v).trim();
}

// CODING completeness — same fields Question's own create/edit routes already require or offer
// (routes/questions.js), plus the handful (inputFormat/outputFormat/constraints/tags/starter code)
// those routes leave optional but a genuinely complete question should still have. `question` may
// be a Question row, a PracticeQuestion row, or an InterviewQuestion row — all three use the same
// field names for these (prompt/description, starterCode(ByLanguage), tags, evaluationType,
// functionSignature), so one function covers every source the audit route scans.
function auditCodingCompleteness(question, testCases) {
  const missing = [];
  const cases = Array.isArray(testCases) ? testCases : [];
  if (isBlank(question.title)) missing.push("title");
  if (isBlank(question.description) && isBlank(question.prompt)) missing.push("description");
  if (isBlank(question.inputFormat)) missing.push("inputFormat");
  if (isBlank(question.outputFormat)) missing.push("outputFormat");
  if (isBlank(question.constraints)) missing.push("constraints");
  if (!Array.isArray(question.tags) || question.tags.length === 0) missing.push("tags");
  const visible = cases.filter((tc) => !tc.isHidden).length;
  const hidden = cases.filter((tc) => tc.isHidden).length;
  if (visible < MIN_CASES.CODING.visible) missing.push(`visible test cases (has ${visible}, needs ${MIN_CASES.CODING.visible})`);
  if (hidden < MIN_CASES.CODING.hidden) missing.push(`hidden test cases (has ${hidden}, needs ${MIN_CASES.CODING.hidden})`);
  const hasStarter = (question.starterCodeByLanguage && Object.keys(question.starterCodeByLanguage).length > 0) || !isBlank(question.starterCode);
  if (!hasStarter) missing.push("starter code");
  if (question.evaluationType === "FUNCTION") {
    const sig = question.functionSignature;
    if (!sig || !sig.methodName || !sig.returnType || !Array.isArray(sig.params)) missing.push("function signature");
  }
  return missing;
}

// SQL completeness — previously not checked ANYWHERE outside the create/edit routes' own
// inline gate: the audit route only ever queried questionType: "CODING", so a SQL question that
// lost its schema or test cases after creation (a bad edit, a partial import, direct DB surgery)
// had no way to ever surface on the one page whose entire job is finding exactly that.
function auditSqlCompleteness(question, testCases) {
  const missing = [];
  const cases = Array.isArray(testCases) ? testCases : [];
  if (isBlank(question.title)) missing.push("title");
  if (isBlank(question.description) && isBlank(question.prompt)) missing.push("description");
  if (isBlank(question.sqlSchema)) missing.push("SQL schema (table setup / seed data)");
  const visible = cases.filter((tc) => !tc.isHidden).length;
  const hidden = cases.filter((tc) => tc.isHidden).length;
  if (visible < MIN_CASES.SQL.visible) missing.push(`visible test cases (has ${visible}, needs ${MIN_CASES.SQL.visible})`);
  if (hidden < MIN_CASES.SQL.hidden) missing.push(`hidden test cases (has ${hidden}, needs ${MIN_CASES.SQL.hidden})`);
  return missing;
}

// MCQ / TRUE_FALSE / MULTISELECT completeness (also covers PracticeQuestion's "OUTPUT_PREDICTION"
// and "DEBUG" types and InterviewQuestion's APTITUDE category — all three are options+correctAnswer
// shaped exactly like an MCQ under a different product-facing name). Mirrors — deliberately, not
// coincidentally — the exact rules routes/questions.js's normalizeOptions() already enforces at
// write time for Question rows (>=2 non-blank options, no duplicates, correctAnswer references a
// real option, single answer unless MULTISELECT): this is the read-only audit counterpart of that
// write-time gate, not a competing set of rules.
//
// IMPORTANT data-shape note: Question.correctAnswer is an array of 0-based indices;
// PracticeQuestion and InterviewQuestion (Aptitude) each store correctAnswer as a single 0-based
// index, not an array. Both are normalized to an array here so one function reads all three
// correctly — treating a bare number as "not an array, therefore missing" was the exact
// misdiagnosis this generalized version exists to avoid.
function auditChoiceCompleteness(question) {
  const missing = [];
  if (isBlank(question.description) && isBlank(question.prompt)) missing.push("question text");

  const options = Array.isArray(question.options) ? question.options : [];
  const trimmed = options.map((o) => String(o ?? "").trim());
  const nonBlankCount = trimmed.filter(Boolean).length;
  if (nonBlankCount < 2) {
    missing.push(`options (has ${nonBlankCount}, needs at least 2)`);
  } else {
    if (nonBlankCount !== options.length) missing.push("empty/whitespace-only option");
    // RAW exact-match only — no trimming, no case-folding. Confirmed against real production
    // data: a programming quiz routinely relies on an EXACT case or whitespace difference as the
    // entire point of two options — "HELLO" vs "hello" testing whether toUpperCase() mutates in
    // place, or "Java " vs "Java" vs " Programming" vs "Programming" as substring()-boundary
    // distractors where the leading/trailing space IS the correct-vs-wrong distinction. An
    // earlier, more aggressive version of this check (trim + lowercase before comparing) flagged
    // every one of those real, well-designed questions as having "duplicate options" — a false
    // positive that would have led to actually breaking correct content. Only a byte-for-byte
    // identical option string (e.g. the same text pasted in twice by mistake) counts as a
    // duplicate now.
    if (new Set(options).size !== options.length) missing.push("duplicate options");
  }

  const correctRaw = question.correctAnswer;
  const correct = Array.isArray(correctRaw) ? correctRaw : (typeof correctRaw === "number" ? [correctRaw] : []);
  if (correct.length === 0) {
    missing.push("correct answer");
  } else if (correct.some((i) => typeof i !== "number" || i < 0 || i >= options.length)) {
    missing.push("correct answer references an option that doesn't exist");
  } else if (question.questionType !== "MULTISELECT" && correct.length > 1) {
    missing.push("only one correct answer is allowed for this question type");
  }
  return missing;
}

// NUMERICAL completeness — a math-test "type the value" question. The only hard requirement is a
// stored expected value (numericAnswer, already normalised to a float at save time); tolerance is
// optional (0 = exact match, the default). Question text is required like every other type.
function auditNumericCompleteness(question) {
  const missing = [];
  if (isBlank(question.description) && isBlank(question.prompt)) missing.push("question text");
  if (typeof question.numericAnswer !== "number" || !Number.isFinite(question.numericAnswer)) missing.push("expected answer");
  if (question.numericTolerance != null && (typeof question.numericTolerance !== "number" || question.numericTolerance < 0)) {
    missing.push("tolerance must be a non-negative number");
  }
  return missing;
}

// Dispatches to the right per-type check above. `kind` lets a caller override what "CODING" vs
// "CHOICE" means for a row whose type field isn't literally Question.questionType (PracticeQuestion
// uses `type`, InterviewQuestion uses `category` — see admin.js's question-audit route for how each
// source's raw value is classified into one of CODING / SQL / CHOICE before calling this).
function auditQuestionCompleteness(question, testCases, kind) {
  if (kind === "CODING") return auditCodingCompleteness(question, testCases);
  if (kind === "SQL") return auditSqlCompleteness(question, testCases);
  if (kind === "CHOICE") return auditChoiceCompleteness(question);
  if (kind === "NUMERICAL") return auditNumericCompleteness(question);
  return [];
}

// Structural gate run before a CODING/SQL question can transition to VERIFIED (spec: "validate
// ... before an assessment becomes official"). This is a structural check, not a semantic one —
// Question has no stored reference-solution field to execute through the judge, so this catches
// the concrete "broken question" failure mode that IS checkable: too few test cases to actually
// grade a submission, a FUNCTION-mode question with no function signature for the judge to build
// a driver around, or an SQL question with no schema to run test cases against. Kept as its own
// function (rather than just calling auditCodingCompleteness/auditSqlCompleteness above and
// reusing their output) because its caller surfaces these as a save-time error message with
// different, more direct wording ("Cannot mark as VERIFIED...") than the audit report's field-name
// list — but it shares the exact same MIN_CASES thresholds, so the two can never silently drift
// apart on WHAT the minimums are, only on how a violation is phrased.
function validateQuestionForVerification(question, testCases) {
  const reasons = [];
  const cases = Array.isArray(testCases) ? testCases : [];
  const visible = cases.filter((tc) => !tc.isHidden).length;
  const hidden = cases.filter((tc) => tc.isHidden).length;

  if (question.questionType === "CODING") {
    if (visible < MIN_CASES.CODING.visible) reasons.push(`Needs at least ${MIN_CASES.CODING.visible} visible sample test cases (has ${visible})`);
    if (hidden < MIN_CASES.CODING.hidden) reasons.push(`Needs at least ${MIN_CASES.CODING.hidden} hidden test cases (has ${hidden})`);
    if (question.evaluationType === "FUNCTION") {
      const sig = question.functionSignature;
      if (!sig || !sig.methodName || !sig.returnType || !Array.isArray(sig.params)) {
        reasons.push("FUNCTION-mode question is missing a valid function signature");
      }
    }
  } else if (question.questionType === "SQL") {
    if (!question.sqlSchema || !question.sqlSchema.trim()) reasons.push("Missing SQL schema (table setup / seed data)");
    if (visible < MIN_CASES.SQL.visible) reasons.push(`Needs at least ${MIN_CASES.SQL.visible} visible sample test case (has ${visible})`);
    if (hidden < MIN_CASES.SQL.hidden) reasons.push(`Needs at least ${MIN_CASES.SQL.hidden} hidden test cases (has ${hidden})`);
  }
  return reasons;
}

module.exports = {
  MIN_CASES,
  isBlank,
  auditCodingCompleteness,
  auditSqlCompleteness,
  auditChoiceCompleteness,
  auditQuestionCompleteness,
  validateQuestionForVerification,
};
