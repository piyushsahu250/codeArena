import { API_BASE_URL } from "../api";

// Derives the realtime WS origin from the same VITE_API_URL every other call already uses (see
// api.js's own comment on why that's the single source of truth for the backend origin) — this
// is the first WebSocket endpoint on the platform (backend/src/index.js's own upgrade handler
// comment confirms it's the only one), so there's no existing helper to reuse here.
// API_BASE_URL is typically "https://api-aws.codearena.site/api" or "http://localhost:4000/api";
// strip the trailing "/api" (the WS route already carries its own "/api/ai-interviews/..." path)
// and swap the scheme: http(s) -> ws(s).
export function aiInterviewVoiceWsUrl(sessionId, ticket) {
  const origin = API_BASE_URL.replace(/\/api\/?$/, "").replace(/^http/, "ws");
  return `${origin}/api/ai-interviews/${sessionId}/voice?ticket=${encodeURIComponent(ticket)}`;
}
