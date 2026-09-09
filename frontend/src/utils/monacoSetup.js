// By default @monaco-editor/react fetches the Monaco AMD bundle from a CDN (jsdelivr) at
// runtime, even though monaco-editor is already an installed dependency bundled by Vite (see
// vite.config.js's vendor-monaco chunk). On any network that blocks/throttles that CDN —
// corporate proxies, ad blockers, offline dev, flaky connections — every <Editor> on the
// platform (Formal Tests, Module Coding Tests, Practice Coding, Mock Interview, Daily/Weekly
// Challenges) hangs on "Loading..." forever. Pointing the loader at the locally bundled
// monaco-editor instance instead removes that network dependency entirely.
//
// Imported once, as a side effect, from main.jsx before the app renders.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Monaco's core editor services (find/replace, tokenization, etc.) run on a background worker.
// Without this, Monaco falls back to running that code on the main thread with a console
// warning — it still works, but this is the officially recommended Vite setup and avoids that
// fallback. Only the core + TypeScript/JavaScript workers are wired up since "javascript" is
// the only language in CODE_LANGUAGES (utils/codeEditorDefaults.js) with a Monaco language
// service; java/python/c/cpp are plain (worker-less) syntax highlighting.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

// Pass as `<Editor onMount={applyPlainTextInputHints}>` on every code editor. Root cause this
// closes: reported live during a mobile test — a, s, d (and potentially other letters) silently
// not appearing while typing code. Nothing in this app's own keyboard handling blocks bare
// letters (TestTaking.jsx/useProctoring.js only intercept Ctrl/Cmd+letter combos) — the actual
// cause is the device's own on-screen keyboard: an active Indic-language transliteration input
// method (e.g. Android's Marathi/Hindi phonetic Gboard mode, consistent with the Marathi search
// suggestions seen on this same device in an earlier report) intercepts certain Latin letters —
// commonly vowels like "a" — while composing a candidate Devanagari word, and doesn't commit
// anything to the field until the composition resolves. Code needs raw ASCII, never a composed
// script, so this looks exactly like "the key does nothing."
//
// This is fundamentally a client keyboard-language setting, not something a webpage can force —
// these are hints a browser/IME MAY honor, not a guarantee. If it recurs, the actual fix is on the
// student's device: switch the on-screen keyboard's input language to English before typing code
// (on Gboard: long-press the spacebar, or tap the globe/language-switch key).
export function applyPlainTextInputHints(editor) {
  const textarea = editor.getDomNode?.()?.querySelector("textarea");
  if (!textarea) return;
  textarea.setAttribute("lang", "en");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("spellcheck", "false");
  // Already Monaco's default -- set explicitly so a future Monaco upgrade changing that default
  // can't silently reintroduce this.
  textarea.setAttribute("inputmode", "text");
}

// IMPORTANT LIMIT, stated plainly rather than papered over: applyPlainTextInputHints above sets
// hints a browser/IME MAY honor -- it cannot be a 100% fix. If a student's ACTIVE system keyboard
// is a dedicated third-party transliteration IME app (not just a language setting inside Gboard),
// no webpage can force it off or select a different one -- that is an OS-level app choice, exactly
// like a website cannot silently switch which app you're using to type. This is the same "layered
// controls, not an absolute guarantee" honesty this platform's own exam-security work (mobile
// long-press lockdown, screen-overlay detection) already commits to elsewhere -- claiming 100%
// prevention here would be the same false claim that work explicitly avoids making.
//
// What IS fully achievable: never let it fail SILENTLY again. Call as
// `<Editor onMount={(editor) => watchForNonAsciiInput(editor, onDetected)}>` (return value is a
// cleanup function) -- fires `onDetected()` the first time the editor's content contains any
// non-ASCII character, which is the actual observable moment an IME's composition COMMITTED a
// converted word (Devanagari, etc.) into the code instead of the plain letter that was pressed.
// Catches it the instant it happens, mid-test, instead of the student only discovering something
// is wrong when Run/Submit fails on a syntax error they can't explain.
export function watchForNonAsciiInput(editor, onDetected) {
  let warned = false;
  const disposable = editor.onDidChangeModelContent(() => {
    if (warned) return;
    // eslint-disable-next-line no-control-regex -- deliberately matching outside the ASCII range
    if (/[^\x00-\x7F]/.test(editor.getValue())) {
      warned = true;
      onDetected();
    }
  });
  return () => disposable.dispose();
}
