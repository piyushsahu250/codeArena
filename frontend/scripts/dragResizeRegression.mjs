// Regression test for dragging the panel dividers inside a test. REPORTED 2026-11-04: "dragging is not working properly inside test".
// Causes found: the handles listened for mousemove/mouseup on the window (a release outside the window or over the editor was never seen, so the panel kept following the pointer), the results
// panel added up `movementY` (wrong at browser zoom and on scaled displays), touch could not drag at all, the handle was 6-9px thick, and on the main test page the dragged size could pass the limit
// the panel is actually drawn at, so the divider looked stuck and then ignored the pointer on the way back.
// This runs the real helper (src/utils/dragResize.js) against a fake pointer-capable element, and checks both pages use it. No browser, no server.
// Run: node frontend/scripts/dragResizeRegression.mjs
import fs from "node:fs";
import { clampSize, sizeAfterDrag, sizeAfterKey, beginDrag } from "../src/utils/dragResize.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ---- the calculation
check("a size is clamped to its limits", clampSize(50, 100, 500) === 100 && clampSize(900, 100, 500) === 500 && clampSize(300, 100, 500) === 300);
check("dragging a left panel's divider right widens it", sizeAfterDrag({ start: 400, delta: 60, min: 260, max: 760 }) === 460);
check("the results panel under the editor grows when its divider moves UP (inverted)", sizeAfterDrag({ start: 220, delta: -80, invert: true, min: 100, max: 560 }) === 300 && sizeAfterDrag({ start: 220, delta: 80, invert: true, min: 100, max: 560 }) === 140);
check("limits hold however far the pointer goes", sizeAfterDrag({ start: 400, delta: 5000, min: 260, max: 760 }) === 760 && sizeAfterDrag({ start: 400, delta: -5000, min: 260, max: 760 }) === 260);
check("a maximum below the minimum cannot invert the limits (tiny window)", sizeAfterDrag({ start: 200, delta: 50, min: 100, max: 60 }) === 100);
check("arrow keys nudge by a step and stop at the limits", sizeAfterKey("ArrowRight", { size: 400, min: 260, max: 760, grow: "ArrowRight", shrink: "ArrowLeft" }) === 424 && sizeAfterKey("ArrowLeft", { size: 270, min: 260, max: 760, grow: "ArrowRight", shrink: "ArrowLeft" }) === 260 && sizeAfterKey("a", { size: 400, min: 1, max: 9, grow: "x", shrink: "y" }) === null);

// ---- the drag itself, against a fake element and page
function fake() {
  const listeners = {};
  const el = {
    captured: null,
    addEventListener(t, f) { (listeners[t] ||= new Set()).add(f); },
    removeEventListener(t, f) { listeners[t]?.delete(f); },
    setPointerCapture(id) { el.captured = id; },
    releasePointerCapture() { el.captured = null; },
    fire(t, ev) { for (const f of [...(listeners[t] || [])]) f(ev); },
    count() { return Object.values(listeners).reduce((n, s) => n + s.size, 0); },
  };
  return el;
}
globalThis.document = { body: { style: { cursor: "", userSelect: "" } } };
function press(el, opts = {}) {
  const sizes = []; let ended = null; let endCalls = 0;
  const e = { currentTarget: el, pointerId: 7, pointerType: "mouse", button: 0, clientX: 500, clientY: 600, preventDefault() { e.prevented = true; }, ...opts };
  const started = beginDrag(e, { axis: opts.axis || "x", start: 400, invert: !!opts.invert, min: 260, max: 760, onChange: (v) => sizes.push(v), onEnd: (v) => { ended = v; endCalls++; } });
  return { e, started, sizes, get ended() { return ended; }, get endCalls() { return endCalls; } };
}
const mv = (x, y, extra = {}) => ({ pointerId: 7, pointerType: "mouse", buttons: 1, clientX: x, clientY: y, ...extra });

