// What colour a question's box in the question navigator shows, in every test screen. REPORTED 2026-11-05: moving on from a question without answering it left its box looking untouched, so a student
// could not see what they had skipped. The rule, one place so the screens cannot disagree:
//   green   the question is answered (also while it is the one open)
//   yellow  the student has been to the question, left it, and it is not answered (a skipped question)
//   plain   not visited yet (and the question that is open right now, until it is answered)
// Marked-for-review (purple) and a failed coding submission (red) keep their own colours and come first, because they say more than "skipped". The open question is also ringed by the screen.

export const STATUS = { REVIEW: "review", WRONG: "wrong", ANSWERED: "answered", SKIPPED: "skipped", UNSEEN: "unseen" };

export function paletteStatus({ answered = false, visited = false, current = false, marked = false, wrong = false } = {}) {
  if (marked) return STATUS.REVIEW;
  if (wrong) return STATUS.WRONG;
  if (answered) return STATUS.ANSWERED;
  if (visited && !current) return STATUS.SKIPPED;
  return STATUS.UNSEEN;
}

// Words for a screen reader, so the colour is never the only signal.
export function paletteLabel(index, status, { current = false } = {}) {
  const word = { review: "marked for review", wrong: "last submission failed", answered: "answered", skipped: "skipped, not answered", unseen: "not visited" }[status] || "not visited";
  return `Question ${index + 1}, ${word}${current ? ", current question" : ""}`;
}

// How many of a list are skipped (for a summary line): visited, not the open one, not answered.
export function countSkipped(items, { isAnswered, isVisited, currentIndex }) {
  return items.filter((it, i) => i !== currentIndex && isVisited(it, i) && !isAnswered(it, i)).length;
}

// The set of question ids a student has been to, kept in the browser for the length of the attempt so a reload does not forget which ones were skipped. Storage can be refused; the page then works
// from memory only.
export function loadVisited(key, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  try {
    const raw = storage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function saveVisited(key, visited, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  try { storage?.setItem(key, JSON.stringify(visited)); } catch { /* storage refused: memory only */ }
}
