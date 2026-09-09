// Pure MCQ/TRUE_FALSE/MULTISELECT options+correctAnswer logic — extracted out of routes/questions.js
// (which pulls in prisma/judge/queue/etc. and can't be safely `require()`d in isolation) so this,
// the exact write-time gate real production data has passed through, can be unit-tested directly
// with zero dependencies. See backend/test/mcqOptions.test.js for the regression coverage this
// enables — added specifically so the duplicate-option bug this session's Question Completeness
// Audit work found and closed can never silently regress.

// Normalizes/validates the type-specific fields (options + correctAnswer) for
// MCQ / TRUE_FALSE / MULTISELECT questions. Returns { options, correctAnswer }
// or throws a descriptive error.
//
// `checkDuplicates` (default true) rejects two options that are the same text (case/whitespace-
// insensitive) — closes a real gap the Question Completeness Audit surfaced: nothing anywhere
// ever rejected duplicate MCQ options, at creation or import. Defaults on for every FRESH
// submission (create, bulk-import) but the PATCH /:id route explicitly turns it off when the
// caller isn't touching options at all (falls back to the question's own already-stored values) —
// otherwise an unrelated edit (fixing a typo in the difficulty field, say) to a legacy question
// that predates this check would suddenly become unsavable until someone fixed options they never
// asked to change. New/actually-edited options are always held to the new rule; untouched legacy
// data is only ever reported by the audit, never silently rewritten or blocked from unrelated edits.
function normalizeOptions(questionType, rawOptions, rawCorrectAnswer, { checkDuplicates = true } = {}) {
  if (questionType === "TRUE_FALSE") {
    const options = ["True", "False"];
    // Deliberately takes the first resolved index only — "True" and "False" both marked correct is
    // a malformed row, but True/False has no "switch to MULTISELECT" escape hatch the way a plain
    // MCQ does, so the historical lenient behavior (pick one) is kept here rather than rejected.
    const idx = normalizeCorrectIndices(rawCorrectAnswer, options)[0];
    if (idx === undefined) throw new Error("True/False questions need a correct answer of True or False");
    return { options, correctAnswer: [idx] };
  }

  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map((o) => String(o ?? "").trim())
    .filter(Boolean);
  if (options.length < 2) throw new Error("Provide at least 2 options");
  if (checkDuplicates) {
    // Case-SENSITIVE: "HELLO" vs "hello" or "class" vs "Class" are legitimate distinct options for
    // a question that's specifically testing case-sensitivity — only an exact-text repeat (after
    // the trim already applied above) is a real duplicate, not a case fold.
    if (new Set(options).size !== options.length) throw new Error("Options must be unique — this question has a duplicate option");
  }

  const isMulti = questionType === "MULTISELECT";
  const correctAnswer = normalizeCorrectIndices(rawCorrectAnswer, options);
  if (correctAnswer.length === 0) throw new Error("Select at least one correct answer");
  // Hard reject — NOT silent truncation. normalizeCorrectIndices deliberately returns every
  // distinct valid index it parsed (it used to slice non-MULTISELECT down to the first, which made
  // this check unreachable dead code and let a bulk-import row that mistakenly listed two correct
  // answers through with an unannounced answer-key change). This mirrors the read-only audit rule
  // in utils/questionValidation.js ("only one correct answer is allowed for this question type") —
  // the two are meant to agree on every row. On bulk import the message surfaces per-row in the
  // preview, telling staff to fix the row or set its type to MULTISELECT.
  if (!isMulti && correctAnswer.length > 1) {
    throw new Error("Multiple Choice questions can only have one correct answer — mark just one option correct, or set the question type to MULTISELECT");
  }

  return { options, correctAnswer };
}

// Accepts correctAnswer as an array of 0-based indices (from the app UI) or
// as text (from spreadsheet import: option text or 1-based numbers, comma/pipe separated).
// Returns EVERY distinct valid index it can resolve, in first-seen order — it does not decide
// how many correct answers a question type is allowed. That arity rule belongs to the caller:
// normalizeOptions rejects >1 for anything that isn't MULTISELECT; its TRUE_FALSE branch takes
// the first. (An earlier version sliced non-MULTISELECT down to the first index here, which
// silently swallowed malformed multi-answer rows before normalizeOptions could reject them.)
function normalizeCorrectIndices(raw, options) {
  let tokens;
  if (Array.isArray(raw)) {
    tokens = raw;
  } else {
    tokens = String(raw ?? "").split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  }

  const indices = tokens
    .map((t) => {
      if (typeof t === "number") return t;
      const s = String(t).trim();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        // Heuristic: treat as a 1-based option number if in range, else 0-based index
        if (n >= 1 && n <= options.length) return n - 1;
        if (n >= 0 && n < options.length) return n;
        return -1;
      }
      return options.findIndex((o) => o.trim().toLowerCase() === s.toLowerCase());
    })
    .filter((i) => i >= 0 && i < options.length);

  const unique = [...new Set(indices)];
  if (unique.length > 0) return unique;

  // Confirmed live on a real bulk import: this splits on comma AND pipe to support
  // MULTISELECT's "OptionA, OptionB" convention, but that collides with a perfectly legitimate
  // single-answer text that itself contains a comma (e.g. "Samkhya, Yoga, Nyaya, Vaisheshika,
  // Mimamsa, Vedanta" naming a list) -- every comma-fragment then fails to match the full option
  // text, and the row gets rejected outright. Same failure mode for a correct-answer text that's
  // purely digits but out of range as an option number (e.g. "25", the actual numeric answer to a
  // question, mistaken for a 1-based index into a 4-option list). Only reached when the normal
  // split-based parse found NOTHING at all, so this can never change an already-successful
  // outcome — it retries the entire raw string, untouched, as one literal answer.
  if (!Array.isArray(raw)) {
    const whole = String(raw ?? "").trim();
    const wholeMatch = whole ? options.findIndex((o) => o.trim().toLowerCase() === whole.toLowerCase()) : -1;
    if (wholeMatch >= 0) return [wholeMatch];
  }
  return unique;
}

module.exports = { normalizeOptions, normalizeCorrectIndices };
