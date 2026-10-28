// Regression test for src/utils/scrollPolicy.js (where the page goes on each kind of navigation). Pure logic: no browser, no router.
// Run: node frontend/scripts/scrollPolicyRegression.mjs
import { decideScroll, loadPositions, savePosition, savedPosition } from "../src/utils/scrollPolicy.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const d = (o) => decideScroll({ navType: "PUSH", prevPathname: "/staff", pathname: "/staff/tests/new", ...o });

// ---- the kinds of navigation
check("a link to another page opens at the top", same(d({}), { action: "top" }));
check("a replace to another page opens at the top", same(d({ navType: "REPLACE" }), { action: "top" }));
check("the same page with a different query or state does not move (filters, tabs, pagination)", same(d({ pathname: "/staff", prevPathname: "/staff" }), { action: "keep" }) && same(d({ navType: "REPLACE", pathname: "/staff", prevPathname: "/staff" }), { action: "keep" }));
check("the first page of a visit (no previous page) opens at the top", same(d({ prevPathname: null }), { action: "top" }));
check("Back or Forward returns to the position that entry had", same(d({ navType: "POP", savedY: 640 }), { action: "restore", y: 640 }));
check("Back to an entry that was never scrolled opens at the top", same(d({ navType: "POP", savedY: 0 }), { action: "top" }) && same(d({ navType: "POP", savedY: null }), { action: "top" }));
check("Back to the SAME page path (an entry with another query) still restores its own position", same(d({ navType: "POP", pathname: "/staff", prevPathname: "/staff", savedY: 300 }), { action: "restore", y: 300 }));

// ---- sections
check("a { scrollTo } request from the navigation that made it goes to that section", same(d({ scrollTo: "manage-tests" }), { action: "element", id: "manage-tests" }));
check("it wins over 'same page keeps its place' (saving from a form returns to the list)", same(d({ pathname: "/staff", prevPathname: "/staff", scrollTo: "manage-tests" }), { action: "element", id: "manage-tests" }));
check("but going BACK to that entry restores where the user was, not the old request", same(d({ navType: "POP", scrollTo: "manage-tests", savedY: 900 }), { action: "restore", y: 900 }));
check("Back to that entry with no saved position does not replay the request either: top", same(d({ navType: "POP", scrollTo: "manage-tests", savedY: null }), { action: "top" }));
check("an address with #section goes to that section, on any kind of navigation", same(d({ hash: "#fees" }), { action: "element", id: "fees" }) && same(d({ navType: "POP", hash: "#fees", savedY: null }), { action: "element", id: "fees" }));
check("a malformed #hash does not throw", same(d({ hash: "#%E0%A4%A" }), { action: "element", id: "%E0%A4%A" }));
check("a bare '#' is not a section", same(d({ hash: "#" }), { action: "top" }));
check("an empty or non-string scrollTo is ignored", same(d({ scrollTo: "" }), { action: "top" }) && same(d({ scrollTo: 5 }), { action: "top" }));

// ---- saved positions (sessionStorage), bounded
function memoryStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
{
  const s = memoryStorage();
  savePosition("k1", 512.7, s);
  check("a position is saved per history entry and rounded", savedPosition("k1", s) === 513 && savedPosition("other", s) === null);
  savePosition("k1", -20, s);
  check("a negative position is stored as 0", savedPosition("k1", s) === 0);
  savePosition("k2", NaN, s); savePosition("", 10, s); savePosition(null, 10, s);
  check("garbage is not stored", savedPosition("k2", s) === null && Object.keys(loadPositions(s)).length === 1);
  for (let i = 0; i < 100; i++) savePosition(`e${i}`, i + 1, s);
  const all = loadPositions(s);
  check("the memory is bounded and keeps the newest entries", Object.keys(all).length === 60 && all.e99 === 100 && all.e40 === 41 && all.e39 === undefined);
  s.setItem("ca_scroll_positions", "{not json");
  check("a corrupt store is ignored, not a crash", Object.keys(loadPositions(s)).length === 0);
  s.setItem("ca_scroll_positions", "[1,2]");
  check("a store that is not an object is ignored", Object.keys(loadPositions(s)).length === 0);
  check("no storage at all is fine", savedPosition("k", null) === null && (savePosition("k", 5, null), true));
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
