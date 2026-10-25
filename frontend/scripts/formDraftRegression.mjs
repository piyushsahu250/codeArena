// Regression test for src/utils/formDraft.js (keeping an unsaved form as a draft). Pure logic with an in-memory storage: no browser, no server.
// Run: node frontend/scripts/formDraftRegression.mjs
import { DRAFT_MAX_CHARS, DRAFT_TTL_MS, clearDraft, draftKey, loadDraft, saveDraft } from "../src/utils/formDraft.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const T0 = 1_800_000_000_000;

// keys
check("the key contains the account and the form", draftKey("u1", "test:new") === "ca_draft:u1:test:new");
check("no account or no form: no key", draftKey("", "test:new") === null && draftKey("u1", "") === null);

// save and load
{
  const s = memory(); const k = draftKey("u1", "test:new");
  check("a draft is saved", saveDraft(k, '{"title":"Midterm"}', null, s, T0) === true);
  const d = loadDraft(k, { storage: s, now: T0 + 5000 });
  check("and comes back unchanged", d && d.data === '{"title":"Midterm"}' && d.savedAt === T0);
  check("loading does not delete it (it can be offered again after another reload)", loadDraft(k, { storage: s, now: T0 + 6000 }) !== null);
  clearDraft(k, s);
  check("clearing removes it", loadDraft(k, { storage: s, now: T0 + 7000 }) === null);
}

// expiry
{
  const s = memory(); const k = draftKey("u1", "test:new");
  saveDraft(k, "x", null, s, T0);
  check("a draft just inside 24 hours is offered", loadDraft(k, { storage: s, now: T0 + DRAFT_TTL_MS - 1000 }) !== null);
  check("a draft older than 24 hours is dropped", loadDraft(k, { storage: s, now: T0 + DRAFT_TTL_MS + 1000 }) === null);
  check("and removed from storage", s.getItem(k) === null);
}

// stale record
{
  const s = memory(); const k = draftKey("u1", "test:abc");
  saveDraft(k, "x", { version: 3 }, s, T0);
  check("a draft of the same version is offered", loadDraft(k, { meta: { version: 3 }, storage: s, now: T0 + 1000 }) !== null);
  check("a draft of an older version is dropped (it would overwrite newer saved work)", loadDraft(k, { meta: { version: 4 }, storage: s, now: T0 + 2000 }) === null);
  check("and removed", s.getItem(k) === null);
}

// accounts do not mix
{
  const s = memory();
  saveDraft(draftKey("u1", "test:new"), "mine", null, s, T0);
  check("another account does not see it", loadDraft(draftKey("u2", "test:new"), { storage: s, now: T0 + 1000 }) === null);
}

// limits and failures
{
  const s = memory(); const k = draftKey("u1", "test:new");
  check("a form too large to store safely is not drafted", saveDraft(k, "x".repeat(DRAFT_MAX_CHARS + 1), null, s, T0) === false && s.getItem(k) === null);
  check("a non-string is refused", saveDraft(k, { a: 1 }, null, s, T0) === false);
  s.setItem(k, "not json");
  check("a corrupt value is ignored", loadDraft(k, { storage: s, now: T0 }) === null);
  s.setItem(k, JSON.stringify({ savedAt: T0, meta: null, data: 5 }));
  check("a value of the wrong shape is dropped", loadDraft(k, { storage: s, now: T0 }) === null && s.getItem(k) === null);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  check("blocked storage: save false, load null, clear silent", saveDraft(k, "x", null, broken, T0) === false && loadDraft(k, { storage: broken, now: T0 }) === null && (clearDraft(k, broken), true));
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
