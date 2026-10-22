const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const net = require("net");
const { Readable, Transform } = require("stream");

// SSRF guard for fetching URLs students/staff supply (e.g. StudentDocument.documentLink).
// Blocks loopback/private/link-local/reserved ranges -- including 169.254.169.254, the cloud metadata endpoint every major provider exposes -- so a crafted link
// can't turn our server into a proxy for probing its own internal network.
//
// Two properties matter beyond the address list:
//  * The host is resolved ONCE per hop, every returned address is checked, and the connection is then made to that same validated address (the `lookup` hook below
//    hands the socket the address we already checked). Resolving once to check and again inside fetch() let a hostile DNS server answer a public address first and a
//    private one second (DNS rebinding).
//  * The response is bounded: a byte ceiling and a total-time ceiling that covers the body, not just the headers, so a hostile link cannot hold a connection or
//    stream gigabytes through this server.

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TOTAL_MS = 60 * 1000;
const TOO_LARGE = "The linked file is larger than the allowed size";

// The IPv4 address embedded in an IPv4-mapped / IPv4-compatible IPv6 address (dotted or hex form), or null.
function embeddedIpv4(lower) {
  const dotted = lower.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

function isBlockedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments, documentation
    if (a === 198 && b === 51 && c === 100) return true; // documentation
    if (a === 203 && b === 0 && c === 113) return true; // documentation
    if (a >= 224) return true; // multicast + reserved (224.0.0.0/4, 240.0.0.0/4)
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    const mapped = embeddedIpv4(lower);
    if (mapped) return isBlockedIp(mapped);
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64: embeds an IPv4 address, can reach internal IPv4 hosts
    if (lower.startsWith("2002:")) return true; // 6to4: embeds an IPv4 address
    if (lower.startsWith("2001:db8:")) return true; // documentation
    if (lower.startsWith("100:")) return true; // discard-only
    return false;
  }
  return true; // unrecognized format -- fail closed
}

const bare = (hostname) => hostname.replace(/^\[|\]$/g, ""); // URL#hostname keeps the brackets of an IPv6 literal

async function resolveHost(hostname, lookup) {
  const host = bare(hostname);
  const family = net.isIP(host);
  if (family) return [{ address: host, family }];
  const records = await lookup(host, { all: true, verbatim: true });
  return Array.isArray(records) ? records : [];
}

// One GET to a validated, already-resolved address. Resolves to the raw IncomingMessage.
function requestPinned(parsed, target, signal) {
  return new Promise((resolve, reject) => {
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request({
      protocol: parsed.protocol,
      hostname: bare(parsed.hostname), // Host header and TLS server name still come from the URL, not from the pinned address
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: { "user-agent": "CodeArena-DocumentFetch/1.0", accept: "*/*", "accept-encoding": "identity" },
      lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)),
      signal,
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}

// A fetch-like view of the response: ok / status / headers.get(), plus `nodeStream` (a byte-capped Node stream) and `body` (the same as a web stream).
function toResponse(res, maxBytes) {
  const declared = Number(res.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); throw new Error(TOO_LARGE); }
  let seen = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, cb) {
      seen += chunk.length;
      if (seen > maxBytes) cb(new Error(TOO_LARGE)); else cb(null, chunk);
    },
  });
  res.on("error", (err) => limiter.destroy(err)); // a total-time abort or a reset mid-body ends the stream with an error instead of hanging
  res.on("close", () => { if (!res.complete) limiter.destroy(new Error("The download was interrupted")); }); // closed before the whole body arrived
  res.pipe(limiter);
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode,
    headers: { get: (name) => { const v = res.headers[String(name).toLowerCase()]; return Array.isArray(v) ? v.join(", ") : v == null ? null : v; } },
    nodeStream: limiter,
    body: Readable.toWeb(limiter),
    destroy: () => { res.destroy(); limiter.destroy(); }, // for a caller that decides not to read the body (e.g. a 404 from the source)
  };
}

// `lookup` and `isBlocked` are injectable so the guard can be tested against a local server; production uses the defaults.
function createSafeFetcher({ lookup = dns.lookup, isBlocked = isBlockedIp } = {}) {
  // Fetches an external, user-supplied URL with manual redirect handling -- each hop is resolved, validated (scheme + every resolved IP) and pinned before it is
  // followed, so a link can't pass the initial check and then 302 into an internal address.
  return async function fetchExternalUrl(url, { signal, maxRedirects = 5, maxBytes = DEFAULT_MAX_BYTES, totalMs = DEFAULT_TOTAL_MS } = {}) {
    const deadline = AbortSignal.timeout(totalMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let current = url;
    try {
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const parsed = new URL(current);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http/https links are allowed");
        const records = await resolveHost(parsed.hostname, lookup);
        if (!records.length) throw new Error("Could not resolve this link's host");
        for (const { address } of records) if (isBlocked(address)) throw new Error("This link points to a restricted address");
        const res = await requestPinned(parsed, records[0], combined);
        const location = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && location) {
          res.resume(); // discard the redirect body and free the socket
          current = new URL(location, current).toString();
          continue;
        }
        return toResponse(res, maxBytes);
      }
    } catch (err) {
      if (deadline.aborted) throw new Error("Fetching the linked file took too long");
      throw err;
    }
    throw new Error("Too many redirects");
  };
}

const fetchExternalUrl = createSafeFetcher();

module.exports = { fetchExternalUrl, createSafeFetcher, isBlockedIp, DEFAULT_MAX_BYTES, DEFAULT_TOTAL_MS };
