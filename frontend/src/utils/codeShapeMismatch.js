// Client-side heuristic warning only — the real, authoritative check is server-side in
// wrapFunctionCode() (backend/src/utils/functionHarness.js). This exists purely to catch the
// mistake BEFORE a student burns a Submit attempt on it: writing a full program (own class/main())
// for a FUNCTION-mode question, or a bare method body for a STDIO-mode one.
//
// Deliberately conservative — only flags the two unambiguous, language-detectable shapes that
// caused real, repeated confusion (Java's own top-level "public class"/main(), and C/C++'s own
// top-level main()). Never flags Python/JavaScript: neither language has a comparably reliable
// "this is definitely a full program, not a snippet" marker, and a wrong guess here is worse than
// no guess — the student would ignore a warning that fires incorrectly on valid code.
const FULL_PROGRAM_MARKERS = {
  java: [/\bpublic\s+class\s+\w+/, /\bpublic\s+static\s+void\s+main\s*\(/],
  cpp: [/\bint\s+main\s*\(/],
  c: [/\bint\s+main\s*\(/],
};

// Returns a short warning string if `code` looks like the wrong shape for `evaluationType`, or
// null if it looks fine (including "can't tell" — silence beats a false positive here).
export function detectCodeShapeMismatch(evaluationType, language, code) {
  const markers = FULL_PROGRAM_MARKERS[language];
  if (!markers || !code) return null;
  const looksLikeFullProgram = markers.some((re) => re.test(code));

  if (evaluationType === "FUNCTION" && looksLikeFullProgram) {
    return "This looks like a full program (with its own class/main()), but this question expects only a method body — see the starter code. It will be rejected on Submit.";
  }
  // Deliberately no reverse check (STDIO question, code doesn't look like a full program yet) —
  // that fires constantly on completely normal in-progress typing (e.g. a student who's about to
  // add their own class/main() but hasn't yet), which is a worse experience than the rare miss.
  return null;
}
