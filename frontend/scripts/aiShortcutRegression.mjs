// Regression test for the AI-assistant shortcut detector. Pure function, no DOM. Run: node frontend/scripts/aiShortcutRegression.mjs
// Ordinary typing, editor shortcuts and Mac Cmd combinations must never match; only the documented Copilot key signature does.
import { detectAiAssistantKey, AI_SHORTCUT_RULES } from "../src/utils/keyboardShortcuts.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

check("Win+Shift+F23 (the Windows Copilot key) is a Copilot key signal", detectAiAssistantKey({ key: "F23", code: "F23", metaKey: true, shiftKey: true }) === "COPILOT_KEY_SIGNAL");
check("matched by code when the browser reports no key name", detectAiAssistantKey({ key: "Unidentified", code: "F23", metaKey: true, shiftKey: true }) === "COPILOT_KEY_SIGNAL");
check("F23 alone is not a signal", detectAiAssistantKey({ key: "F23", code: "F23" }) === null);
check("Win+F23 without Shift is not a signal", detectAiAssistantKey({ key: "F23", code: "F23", metaKey: true }) === null);
check("Shift+F23 without the Windows key is not a signal", detectAiAssistantKey({ key: "F23", code: "F23", shiftKey: true }) === null);
check("the Windows key alone is not a signal", detectAiAssistantKey({ key: "Meta", code: "MetaLeft", metaKey: true }) === null);
check("LaunchApplication1 is not treated as the Copilot key (it is a different key)", detectAiAssistantKey({ key: "LaunchApplication1", code: "LaunchApplication1" }) === null);

const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
check("no letter or digit matches, with any Shift/Ctrl/Alt/Meta combination",
  letters.every((k) => [0, 1, 2, 3, 4, 5, 6, 7].every((bits) => detectAiAssistantKey({ key: k, code: `Key${k.toUpperCase()}`, shiftKey: !!(bits & 1), ctrlKey: !!(bits & 2), altKey: !!(bits & 4), metaKey: false }) === null)));
check("Cmd+C, Cmd+Shift+C, Cmd+V (Mac copy/paste) never match", [["c", false], ["c", true], ["v", false]].every(([k, s]) => detectAiAssistantKey({ key: k, code: `Key${k.toUpperCase()}`, metaKey: true, shiftKey: s }) === null));
check("editor shortcuts never match (Ctrl+Space, Ctrl+/, Ctrl+Z, Tab, Enter, F1-F12)", [{ key: " ", ctrlKey: true }, { key: "/", ctrlKey: true }, { key: "z", ctrlKey: true }, { key: "Tab" }, { key: "Enter" }, ...Array.from({ length: 12 }, (_, i) => ({ key: `F${i + 1}` }))].every((e) => detectAiAssistantKey(e) === null));
check("AltGr (Ctrl+Alt) characters never match", detectAiAssistantKey({ key: "s", code: "KeyS", ctrlKey: true, altKey: true }) === null);
check("an empty or missing event never matches or throws", detectAiAssistantKey() === null && detectAiAssistantKey({}) === null);
check("every rule requires a modifier, so plain typing cannot match", AI_SHORTCUT_RULES.every((r) => r.match({ key: "F23", code: "F23" }) === false));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("AI shortcut regression: all passed");
