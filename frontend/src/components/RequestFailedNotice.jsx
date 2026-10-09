import { useEffect, useState } from "react";

// Pages that fire an API call without a catch used to fail silently (an empty list or an endless spinner, nothing said). main.jsx turns any API failure that
// no page handled into an "app:request-failed" event; this shows one small, dismissible message so the person knows it was not their doing and what to try.
// Throttled so a burst of failures shows one message, not a stack of them.
const SHOW_MS = 12000;
const QUIET_MS = 8000;

export default function RequestFailedNotice() {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let lastShownAt = 0;
    let hideTimer = null;
    function onFailed(e) {
      const now = Date.now();
      if (now - lastShownAt < QUIET_MS) return;
      lastShownAt = now;
      const { status, message } = e.detail || {};
      const text = !status
        ? "We couldn't reach the server. Check your internet connection, then refresh the page."
        : status >= 500
          ? "Something went wrong on our side while loading this. Please refresh and try again."
          : (message || "Some information could not be loaded.") ;
      setNotice(text);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setNotice(null), SHOW_MS);
    }
    window.addEventListener("app:request-failed", onFailed);
    return () => { window.removeEventListener("app:request-failed", onFailed); clearTimeout(hideTimer); };
  }, []);

  if (!notice) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 9999, maxWidth: 520, margin: "0 auto", padding: "12px 16px", borderRadius: 10, background: "var(--ink, #1C1B18)", color: "#fff", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", boxShadow: "0 6px 24px rgba(0,0,0,0.3)" }}>
      <span style={{ flex: 1, minWidth: 200, fontSize: 13 }}>{notice}</span>
      <button type="button" className="btn btn-ghost" style={{ background: "#fff", color: "#1C1B18" }} onClick={() => window.location.reload()}>Refresh</button>
      <button type="button" className="btn btn-ghost" style={{ color: "#fff" }} onClick={() => setNotice(null)}>Dismiss</button>
    </div>
  );
}
