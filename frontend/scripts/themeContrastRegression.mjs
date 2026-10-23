// Regression test for the theme's colour tokens (audit batch 8): every text colour that is meant to sit on a tinted or dark surface must reach WCAG AA (4.5:1) against that surface,
// in BOTH themes. REGRESSION: the dark-mode status text colours were believed to pass "comfortably" but measured 3.8:1 (success), 4.2:1 (warning), 3.1:1 (danger) and 2.7:1 (info)
// on their own tinted backgrounds, so every Badge and difficulty chip outside the two dashboard kits (which carry their own lighter dark-mode tones) was below AA in dark mode.
// Reads src/theme.css directly (hex colours and var() references only). Pure arithmetic, no browser.
// Run: node frontend/scripts/themeContrastRegression.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The custom properties declared by every block whose selector is exactly `selector`.
function declarations(selector) {
  const out = {};
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "\\s*\\{([^}]*)\\}", "g");
  for (const block of css.matchAll(re)) for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = { ...declarations(":root"), ...declarations(':root:not([data-theme="dark"])') };
const dark = { ...light, ...declarations(':root[data-theme="dark"]') };

function resolve(theme, name, trail = []) {
  const value = theme[name];
  if (value === undefined) throw new Error(`the token ${name} is not defined`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return value;
  if (trail.includes(ref[1])) throw new Error(`the token ${name} refers to itself`);
  return resolve(theme, ref[1], [...trail, name]);
}
function rgb(hex) {
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) throw new Error(`"${hex}" is not a hex colour (this check reads hex colours only)`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

// The arithmetic itself, against values known from the browser scans (axe reported 3.12 for the old green link on cream and 4.35 for the old gold eyebrow on the blackboard green).
check("black on white is 21:1", Math.abs(ratio("#000000", "#ffffff") - 21) < 0.01);
check("the arithmetic reproduces axe's 3.12:1 for #4f9d6e on #fbf9f4", Math.abs(ratio("#4f9d6e", "#fbf9f4") - 3.12) < 0.02);
check("and axe's 4.35:1 for #c7852a on #123528", Math.abs(ratio("#c7852a", "#123528") - 4.35) < 0.02);

// Text on the surface it is designed for, checked in both themes.
const PAIRS = [
  ["--success-text", "--success-bg"], ["--warning-text", "--warning-bg"], ["--danger-text", "--danger-bg"], ["--info-text", "--info-bg"],
  ["--success-text", "--paper"], ["--warning-text", "--paper"], ["--danger-text", "--paper"], ["--info-text", "--paper"],
  ["--success-text", "--card-bg"], ["--warning-text", "--card-bg"], ["--danger-text", "--card-bg"], ["--info-text", "--card-bg"],
  ["--ink", "--paper"], ["--ink-dim", "--paper"], ["--ink", "--card-bg"], ["--ink-dim", "--card-bg"],
];
for (const [themeName, theme] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg] of PAIRS) {
    const r = ratio(resolve(theme, fg), resolve(theme, bg));
    check(`${themeName}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (needs 4.5)`, r >= 4.5);
  }
}

// Surfaces that are the same in both themes: the blackboard greens and the solid accent.
const FIXED = [
  ["--chalk", "--slate-900"], ["--chalk-dim", "--slate-900"], ["--chalk-dim", "--slate-950"], ["--chalk-dim", "--slate-800"],
  ["--amber", "--slate-900"], ["--amber", "--slate-950"], ["--mint-on-dark", "--slate-900"], ["--mint-on-dark", "--slate-800"],
  ["--amber-ink", "--amber"],
];
for (const [fg, bg] of FIXED) {
  const r = ratio(resolve(light, fg), resolve(light, bg));
  check(`${fg} on ${bg} is ${r.toFixed(2)}:1 (needs 4.5)`, r >= 4.5);
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("theme contrast regression: all passed");
