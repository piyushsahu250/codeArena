// Tolerant parsing of the JSON text an AI model returns.
//
// Why this exists: for coding questions (code samples, multi-line statements, test inputs) the model sometimes puts a raw newline or tab inside a JSON string instead of the
// escape \n or \t. That is invalid JSON, so JSON.parse throws "Bad control character in string literal", both attempts fail the same way, and the admin sees
// "AI service is temporarily unavailable" although the model answered and the quota is fine. The content is valid; only the escaping is wrong, so it is repaired
// here rather than discarded. Nothing else is guessed: structure, keys and values are never altered, and text that is still not JSON after the repair throws as before.

// Escapes control characters (U+0000-U+001F) that appear INSIDE a string literal. Outside strings, whitespace between tokens is left alone.
function escapeControlCharsInStrings(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) { escaped = false; out += ch; continue; }
    if (ch === "\\") { escaped = true; out += ch; continue; }
    if (ch === '"') { inString = false; out += ch; continue; }
    if (code < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

// Removes a ```json ... ``` fence and a byte-order mark if the model wrapped its answer in one.
function stripFence(text) {
  let t = String(text).replace(/^﻿/, "").trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) t = m[1];
  return t;
}

// Parses strictly first (the normal, valid case is unchanged), then once more after the repair above. Throws the ORIGINAL parse error if the repair does not help,
// so the diagnostic in the usage log still names the real problem.
function parseModelJson(text) {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    try {
      return JSON.parse(escapeControlCharsInStrings(cleaned));
    } catch {
      throw firstErr;
    }
  }
}

module.exports = { parseModelJson, escapeControlCharsInStrings };
