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

// Label spelling is deliberately forgiving — two versions of this spec have used two different
// conventions ("OPTION_A:" underscored-caps vs. "Option A:" spaced-title-case, "CORRECT_OPTION:"
// vs. "Correct Answer:"), and staff typing free-hand in Notepad won't necessarily match either
// exactly. Every label line is normalized (trim, uppercase, spaces->underscores) before matching
// against CANONICAL_LABEL_ALIASES, so "Option A", "OPTION_A", "option a" and "Correct Answer",
// "CORRECT_OPTION", "Correct_Answer" all resolve to the same internal field.
const CANONICAL_LABEL_ALIASES = {
  QUESTION: "QUESTION",
  QUESTION_TYPE: "QUESTION_TYPE", TYPE: "QUESTION_TYPE",
  OPTION_A: "OPTION_A", OPTION_1: "OPTION_A",
  OPTION_B: "OPTION_B", OPTION_2: "OPTION_B",
  OPTION_C: "OPTION_C", OPTION_3: "OPTION_C",
  OPTION_D: "OPTION_D", OPTION_4: "OPTION_D",
  OPTION_E: "OPTION_E", OPTION_5: "OPTION_E",
  OPTION_F: "OPTION_F", OPTION_6: "OPTION_F",
  CORRECT_OPTION: "CORRECT_ANSWER", CORRECT_ANSWER: "CORRECT_ANSWER", ANSWER: "CORRECT_ANSWER",
  DIFFICULTY: "DIFFICULTY",
  BTL: "BTL", BTL_LEVEL: "BTL",
  SUBJECT: "SUBJECT",
  UNIT: "UNIT",
  TOPIC: "TOPIC",
  EXPLANATION: "EXPLANATION",
  MARKS: "MARKS", POINTS: "MARKS",
  TITLE: "TITLE", QUESTION_NAME: "TITLE",
  LANGUAGE: "LANGUAGE", PROGRAMMING_LANGUAGES: "LANGUAGE",
  FUNCTION_NAME: "FUNCTION_NAME",
  INPUT_FORMAT: "INPUT_FORMAT",
  OUTPUT_FORMAT: "OUTPUT_FORMAT",
  CONSTRAINTS: "CONSTRAINTS",
  SAMPLE_INPUT: "SAMPLE_INPUT",
  SAMPLE_OUTPUT: "SAMPLE_OUTPUT",
  SAMPLE_INPUT_2: "SAMPLE_INPUT_2",
  SAMPLE_OUTPUT_2: "SAMPLE_OUTPUT_2",
  TEST_CASES: "TEST_CASES",
  TIME_LIMIT_SEC: "TIME_LIMIT_SEC", TIME_LIMIT: "TIME_LIMIT_SEC",
};

function splitLabeledBlock(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const fields = {};
  let current = null;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _]*?)\s*:\s*(.*)$/);
    const canonical = m && CANONICAL_LABEL_ALIASES[m[1].trim().toUpperCase().replace(/\s+/g, "_")];
    if (canonical) {
      current = canonical;
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

// Splits the whole uploaded text into per-question chunks. A line of 3+ dashes always starts a
// new block (explicit, staff-authored separator — used by the coding format especially, whose
// blocks are long and contain blank lines inside TEST_CASES so a blank-line heuristic alone
// wouldn't be reliable there). Within a dash-delimited part, a new block also starts the moment a
// recognized label repeats — e.g. a second "Question:" (or "Question Type:", or any other field)
// means the previous question's fields are done and a new one has begun. This is deliberately
// order-independent (doesn't assume "Question:" is always the first field staff type — the
// platform's own downloadable template puts "Question Type:" before "Question:") rather than
// keying off one specific label appearing first.
function splitBlocks(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const dashParts = normalized.split(/\n\s*-{3,}\s*\n/);
  const blocks = [];
  for (const part of dashParts) {
    let currentLines = [];
    let seenLabels = new Set();
    for (const line of part.split("\n")) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9 _]*?)\s*:\s*(.*)$/);
      const canonical = m && CANONICAL_LABEL_ALIASES[m[1].trim().toUpperCase().replace(/\s+/g, "_")];
      if (canonical && seenLabels.has(canonical)) {
        if (currentLines.some((l) => l.trim())) blocks.push(currentLines.join("\n"));
        currentLines = [line];
        seenLabels = new Set([canonical]);
      } else {
        if (canonical) seenLabels.add(canonical);
        currentLines.push(line);
      }
    }
    if (currentLines.some((l) => l.trim())) blocks.push(currentLines.join("\n"));
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
    // Type auto-detection, so staff never need a Question Type: line for the common cases —
    // an explicit one (MCQ / TRUE_FALSE / MULTISELECT / MULTI SELECT) always wins when present.
    let type = f.QUESTION_TYPE;
    if (!type) {
      const isTrueFalse = options.length === 2 && options.every((o) => /^(true|false)$/i.test(o.trim()));
      const correctCount = String(f.CORRECT_ANSWER || "").split(/[,\s]+/).filter(Boolean).length;
      type = isTrueFalse ? "True/False" : correctCount > 1 ? "Multiple Select" : "Multiple Choice";
    }
    // Accepts a letter ("B") or comma/space-separated letters ("A, C") — converted to 1-based
    // option numbers questions.js's normalizeCorrectIndices already parses. A value that isn't a
    // single letter (e.g. staff typed the answer's actual text, "Queue") is passed through as-is
    // — normalizeCorrectIndices also matches by option text case-insensitively, so this still works.
    const correctAnswer = String(f.CORRECT_ANSWER || "")
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((token) => (/^[A-Fa-f]$/.test(token) ? letterToOptionNumber(token) : token))
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
