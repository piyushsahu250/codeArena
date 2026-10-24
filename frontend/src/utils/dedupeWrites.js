// Collapses an identical write that is already in flight into the one request, for the shared API client (src/api.js).
//
// Why: a double click (or a click, then an impatient second click while the server is still working) on a Save / Send / Create button sent the same POST twice. Where the page
// had no "disabled while saving" guard (the scan of the pages found several: "Save Question" on the interview admin page created the question twice; "Send" feedback on the
// resume admin page e-mailed the student twice) the result was a duplicate record. Guarding each button one at a time left the next page unprotected; this fixes the class in one place.
//
// What is collapsed: POST, PUT, PATCH and DELETE with the same method, URL, query and JSON body while the first is still pending. The second caller receives the first request's
// own response (or error), so nothing is sent twice and both callers see the same outcome. As soon as the first settles, the next identical request is sent normally,
// so deliberately repeating an action (Save, edit, Save again) is never blocked.
// What is not touched: GET and other reads; uploads (a FormData / Blob body cannot be compared); and any request that opts out with `config.allowDuplicate = true`.

const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

function keyFor(config) {
  const method = String(config.method || "get").toLowerCase();
  if (!WRITE_METHODS.has(method)) return null;
  const body = config.data;
  if (body !== undefined && body !== null && typeof body !== "string") return null; // FormData, Blob, ArrayBuffer, stream: not comparable
  let params = "";
  try { params = config.params ? JSON.stringify(config.params) : ""; } catch { return null; }
  // the signed-in user and the exam / secure-session headers are part of the identity of the request
  const h = config.headers || {};
  const read = (name) => { const v = typeof h.get === "function" ? h.get(name) : h[name]; return typeof v === "string" ? v : ""; };
  const who = [read("Authorization"), read("X-Exam-Session"), read("X-Secure-Session")].join("|");
  return [method, config.baseURL || "", config.url || "", params, body || "", who].join("\u0001");
}

// `adapter` is axios' real transport: (config) => Promise<response>. Returns an adapter with the behaviour above.
export function withWriteDedupe(adapter) {
  const inFlight = new Map();
  return function dedupingAdapter(config) {
    const key = config.allowDuplicate ? null : keyFor(config);
    if (key === null) return adapter(config);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = Promise.resolve(adapter(config)).finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
    inFlight.set(key, request);
    return request;
  };
}
