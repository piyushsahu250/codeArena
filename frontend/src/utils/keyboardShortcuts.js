// Pure, dependency-free classifier for the browser-shortcut/devtools keydown blocking used during
// a proctored attempt (TestTaking.jsx's inline copy, useProctoring.js's shared hook). Extracted
// specifically because those two implementations had drifted into two independently-maintained,
// hand-copied versions of "is this key combo a browser/devtools shortcut" — exactly the kind of
// duplication that let a real accuracy bug slip through in this session's own score-computation
// audit. This is the ONE place that logic is allowed to live now; both call sites classify a key
// event through this function instead of re-deriving the answer themselves.
//
// Root-cause audit (2026-09-11, "A/S/D not typing" report): every check here is gated on a
// modifier key (ctrlKey/metaKey, optionally + shiftKey) before ever matching a letter -- a bare
// "a"/"s"/"d" keypress with no modifier held can NEVER classify as anything but null (normal
// text input, never intercepted). Confirmed by direct inspection of both call sites before this
// refactor, and now locked down by the test suite alongside this file: there is no code path in
// this classifier, or anywhere else in the codebase (no Monaco custom keybindings, no
// editor.onKeyDown() hooks, no other global keydown listener touches the coding editor), that
// blocks, remaps, or intercepts a normal alphanumeric keystroke. The historical "a/s/d don't
// appear while typing" report traced to a third-party Indic-transliteration keyboard IME on that
// specific device (see monacoSetup.js's applyPlainTextInputHints/watchForNonAsciiInput) --
// something no webpage's JavaScript can detect or override, since the browser never even
// dispatches a keydown for a key an IME is still composing.
// Accepts a plain object shaped like the handful of KeyboardEvent fields this actually needs
// (key, ctrlKey, metaKey, shiftKey) -- not a real Event -- so it's usable both from a live
// keydown handler (`classifyKeyEvent(e)`) and from a plain object in a test, with zero DOM
// dependency either way.
export function classifyKeyEvent({ key, ctrlKey = false, metaKey = false, shiftKey = false } = {}) {
  const ctrlOrCmd = ctrlKey || metaKey;
  const k = String(key || "").toLowerCase();

  if (key === "PrintScreen") return "PRINT_SCREEN_ATTEMPT";

  // Devtools: F12 alone, or Ctrl/Cmd+Shift+I/J/C (inspector/console/element-picker), or Ctrl+U
  // (view-source). Every letter check here REQUIRES ctrlOrCmd — "i", "j", "c", "u" alone are
  // always normal typing, never classified as anything.
  if (key === "F12") return "DEVTOOLS";
  if (ctrlOrCmd && shiftKey && ["i", "j", "c"].includes(k)) return "DEVTOOLS";
  if (ctrlOrCmd && k === "u") return "DEVTOOLS";

  // Browser chrome shortcuts: Ctrl/Cmd + one of save/print/close-tab/new-window/new-tab/
  // reload/address-bar, or Ctrl/Cmd+Tab (switch tabs), or Ctrl/Cmd+Shift+T (reopen closed tab),
  // or the bare function keys F5/F11. Same rule -- every letter requires ctrlOrCmd.
  if (ctrlOrCmd && ["s", "p", "w", "n", "t", "r", "l"].includes(k)) return "BROWSER_SHORTCUT";
  if (ctrlOrCmd && key === "Tab") return "BROWSER_SHORTCUT";
  if (ctrlOrCmd && shiftKey && k === "t") return "BROWSER_SHORTCUT";
  if (key === "F5" || key === "F11") return "BROWSER_SHORTCUT";

  return null; // normal input -- never intercepted, never preventDefault()'d
}
