import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "katex/dist/katex.min.css";
import App from "./App.jsx";

// A route's lazy-loaded chunk (React.lazy in App.jsx) is a content-hashed filename baked into the
// HTML this tab loaded. Every deploy replaces those files, so a tab left open across a deploy
// tries to fetch a chunk that no longer exists — Vite fires "vite:preloadError" for that instead
// of letting it surface as an unhandled rejection that crashes to a blank screen. A single
// reload fetches the current HTML/chunk map and resolves it; the sessionStorage guard stops a
// reload loop if the failure has some other persistent cause.
const PRELOAD_RETRY_KEY = "codearena:preload-reload-attempted";
window.addEventListener("vite:preloadError", () => {
  if (sessionStorage.getItem(PRELOAD_RETRY_KEY)) return;
  sessionStorage.setItem(PRELOAD_RETRY_KEY, "1");
  window.location.reload();
});
// Clears the guard once this load has settled without hitting the error again, so a tab that
// stays open across a LATER deploy can still recover from a fresh stale-chunk failure rather than
// being silently blocked forever by a flag set during a previous, already-resolved incident.
window.addEventListener("load", () => {
  setTimeout(() => sessionStorage.removeItem(PRELOAD_RETRY_KEY), 5000);
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// An API call that failed and that no page handled (api.get(...).then(...) with no catch) reaches here as an unhandled rejection. Tell the person once,
// in plain words, instead of leaving an empty screen. Cancelled requests and session-expiry (already redirecting to login) are not reported.
window.addEventListener("unhandledrejection", (event) => {
  const err = event.reason;
  if (!err || !err.isAxiosError || err.code === "ERR_CANCELED") return;
  if (err.response?.data?.authExpired) return;
  window.dispatchEvent(new CustomEvent("app:request-failed", { detail: { status: err.response?.status || 0, message: err.response?.data?.error } }));
});
