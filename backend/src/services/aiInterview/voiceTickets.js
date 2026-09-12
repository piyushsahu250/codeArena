// Short-lived, single-use voice-session tickets (spec §28: "Create a secure short-lived session
// creation... Return short-lived client credential/session information... Frontend establishes
// realtime connection"). A WebSocket upgrade request has no clean way to carry an Authorization
// header the way a normal fetch/XHR does, and putting the student's real (long-lived) JWT
// straight into a `wss://...&token=...` URL risks it being captured in proxy/CDN/browser-history
// logs for the rest of its actual multi-hour validity window. Instead: the browser first calls the
// normal authenticated REST endpoint (POST .../voice-session, real JWT, real auth middleware) to
// mint a random, 30-second, single-use ticket; THAT (not the JWT) is what goes in the WS URL.
// Worst case a ticket leaks somewhere it shouldn't, it's already useless within half a minute and
// can only ever be redeemed once.
//
// In-memory (a plain Map), same "not multi-instance-safe, documented as such" convention already
// established for aiQueue.js's own in-process concurrency counters — this single EC2 instance is
// the platform's entire deployment today; if that ever changes, this needs a shared store (Redis)
// same as that file would.
const crypto = require("crypto");

const TICKET_TTL_MS = 30 * 1000;
const tickets = new Map(); // ticket -> { sessionId, studentId, instituteId, expiresAt }

function mintTicket({ sessionId, studentId, instituteId }) {
  const ticket = crypto.randomBytes(24).toString("hex");
  tickets.set(ticket, { sessionId, studentId, instituteId, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

// Single-use: deletes on any lookup, valid or not, so a replayed/guessed ticket can never succeed
// twice even if the first redemption already failed for an unrelated reason.
function consumeTicket(ticket) {
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

// Best-effort periodic sweep so an unredeemed ticket doesn't sit in memory forever — cheap
// insurance, not load-bearing (consumeTicket already re-checks expiresAt on every lookup).
setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of tickets) if (now > entry.expiresAt) tickets.delete(ticket);
}, 60 * 1000).unref();

module.exports = { mintTicket, consumeTicket };
