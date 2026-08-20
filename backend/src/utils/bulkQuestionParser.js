// Parses the platform's ".txt / Notepad" bulk-upload format for MCQ and Coding questions into
// the same header-keyed row shape questions.js's existing .xlsx/.csv import already consumes
// (IMPORT_HEADER_ALIASES / CODING_IMPORT_HEADER_ALIASES canonical header strings) — so every
// downstream validation/duplicate-detection/creation code path in questions.js runs completely
// unchanged regardless of which format a row came from. This file only ever produces rows; it
// never talks to Prisma or expresses an opinion about what's "valid" (that stays questions.js's
// job, same as it already is for spreadsheet rows).
//
// Format: one question per block. Each field is a "LABEL:" line followed by its value on the
// following line(s), continuing until the next recognized LABEL: line. Blocks are separated by a
// blank line before the next QUESTION: (MCQ) or a line of at least 3 dashes ("---", coding, to
// separate one question from the next since coding blocks are long). A trailing/leading label
// with no value is simply empty — never a parse error.

function splitLabeledBlock(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const fields = {};
  let current = null;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (m && KNOWN_LABELS.has(m[1].toUpperCase())) {
      current = m[1].toUpperCase();
      fields[current] = m[2] ? [m[2]] : [];
    } else if (current) {
      fields[current].push(line);
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v.join("\n").trim();
  }
  return out;
}

const KNOWN_LABELS = new Set([
  "QUESTION", "OPTION_A", "OPTION_B", "OPTION_C", "OPTION_D", "OPTION_E", "OPTION_F",
  "CORRECT_OPTION", "TYPE", "DIFFICULTY", "BTL", "SUBJECT", "UNIT", "TOPIC", "EXPLANATION",
  "LANGUAGE", "FUNCTION_NAME", "INPUT_FORMAT", "OUTPUT_FORMAT", "CONSTRAINTS",
  "SAMPLE_INPUT", "SAMPLE_OUTPUT", "SAMPLE_INPUT_2", "SAMPLE_OUTPUT_2", "TEST_CASES",
  "TITLE", "MARKS", "TIME_LIMIT_SEC",
]);

// Splits the whole uploaded text into per-question chunks. A blank line followed directly by a
// new QUESTION: starts a new block; a line of 3+ dashes always starts a new block (used by the
// coding format, whose blocks are long and may contain blank lines inside TEST_CASES).
function splitBlocks(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const parts = normalized.split(/\n\s*-{3,}\s*\n/); // explicit "---" separators first
  const blocks = [];
  for (const part of parts) {
    // Within a part, also split on a blank line immediately preceding a new QUESTION: line —
    // covers the MCQ format, where staff separate questions with a blank line instead of dashes.
    const subParts = part.split(/\n\s*\n(?=QUESTION\s*:)/i);
    for (const sp of subParts) {
      const trimmed = sp.trim();
      if (trimmed) blocks.push(trimmed);
    }
  }
  return blocks;
}

function letterToOptionNumber(letter) {
  const idx = "ABCDEF".indexOf(String(letter || "").trim().toUpperCase());
  return idx === -1 ? "" : String(idx + 1);
}

// BTL: BTL-3 / BTL: 3 / BTL: Level 3 -> "3". Returns "" (not a hard failure here — questions.js's
// own row-level validation decides whether a missing/invalid BTL is acceptable) if no digit 1-6
// is found.
function extractBtlDigit(raw) {
  const m = String(raw || "").match(/[1-6]/);
  return m ? m[0] : "";
}

