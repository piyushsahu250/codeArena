// Regression test for src/utils/dedupeWrites.js (the double-click protection in the shared API client). Pure logic with a fake transport: no browser, no server.
// Run: node frontend/scripts/dedupeWritesRegression.mjs
import { withWriteDedupe } from "../src/utils/dedupeWrites.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

// A transport whose requests finish only when the test says so, and which counts how many were really sent.
function fakeTransport() {
  const sent = [];
  const adapter = (config) => new Promise((resolve, reject) => { sent.push({ config, resolve, reject }); });
  return { adapter, sent };
}
const cfg = (over = {}) => ({ method: "post", baseURL: "http://x/api", url: "/things", data: '{"a":1}', headers: { Authorization: "Bearer t1" }, ...over });

// 1. A double click sends one request; both callers get the same answer.
{
  const t = fakeTransport(); const a = withWriteDedupe(t.adapter);
  const p1 = a(cfg()); const p2 = a(cfg());
  check("an identical POST while the first is in flight is sent once", t.sent.length === 1, `sent=${t.sent.length}`);
  t.sent[0].resolve({ status: 201, data: { id: 7 } });
  const [r1, r2] = await Promise.all([p1, p2]);
  check("both callers receive the one response", r1 === r2 && r1.data.id === 7);
}

// 2. After the first finishes, the same action can be repeated on purpose.
{
  const t = fakeTransport(); const a = withWriteDedupe(t.adapter);
  const p1 = a(cfg()); t.sent[0].resolve({ status: 200 }); await p1;
  const p2 = a(cfg());
  check("the same request after the first settled is sent again", t.sent.length === 2);
  t.sent[1].resolve({ status: 200 }); await p2;
}

// 3. A failure is shared, then does not poison the next attempt.
{
  const t = fakeTransport(); const a = withWriteDedupe(t.adapter);
  const p1 = a(cfg()); const p2 = a(cfg());
  const boom = new Error("500"); t.sent[0].reject(boom);
  const o1 = await p1.then(() => "ok", (e) => e); const o2 = await p2.then(() => "ok", (e) => e);
  check("an error is delivered to both callers", o1 === boom && o2 === boom);
  const p3 = a(cfg());
  check("a retry after a failure is sent", t.sent.length === 2);
  t.sent[1].resolve({ status: 200 }); await p3;
}

// 4. Different requests are never merged.
{
  const t = fakeTransport(); const a = withWriteDedupe(t.adapter);
  const calls = [
    cfg(), cfg({ data: '{"a":2}' }), cfg({ url: "/other" }), cfg({ method: "put" }), cfg({ params: { x: 1 } }),
    cfg({ headers: { Authorization: "Bearer t2" } }), cfg({ method: "delete", data: undefined }),
  ];
  calls.forEach((c) => { a(c); });
  check("different body, url, method, query, user or verb are all sent", t.sent.length === calls.length, `sent=${t.sent.length}/${calls.length}`);
}

// 5. Reads, uploads and opted-out calls are untouched.
{
  const t = fakeTransport(); const a = withWriteDedupe(t.adapter);
  a(cfg({ method: "get", data: undefined })); a(cfg({ method: "get", data: undefined }));
  check("GET requests are never collapsed", t.sent.length === 2);
  const upload = { name: "file-like object, not a string" };
  a(cfg({ data: upload })); a(cfg({ data: upload }));
  check("a non-string body (FormData, Blob) is never collapsed", t.sent.length === 4);
  a(cfg({ allowDuplicate: true })); a(cfg({ allowDuplicate: true }));
  check("allowDuplicate opts a call out", t.sent.length === 6);
}

// 6. AxiosHeaders-style objects (with a get method) are read correctly.
{
  const t = fakeTransport(); const a = withWriteDedupe(t.adapter);
  const headers = (tok) => ({ get: (n) => (n === "Authorization" ? tok : undefined) });
  a(cfg({ headers: headers("Bearer A") })); a(cfg({ headers: headers("Bearer A") })); a(cfg({ headers: headers("Bearer B") }));
  check("requests are identified by the signed-in user's token, read through headers.get", t.sent.length === 2, `sent=${t.sent.length}`);
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
