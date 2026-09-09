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
