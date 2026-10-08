// Proves the central permission registry grants exactly what the requireRole(...) lists it replaced did, for every role, and exercises the guard.
//   node scripts/verifyPermissions.js
const { REGISTRY, can, requirePermission } = require("../src/utils/permissions");
const ROLES = ["STUDENT", "STAFF", "CLERK", "ADMIN", "INSTITUTE_ADMIN", "SUPER_ADMIN"];
// The original requireRole lists for the routes converted so far.
const ORIGINAL = {
  "student.portal": ["STUDENT"],
  "staff.console": ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"],
  "staff.workspace": ["STAFF"],
  "clerk.workspace": ["CLERK"],
  "placement.console": ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"],
  "institute.console": ["SUPER_ADMIN", "ADMIN", "INSTITUTE_ADMIN"],
  "platform.console": ["SUPER_ADMIN", "ADMIN"],
  "platform.owner": ["SUPER_ADMIN"],
};
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++; };

(async () => {
  check("every registry key has an original list", Object.keys(REGISTRY).every((k) => ORIGINAL[k]) && Object.keys(ORIGINAL).every((k) => REGISTRY[k]));
  let mismatches = 0;
  for (const key of Object.keys(ORIGINAL)) for (const role of ROLES) {
    const got = await can({ role }, key);
    if (got !== ORIGINAL[key].includes(role)) { mismatches++; console.log(`   mismatch ${key} / ${role}: got ${got}`); }
  }
  check(`can() equals the original role lists (${Object.keys(ORIGINAL).length} keys x ${ROLES.length} roles)`, mismatches === 0);
  check("unknown key is denied", (await can({ role: "SUPER_ADMIN" }, "no.such.key")) === false);
  check("missing user is denied", (await can(null, "student.portal")) === false);
  let threw = false; try { requirePermission("no.such.key"); } catch { threw = true; }
  check("requirePermission rejects an unknown key at startup", threw);

  const run = (user, key) => new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
    requirePermission(key)({ user, headers: {}, originalUrl: "/x", method: "GET" }, res, () => resolve(200));
  });
  check("guard lets an allowed role through", (await run({ role: "STUDENT", id: "x" }, "student.portal")) === 200);
  check("guard answers 403 to a role without the permission", (await run({ role: "STUDENT", id: "x" }, "platform.console")) === 403);
  check("guard answers 403 with no user", (await run(undefined, "student.portal")) === 403);
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
