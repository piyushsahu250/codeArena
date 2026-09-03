// Deterministic, seeded MCQ option-order shuffling for student-facing surfaces that have no
// per-attempt row of their own to persist a shuffle into (unlike Test/TestAttempt.optionOrder,
// which IS persisted — see routes/tests.js buildAttemptOrder() and routes/submissions.js
// toOriginalIndices()). LMS Practice Questions (re-answerable anytime, no attempt concept),
// Readiness Assessments, and Interview Aptitude questions all serve the same raw, unshuffled
// Question.options/correctAnswer to every student on every view — which is exactly what let any
// authoring-time bias in *where* the correct answer sits (see the MCQ distribution audit) show up
// as a directly-observable fixed pattern to students, since nothing ever varied the display order.
//
// A shuffle seeded from `${studentId}:${questionId}` is stable for that pair forever (a refresh, a
// re-open, a retry all reproduce the identical permutation) without writing anything new to the
// database — the same "no schema change needed" outcome the fix spec calls for, achieved by making
// the shuffle a pure function of identity instead of stored state.
"use strict";

// xmur3-style string hash -> 32-bit int seed, then mulberry32 as the PRNG. Not cryptographic —
// display-order randomization only, same trust level as Math.random() elsewhere on this platform,
// just deterministic for a given seed string instead of fresh every call.
function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = (h ^= h >>> 16) >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, seedStr) {
  const arr = array.slice();
  const rng = seededRng(seedStr);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Returns { options, order, correctAnswer } — `options` in shuffled display order, `order[i]` =
// the ORIGINAL index now shown at position i (same convention as TestAttempt.optionOrder), and
// `correctAnswer` re-expressed as a position in the SHUFFLED array so callers that just render
// `options[correctAnswer]` keep working unchanged. `originalCorrectAnswer` may be a number or a
// number[] (single- vs multi-correct) — both are supported and shaped back the same way.
function shuffleQuestionOptions(options, originalCorrectAnswer, seedStr) {
  if (!Array.isArray(options) || options.length < 2) {
    return { options, order: Array.isArray(options) ? options.map((_, i) => i) : [], correctAnswer: originalCorrectAnswer };
  }
  const order = seededShuffle(options.map((_, i) => i), seedStr);
  const shuffledOptions = order.map((origIdx) => options[origIdx]);
  const remap = (origIdx) => order.indexOf(origIdx);
  const correctAnswer = Array.isArray(originalCorrectAnswer)
    ? originalCorrectAnswer.map(remap)
    : typeof originalCorrectAnswer === "number"
    ? remap(originalCorrectAnswer)
    : originalCorrectAnswer;
  return { options: shuffledOptions, order, correctAnswer };
}

// Inverts a shuffled-position selection (number or number[]) back to original option index/indices,
// given the `order` permutation returned by shuffleQuestionOptions. Mirrors submissions.js's
// toOriginalIndices for the persisted-optionOrder case.
function toOriginalSelection(selected, order) {
  if (!order || !order.length) return selected;
  const map = (pos) => (typeof pos === "number" && pos >= 0 && pos < order.length ? order[pos] : pos);
  return Array.isArray(selected) ? selected.map(map) : map(selected);
}

module.exports = { seededShuffle, shuffleQuestionOptions, toOriginalSelection };
