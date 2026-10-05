// Probes each configured Gemini key separately (status + message only; keys are never printed).
const keys = { K1: process.env.GEMINI_API_KEY, K2: process.env.GEMINI_API_KEY_2 };
(async () => {
  for (const [name, key] of Object.entries(keys)) {
    if (!key) { console.log(name, "not set"); continue; }
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Say OK" }] }], generationConfig: { maxOutputTokens: 20, thinkingConfig: { thinkingLevel: "minimal" } } }),
      });
      const t = await r.text();
      const m = /"message"\s*:\s*"([^"]{0,200})/.exec(t);
      const d = /"retryDelay"\s*:\s*"([^"]+)"/.exec(t);
      const q = /"quotaMetric"\s*:\s*"([^"]+)"|"quotaId"\s*:\s*"([^"]+)"/.exec(t);
      console.log(name, i, r.status, r.ok ? "ok" : (m ? m[1] : t.slice(0, 120)), d ? `retryDelay=${d[1]}` : "", q ? `quota=${q[1] || q[2]}` : "");
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
})();
