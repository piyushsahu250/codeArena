// Keep an unsaved form as a draft so that a reload, a crashed tab or an expired session does not lose a long form (the create-test page is the first user).
//
// Stored in sessionStorage: it belongs to this browser tab and is gone when the tab is closed, so nothing lingers on a shared computer. The key contains the account id, so another person
// signing in on the same tab never sees it. A draft is only offered back (never applied silently), expires after 24 hours, and is dropped if the thing it was a draft of has changed
// since (`meta`, for example the record's version number), so an old draft cannot overwrite newer saved work.

const PREFIX = "ca_draft:";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_MAX_CHARS = 400000; // well under the usual ~5 MB storage quota; a larger form is simply not drafted

export function draftKey(userId, scope) {
  return userId && scope ? `${PREFIX}${userId}:${scope}` : null;
}

export function saveDraft(key, data, meta = null, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    if (!key || typeof data !== "string") return false;
    const body = JSON.stringify({ savedAt: now, meta, data });
    if (body.length > DRAFT_MAX_CHARS) return false;
    storage.setItem(key, body);
    return true;
  } catch { return false; /* storage blocked or full */ }
}

// Returns { data, savedAt } or null. Removes a draft that is expired, corrupt or stale.
export function loadDraft(key, { meta = null, storage = globalThis.sessionStorage, now = Date.now() } = {}) {
  try {
    if (!key) return null;
    const raw = storage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const fresh = d && typeof d.data === "string" && typeof d.savedAt === "number" && now - d.savedAt <= DRAFT_TTL_MS && now >= d.savedAt - 60000;
    const sameMeta = JSON.stringify(d?.meta ?? null) === JSON.stringify(meta ?? null);
    if (!fresh || !sameMeta) { storage.removeItem(key); return null; }
    return { data: d.data, savedAt: d.savedAt };
  } catch { return null; }
}

export function clearDraft(key, storage = globalThis.sessionStorage) {
  try { if (key) storage.removeItem(key); } catch { /* storage blocked */ }
}