// -> array of objects keyed by the exact canonical header strings questions.js's
// IMPORT_HEADER_ALIASES already recognizes for MCQ/TRUE_FALSE/MULTISELECT import.
function parseNotepadMcqText(text) {
  return splitBlocks(text).map((block) => {
    const f = splitLabeledBlock(block);
    const options = ["OPTION_A", "OPTION_B", "OPTION_C", "OPTION_D", "OPTION_E", "OPTION_F"]
      .map((k) => f[k])
      .filter((v) => v !== undefined && v !== "");
    // Type auto-detection, so staff never need a TYPE: line for the common cases — explicit
    // TYPE: (MCQ / TRUE_FALSE / MULTISELECT / MULTI SELECT) always wins when present.
    let type = f.TYPE;
    if (!type) {
      const isTrueFalse = options.length === 2 && options.every((o) => /^(true|false)$/i.test(o.trim()));
      const correctCount = String(f.CORRECT_OPTION || "").split(/[,\s]+/).filter(Boolean).length;
      type = isTrueFalse ? "True/False" : correctCount > 1 ? "Multiple Select" : "Multiple Choice";
    }
    const correctAnswer = String(f.CORRECT_OPTION || "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(letterToOptionNumber)
      .filter(Boolean)
      .join(",");

    return {
      "Question Text": f.QUESTION || "",
      "Question Type": type,
      "Options": options.join("|"),
      "Correct Answer": correctAnswer,
      "Difficulty Level": f.DIFFICULTY || "",
      "BTL": extractBtlDigit(f.BTL),
      "Subject": f.SUBJECT || "",
      "Unit": f.UNIT || "",
      "Topic": f.TOPIC || "",
      "Explanation": f.EXPLANATION || "",
      "Question Name": f.TITLE || "",
      "Marks": f.MARKS || "",
    };
  });
}

// Parses a TEST_CASES: block of repeated INPUT:/OUTPUT: line pairs into "in->out||in->out" —
// the exact packed format questions.js's existing parseHiddenTestCases() already unpacks, so
// that function is reused verbatim rather than re-implemented here.
function parseTestCasesBlock(raw) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const pairs = [];
  let pendingInput = null;
  for (const line of lines) {
    const inMatch = line.match(/^\s*INPUT\s*:\s*(.*)$/i);
    const outMatch = line.match(/^\s*OUTPUT\s*:\s*(.*)$/i);
    if (inMatch) {
      pendingInput = inMatch[1];
    } else if (outMatch && pendingInput !== null) {
      pairs.push({ input: pendingInput.trim(), output: outMatch[1].trim() });
      pendingInput = null;
    } else if (pendingInput !== null) {
      pendingInput += `\n${line}`; // multi-line input
    }
  }
  return pairs.map((p) => `${p.input}->${p.output}`).join("||");
}

// -> array of objects keyed by the exact canonical header strings questions.js's
// CODING_IMPORT_HEADER_ALIASES already recognizes.
function parseNotepadCodingText(text) {
  return splitBlocks(text).map((block) => {
    const f = splitLabeledBlock(block);
    return {
      "Question Title": f.TITLE || f.QUESTION?.split("\n")[0]?.slice(0, 80) || "",
      "Problem Statement": f.QUESTION || "",
      "Subject": f.SUBJECT || "",
      "Unit": f.UNIT || "",
      "Topic": f.TOPIC || "",
      "Difficulty": f.DIFFICULTY || "",
      "BTL": extractBtlDigit(f.BTL),
      "Programming Languages": f.LANGUAGE || "",
      "Constraints": f.CONSTRAINTS || "",
      "Input Format": f.INPUT_FORMAT || "",
      "Output Format": f.OUTPUT_FORMAT || "",
      "Sample Input 1": f.SAMPLE_INPUT || "",
      "Sample Output 1": f.SAMPLE_OUTPUT || "",
      "Sample Input 2": f.SAMPLE_INPUT_2 || "",
      "Sample Output 2": f.SAMPLE_OUTPUT_2 || "",
      "Hidden Test Cases": parseTestCasesBlock(f.TEST_CASES),
      "Marks": f.MARKS || "",
      "Time Limit (seconds)": f.TIME_LIMIT_SEC || "",
      "Function Name": f.FUNCTION_NAME || "",
      "Evaluation Mode (STDIO or Function)": f.FUNCTION_NAME ? "Function" : "",
    };
  });
}

module.exports = { parseNotepadMcqText, parseNotepadCodingText, extractBtlDigit };
