// Progress helpers for the examination screens. isAnswered mirrors the server's rule (backend utils/examQuestions.js isAnswerNonEmpty), so what the page counts as answered is
// what the server counts; the server's own count is still the one that decides whether a section may be completed.
export function isAnswered(sectionKey, payload) {
  if (!payload) return false;
  if (sectionKey === "APTITUDE" || sectionKey === "TECHNICAL") return Array.isArray(payload.selected) ? payload.selected.length > 0 : payload.selected !== null && payload.selected !== undefined;
  if (sectionKey === "AI_INTERVIEW") return typeof payload.text === "string" && payload.text.trim().length > 0;
  if (sectionKey === "CODING") return typeof payload.code === "string" && payload.code.trim().length > 0;
  return false;
}

export function countAnswered(sectionKey, items, drafts) {
  return (items || []).filter((i) => isAnswered(sectionKey, drafts?.[i.id])).length;
}

// "answered 4 of 10" and the list of unanswered question numbers for the review before a section is submitted.
export function reviewSummary(sectionKey, items, drafts) {
  const list = items || [];
  const unanswered = [];
  list.forEach((item, i) => { if (!isAnswered(sectionKey, drafts?.[item.id])) unanswered.push(i + 1); });
  return { total: list.length, answered: list.length - unanswered.length, unanswered };
}

// Where a section stands for the navigation bar.
export function sectionState(section) {
  if (!section) return "locked";
  if (section.status === "COMPLETED") return "done";
  if (section.status === "IN_PROGRESS") return "open";
  return "locked";
}

// The next section the student may open, or null: strictly in order, only when none is open.
export function nextOpenable(sections) {
  const list = sections || [];
  if (list.some((s) => s.status === "IN_PROGRESS")) return null;
  return list.find((s) => s.status === "LOCKED") || null;
}

export function allSectionsDone(sections) {
  return (sections || []).length > 0 && sections.every((s) => s.status === "COMPLETED");
}

// A server error code -> the sentence the student sees. Unknown codes fall back to the server's own message.
export function examErrorMessage(err, fallback = "Something went wrong. Your saved answers are safe.") {
  const code = err?.response?.data?.code;
  const map = {
    SESSION_REPLACED: "This examination is open in another tab, window or device. Close this one and continue there.",
    SECTION_ORDER: "Sections must be completed in order.",
    ANOTHER_SECTION_OPEN: "Finish the section that is open first.",
    ALREADY_COMPLETED: "This section was already submitted and cannot be reopened.",
    UNSAVED_ANSWERS: "Some answers have not reached the server yet. Wait until they show as saved, then try again.",
    UNANSWERED: "This section requires every question to be answered.",
    EXAM_EXPIRED: "Time is up. Your saved answers have been submitted.",
    SECTION_EXPIRED: "Time is up for this section.",
    ATTEMPT_CLOSED: "This examination is no longer accepting answers.",
    ANSWER_LOCKED: "This answer can no longer be changed.",
    NAVIGATION_FORWARD_ONLY: "In this section you cannot go back to an earlier question.",
    SUBMISSION_LIMIT: "You have used all submissions for this problem.",
    JUDGE_BUSY: "The code runner is busy. Your code is saved; try again in a moment.",
    JUDGE_UNAVAILABLE: "The code runner is unavailable. Your code is saved; try again in a moment.",
    READINESS_INCOMPLETE: "A required readiness check has not passed yet.",
    SECTIONS_INCOMPLETE: "Finish every section before submitting the examination.",
    NOT_STARTED: "This examination has not opened yet.",
    CLOSED: "This examination is closed.",
    EXAM_NOT_READY: "This examination is not ready yet. Please contact your administrator.",
  };
  return map[code] || err?.response?.data?.error || fallback;
}
