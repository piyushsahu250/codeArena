// Browser side of the exam-security engine. DETECTION ONLY: the server (routes/examSecurity.js, moduleCoding.js) decides
// severity, enforces the single-session rule and the secure-browser requirement, and a student can modify this code.
// Nothing here can see Copilot, ChatGPT, extensions or other applications; it records what a web page can actually
// observe. See docs/EXAM_SECURITY.md.
import api from "../api";

import { classifyInsertion } from "./codeInsertion";
export { classifyInsertion };

// Watches a Monaco editor. Skips programmatic changes (initial value/setValue = isFlush, undo, redo) so loading starter
// code or switching language never counts. Returns a disposer.
export function watchCodeInsertion(editor, { charThreshold, lineThreshold, onInsertion }) {
  const sub = editor.onDidChangeModelContent((e) => {
    if (e.isFlush || e.isUndoing || e.isRedoing) return;
    const r = classifyInsertion(e.changes, { charThreshold, lineThreshold });
    if (r.suspicious) onInsertion({ chars: r.chars, lines: r.lines });
  });
  return () => sub.dispose();
}

// Batched evidence reporter: events queue locally and go out in one request every few seconds (and when the tab is
// hidden or closing), never per keypress/mousemove/scroll. Failures are retried with the next batch; losing a weak
// signal must never affect the exam itself.
export function createEventReporter({ getAttemptId, getSessionId, flushMs = 10000, maxQueue = 50 }) {
  let queue = [];
  let timer = null;
  async function flush() {
    const attemptId = getAttemptId();
    if (!attemptId || queue.length === 0) return;
    const batch = queue.splice(0, 25);
    try {
      await api.post("/exam-security/events", { attemptId, events: batch }, { headers: { "X-Exam-Session": getSessionId?.() || "" } });
    } catch {
      queue = [...batch, ...queue].slice(0, maxQueue); // keep for the next flush, bounded
    }
  }
  function report(type, metadata, questionId) {
    if (queue.length >= maxQueue) return;
    queue.push({ type, metadata, questionId, at: Date.now() });
  }
  function start() { if (!timer) timer = setInterval(flush, flushMs); }
  function stop() { if (timer) clearInterval(timer); timer = null; flush(); }
  return { report, flush, start, stop };
}