{
  const el = fake(); const d = press(el);
  check("a left-button press starts a drag, captures the pointer, and stops the browser's own selection/drag", d.started === true && el.captured === 7 && d.e.prevented === true);
  check("the page shows a resize cursor and blocks text selection while dragging", document.body.style.cursor === "col-resize" && document.body.style.userSelect === "none");
  el.fire("pointermove", mv(560, 0)); el.fire("pointermove", mv(530, 0));
  check("the size follows the pointer from where it started", d.sizes.join() === "460,430");
  el.fire("pointermove", mv(555, 0)); el.fire("pointermove", mv(500, 0)); el.fire("pointermove", mv(620, 0));
  check("a jittery path ends exactly where the pointer ended: no drift from summing small moves", d.sizes.at(-1) === 520);
  el.fire("pointerup", { pointerId: 7 });
  check("release ends the drag once, with the final size, and gives the cursor and selection back", d.ended === 520 && d.endCalls === 1 && document.body.style.cursor === "" && document.body.style.userSelect === "");
  el.fire("pointermove", mv(900, 0)); el.fire("pointerup", { pointerId: 7 });
  check("after the end nothing moves the panel and no listener is left behind", d.sizes.length === 5 && el.count() === 0 && el.captured === null && d.endCalls === 1);
}
{
  const el = fake(); const d = press(el, { axis: "y", invert: true });
  el.fire("pointermove", mv(0, 520));
  check("a vertical drag UP grows an inverted panel", d.sizes[0] === 480 && document.body.style.cursor === "row-resize");
  el.fire("lostpointercapture", { pointerId: 7 });
  check("losing the pointer (released off the window or over the editor) ends the drag", d.endCalls === 1 && el.count() === 0);
}
{
  const el = fake(); const d = press(el);
  el.fire("pointermove", mv(520, 0));
  el.fire("pointermove", mv(560, 0, { buttons: 0 }));
  check("a move with no button down means the release was missed: the drag ends instead of following the pointer", d.endCalls === 1 && d.sizes.length === 1 && el.count() === 0);
}
{
  const el = fake(); const d = press(el);
  el.fire("pointercancel", { pointerId: 7 });
  check("a cancelled pointer (touch interrupted) ends the drag", d.endCalls === 1);
}
{
  const el = fake(); const d = press(el, { button: 2 });
  check("a right-click does not start a drag", d.started === false && el.count() === 0 && el.captured === null);
  const t = fake(); const dt = press(t, { pointerType: "touch", button: -1 });
  t.fire("pointermove", { pointerId: 7, pointerType: "touch", buttons: 0, clientX: 580, clientY: 0 });
  check("a finger drags (touch moves report no buttons and must not end the drag)", dt.started === true && dt.sizes.at(-1) === 480 && dt.endCalls === 0);
  const other = fake(); const d2 = press(other); other.fire("pointermove", mv(700, 0, { pointerId: 99 }));
  check("another pointer's moves are ignored", d2.sizes.length === 0);
}
{
  const el = fake(); const sizes = [];
  const e = { currentTarget: el, pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 0, preventDefault() {} };
  beginDrag(e, { axis: "x", start: 400, min: () => 300, max: () => 450, onChange: (v) => sizes.push(v) });
  el.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 400, clientY: 0 });
  check("limits can be functions, read at the moment of each move (the window may have been resized)", sizes[0] === 450);
}

// ---- both pages
const task = read("pages/ModuleCodingAssessment.jsx"), test = read("pages/TestTaking.jsx"), css = read("theme.css");
for (const [name, src] of [["assessment page", task], ["main test page", test]]) {
  check(`${name}: no more movementY arithmetic`, !/movementY|movementX/.test(src));
  check(`${name}: no window-level mouse listeners for the dividers`, !/window\.addEventListener\("mousemove"/.test(src) && !/onMouseDown=\{[^}]*[sS]tartResize/.test(src));
  check(`${name}: dividers use pointer events with the shared helper`, /import \{[^}]*beginDrag[^}]*\} from "\.\.\/utils\/dragResize"/.test(src) && /onPointerDown=/.test(src) && /beginDrag\(e/.test(src));
  check(`${name}: dividers are keyboard-reachable separators`, /role="separator"/.test(src) && /sizeAfterKey\(/.test(src));
}
check("main test page: a drag is limited to the height the panel is actually drawn at, and starts from the drawn height", /const resultsLimit = \(\) =>/.test(test) && /start: cappedResultsPanelHeight, invert: true, min: 100, max: resultsLimit/.test(test));
check("main test page: the question panel no longer assumes a fixed 220px left offset", !/clientX - 220/.test(test));
check("assessment page: a stored results height is clamped when read", /clampSize\(Number\(localStorage\.getItem\("moduleCodingResultsHeight"\)\)/.test(task));
check("the divider's grabbable area is wider than the drawn bar, and touch scrolling does not steal the drag", /\.ca-resize-col::after/.test(css) && /\.ca-resize-row::after/.test(css) && /touch-action: none/.test(css));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
