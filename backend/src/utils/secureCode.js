// Unguessable public identifiers for certificates and marksheets (audit item T-4).
//
// A verification code is a CAPABILITY: anyone holding it can see the holder's name and institute on the public verify page. The old
// codes ended in a 6-digit random sequence (10^6 possibilities behind a readable prefix: year, institute, programme) or, for interview
// certificates, six base-36 characters from Math.random() (predictable, ~2^31). Both are enumerable. New codes end in 12 characters
// from a 32-symbol alphabet drawn from crypto.randomBytes (60 bits, grouped 4-4-4 for transcription). The alphabet drops I, L, O and U so
// a code read aloud or from print is not misread. Codes issued before this change keep working: lookups are exact-match on whatever is
// stored, nothing is rewritten.
const crypto = require("crypto");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 symbols: one byte & 31 maps uniformly, no modulo bias

function randomGroupedCode(groups = 3, size = 4) {
  const bytes = crypto.randomBytes(groups * size);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]);
  const out = [];
  for (let g = 0; g < groups; g++) out.push(chars.slice(g * size, (g + 1) * size).join(""));
  return out.join("-");
}

// Public verify routes: tolerate case and stray whitespace (codes are stored upper-case).
const normalizeVerifyCode = (raw) => String(raw || "").trim().toUpperCase().slice(0, 80);

module.exports = { ALPHABET, randomGroupedCode, normalizeVerifyCode };
