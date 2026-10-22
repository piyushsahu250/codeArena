// The SSRF guard behind the document-download proxy (utils/safeFetch.js). REGRESSION (2026-10 audit):
//  * the host was resolved once to CHECK and again inside fetch() to CONNECT, so a hostile DNS server could answer a public address first and a private one second;
//  * the 20 s timeout ended when the headers arrived and the body had no size cap, so a hostile link could hold a connection or stream without limit.
// These tests run against a local server with an injected resolver and block rule, so no real network or private address is touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createSafeFetcher, isBlockedIp } = require("../src/utils/safeFetch");

const T = { timeout: 20000 };
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      close: () => new Promise((done) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => done()); }),
    }));
  });
}
const toLoopback = async () => [{ address: "127.0.0.1", family: 4 }];
const onlyLoopbackAllowed = (ip) => ip !== "127.0.0.1"; // "blocked" = anything except the test server
async function readAll(stream) { const chunks = []; for await (const c of stream) chunks.push(c); return Buffer.concat(chunks); }

test("it connects to the address it validated and still sends the URL's own host name", T, async () => {
  const s = await serve((req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end(`${req.headers.host} ${req.url}`); });
  try {
    const fetchIt = createSafeFetcher({ lookup: toLoopback, isBlocked: onlyLoopbackAllowed });
    const r = await fetchIt(`http://docs.example.test:${s.port}/a?b=1`);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/plain");
    assert.equal((await readAll(r.nodeStream)).toString(), `docs.example.test:${s.port} /a?b=1`);
  } finally { await s.close(); }
});

test("the host is resolved once per hop: a second, different DNS answer is never consulted", T, async () => {
  const s = await serve((req, res) => res.end("ok"));
  try {
    let calls = 0;
    const lookup = async () => (++calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.9", family: 4 }]); // a rebinding resolver
    const fetchIt = createSafeFetcher({ lookup, isBlocked: onlyLoopbackAllowed });
    const r = await fetchIt(`http://rebind.example.test:${s.port}/`);
    assert.equal((await readAll(r.nodeStream)).toString(), "ok");
    assert.equal(calls, 1, "the connection reuses the validated address instead of resolving again");
  } finally { await s.close(); }
});

test("a host that resolves to a private address is refused, and so is one with ANY private record", T, async () => {
  for (const records of [[{ address: "10.0.0.5", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "169.254.169.254", family: 4 }], [{ address: "::1", family: 6 }]]) {
    const fetchIt = createSafeFetcher({ lookup: async () => records }); // the real block list
    await assert.rejects(() => fetchIt("http://anything.example.test/"), /restricted address/);
  }
  const fetchIt = createSafeFetcher({ lookup: async () => [] });
  await assert.rejects(() => fetchIt("http://nothing.example.test/"), /Could not resolve/);
});

test("literal private addresses and non-http schemes are refused before any connection", T, async () => {
  const fetchIt = createSafeFetcher({ lookup: async () => { throw new Error("lookup must not run for a literal address"); } });
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:7f00:1]/", "http://2130706433/"]) {
    await assert.rejects(() => fetchIt(url), /restricted address/, url);
  }
  for (const url of ["file:///etc/passwd", "ftp://example.test/x", "gopher://example.test/"]) await assert.rejects(() => fetchIt(url), /Only http\/https/, url);
});

test("a redirect is re-validated: to an allowed host it is followed, to a restricted one it is refused", T, async () => {
  const s = await serve((req, res) => {
    if (req.url === "/to-internal") { res.writeHead(302, { location: `http://internal.example.test:${s.port}/` }); return res.end(); }
    if (req.url === "/to-b") { res.writeHead(302, { location: "/b" }); return res.end(); }
    res.end(req.url === "/b" ? "arrived" : "other");
  });
  try {
    const lookup = async (host) => (host === "internal.example.test" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    const fetchIt = createSafeFetcher({ lookup, isBlocked: onlyLoopbackAllowed });
    assert.equal((await readAll((await fetchIt(`http://ok.example.test:${s.port}/to-b`)).nodeStream)).toString(), "arrived");
    await assert.rejects(() => fetchIt(`http://ok.example.test:${s.port}/to-internal`), /restricted address/);
  } finally { await s.close(); }
});

test("an endless redirect chain stops", T, async () => {
  const s = await serve((req, res) => { res.writeHead(302, { location: "/again" }); res.end(); });
  try {
    const fetchIt = createSafeFetcher({ lookup: toLoopback, isBlocked: onlyLoopbackAllowed });
    await assert.rejects(() => fetchIt(`http://loop.example.test:${s.port}/`, { maxRedirects: 3 }), /Too many redirects/);
  } finally { await s.close(); }
});

test("a declared size over the ceiling is refused before any body is read", T, async () => {
  const s = await serve((req, res) => { res.writeHead(200, { "content-length": 5_000_000 }); res.write("start"); });
  try {
    const fetchIt = createSafeFetcher({ lookup: toLoopback, isBlocked: onlyLoopbackAllowed });
    await assert.rejects(() => fetchIt(`http://big.example.test:${s.port}/`, { maxBytes: 1000 }), /larger than the allowed size/);
  } finally { await s.close(); }
});

test("a body that never declares its size is cut off at the ceiling", T, async () => {
  const s = await serve((req, res) => { // chunked: 64 KB pieces, far more than the ceiling
    res.writeHead(200);
    let sent = 0;
    const pump = () => { while (sent < 40) { sent++; if (!res.write(Buffer.alloc(64 * 1024, 1))) return res.once("drain", pump); } res.end(); };
    pump();
  });
  try {
    const fetchIt = createSafeFetcher({ lookup: toLoopback, isBlocked: onlyLoopbackAllowed });
    const r = await fetchIt(`http://stream.example.test:${s.port}/`, { maxBytes: 256 * 1024 });
    await assert.rejects(() => readAll(r.nodeStream), /larger than the allowed size/);
  } finally { await s.close(); }
});

test("a body that stalls is cut off by the TOTAL time ceiling, not only the header wait", T, async () => {
  const s = await serve((req, res) => { res.writeHead(200); res.write("first bytes"); /* then never finishes */ });
  try {
    const fetchIt = createSafeFetcher({ lookup: toLoopback, isBlocked: onlyLoopbackAllowed });
    const started = Date.now();
    const r = await fetchIt(`http://slow.example.test:${s.port}/`, { totalMs: 300 });
    await assert.rejects(() => readAll(r.nodeStream));
    assert.ok(Date.now() - started < 5000, "the stalled download ended promptly");
  } finally { await s.close(); }
});

test("a normal file under the ceiling downloads in full", T, async () => {
  const payload = Buffer.alloc(300 * 1024, 7);
  const s = await serve((req, res) => { res.writeHead(200, { "content-type": "application/pdf" }); res.end(payload); });
  try {
    const fetchIt = createSafeFetcher({ lookup: toLoopback, isBlocked: onlyLoopbackAllowed });
    const r = await fetchIt(`http://files.example.test:${s.port}/x.pdf`);
    const got = await readAll(r.nodeStream);
    assert.equal(got.length, payload.length);
    assert.ok(got.equals(payload));
  } finally { await s.close(); }
});

test("isBlockedIp: reserved, private, mapped and embedded-IPv4 forms are blocked; ordinary public addresses are not", () => {
  const blocked = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "192.0.2.5", "198.51.100.9", "203.0.113.4", "::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::7f00:1",
    "2002:7f00:1::1", "2001:db8::1", "not-an-ip", ""];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.80.46", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isBlockedIp(ip), false, ip);
});
