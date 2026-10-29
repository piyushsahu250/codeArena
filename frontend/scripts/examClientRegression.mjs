// Regression test for the examination page's pure helpers: the versioned answer saver, the server-clock display, and the progress/error helpers. No DOM.
// Run: node frontend/scripts/examClientRegression.mjs
import { createExamAnswerSaver } from "../src/utils/examAnswerSaver.js";
import { clockOffset, secondsUntil, formatClock, timerTone } from "../src/utils/examClock.js";
import { isAnswered, countAnswered, reviewSummary, sectionState, nextOpenable, allSectionsDone, examErrorMessage } from "../src/utils/examProgress.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const httpError = (status, data) => Object.assign(new Error("http " + status), { response: { status, data } });

function fakeClock() {
  const timers = [];
  return { setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clearTimer: (t) => { if (t) t.live = false; }, pending: () => timers.filter((t) => t.live), fire: () => { const t = timers.find((x) => x.live); if (t) { t.live = false; t.fn(); } } };
}
// A fake server: stores the version and payload per item; a put with a wrong version is a 409 STALE_VERSION carrying the current version.
function fakeServer() {
  const rows = new Map(); const calls = []; let failNext = null;
  const put = async (itemRef, body) => {
    calls.push({ itemRef, ...body });
    if (failNext) { const f = failNext; failNext = null; throw f; }
    const row = rows.get(itemRef);
    if (!row) { if (body.version !== 0) throw httpError(409, { code: "STALE_VERSION", currentVersion: 0 }); rows.set(itemRef, { version: 1, payload: body.payload }); return { version: 1 }; }
    if (body.version !== row.version) throw httpError(409, { code: "STALE_VERSION", currentVersion: row.version });
    row.version += 1; row.payload = body.payload; return { version: row.version };
  };
  return { put, rows, calls, failWith: (e) => { failNext = e; } };
}

// 1. first save is version 0, later saves use the confirmed version, "saved" only after confirmation
{
  const srv = fakeServer(); const clock = fakeClock(); const statuses = [];
  const saver = createExamAnswerSaver({ put: srv.put, onStatus: (k, s) => statuses.push(s), ...clock });
  saver.save("q1", { selected: 1 }); await settle();
  check("the first save sends version 0", srv.calls[0].version === 0 && srv.rows.get("q1").version === 1);
  check("status is saved only after the server confirmed", saver.status("q1") === "saved");
  saver.save("q1", { selected: 2 }); await settle();
  check("the next save sends the confirmed version 1 and the server ends at version 2", srv.calls[1].version === 1 && srv.rows.get("q1").version === 2 && srv.rows.get("q1").payload.selected === 2);
  check("the saver knows the confirmed version", saver.versionOf("q1") === 2);
}

// 2. an unchanged payload is not sent again, key order does not matter
{
  const srv = fakeServer(); const saver = createExamAnswerSaver({ put: srv.put, ...fakeClock() });
  saver.save("q1", { text: "a", input: "TYPED" }); await settle();
  saver.save("q1", { text: "a", input: "TYPED" }); await settle();
  check("the same payload again sends nothing", srv.calls.length === 1);
}

// 3. a stale version is repaired once and the newest value wins
{
  const srv = fakeServer(); const saver = createExamAnswerSaver({ put: srv.put, ...fakeClock() });
  srv.rows.set("q1", { version: 5, payload: { selected: 0 } }); // the server is ahead of this page (for example after a reload)
  saver.save("q1", { selected: 3 }); await settle();
  check("a stale save learns the server version and is sent again", srv.calls.length === 2 && srv.calls[1].version === 5 && srv.rows.get("q1").version === 6);
  check("this tab's newest value is what the server keeps", srv.rows.get("q1").payload.selected === 3);
  check("and it is reported saved", saver.status("q1") === "saved");
}

// 4. versions seeded from the attempt view avoid the stale round trip
{
  const srv = fakeServer(); const saver = createExamAnswerSaver({ put: srv.put, ...fakeClock() });
  srv.rows.set("q1", { version: 3, payload: { selected: 0 } });
  saver.setVersion("q1", 3);
  saver.save("q1", { selected: 1 }); await settle();
  check("a restored answer is saved on the first try", srv.calls.length === 1 && srv.calls[0].version === 3);
  saver.setVersion("q1", "nope");
  check("a bad version is ignored", saver.versionOf("q1") === 4);
}

// 5. network failures are retried, permanent refusals are not, and nothing is lost
{
  const srv = fakeServer(); const clock = fakeClock();
  const saver = createExamAnswerSaver({ put: srv.put, retryDelaysMs: [1000], ...clock });
  srv.failWith(new Error("Network Error"));
  saver.save("q1", { text: "keep me" }); await settle();
  check("a network failure shows reconnecting", saver.status("q1") === "retrying" && clock.pending().length === 1);
  clock.fire(); await settle();
  check("the retry sends the same text and succeeds", srv.rows.get("q1").payload.text === "keep me" && saver.status("q1") === "saved");
  srv.failWith(httpError(409, { code: "ATTEMPT_CLOSED" }));
  saver.save("q2", { text: "late" }); await settle();
  check("a refusal because the attempt is closed is failed, with no retry loop", saver.status("q2") === "failed" && clock.pending().length === 0);
  srv.failWith(httpError(409, { code: "STALE_VERSION" }));
  saver.save("q3", { text: "x" }); await settle();
  check("a stale error without a usable current version is not retried forever", saver.status("q3") === "failed");
}

