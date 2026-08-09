import axios from "axios";

// Single source of truth for the backend origin — every environment (local dev, staging,
// production) sets VITE_API_URL at build time; the localhost fallback only ever applies when
// running the Vite dev server with no .env, never in a deployed build. Exported so the two
// call sites that need a raw fetch() instead of this axios instance (keepaliveSave in
// TestTaking.jsx / ModuleCodingAssessment.jsx, which need fetch's `keepalive` flag that axios
// doesn't expose) don't each duplicate this same fallback expression.
export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// `authExpired: true` (see backend/src/middleware/auth.js) means the token/session itself is
// dead — expired, malformed, or revoked server-side (forced logout / single-session login
// elsewhere). This is deliberately NOT triggered by every 401 — the platform also returns plain
// 401s for things like an admin re-confirming their own password before deleting an academic
// group ("Incorrect password") or a wrong current-password on the change-password flow; those are
// normal inline form errors, not a dead session, and must not force a logout. Before this flag
// existed, nothing in the app handled a dead session at all: every page's own .catch() just
// displayed the raw "Invalid or expired token" string inline, so a token expiring mid-session on
// an auto-polling page (e.g. SystemMonitoring's 10s interval) meant the same error repeated
// forever with no way back to a working state short of a manual reload.
// A hard `window.location` redirect (not react-router navigate) is deliberate — this file has no
// access to AuthContext's React state, and a full reload is the simplest way to guarantee every
// bit of in-memory session state (AuthContext's `user`, any open polling intervals) tears down
// cleanly. The guard flag stops several requests failing at once (common — most pages fire
// multiple calls on mount) from triggering redundant redirects.
let redirectingToLogin = false;
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.data?.authExpired && !redirectingToLogin && window.location.pathname !== "/login") {
      redirectingToLogin = true;
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login?expired=1";
    }
    return Promise.reject(err);
  }
);

export default api;
