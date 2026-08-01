const dns = require("dns").promises;
const net = require("net");

// SSRF guard for fetching URLs students/staff supply (e.g. StudentDocument.documentLink).
// Blocks loopback/private/link-local/reserved ranges — including 169.254.169.254, the cloud
// metadata endpoint every major provider exposes — so a crafted link can't turn our server into a
// proxy for probing its own internal network. Checked against the *resolved* IP, not the hostname
// string, since a hostname can resolve to a private address (DNS rebinding) regardless of how it
// looks in the URL.
function isBlockedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved (224.0.0.0/4, 240.0.0.0/4)
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
    if (lower.startsWith("fe80") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // unrecognized format — fail closed
}

async function assertPublicHost(hostname) {
  const literal = net.isIP(hostname);
  if (literal) {
    if (isBlockedIp(hostname)) throw new Error("This link points to a restricted address");
    return;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length) throw new Error("Could not resolve this link's host");
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error("This link points to a restricted address");
  }
}

// Fetches an external, user-supplied URL with manual redirect handling — each hop is re-validated
// (scheme + resolved IP) before being followed, so a link can't pass the initial check and then
// 302 into an internal address.
async function fetchExternalUrl(url, { signal, maxRedirects = 5 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http/https links are allowed");
    }
    await assertPublicHost(parsed.hostname);

    const res = await fetch(current, { redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

module.exports = { fetchExternalUrl };
