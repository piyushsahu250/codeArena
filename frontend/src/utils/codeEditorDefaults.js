// Single source of truth for the language list and default starter code shown across every
// Monaco-based coding surface (Formal Tests, Module Coding Tests, Practice Coding, Mock
// Interview coding, Daily/Weekly Challenges). Previously each of those 6 pages carried its own
// near-identical copy of this — a fix or a new language had to be applied 6 times, and drifted
// (e.g. dropdown order and starter-code comments already differed slightly page to page).
export const CODE_LANGUAGES = [
  { id: "java", label: "Java", monaco: "java" },
  { id: "python", label: "Python", monaco: "python" },
  { id: "javascript", label: "JavaScript", monaco: "javascript" },
  { id: "c", label: "C", monaco: "c" },
  { id: "cpp", label: "C++", monaco: "cpp" },
];

// The language options actually usable for a given coding question. FUNCTION-mode questions only
// have a real starter/driver for the languages baked into starterCodeByLanguage at authoring time
// (e.g. functionHarness.js excludes C whenever the signature uses array types, since there's no
// shared array+length convention across the other 4) — picking an unsupported one fails at judge
// time with a confusing "signature isn't available in X" error instead of never being offered.
// STDIO-mode questions (or any question authored before this map existed) accept any language, so
// an empty/missing map falls back to the full list rather than hiding the picker entirely.
export function supportedLanguages(question) {
  const keys = question?.starterCodeByLanguage && typeof question.starterCodeByLanguage === "object"
    ? Object.keys(question.starterCodeByLanguage)
    : [];
  if (keys.length === 0) return CODE_LANGUAGES;
  return CODE_LANGUAGES.filter((l) => keys.includes(l.id));
}

export function defaultStarter(language) {
  switch (language) {
    case "python":
      return "# Read input via input(), print your answer\n";
    case "c":
      return '#include <stdio.h>\n\nint main() {\n    // read input with scanf, print your answer with printf\n    return 0;\n}\n';
    case "cpp":
      return '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // read input with cin, print your answer with cout\n    return 0;\n}\n';
    case "java":
      return 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // read input via sc, print your answer with System.out\n    }\n}\n';
    default:
      return "// Read input via require('fs').readFileSync(0, 'utf8'), console.log your answer\n";
  }
}
