// Regression test for the speech-to-text engine used by the interview answer box. No DOM: a fake SpeechRecognition is driven by hand and the clock is fake.
// Run: node frontend/scripts/dictationRegression.mjs
import { createDictationEngine, DICT, canTransition, canStartFrom, isBusy, MESSAGES } from "../src/utils/dictationEngine.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// ---- fakes -------------------------------------------------------------------------------------------------------------------------------------------------
function fakeClock() {
  let t = 1000;
  const timers = [];
  return {
    now: () => t, advance: (ms) => { t += ms; },
    setTimer: (fn, ms) => { const x = { fn, ms, live: true }; timers.push(x); return x; },
    clearTimer: (x) => { if (x) x.live = false; },
    pending: () => timers.filter((x) => x.live),
    fire: () => { const x = timers.find((y) => y.live); if (x) { x.live = false; x.fn(); } },
  };
}
// A SpeechRecognition stand-in. `instances` records every one created; helpers deliver results like a browser would.
function makeRecognition() {
  const instances = [];
  class Rec {
    constructor() { this.started = false; this.aborted = false; this.stopped = false; this.autoEndOnStop = true; instances.push(this); }
    start() { if (this.throwOnStart) throw new Error("InvalidStateError"); this.started = true; }
    stop() { this.stopped = true; if (this.autoEndOnStop) queueMicrotask(() => this.onend?.()); }
    abort() { this.aborted = true; }
    // emulation helpers
    emitStart() { this.onstart?.(); }
    emitResults(list) { // list of [text, isFinal]
      const results = list.map(([text, isFinal]) => Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal }));
      this.onresult?.({ results, resultIndex: 0 });
    }
    emitError(code) { this.onerror?.({ error: code }); }
    emitEnd() { this.onend?.(); }
  }
  return { Rec, instances, last: () => instances[instances.length - 1] };
}
function setup(over = {}) {
  const clock = fakeClock();
  const fake = makeRecognition();
  const commits = []; const states = [];
  const engine = createDictationEngine({
    getCtor: () => (over.noCtor ? null : fake.Rec), lang: "en-IN",
    onCommit: (q, text) => commits.push({ q, text }),
    onChange: (s) => states.push(s.status),
    isSecureContext: () => over.insecure !== true,
    queryMicPermission: over.permission ? async () => over.permission : async () => "granted",
    ...clock, ...over.engine,
  });
  return { engine, fake, clock, commits, states };
}
async function recording(over) { const s = setup(over); await s.engine.start("qA"); s.fake.last().emitStart(); await settle(); return s; }

// ---- state machine -----------------------------------------------------------------------------------------------------------------------------------------
check("the documented flow is allowed step by step", [[DICT.IDLE, DICT.REQUESTING_PERMISSION], [DICT.REQUESTING_PERMISSION, DICT.READY], [DICT.READY, DICT.RECORDING], [DICT.RECORDING, DICT.PROCESSING_TRANSCRIPT], [DICT.PROCESSING_TRANSCRIPT, DICT.TRANSCRIPT_READY], [DICT.TRANSCRIPT_READY, DICT.IDLE]].every(([a, b]) => canTransition(a, b)));
check("steps that skip the flow are refused", !canTransition(DICT.IDLE, DICT.RECORDING) && !canTransition(DICT.RECORDING, DICT.READY) && !canTransition(DICT.TRANSCRIPT_READY, DICT.RECORDING) && !canTransition(DICT.PROCESSING_TRANSCRIPT, DICT.RECORDING));
check("every error state can retry or go idle", [DICT.PERMISSION_DENIED, DICT.DEVICE_UNAVAILABLE, DICT.RECOGNITION_ERROR, DICT.NETWORK_ERROR, DICT.RECOVERY_REQUIRED].every((s) => canTransition(s, DICT.REQUESTING_PERMISSION) && canTransition(s, DICT.IDLE)));
check("a start is possible only when nothing is running", canStartFrom(DICT.IDLE) && canStartFrom(DICT.TRANSCRIPT_READY) && canStartFrom(DICT.NETWORK_ERROR) && !canStartFrom(DICT.RECORDING) && !canStartFrom(DICT.REQUESTING_PERMISSION) && !canStartFrom(DICT.PROCESSING_TRANSCRIPT));
check("busy covers acquiring the microphone and finishing", isBusy(DICT.REQUESTING_PERMISSION) && isBusy(DICT.PROCESSING_TRANSCRIPT) && !isBusy(DICT.RECORDING) && !isBusy(DICT.IDLE));

