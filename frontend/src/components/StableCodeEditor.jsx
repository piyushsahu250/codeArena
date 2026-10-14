import { useRef } from "react";
import Editor from "@monaco-editor/react";

// A Monaco editor that never overwrites what the student has just typed.
//
// @monaco-editor/react in controlled mode (`value`) re-applies the prop to the model whenever `value !== editor.getValue()`. On a busy page (the exam
// screen re-renders on every keystroke) the prop it applies is the one from the render BEFORE the latest keystrokes, so characters typed in between are
// replaced by the stale text and the cursor jumps: letters (a, s, d, anything) silently vanish while typing quickly or on a slow device.
//
// Here the editor owns its text while the student types. `value` is forwarded to the library only when it changes for a reason other than the editor's own
// onChange echo (another question, another language, a restore from the server), which is identified by `contextKey`.
export default function StableCodeEditor({ value, onChange, contextKey, ...props }) {
  const shownRef = useRef(value);
  const lastEmittedRef = useRef(null);
  const contextRef = useRef(contextKey);

  if (contextRef.current !== contextKey) {
    // A different document: always show what the parent says, and forget the echo of the previous one.
    contextRef.current = contextKey;
    lastEmittedRef.current = null;
    shownRef.current = value;
  } else if (value !== lastEmittedRef.current && value !== shownRef.current) {
    // The parent changed the text by itself (not an echo of our onChange): push it into the editor.
    shownRef.current = value;
  }

  return (
    <Editor
      {...props}
      value={shownRef.current}
      onChange={(v, ev) => {
        lastEmittedRef.current = v ?? "";
        if (onChange) onChange(v, ev);
      }}
    />
  );
}
