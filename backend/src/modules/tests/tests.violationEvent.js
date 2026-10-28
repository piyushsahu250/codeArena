// Pure rules for the identity of a violation event reported by the exam page. No database, no HTTP (unit-tested in test/violationEvent.test.js).
//
// eventId     the page's unique id for ONE event, generated when the event is detected and kept across every retry. It is an idempotency key, not proof of anything: the server uses it only to
//             recognise a repeat of the same report (a retry after a lost answer, a queue flushed twice) and acknowledge it without a second record or strike. Two different incidents have different
//             ids, so each stays independently auditable. Missing is allowed (older clients): such an event is processed exactly as before.
// clientAt    when the PAGE says it happened. Stored as a client-provided value; never used for ordering, counting, deadlines or classification (createdAt, the server's receipt time, is the record).
const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_CLIENT_SKEW_MS = 24 * 60 * 60 * 1000; // a client time further than a day from the server's is ignored, not trusted

// -> { value: string | null } | { error }
function parseEventId(input) {
  if (input === undefined || input === null || input === "") return { value: null };
  if (typeof input !== "string" || !EVENT_ID_RE.test(input)) return { error: "eventId must be 8 to 64 letters, digits, - or _" };
  return { value: input };
}

// A Date, or null when the value is missing, unreadable or implausible (more than a day from `now`).
function parseClientAt(input, now = Date.now()) {
  if (input === undefined || input === null || input === "") return null;
  const ms = typeof input === "number" ? input : typeof input === "string" ? Date.parse(input) : NaN;
  if (!Number.isFinite(ms)) return null;
  if (Math.abs(ms - now) > MAX_CLIENT_SKEW_MS) return null;
  return new Date(ms);
}

// Prisma reports a unique-constraint violation with this code (also when it comes out of a $transaction).
const isUniqueViolation = (err) => !!err && err.code === "P2002";

module.exports = { EVENT_ID_RE, MAX_CLIENT_SKEW_MS, parseEventId, parseClientAt, isUniqueViolation };