// 1. successful recognition, interim vs final, nothing saved from interim
{
  const s = setup();
  const started = await s.engine.start("qA");
  check("start returns true and the state is waiting for the microphone", started === true && s.engine.getState().status === DICT.REQUESTING_PERMISSION);
  s.fake.last().emitStart(); await settle();
  check("the engine reports RECORDING once audio starts", s.engine.getState().status === DICT.RECORDING);
  s.fake.last().emitResults([["hello wor", false]]); await settle();
  check("interim text is shown but not committed", s.engine.getState().interim === "hello wor" && s.commits.length === 0);
  s.fake.last().emitResults([["hello world", false]]); await settle();
  check("a revised interim REPLACES the previous interim (no duplicated words)", s.engine.getState().interim === "hello world" && s.commits.length === 0);
  s.fake.last().emitResults([["hello world", true]]); await settle();
  check("the final result is committed once, for the right question", s.commits.length === 1 && s.commits[0].q === "qA" && s.commits[0].text === "hello world");
  check("interim is cleared after the final", s.engine.getState().interim === "");
  s.fake.last().emitResults([["hello world", true]]); await settle();
  check("the same event delivered again is not committed again", s.commits.length === 1);
  s.fake.last().emitResults([["hello world", true], ["this is a test", false]]); await settle();
  check("a new interim after a final shows only the new words", s.engine.getState().interim === "this is a test" && s.commits.length === 1);
  s.fake.last().emitResults([["hello world", true], ["this is a test", true]]); await settle();
  check("the second final is committed, the first is not repeated", s.commits.length === 2 && s.commits[1].text === "this is a test");
}

// 2. stop: waits for the last words, then reports transcript ready
{
  const s = await recording();
  s.fake.last().emitResults([["first phrase", true]]); await settle();
  let stopped = false;
  const p = s.engine.stop().then(() => { stopped = true; });
  await settle();
  const inst = s.fake.last();
  check("stop asks the engine to stop", inst.stopped === true);
  await p;
  check("stop resolves after the engine ended", stopped === true);
  check("a recording with text ends in TRANSCRIPT_READY with the success notice", s.engine.getState().status === DICT.TRANSCRIPT_READY && s.engine.getState().notice === MESSAGES.READY);
}

// 3. last words arriving while stopping are still committed (to the right question)
{
  const s = await recording();
  const inst = s.fake.last();
  inst.autoEndOnStop = false;
  const p = s.engine.stop();
  await settle();
  check("while finishing the state is PROCESSING_TRANSCRIPT", s.engine.getState().status === DICT.PROCESSING_TRANSCRIPT);
  inst.emitResults([["the last words", true]]); await settle();
  inst.emitEnd(); await p;
  check("the last words are committed to the question the recording started on", s.commits.length === 1 && s.commits[0].q === "qA" && s.commits[0].text === "the last words");
}

// 4. an engine that never ends: the grace timer finalises with what was delivered
{
  const s = await recording();
  const inst = s.fake.last();
  inst.autoEndOnStop = false;
  inst.emitResults([["kept", true]]); await settle();
  const p = s.engine.stop(); await settle();
  check("a grace timer is waiting", s.clock.pending().length === 1);
  s.clock.fire(); await p;
  check("after the grace period the transcript is finalised with what was delivered", s.engine.getState().status === DICT.TRANSCRIPT_READY && s.commits.length === 1);
}

// 5. empty transcript: no success message
{
  const s = await recording();
  await s.engine.stop();
  const st = s.engine.getState();
  check("no speech: back to IDLE with the no-speech message, never the success message", st.status === DICT.IDLE && st.notice === MESSAGES.NO_SPEECH && s.commits.length === 0);
}

// 6. only one recording at a time, and repeated sessions work
{
  const s = setup();
  const a = s.engine.start("q1"); const b = await s.engine.start("q1");
  check("a second start while one is starting is refused", b === false);
  await a; s.fake.last().emitStart(); await settle();
  check("a second start while recording is refused", (await s.engine.start("q1")) === false && s.fake.instances.length === 1);
  s.fake.last().emitResults([["one", true]]); await settle(); await s.engine.stop();
  check("first session ended", s.engine.getState().status === DICT.TRANSCRIPT_READY);
  check("a new recording can start after the first ended", (await s.engine.start("q2")) === true);
  s.fake.last().emitStart(); await settle();
  s.fake.last().emitResults([["two", true]]); await settle(); await s.engine.stop();
  check("each session's text went to its own question", s.commits.map((c) => `${c.q}:${c.text}`).join("|") === "q1:one|q2:two");
  check("the commit count starts again for the new session", s.engine.getState().commitCount === 1);
}

