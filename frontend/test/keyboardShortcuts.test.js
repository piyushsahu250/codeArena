import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyKeyEvent } from "../src/utils/keyboardShortcuts.js";

// Root-cause regression suite for the "A/S/D not typing" report (2026-09-11). The literal claim
// under test: every bare letter/number/symbol keystroke -- with no modifier held -- must classify
// as null (normal input, never intercepted/preventDefault()'d), for every key on a standard
// keyboard, not just A/S/D. Modifier combinations must still classify correctly so the
// proctoring/anti-cheat behavior these functions gate is provably unchanged by the refactor.

test("every bare A-Z letter (no modifier) is normal input, never intercepted", () => {
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    assert.equal(classifyKeyEvent({ key: letter.toLowerCase() }), null, `bare "${letter.toLowerCase()}" must not be intercepted`);
    assert.equal(classifyKeyEvent({ key: letter }), null, `bare "${letter}" (shift-typed capital) must not be intercepted`);
  }
});

test("bare digits 0-9 (no modifier) are normal input", () => {
  for (let d = 0; d <= 9; d++) {
    assert.equal(classifyKeyEvent({ key: String(d) }), null);
  }
});

test("bare symbols/punctuation (no modifier) are normal input", () => {
  const symbols = ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "-", "_", "=", "+", "[", "]", "{", "}",
    ";", ":", "'", '"', ",", ".", "/", "<", ">", "?", "\\", "|", "`", "~", " ", "Enter", "Backspace",
    "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
  for (const key of symbols) {
    assert.equal(classifyKeyEvent({ key }), null, `bare "${key}" must not be intercepted`);
  }
});

test("shift-only letter combos (capital letters via Shift) are still normal input", () => {
  // Shift alone must never trigger a classification -- only Ctrl/Cmd (+ optionally Shift) does.
  for (const key of ["a", "s", "d", "A", "S", "D", "i", "j", "c", "u", "t"]) {
    assert.equal(classifyKeyEvent({ key, shiftKey: true }), null, `Shift+${key} alone must not be intercepted`);
  }
});

test("PrintScreen is always PRINT_SCREEN_ATTEMPT, with or without modifiers", () => {
  assert.equal(classifyKeyEvent({ key: "PrintScreen" }), "PRINT_SCREEN_ATTEMPT");
  assert.equal(classifyKeyEvent({ key: "PrintScreen", ctrlKey: true }), "PRINT_SCREEN_ATTEMPT");
});

test("F12 alone is DEVTOOLS", () => {
  assert.equal(classifyKeyEvent({ key: "F12" }), "DEVTOOLS");
});

test("Ctrl/Cmd+Shift+I/J/C are DEVTOOLS (inspector/console/element-picker)", () => {
  for (const k of ["i", "j", "c", "I", "J", "C"]) {
    assert.equal(classifyKeyEvent({ key: k, ctrlKey: true, shiftKey: true }), "DEVTOOLS", `Ctrl+Shift+${k}`);
    assert.equal(classifyKeyEvent({ key: k, metaKey: true, shiftKey: true }), "DEVTOOLS", `Cmd+Shift+${k}`);
  }
});

test("Ctrl/Cmd+U (view-source) is DEVTOOLS", () => {
  assert.equal(classifyKeyEvent({ key: "u", ctrlKey: true }), "DEVTOOLS");
  assert.equal(classifyKeyEvent({ key: "U", metaKey: true }), "DEVTOOLS");
});

test("Ctrl/Cmd+S/P/W/N/T/R/L are BROWSER_SHORTCUT", () => {
  for (const k of ["s", "p", "w", "n", "t", "r", "l"]) {
    assert.equal(classifyKeyEvent({ key: k, ctrlKey: true }), "BROWSER_SHORTCUT", `Ctrl+${k}`);
    assert.equal(classifyKeyEvent({ key: k.toUpperCase(), metaKey: true }), "BROWSER_SHORTCUT", `Cmd+${k.toUpperCase()}`);
  }
});

test("Ctrl/Cmd+Tab is BROWSER_SHORTCUT", () => {
  assert.equal(classifyKeyEvent({ key: "Tab", ctrlKey: true }), "BROWSER_SHORTCUT");
  assert.equal(classifyKeyEvent({ key: "Tab", metaKey: true }), "BROWSER_SHORTCUT");
});

test("Ctrl/Cmd+Shift+T (reopen closed tab) is BROWSER_SHORTCUT", () => {
  assert.equal(classifyKeyEvent({ key: "t", ctrlKey: true, shiftKey: true }), "BROWSER_SHORTCUT");
  assert.equal(classifyKeyEvent({ key: "T", metaKey: true, shiftKey: true }), "BROWSER_SHORTCUT");
});

test("bare F5/F11 are BROWSER_SHORTCUT even with no modifier", () => {
  assert.equal(classifyKeyEvent({ key: "F5" }), "BROWSER_SHORTCUT");
  assert.equal(classifyKeyEvent({ key: "F11" }), "BROWSER_SHORTCUT");
});

test("Ctrl/Cmd+letter combos outside the documented shortcut set stay normal input", () => {
  // e.g. Ctrl+A (select all), Ctrl+C/V/X (copy/paste/cut), Ctrl+Z/Y (undo/redo), Ctrl+B/I bold/italic
  // -- none of these are browser/devtools shortcuts and must remain unblocked for editor use.
  for (const k of ["a", "c", "v", "x", "z", "y", "b", "e", "f", "g", "h", "k", "m", "o", "q", "d"]) {
    assert.equal(classifyKeyEvent({ key: k, ctrlKey: true }), null, `Ctrl+${k} must remain normal editor input`);
  }
});

test("no arguments / empty object defaults to normal input", () => {
  assert.equal(classifyKeyEvent(), null);
  assert.equal(classifyKeyEvent({}), null);
});
