// Regression test for the exam-window rule in src/utils/secureAssessment.js (assessWindowFill, windowMoved, createWindowFillMonitor). Pure logic: no browser. The monitor takes its measurements and
// its clock as arguments, so a floating window, a keyboard, a pinch-zoom, a brief glitch, a window being dragged and repeated episodes are all driven directly.
// Run: node frontend/scripts/windowFillRegression.mjs
import { assessWindowFill, windowMoved, createWindowFillMonitor } from "../src/utils/secureAssessment.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

const phone = { isMobile: true, portrait: true, availW: 412, availH: 915, innerW: 412, innerH: 800, scale: 1, typing: false, screenX: 0, screenY: 0 };
const floating = { ...phone, innerW: 300, innerH: 520, screenX: 60, screenY: 220 }; // like the reported screenshot: a small window over another app

// ---- the single measurement
check("a phone browser filling the screen is fine", assessWindowFill(phone).notFilling === false);
check("the reported floating window is not filling the screen", assessWindowFill(floating).notFilling === true && assessWindowFill(floating).reason === "narrow");
check("a narrower window is caught while typing (the keyboard never changes the width)", assessWindowFill({ ...floating, typing: true }).notFilling === true);
check("the on-screen keyboard (shorter, same width) while typing is NOT a violation", assessWindowFill({ ...phone, innerH: 380, typing: true }).notFilling === false);
check("a short window (split screen, full width) is caught when not typing", assessWindowFill({ ...phone, innerH: 400 }).notFilling === true && assessWindowFill({ ...phone, innerH: 400 }).reason === "short");
check("a normal browser bar (about 20 % off the height) is fine", assessWindowFill({ ...phone, innerH: 760 }).notFilling === false);
check("pinch-zoom is ignored", assessWindowFill({ ...floating, scale: 1.6 }).notFilling === false);
check("a desktop browser is never judged by this rule (fullscreen exit covers it)", assessWindowFill({ ...floating, isMobile: false }).notFilling === false);
check("landscape: the long axis (width) below 62 % is caught, a full-width window is not", assessWindowFill({ ...phone, portrait: false, availW: 915, availH: 412, innerW: 500, innerH: 380 }).notFilling === true && assessWindowFill({ ...phone, portrait: false, availW: 915, availH: 412, innerW: 915, innerH: 330 }).notFilling === false);
check("missing or zero screen measurements are never a violation", assessWindowFill(null).notFilling === false && assessWindowFill({ ...phone, availW: 0 }).notFilling === false);
check("movement: a window shifted by more than 24 px counts as moved, small jitter does not", windowMoved(floating, { ...floating, screenX: 120 }) === true && windowMoved(floating, { ...floating, screenX: 66, screenY: 224 }) === false && windowMoved(null, floating) === false);

// ---- the monitor: sustained, once per episode, cooldown
function run(samples, opts = {}) {
  const reports = [];
  let t = 1_000_000;
  let i = 0;
  const monitor = createWindowFillMonitor({ measure: () => samples[Math.min(i++, samples.length - 1)], now: () => t, onViolation: (r) => reports.push(r), ...opts });
  const stepAll = (n, dt = 2000) => { for (let k = 0; k < n; k++) { monitor.step(); t += dt; } };
  return { reports, monitor, stepAll, setTime: (v) => { t = v; } };
}
{
  const r = run([phone, phone, phone]);
  r.stepAll(3);
  check("a window that always fills the screen never reports", r.reports.length === 0);
}
{
  const r = run([floating, floating, phone, phone, phone]);
  r.stepAll(5);
  check("a brief glitch (2 measurements) never reaches the threshold", r.reports.length === 0);
}
{
  const r = run([floating, floating, floating, floating, floating, floating]);
  r.stepAll(6);
  check("a window that stays small is reported exactly ONCE for the episode, however long it lasts", r.reports.length === 1, `reports ${r.reports.length}`);
  check("the report says what was measured, in plain words, and never accuses", /not filling the screen \(about 73% of the screen width\)/.test(r.reports[0].text) && !/cheat|misconduct/i.test(r.reports[0].text), r.reports[0].text);
}
{
  const dragged = [floating, { ...floating, screenX: 200, screenY: 300 }, { ...floating, screenX: 40, screenY: 500 }, { ...floating, screenX: 10, screenY: 100 }];
  const r = run(dragged);
  r.stepAll(4);
  check("dragging the floating window around within one episode is still ONE report, and the report says it was moved", r.reports.length === 1 && r.reports[0].moved === true && /was moved/.test(r.reports[0].text), r.reports[0] && r.reports[0].text);
}
{
  // episode 1, back to full screen, episode 2 later than the cooldown: two independent reports
  const seq = [floating, floating, floating, phone, phone, phone, floating, floating, floating];
  const r = run(seq, { cooldownMs: 0 });
  r.stepAll(9);
  check("two separate episodes (back to full screen in between) are two independent reports", r.reports.length === 2, `reports ${r.reports.length}`);
}
{
  const seq = [floating, floating, floating, phone, phone, floating, floating, floating];
  const r = run(seq, { cooldownMs: 30000 });
  r.stepAll(8, 2000);
  check("a second episode inside the cooldown is not reported twice (the server holds the same floor)", r.reports.length === 1, `reports ${r.reports.length}`);
}
{
  const seq = [floating, floating, floating, phone, phone, floating, floating, floating];
  const r = run(seq, { cooldownMs: 30000 });
  r.stepAll(8, 20000);
  check("the same two episodes 20 s apart per measurement (far beyond the cooldown) are two reports", r.reports.length === 2, `reports ${r.reports.length}`);
}
{
  const r = run([floating, floating, floating, { ...phone, innerH: 380, typing: true }, floating, floating, floating]);
  r.stepAll(7);
  check("one keyboard-open measurement in the middle is a 'filling' measurement and does not make one episode two", r.reports.length === 1, `reports ${r.reports.length}`);
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
