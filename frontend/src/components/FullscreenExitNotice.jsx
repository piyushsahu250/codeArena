import { useEffect, useState } from "react";
import { getFullscreenElement, onFullscreenChange } from "../utils/fullscreenCompat";
import { dismissFullscreenNotice, getFullscreenStatus, retryExitFullscreen, subscribeFullscreenStatus } from "../utils/fullscreenSession";

// Shown only when the browser refused to leave fullscreen after a session ended (see utils/fullscreenSession.js). Never claims success: it stays until the
// browser is really out of fullscreen, offers Retry, and tells the person Esc always works.
export default function FullscreenExitNotice() {
  const [failed, setFailed] = useState(getFullscreenStatus().exitFailed);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => subscribeFullscreenStatus((s) => setFailed(s.exitFailed)), []);
  // the real browser state wins: once fullscreen is gone the notice goes away by itself
  useEffect(() => onFullscreenChange(() => { if (!getFullscreenElement()) dismissFullscreenNotice(); }), []);

  if (!failed || !getFullscreenElement()) return null;
  return (
    <div role="alert" style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 10000, maxWidth: 520, margin: "0 auto", padding: "12px 16px", borderRadius: 10, background: "var(--ink, #1C1B18)", color: "#fff", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", boxShadow: "0 6px 24px rgba(0,0,0,0.3)" }}>
      <span style={{ flex: 1, minWidth: 200, fontSize: 13 }}>The session has ended, but your browser is still in fullscreen. Press Esc, or use the button.</span>
      <button className="btn btn-ghost" style={{ background: "#fff", color: "#1C1B18" }} disabled={retrying}
        onClick={async () => { setRetrying(true); await retryExitFullscreen(); setRetrying(false); }}>
        {retrying ? "Leaving…" : "Exit fullscreen"}
      </button>
      <button className="btn btn-ghost" style={{ color: "#fff" }} onClick={dismissFullscreenNotice}>Dismiss</button>
    </div>
  );
}
