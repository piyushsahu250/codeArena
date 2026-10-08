const test = require("node:test");
const assert = require("node:assert");
const { ALPHABET, randomGroupedCode, normalizeVerifyCode } = require("../src/utils/secureCode");

test("randomGroupedCode: shape is XXXX-XXXX-XXXX from the 32-symbol alphabet without ambiguous letters", () => {
  for (let i = 0; i < 200; i++) {
    const c = randomGroupedCode();
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.ok(!/[ILOU]/.test(c));
  }
  assert.strictEqual(ALPHABET.length, 32);
  assert.strictEqual(new Set(ALPHABET).size, 32);
});

test("randomGroupedCode: 20,000 codes are all distinct (60 bits of entropy)", () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(randomGroupedCode());
  assert.strictEqual(seen.size, 20000);
});

test("randomGroupedCode: symbols are uniformly distributed (no modulo bias)", () => {
  const counts = Object.fromEntries([...ALPHABET].map((c) => [c, 0]));
  const N = 60000; // codes -> 12 symbols each
  for (let i = 0; i < N; i++) for (const ch of randomGroupedCode().replace(/-/g, "")) counts[ch]++;
  const expected = (N * 12) / 32;
  for (const [ch, n] of Object.entries(counts)) assert.ok(Math.abs(n - expected) / expected < 0.03, `${ch} off by ${((n - expected) / expected * 100).toFixed(1)}%`);
});

test("normalizeVerifyCode: trims, upper-cases, bounds length, tolerates junk", () => {
  assert.strictEqual(normalizeVerifyCode("  ca-2026-abc-xyz-k7m2-q9x4-b3td \n"), "CA-2026-ABC-XYZ-K7M2-Q9X4-B3TD");
  assert.strictEqual(normalizeVerifyCode(null), "");
  assert.strictEqual(normalizeVerifyCode(undefined), "");
  assert.ok(normalizeVerifyCode("a".repeat(500)).length <= 80);
});
