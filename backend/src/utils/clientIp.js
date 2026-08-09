// Resolves the real client IP for rate-limit keying, audit logs, and session records.
//
// Confirmed via a temporary debug route (see git history) that this deployment sits behind TWO
// proxy hops - Cloudflare's edge, then Render's own internal load balancer - and both hops' own
// addresses change per request (Cloudflare's depending on which edge node served it, Render's
// bouncing between at least two internal addresses). No single `trust proxy` hop-count reliably
// resolves Express's req.ip to the real client through that chain. Cloudflare, however, always
// sets CF-Connecting-IP to the verified original client IP (it strips/overwrites any client-
// supplied value at its own edge, so this can't be spoofed by the caller) - confirmed stable
// across every test request. Preferring that header sidesteps the hop-counting problem entirely,
// and still works correctly in any environment without Cloudflare in front (local dev, or if the
// hosting provider ever changes) by falling back to Express's own req.ip.
function getClientIp(req) {
  return req.headers["cf-connecting-ip"] || req.ip;
}

module.exports = { getClientIp };
