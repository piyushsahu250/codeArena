// Regression test for the "A/S/D stopped typing" class of bug and for the insertion classifier. Pure functions, no DOM.
// Run: node frontend/scripts/keyboardRegression.mjs
import { classifyKeyEvent } from "../src/utils/keyboardShortcuts.js";
import { classifyInsertion } from "../src/utils/codeInsertion.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

// 1. Every ordinary typing key, with no modifier or only Shift (capitals, symbols), must be left alone.
const typing = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].concat([..."`~!@#$%^&*()-_=+[]{}\|;:'\",.<>/? "]);
check("all letters, digits and symbols type normally (no modifier)", typing.every((k) => classifyKeyEvent({ key: k }) === null));
check("Shift+letter (capitals) types normally", [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].every((k) => classifyKeyEvent({ key: k, shiftKey: true }) === null));
check("A, S, D, W, F specifically are never intercepted", ["a", "s", "d", "w", "f", "A", "S", "D", "W", "F"].every((k) => classifyKeyEvent({ key: k }) === null && classifyKeyEvent({ key: k, shiftKey: true }) === null));
check("Tab, Enter, Backspace, Delete, arrows, Home/End are never intercepted", ["Tab", "Enter", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"].every((k) => classifyKeyEvent({ key: k }) === null));
check("AltGr-style symbols (Ctrl+Alt is not Ctrl alone) still reach the editor for typing keys like [ ] { }", ["[", "]", "{", "}", "@", "\\"].every((k) => classifyKeyEvent({ key: k, shiftKey: false }) === null));

// 2. Prohibited shortcuts are still caught.
check("F12 and Ctrl+Shift+I are flagged as devtools", classifyKeyEvent({ key: "F12" }) === "DEVTOOLS" && classifyKeyEvent({ key: "I", ctrlKey: true, shiftKey: true }) === "DEVTOOLS");
check("Ctrl+S / Ctrl+P / Ctrl+T are flagged as browser shortcuts", ["s", "p", "t"].every((k) => classifyKeyEvent({ key: k, ctrlKey: true }) === "BROWSER_SHORTCUT"));
check("Cmd+S is flagged on macOS", classifyKeyEvent({ key: "s", metaKey: true }) === "BROWSER_SHORTCUT");

// 3. Insertion classifier: normal typing/autocomplete is fine, a pasted/assistant-inserted block is flagged.
check("one typed character is not flagged", !classifyInsertion([{ text: "a" }]).suspicious);
check("a 60-char autocomplete is not flagged", !classifyInsertion([{ text: "System.out.println(\"hello world\");" }]).suspicious);
check("a 500-char single insertion is flagged", classifyInsertion([{ text: "x".repeat(500) }]).suspicious);
check("a 30-line insertion is flagged", classifyInsertion([{ text: "line\n".repeat(30) }]).suspicious);
check("stricter thresholds flag smaller insertions", classifyInsertion([{ text: "y".repeat(200) }], { charThreshold: 150 }).suspicious);
check("many tiny changes in one event (multi-cursor) below threshold are fine", !classifyInsertion(Array.from({ length: 20 }, () => ({ text: "ab" }))).suspicious);

console.log(failures === 0 ? "\nKEYBOARD + INSERTION REGRESSION OK" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
