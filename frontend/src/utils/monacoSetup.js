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
