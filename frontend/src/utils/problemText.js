// Some coding problems were authored with their format sections typed INTO the description ("Constraints:", "Input Format:", "Output Format:" each on its own line, followed by the text).
// Shown as they are, those lines read as unstyled paragraphs with large gaps, and the page repeats them again in its own Input / Output and Constraints sections.
// REPORTED 2026-11-04 on "Best Time to Buy and Sell Stock" in the Mock examination. splitStatement lifts them out so the page can show them once, in the sections made for them.
// Pure: it never invents text, and a description without such headings comes back exactly as it was.

const HEADINGS = { constraints: "constraints", "input format": "inputFormat", "output format": "outputFormat" };
const HEADING_LINE = /^\s*(constraints|input format|output format)\s*:\s*(.*)$/i;

export function splitStatement(description) {
  const text = typeof description === "string" ? description : "";
  if (!text.split("\n").some((l) => HEADING_LINE.test(l))) return { text, constraints: null, inputFormat: null, outputFormat: null };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const found = { constraints: null, inputFormat: null, outputFormat: null };
  const rest = [];
  let current = null; // the section being collected: it ends at the first blank line
  for (const line of lines) {
    const m = line.match(HEADING_LINE);
    if (m) {
      current = HEADINGS[m[1].toLowerCase()];
      found[current] = found[current] ? found[current] : "";
      if (m[2].trim()) found[current] = (found[current] ? found[current] + "\n" : "") + m[2].trim();
      continue;
    }
    if (current) {
      if (line.trim() === "") { current = null; continue; }
      found[current] = (found[current] ? found[current] + "\n" : "") + line.trimEnd();
      continue;
    }
    rest.push(line);
  }
  const clean = (v) => (v && v.trim() ? v.trim() : null);
  return { text: rest.join("\n").replace(/\n{3,}/g, "\n\n").trim(), constraints: clean(found.constraints), inputFormat: clean(found.inputFormat), outputFormat: clean(found.outputFormat) };
}
