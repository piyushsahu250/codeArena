import { useEffect, useRef } from "react";

// While an active proctored interview is on screen, the browser's Back button (and Alt+Left) must not drop the student out of it by accident. A marker entry is pushed on
// top of the page's history entry; pressing Back lands on the page's own entry, which is the same page, so the route does not change, and the marker is pushed again.
//
// This is a safeguard against accidents, NOT a lock, and it does not pretend to be one: the student can still close the tab, reload (which resumes the same session: the
// server owns the session and the timer) or leave by the address bar. onAttempt("BACK") lets the page tell them the interview is still running and record the attempt.
export function useExamNavigationGuard({ enabled, onAttempt }) {
  const attemptRef = useRef(onAttempt);
  attemptRef.current = onAttempt;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const marker = { examGuard: true };
    window.history.pushState(marker, "", window.location.href);
    const onPop = () => {
      window.history.pushState(marker, "", window.location.href);
      attemptRef.current?.("BACK");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);
}
