const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

// Model fallback in geminiProvider: when the main model's free daily allowance is gone, the next model (which has its own allowance) answers,
// and a model that just reported its limit is not called again until it reopens. Network is stubbed; the provider's module state (cooldowns)
// is reset by a fresh require per test.
const PROVIDER = "../src/services/ai/geminiProvider";
const MAIN = "gemini-3.6-flash"; // DEFAULT_MODEL
const envKeys = ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEYS", "GEMINI_MODEL", "GEMINI_FALLBACK_MODELS", "GEMINI_MAX_RETRIES", "GEMINI_THINKING_LEVEL"];
let savedEnv;
let savedFetch;
let calls; // [{ model, thinkingLevel }]

function loadProvider() {
  delete require.cache[require.resolve(PROVIDER)];
  return require(PROVIDER);
}

function respond(handler) {
  global.fetch = async (url, init) => {
    const model = /models\/([^:]+):generateContent/.exec(String(url))[1];
    const body = JSON.parse(init.body);
    const thinkingLevel = body.generationConfig?.thinkingConfig?.thinkingLevel;
    calls.push({ model, thinkingLevel });
    return handler(model, thinkingLevel);
  };
}

const quotaRes = (seconds = 10000) => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => `{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"${seconds}s"}]}}` });
const errRes = (status, text) => ({ ok: false, status, headers: { get: () => null }, text: async () => text });
const okRes = (model) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: `{"from":"${model}"}` }] }, finishReason: "STOP" }], modelVersion: model }) });

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  savedFetch = global.fetch;
  for (const k of envKeys) delete process.env[k];
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MAX_RETRIES = "0";
  calls = [];
});

afterEach(() => {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = savedFetch;
  delete require.cache[require.resolve(PROVIDER)];
});

test("the main model answers when it has quota, and no other model is called", async () => {
  respond((model) => okRes(model));
  const { generateContent } = loadProvider();
  const out = await generateContent({ prompt: "hi" });
  assert.equal(out.model, MAIN);
  assert.deepEqual(calls.map((c) => c.model), [MAIN]);
});

test("when the main model's daily limit is reached, the next model answers", async () => {
  respond((model) => (model === MAIN ? quotaRes() : okRes(model)));
  const { generateContent } = loadProvider();
  const out = await generateContent({ prompt: "hi" });
  assert.equal(out.model, "gemini-3.5-flash-lite");
  assert.deepEqual(calls.map((c) => c.model), [MAIN, "gemini-3.5-flash-lite"]);
});

test("a model that reported its daily limit is not called again on the next request", async () => {
  respond((model) => (model === MAIN ? quotaRes() : okRes(model)));
  const { generateContent } = loadProvider();
  await generateContent({ prompt: "one" });
  calls.length = 0;
  const out = await generateContent({ prompt: "two" });
  assert.equal(out.model, "gemini-3.5-flash-lite");
  assert.deepEqual(calls.map((c) => c.model), ["gemini-3.5-flash-lite"], "the main model must be skipped while its limit stands");
});

test("the chain continues through every fallback and stops at the first that answers", async () => {
  respond((model) => (model === "gemini-3-flash-preview" ? okRes(model) : quotaRes()));
  const { generateContent } = loadProvider();
  const out = await generateContent({ prompt: "hi" });
  assert.equal(out.model, "gemini-3-flash-preview");
  assert.deepEqual(calls.map((c) => c.model), [MAIN, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview"]);
});

test("when every model is out of quota, it fails with dailyQuota and the shortest reset time, then answers instantly without calling anyone", async () => {
  const resets = { [MAIN]: 9000, "gemini-3.5-flash-lite": 4000, "gemini-3.1-flash-lite": 7000, "gemini-3-flash-preview": 8000 };
  respond((model) => quotaRes(resets[model]));
  const { generateContent } = loadProvider();
  await assert.rejects(() => generateContent({ prompt: "hi" }), (err) => {
    assert.equal(err.dailyQuota, true);
    assert.equal(err.resetInSeconds, 4000, "the message should say when the FIRST model reopens");
    return true;
  });
  calls.length = 0;
  await assert.rejects(() => generateContent({ prompt: "again" }), (err) => err.dailyQuota === true && err.resetInSeconds > 0);
  assert.equal(calls.length, 0, "no network call while every model is cooling down");
});

test("a model that no longer exists for the key (404) is skipped for good", async () => {
  respond((model) => (model === MAIN ? errRes(404, '{"error":{"message":"This model is no longer available to new users"}}') : okRes(model)));
  const { generateContent } = loadProvider();
  const out = await generateContent({ prompt: "hi" });
  assert.equal(out.model, "gemini-3.5-flash-lite");
  calls.length = 0;
  await generateContent({ prompt: "again" });
  assert.deepEqual(calls.map((c) => c.model), ["gemini-3.5-flash-lite"]);
});

test("a model that rejects the thinking level is retried once with \"low\", and that choice is remembered", async () => {
  respond((model, level) => (model === "gemini-3.7-flash" && level === "minimal" ? errRes(400, '{"error":{"message":"Thinking level MINIMAL is not supported for this model."}}') : okRes(model)));
  process.env.GEMINI_MODEL = "gemini-3.7-flash";
  const { generateContent } = loadProvider();
  const out = await generateContent({ prompt: "hi" });
  assert.equal(out.model, "gemini-3.7-flash");
  assert.deepEqual(calls.map((c) => c.thinkingLevel), ["minimal", "low"]);
  calls.length = 0;
  await generateContent({ prompt: "again" });
  assert.deepEqual(calls.map((c) => c.thinkingLevel), ["low"], "no second rejected call");
});

test("a server error is NOT passed to another model (it would not help); it reaches the caller", async () => {
  respond(() => errRes(500, "boom"));
  const { generateContent } = loadProvider();
  await assert.rejects(() => generateContent({ prompt: "hi" }), (err) => err.status === 500);
  assert.equal(calls.length, 1);
});

test("a prompt blocked by the safety filter is NOT passed to another model", async () => {
  respond(() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [], promptFeedback: { blockReason: "SAFETY" } }) }));
  const { generateContent } = loadProvider();
  await assert.rejects(() => generateContent({ prompt: "hi" }), (err) => err.blocked === true);
  assert.equal(calls.length, 1);
});

test("GEMINI_FALLBACK_MODELS=none turns the fallback off", async () => {
  process.env.GEMINI_FALLBACK_MODELS = "none";
  respond(() => quotaRes());
  const { generateContent } = loadProvider();
  await assert.rejects(() => generateContent({ prompt: "hi" }), (err) => err.dailyQuota === true);
  assert.deepEqual(calls.map((c) => c.model), [MAIN]);
});

test("GEMINI_FALLBACK_MODELS overrides the list", async () => {
  process.env.GEMINI_FALLBACK_MODELS = "model-a, model-b";
  respond((model) => (model === "model-b" ? okRes(model) : quotaRes()));
  const { generateContent } = loadProvider();
  const out = await generateContent({ prompt: "hi" });
  assert.equal(out.model, "model-b");
  assert.deepEqual(calls.map((c) => c.model), [MAIN, "model-a", "model-b"]);
});
