// What the screen between two sections of an examination says. Pure functions over the section objects the server sends (exams.view.js), so the wording and the counts can be tested
// without a browser. Nothing here decides what is allowed: the server owns the order, the clock and the rules; this only describes them to the student.

const UNIT = { CODING: ["problem", "problems"], AI_INTERVIEW: ["question", "questions"] };

export function unitWord(key, n) {
  const [one, many] = UNIT[key] || ["question", "questions"];
  return n === 1 ? one : many;
}

// "2 of 4 sections done" and the bar's fill.
export function sectionProgress(sections) {
  const list = sections || [];
  const done = list.filter((s) => s.status === "COMPLETED").length;
  return { done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// 1-based position of a section in the examination, "Section 3 of 4".
export function positionOf(sections, key) {
  const i = (sections || []).findIndex((s) => s.key === key);
  return i < 0 ? null : { n: i + 1, of: sections.length };
}

// The four facts shown as tiles for the section that is about to open.
export function sectionFacts(section) {
  if (!section) return [];
  const facts = [
    { label: section.key === "CODING" ? "Problems" : "Questions", value: String(section.questionCount) },
    { label: "Marks", value: String(section.maxMarks) },
  ];
  facts.push({ label: "Time", value: section.durationMin ? `${section.durationMin} min` : "Shared with the total" });
  facts.push({ label: "Moving around", value: section.navigation === "FORWARD_ONLY" ? "Forward only" : "Go back freely" });
  return facts;
}

// The rules that matter before the student presses open, in the order they would want to read them. Only things the server actually enforces for this section are listed.
export function sectionNotes(section) {
  if (!section) return [];
  const notes = [];
  if (section.durationMin) notes.push(`You have ${section.durationMin} minutes for this section. Its own timer starts the moment you open it and cannot be paused.`);
  else notes.push("This section has no timer of its own; it runs inside the total examination time.");
  notes.push("Once you submit this section it is closed and cannot be reopened.");
  notes.push(section.navigation === "FORWARD_ONLY" ? "You can only move forward: you cannot return to an earlier question." : "You can move between questions and change your answers until you submit the section.");
  if (section.requireAllAnswered) notes.push("Every question in this section must be answered before it can be submitted.");
  if (section.key === "CODING" && section.maxSubmissionsPerProblem) notes.push(`You may submit each problem up to ${section.maxSubmissionsPerProblem} times; run your code as often as you like first.`);
  if (section.key === "AI_INTERVIEW") notes.push(section.interview?.answerInput === "TYPED" ? "Answer each question in your own words by typing." : "Answer each question in your own words. You may type, or speak and let the browser transcribe it, then edit the text.");
  if (section.key === "AI_INTERVIEW" && section.interview?.cameraRequired) notes.push("Keep your camera on and stay in view while you answer.");
  return notes;
}

// The line under a finished section in the progress list: "7 of 10 answered · 10 marks".
export function doneLine(section) {
  const total = section.questionCount;
  const answered = Math.min(section.answered ?? 0, total);
  return `${answered} of ${total} answered`;
}

export function headline(sections, hasCompleted) {
  if (!hasCompleted) return "Ready to begin";
  const { done, total } = sectionProgress(sections);
  return done >= total ? "All sections are complete" : "Section complete";
}
