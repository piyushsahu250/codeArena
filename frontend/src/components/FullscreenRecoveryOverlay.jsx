import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Shown over a running exam that REQUIRES fullscreen while the page is not in fullscreen (the student pressed Esc, or came back from another tab and the browser had left fullscreen).
// What it does and does not do, honestly:
//   * It blocks the exam until the student presses the button. Browsers only allow fullscreen from a user gesture, so the page cannot (and does not try to) force it back by itself; the one
//     request is made from this button's click. It never loops: one request per press, and the result of that request is verified by the caller (resume() returns whether the browser really
//     is in fullscreen now), not assumed.
//   * The page behind it is made inert and hidden, so the questions cannot be read or answered from a small window while recovery is pending. The timer keeps running (nothing is paused or
//     extended) and is shown here, because the student's time is not affected by this screen.
//   * If the browser refuses fullscreen, the reason is said plainly after each failed press. This overlay is only used where the browser can do fullscreen at all and on devices with a physical
//     keyboard layout (see TestTaking.jsx): on phones and tablets the on-screen keyboard itself leaves fullscreen, which would trap a student who is typing.
export default function FullscreenRecoveryOverlay({ timeLabel, resume }) {
  const buttonRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);

  // Focus the button, keep focus inside the dialog, and make the page behind it inert for keyboards and assistive technology while it is up.
  useEffect(() => {
    const root = document.getElementById("root");
    const wasInert = root ? root.hasAttribute("inert") : false;
    if (root && !wasInert) root.setAttribute("inert", "");
    buttonRef.current?.focus();
    const trap = (e) => { if (e.key === "Tab") { e.preventDefault(); buttonRef.current?.focus(); } };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      if (root && !wasInert) root.removeAttribute("inert");
    };
  }, []);

  async function press() {
    if (busy) return;
    setBusy(true);
    let ok = false;
    try { ok = !!(await resume()); } catch { ok = false; }
    setBusy(false);
    if (!ok) setFailures((n) => n + 1); // on success the overlay unmounts: fullscreen is real again
  }

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fs-recovery-title"
      aria-describedby="fs-recovery-body"
      style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "var(--paper, #FAF7F0)", color: "var(--ink, #1C1B18)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <h2 id="fs-recovery-title" style={{ margin: 0 }}>Fullscreen is required</h2>
        <p id="fs-recovery-body" style={{ marginTop: 12, lineHeight: 1.6 }}>
          Fullscreen mode is required for this assessment. Your exit from fullscreen has been recorded. Select Re-enter Fullscreen to continue.
        </p>
        <p className="mono" style={{ marginTop: 8, fontSize: 13 }} aria-live="off">Time remaining: {timeLabel}. Your time keeps running and your answers are saved.</p>
        <button ref={buttonRef} className="btn btn-primary" style={{ marginTop: 18, padding: "12px 24px" }} onClick={press} disabled={busy}>
          {busy ? "Entering fullscreen…" : "Re-enter Fullscreen"}
        </button>
        {failures > 0 && (
          <p role="alert" style={{ marginTop: 14, fontSize: 13, color: "var(--rust)", lineHeight: 1.5 }}>
            Your browser did not enter fullscreen. Press the button again. If it keeps failing, check that this site is allowed to use fullscreen in your browser settings, close any window that is asking for permission, or use a different browser.
            {failures >= 3 && " If fullscreen cannot be used on this device at all, tell your invigilator now: your time is still running."}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