// 7. engine ends by itself after silence: restart, keep the text, continue
{
  const s = await recording();
  const first = s.fake.last();
  first.emitResults([["before the pause", true]]); await settle();
  first.emitEnd(); await settle();
  check("a recogniser that ends by itself is restarted (a new instance)", s.fake.instances.length === 2 && s.engine.getState().status === DICT.RECORDING);
  first.emitResults([["stale words from the old instance", true]]); await settle();
  check("anything the OLD instance says after it ended is ignored", s.commits.length === 1);
  s.fake.last().emitStart(); await settle();
  s.fake.last().emitResults([["after the pause", true]]); await settle();
  check("text from before and after the restart is kept, in order, once each", s.commits.map((c) => c.text).join("|") === "before the pause|after the pause");
}

// 8. duplicate replay after a restart is dropped, a genuine repeat later is kept
{
  const s = await recording();
  s.fake.last().emitResults([["I would use a hash map", true]]); await settle();
  s.fake.last().emitEnd(); await settle();
  s.fake.last().emitResults([["I would use a hash map", true]]); await settle();
  check("the same phrase replayed right after a restart is not committed twice", s.commits.length === 1);
  s.clock.advance(5000);
  s.fake.last().emitEnd(); await settle();
  s.fake.last().emitResults([["I would use a hash map", true]]); await settle();
  check("the same words said again much later (a new instance, 5 s on) are kept", s.commits.length === 2);
}

// 9. restart loop guard
{
  const s = await recording({ engine: { maxRapidRestarts: 3, rapidWindowMs: 3000 } });
  for (let i = 0; i < 6 && s.engine.getState().status === DICT.RECORDING; i++) { s.fake.last().emitEnd(); await settle(); }
  check("a recogniser that keeps ending at once ends in RECOVERY_REQUIRED with its message", s.engine.getState().status === DICT.RECOVERY_REQUIRED && s.engine.getState().message === MESSAGES.RECOVERY_REQUIRED);
  check("it stopped creating instances", s.fake.instances.length <= 5);
}

// 10. errors
{
  const s = setup();
  await s.engine.start("q"); s.fake.last().emitError("not-allowed"); await settle();
  check("permission denied is its own state with the exact message", s.engine.getState().status === DICT.PERMISSION_DENIED && s.engine.getState().message === MESSAGES.PERMISSION_DENIED);
  check("after an error a retry starts a new recording", (await s.engine.start("q")) === true && s.engine.getState().status === DICT.REQUESTING_PERMISSION);
  s.fake.last().emitStart(); await settle(); s.fake.last().emitError("audio-capture"); await settle();
  check("no microphone is DEVICE_UNAVAILABLE", s.engine.getState().status === DICT.DEVICE_UNAVAILABLE);
  await s.engine.start("q"); s.fake.last().emitStart(); await settle(); s.fake.last().emitError("network"); await settle();
  check("a lost connection is NETWORK_ERROR and says the answer is preserved", s.engine.getState().status === DICT.NETWORK_ERROR && /preserved/.test(s.engine.getState().message));
  await s.engine.start("q"); s.fake.last().emitStart(); await settle(); s.fake.last().emitError("service-not-allowed"); await settle();
  check("service-not-allowed is also a permission problem", s.engine.getState().status === DICT.PERMISSION_DENIED);
  await s.engine.start("q"); s.fake.last().emitStart(); await settle(); s.fake.last().emitError("something-new"); await settle();
  check("an unknown error is RECOGNITION_ERROR with the service-unavailable message", s.engine.getState().status === DICT.RECOGNITION_ERROR && s.engine.getState().message === MESSAGES.RECOGNITION_ERROR);
}
{
  const s = await recording();
  s.fake.last().emitResults([["kept text", true]]); await settle();
  s.fake.last().emitError("network"); await settle();
  check("text committed before an error stays committed", s.commits.length === 1 && s.commits[0].text === "kept text");
}
{
  const s = await recording();
  s.fake.last().emitError("no-speech"); await settle();
  check("no-speech is not an error: still recording", s.engine.getState().status === DICT.RECORDING);
  s.fake.last().emitEnd(); await settle();
  check("and the engine restarts after it", s.engine.getState().status === DICT.RECORDING && s.fake.instances.length === 2);
}
{
  const s = await recording();
  s.fake.last().emitError("aborted"); await settle();
  check("aborted is not an error either", s.engine.getState().status === DICT.RECORDING);
}
{
  const s = setup();
  await s.engine.start("q");
  const failing = s.fake.last();
  failing.onend?.(); await settle();
  check("an instance that ends before any audio started is a recognition error, not a hang", s.engine.getState().status === DICT.RECOGNITION_ERROR);
}
{
  const s = setup(); s.fake.Rec.prototype.throwOnStart = true;
  const ok = await s.engine.start("q");
  check("start() throwing inside the browser is reported as a recognition error", ok === false && s.engine.getState().status === DICT.RECOGNITION_ERROR);
}

