// Remember where a person was when their session expired, and take them back there after they sign in again.
//
// Before this, an expired session sent people to the sign-in page and, after signing in, to their dashboard: the page they were working on was lost. Only an in-app path is ever
// stored (never a full URL, so it cannot be used as an open redirect), only for the same account that was signed in (a different person signing in on a shared computer lands on
// their own home page), and never for pages where silently re-entering would be wrong (an exam or interview in progress, the sign-in and password pages).
// Stored in sessionStorage: it is gone when the tab closes, and nothing but the path and the account id is kept (no page content, no form data).

const KEY = "ca_return_to";
const MAX_LENGTH = 300;
const BLOCKED_PREFIXES = ["/login", "/logout", "/change-password", "/reset-password", "/forgot-password", "/verify", "/register", "/test/", "/exam", "/secure"];

export function isSafeReturnPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_LENGTH) return false;
  if (path[0] !== "/" || path[1] === "/" || path[1] === "\\") return false; // in-app absolute path only: no "//host", no scheme
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.includes("/session/")) return false; // interview sessions and similar
  if (path === "/") return false;
  return !BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/") || path.startsWith(p + "?"));
}

export function rememberReturnTo(path, userId, storage = globalThis.sessionStorage) {
  try {
    if (!userId || !isSafeReturnPath(path)) return false;
    storage.setItem(KEY, JSON.stringify({ path, userId }));
    return true;
  } catch { return false; /* storage blocked */ }
}

// Returns the remembered path if it belongs to `userId` and is still safe, and always forgets it.
export function consumeReturnTo(userId, storage = globalThis.sessionStorage) {
  try {
    const raw = storage.getItem(KEY);
    storage.removeItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.userId !== userId || !isSafeReturnPath(saved.path)) return null;
    return saved.path;
  } catch { return null; }
}
