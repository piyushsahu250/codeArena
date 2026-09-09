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
    const idx = normalizeCorrectIndices(rawCorrectAnswer, options, false)[0];
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
  const correctAnswer = normalizeCorrectIndices(rawCorrectAnswer, options, isMulti);
  if (correctAnswer.length === 0) throw new Error("Select at least one correct answer");
  if (!isMulti && correctAnswer.length > 1) throw new Error("Multiple Choice questions can only have one correct answer");

  return { options, correctAnswer };
}

// Accepts correctAnswer as an array of 0-based indices (from the app UI) or
// as text (from spreadsheet import: option text or 1-based numbers, comma/pipe separated).
function normalizeCorrectIndices(raw, options, isMulti) {
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
  if (unique.length > 0) return isMulti ? unique : unique.slice(0, 1);

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
