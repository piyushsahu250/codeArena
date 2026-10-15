import { useEffect, useRef } from "react";
import api from "../api";
import { detectAiAssistantKey } from "../utils/keyboardShortcuts";

// Reports observed AI-assistant launcher keys (the Windows Copilot key signature) during an active formal-test attempt, when the test's policy turns this on.
//  * Observation only. A page sees a key combination, never an application, and the OS or firmware may handle the key first; cancelling the event is
//    best-effort and the report says whether it was cancelable. Nothing here is penalised, auto-submitted or called a violation.
//  * The server is the authority: it accepts these events only for the student's own IN_PROGRESS attempt whose policy has the switch on, so a flag set here
//    changes nothing on its own.
//  * Capture-phase listener on window, added once per enabled period and removed on cleanup. Repeats inside a 3 s window are one report with a count; a failed
//    send is retried a few times and never blocks typing, autosave or submission.
const FLUSH_MS = 3000;
const RETRY_MS = 10000;
const MAX_QUEUE = 20;

export default function useAiShortcutSignals({ enabled, getAttemptId, isFinished }) {
  const getIdRef = useRef(getAttemptId);
  const finishedRef = useRef(isFinished);
  useEffect(() => { getIdRef.current = getAttemptId; finishedRef.current = isFinished; });

  useEffect(() => {
    if (!enabled) return undefined;
    let queue = [];
    let timer = null;
    let disposed = false;

    async function flush() {
      timer = null;
      const attemptId = getIdRef.current?.();
      if (!attemptId || queue.length === 0) return;
      const batch = queue;
      queue = [];
      try {
        await api.post("/exam-security/test-events", { attemptId, events: batch });
      } catch {
        if (!disposed && batch.length + queue.length <= MAX_QUEUE) {
          queue = batch.concat(queue);
          timer = setTimeout(flush, RETRY_MS);
        }
      }
    }

    function onKeyDown(e) {
      if (finishedRef.current?.()) return;
      const type = detectAiAssistantKey(e);
      if (!type) return;
      const cancelable = e.cancelable === true;
      if (cancelable) { e.preventDefault(); e.stopPropagation(); }
      const existing = queue.find((q) => q.type === type);
      if (existing) existing.metadata.count += 1;
      else if (queue.length < MAX_QUEUE) {
        queue.push({
          type,
          metadata: {
            code: e.code || "", key: e.key || "", metaKey: !!e.metaKey, shiftKey: !!e.shiftKey, ctrlKey: !!e.ctrlKey, altKey: !!e.altKey,
            cancelable, cancelAttempted: cancelable, defaultPrevented: e.defaultPrevented === true, count: 1, clientAt: Date.now(),
          },
        });
      }
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown, true);
      if (timer) clearTimeout(timer);
      if (queue.length) flush(); // last best-effort send; the server ignores it if the attempt has already closed
    };
  }, [enabled]);
}
