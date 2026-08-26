// One-off: measure real Gemini latency for the exact smoke-test call shape the daily health check
// uses, with maxRetries forced to 0 so each measurement is a single, non-retried round-trip. This
// answers whether the health check's 14.9s finding reflects one slow-but-normal "thinking" call, or
// something inflated by retries/backoff stacking on top of a slow first attempt.
const { generateContent } = require("../src/services/ai/geminiProvider");

async function main() {
  const results = [];
  for (let i = 1; i <= 5; i++) {
    const started = Date.now();
    try {
      const r = await generateContent({ prompt: "Reply with exactly: ok", maxTokens: 10, maxRetries: 0 });
      const ms = Date.now() - started;
      results.push({ run: i, ms, ok: true, text: r.text, usage: r.usage });
      console.log(`Run ${i}: ${ms}ms — text=${JSON.stringify(r.text)} usage=${JSON.stringify(r.usage)}`);
    } catch (err) {
      const ms = Date.now() - started;
      results.push({ run: i, ms, ok: false, error: err.message });
      console.log(`Run ${i}: ${ms}ms — FAILED: ${err.message}`);
    }
  }
  const times = results.filter((r) => r.ok).map((r) => r.ms);
  if (times.length) {
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`\nmin=${Math.min(...times)}ms max=${Math.max(...times)}ms avg=${avg}ms (n=${times.length}, all single-attempt, no retries)`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
