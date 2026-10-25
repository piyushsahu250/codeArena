// Regression test for src/utils/editorHeight.js (editor height on a short landscape screen). Pure logic: no browser, no server.
// Run: node frontend/scripts/editorHeightRegression.mjs
import { SHORT_LANDSCAPE_EDITOR_PX, SHORT_LANDSCAPE_QUERY, editorHeightFor } from "../src/utils/editorHeight.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

check("a normal screen keeps the full editor height", editorHeightFor(380, false) === 380 && editorHeightFor(420, false) === 420 && editorHeightFor(360, false) === 360);
check("a short landscape screen caps every exam editor at the same height", [380, 420, 360].every((b) => editorHeightFor(b, true) === SHORT_LANDSCAPE_EDITOR_PX), String(SHORT_LANDSCAPE_EDITOR_PX));
check("the cap is below a landscape phone's height (about 375 px)", SHORT_LANDSCAPE_EDITOR_PX < 375 && SHORT_LANDSCAPE_EDITOR_PX >= 180);
check("an editor already smaller than the cap is not enlarged", editorHeightFor(150, true) === 150 && editorHeightFor(260, true) === SHORT_LANDSCAPE_EDITOR_PX);
check("the media query is landscape and short, so it does not depend on the keyboard", /orientation:\s*landscape/.test(SHORT_LANDSCAPE_QUERY) && /max-height:\s*500px/.test(SHORT_LANDSCAPE_QUERY));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