// 6. items are independent, and the newest value wins while a request is in flight
{
  let release; const gate = new Promise((r) => { release = r; }); const calls = [];
  const put = async (itemRef, body) => { calls.push({ itemRef, ...body }); if (calls.length === 1) await gate; return { version: body.version + 1 }; };
  const saver = createExamAnswerSaver({ put, ...fakeClock() });
  saver.save("q1", { text: "a" }); await settle();
  saver.save("q1", { text: "ab" }); saver.save("q1", { text: "abc" }); saver.save("q2", { text: "other" }); await settle();
  check("only one request per item is in flight and other items go ahead", calls.length === 2 && calls[0].itemRef === "q1" && calls[1].itemRef === "q2");
  release(); await settle();
  check("then the newest value of the first item is sent with the new version", calls.length === 3 && calls[2].payload.text === "abc" && calls[2].version === 1);
}

// 7. finalize flushes first, then sends the final value with the flag
{
  const srv = fakeServer(); const saver = createExamAnswerSaver({ put: srv.put, ...fakeClock() });
  saver.save("q1", { selected: 1 }); await settle();
  const ok = await saver.finalize("q1", { selected: 2 });
  check("finalize succeeds and sends the flag after the pending save", ok === true && srv.calls.at(-1).finalize === true && srv.rows.get("q1").payload.selected === 2);
  srv.failWith(httpError(409, { code: "ANSWER_LOCKED" }));
  check("a refused finalize reports false", (await saver.finalize("q1", { selected: 3 })) === false);
}

// 8. clock helpers
{
  check("the offset is the server's time minus the browser's", clockOffset(10_000, 4_000) === 6_000 && clockOffset(NaN, 4_000) === 0);
  check("the remaining time follows the server's clock, not the browser's", secondsUntil(100_000, 6_000, 4_000) === 90 && secondsUntil(100_000, 0, 4_000) === 96);
  check("it never goes below zero and a missing deadline shows nothing", secondsUntil(1_000, 0, 5_000) === 0 && secondsUntil(null) === null);
  check("formatting: minutes and hours", formatClock(65) === "01:05" && formatClock(3725) === "1:02:05" && formatClock(0) === "00:00" && formatClock(null) === "--:--" && formatClock(-5) === "00:00");
  check("the timer turns urgent in the last 5 minutes or last 10 percent", timerTone(299, 3600) === "urgent" && timerTone(361, 3600) === "normal" && timerTone(399, 4000) === "urgent" && timerTone(401, 4000) === "normal" && timerTone(null, 100) === "normal");
}

// 9. progress helpers
{
  check("option 0 is an answer, an empty selection is not", isAnswered("APTITUDE", { selected: 0 }) && !isAnswered("APTITUDE", { selected: null }) && !isAnswered("TECHNICAL", { selected: [] }) && isAnswered("TECHNICAL", { selected: [1] }));
  check("blank text and blank code are not answers", !isAnswered("AI_INTERVIEW", { text: "  " }) && isAnswered("AI_INTERVIEW", { text: "hi" }) && !isAnswered("CODING", { code: "\n" }) && isAnswered("CODING", { code: "x" }) && !isAnswered("CODING", null));
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const drafts = { a: { selected: 1 }, c: { selected: null } };
  check("counts answered and lists the unanswered question numbers", countAnswered("APTITUDE", items, drafts) === 1 && JSON.stringify(reviewSummary("APTITUDE", items, drafts)) === JSON.stringify({ total: 3, answered: 1, unanswered: [2, 3] }));
  check("empty input is handled", countAnswered("APTITUDE", undefined, undefined) === 0 && reviewSummary("APTITUDE", undefined, undefined).total === 0);
  const secs = [{ key: "A", status: "COMPLETED" }, { key: "B", status: "LOCKED" }, { key: "C", status: "LOCKED" }];
  check("the next section is the first locked one, only when none is open", nextOpenable(secs).key === "B" && nextOpenable([{ status: "IN_PROGRESS" }, { status: "LOCKED" }]) === null && nextOpenable([{ status: "COMPLETED" }]) === null);
  check("done means every section completed", allSectionsDone([{ status: "COMPLETED" }, { status: "COMPLETED" }]) && !allSectionsDone(secs) && !allSectionsDone([]));
  check("section states for the navigation bar", sectionState({ status: "COMPLETED" }) === "done" && sectionState({ status: "IN_PROGRESS" }) === "open" && sectionState({ status: "LOCKED" }) === "locked" && sectionState(null) === "locked");
}

// 10. error messages
{
  check("known codes get the student-friendly sentence", /another tab/.test(examErrorMessage(httpError(409, { code: "SESSION_REPLACED" }))) && /not been confirmed|have not reached/.test(examErrorMessage(httpError(409, { code: "UNSAVED_ANSWERS" }))));
  check("an unknown code uses the server's message, and nothing at all uses the fallback", examErrorMessage(httpError(400, { code: "NEW_ONE", error: "Server says" })) === "Server says" && /saved answers are safe/.test(examErrorMessage(new Error("x"))));
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("Exam client regression: all passed");
