// Resolves the real client IP for rate-limit keying, audit logs, and session records.
//
// SECURITY FIX (2026-10-01): this used to prefer the CF-Connecting-IP header, written back when
// this deployment sat behind Cloudflare in front of Render. That's no longer the topology --
// confirmed live that api-aws.codearena.site is served directly by nginx on the EC2 host, with no
// Cloudflare in front. CF-Connecting-IP is therefore just an ordinary client-supplied header now,
// no longer edge-verified or stripped by anything -- confirmed exploitable live: sending a
// different fake CF-Connecting-IP on every request fully defeated the login rate limiter (5
// attempts/15min) and would equally defeat forgot-password's, plus poison every audit-log/
// session IP record with attacker-chosen values. Never trust a client-supplied IP header directly.
//
// req.ip is the correct source instead: index.js sets `trust proxy` to exactly the real hop count
// (1, matching this single nginx hop -- see its own comment), which makes Express parse
// X-Forwarded-For itself, trusting only the one entry nginx actually appended and discarding
// anything a client tried to prepend -- the standard, spoof-resistant pattern for this topology.
// If a CDN/WAF is ever placed in front of nginx again, update `TRUST_PROXY_HOPS` (env var) to
// match the new real hop count -- req.ip adapts automatically, no code change needed here.
function getClientIp(req) {
  return req.ip;
}

module.exports = { getClientIp };