// 11. unsupported browser, insecure page, microphone blocked before asking
{
  const s = setup({ noCtor: true });
  check("no SpeechRecognition: isSupported is false", s.engine.isSupported() === false);
  check("start() says UNSUPPORTED and does not pretend to record", (await s.engine.start("q")) === false && s.engine.getState().status === DICT.UNSUPPORTED && s.engine.getState().message === MESSAGES.UNSUPPORTED && s.fake.instances.length === 0);
}
{
  const s = setup({ insecure: true });
  check("a page that is not secure cannot record, and the message says why", (await s.engine.start("q")) === false && s.engine.getState().message === MESSAGES.UNSUPPORTED_INSECURE);
}
{
  const s = setup({ permission: "denied" });
  check("a permission already denied is reported without starting recognition", (await s.engine.start("q")) === false && s.engine.getState().status === DICT.PERMISSION_DENIED && s.fake.instances.length === 0);
}

// 12. leaving the question / unmount / cancel
{
  const s = await recording();
  s.fake.last().emitResults([["half done", true]]); await settle();
  const inst = s.fake.last();
  s.engine.cancel();
  check("cancel aborts the engine and goes IDLE", inst.aborted === true && s.engine.getState().status === DICT.IDLE);
  inst.emitResults([["late words", true]]); await settle();
  check("results arriving after cancel are ignored", s.commits.length === 1);
}
{
  const s = await recording();
  const inst = s.fake.last();
  s.engine.dispose();
  check("dispose aborts the engine and drops its handlers", inst.aborted === true && inst.onresult === null && inst.onend === null);
  check("a disposed engine refuses to start", (await s.engine.start("q")) === false);
  const before = s.states.length;
  inst.onresult?.({ results: [] });
  check("nothing is reported after dispose", s.states.length === before);
}
{
  const s = setup();
  const p = s.engine.start("q"); // permission query pending
  s.engine.cancel();
  await p;
  await settle();
  check("cancelling while the permission query is pending never creates a recogniser", s.fake.instances.length === 0 && s.engine.getState().status === DICT.IDLE);
}
{
  const s = await recording();
  const stopping = s.engine.stop();
  s.engine.dispose();
  await stopping;
  check("a stop() that is waiting is released by dispose", true);
}

// 13. long answers
{
  const s = await recording();
  const words = Array.from({ length: 300 }, (_, i) => `word${i}`);
  for (let i = 0; i < 30; i++) {
    s.fake.last().emitResults([[words.slice(i * 10, i * 10 + 10).join(" "), true]]); await settle();
    s.fake.last().emitEnd(); await settle();
    s.clock.advance(3500); // each pause is well apart, like real speech
  }
  const all = s.commits.map((c) => c.text).join(" ").split(" ");
  check("a long dictation across 30 restarts commits every word once, in order", all.length === 300 && all.every((w, i) => w === words[i]));
  check("and keeps recording", s.engine.getState().status === DICT.RECORDING);
}

// 14. whitespace and empty results
{
  const s = await recording();
  s.fake.last().emitResults([["  spaced   out   words  ", true]]); await settle();
  check("a commit is trimmed and single-spaced", s.commits[0].text === "spaced out words");
  s.fake.last().emitResults([["  spaced   out   words  ", true], ["   ", true]]); await settle();
  check("an empty final is not committed", s.commits.length === 1);
}

// 15. commit callback throwing does not break the engine's state
{
  const clock = fakeClock(); const fake = makeRecognition();
  const engine = createDictationEngine({ getCtor: () => fake.Rec, onCommit: () => { throw new Error("boom"); }, queryMicPermission: async () => "granted", ...clock });
  await engine.start("q"); fake.last().emitStart(); await settle();
  const realError = console.error; console.error = () => {};
  let threw = false;
  try { fake.last().emitResults([["x", true]]); fake.last().emitResults([["x", true], ["y", false]]); } catch { threw = true; }
  console.error = realError;
  check("an exception in the page's onCommit never breaks recognition", threw === false && engine.getState().status === DICT.RECORDING);
  check("and the next phrase is still processed", engine.getState().interim === "y");
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("Dictation regression: all passed");
