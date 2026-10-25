// Regression test for src/utils/returnTo.js (returning to the page a person was on after their session expired). Pure logic with an in-memory storage: no browser, no server.
// Run: node frontend/scripts/returnToRegression.mjs
import { consumeReturnTo, isSafeReturnPath, rememberReturnTo } from "../src/utils/returnTo.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };

// 1. Ordinary in-app pages are remembered and restored for the same account, once.
{
  const s = memory();
  check("an ordinary page is remembered", rememberReturnTo("/staff/tests/new?x=1", "u1", s) === true);
  check("it comes back for the same account", consumeReturnTo("u1", s) === "/staff/tests/new?x=1");
  check("and only once", consumeReturnTo("u1", s) === null);
}

// 2. A different person signing in on the same computer does not inherit it, and it is forgotten.
{
  const s = memory();
  rememberReturnTo("/admin/users", "u1", s);
  check("another account gets nothing", consumeReturnTo("u2", s) === null);
  check("and the stored value is gone afterwards", consumeReturnTo("u1", s) === null);
}

// 3. Only safe, in-app paths are ever stored.
const unsafe = [
  "https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "evil", "", "/", "x".repeat(400),
  "/login", "/login?expired=1", "/change-password", "/logout", "/reset-password/abc", "/forgot-password", "/verify/xyz",
  "/test/123/start", "/interview/session/abc", "/ai-interview/session/abc", "/exam/1", "/secure/launch", "/a\nb",
];
for (const p of unsafe) check(`not stored: ${JSON.stringify(p.length > 40 ? p.slice(0, 40) + "..." : p)}`, isSafeReturnPath(p) === false && rememberReturnTo(p, "u1", memory()) === false);
const safe = ["/dashboard", "/staff/tests/abc/edit", "/learning/java", "/admin/users?page=2", "/staff/exam-security/readiness/abc", "/results/9"];
for (const p of safe) check(`stored: ${p}`, isSafeReturnPath(p) === true);

// 4. No account id means nothing is stored; blocked storage never throws.
check("no account id: nothing stored", rememberReturnTo("/dashboard", null, memory()) === false);
const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
check("blocked storage: remember returns false, no throw", rememberReturnTo("/dashboard", "u1", broken) === false);
check("blocked storage: consume returns null, no throw", consumeReturnTo("u1", broken) === null);

// 5. A tampered stored value is rejected.
{
  const s = memory();
  s.setItem("ca_return_to", JSON.stringify({ path: "https://evil.example/", userId: "u1" }));
  check("a tampered stored URL is refused", consumeReturnTo("u1", s) === null);
  s.setItem("ca_return_to", "not json");
  check("a corrupt stored value is refused", consumeReturnTo("u1", s) === null);
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
