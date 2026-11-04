// What a student's editor holds before they have written anything, for one language of an examination coding problem.
// REPORTED 2026-11-04 (Mock, "Best Time to Buy and Sell Stock"): picking a language replaced the editor with nothing at all, and a problem whose only starter was the placeholder "// TODO" started
// from that line. Both now start from the language's own scaffold. Pure, so the rules are tested without a browser.
import { defaultStarter } from "./codeEditorDefaults.js";

// A starter that is only a placeholder comment ("// TODO", "# TODO: write your code") is not a scaffold.
export function isPlaceholder(code) {
  const lines = String(code ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((l) => /^(\/\/|#|\/\*|\*)/.test(l) && /todo|fixme|write (your )?(code|solution)/i.test(l));
}

// The author's starter for this language, else the platform's scaffold for it. `firstLanguage` is the one the legacy single starterCode field belongs to.
export function starterFor(item, language, firstLanguage) {
  const own = item?.starterCodeByLanguage?.[language] || (language === firstLanguage ? item?.starterCode : null);
  return own && !isPlaceholder(own) ? own : defaultStarter(language);
}

// Switching language: a student who has not written anything yet (blank, or still the starter) gets the new language's starter; anyone who has written code keeps it.
export function codeAfterLanguageChange({ code, from, to, item, firstLanguage }) {
  const blank = !String(code ?? "").trim();
  const untouched = blank || code === starterFor(item, from, firstLanguage) || code === defaultStarter(from);
  return untouched ? { code: starterFor(item, to, firstLanguage), kept: false } : { code, kept: true };
}
