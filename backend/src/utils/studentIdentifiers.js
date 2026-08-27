// Shared helpers for the Registration Number (PRN) / Roll Number split — Registration Number is
// the platform's permanent, system-wide unique student identifier; Roll Number is the classroom
// number used for attendance/display/sort ordering, intentionally non-unique (duplicates across
// departments/institutes are expected). Used by the migration script and every route that
// creates/sorts students, so the "last 3 characters" / numeric-sort rules only live in one place.

// Registration Number (PRN): 9-12 alphanumeric characters, stored exactly as entered.
const REGISTRATION_NUMBER_RE = /^[A-Za-z0-9]{9,12}$/;
// Roll Number: capped at 3 characters platform-wide.
const ROLL_NUMBER_MAX_LENGTH = 3;
// A *valid* (as opposed to merely "not-too-long") Roll Number is exactly 3 numeric digits —
// this was previously only enforced by convention (every generator produces this shape), not
// actually validated at any write path, which let non-numeric/garbled values slip in edited
// through routes that only checked length. A value can never literally satisfy this regex AND
// contain "DUP" as a substring, but isValidRollNumber() checks for it explicitly anyway (belt
// and suspenders, and it's what was asked for): if a future change ever loosens the character
// set, the DUP check still catches the one specific corruption signature this platform has
// actually seen in production.
const ROLL_NUMBER_RE = /^\d{3}$/;
function isValidRollNumber(value) {
  const s = String(value ?? "").trim();
  if (!ROLL_NUMBER_RE.test(s)) return false;
  if (s.toUpperCase().includes("DUP")) return false;
  return true;
}

// Auto-init a blank Roll Number from the last 3 characters of a Registration Number (PRN), e.g.
// "2028COMP00123" -> "123". Verbatim last-3-characters (matching the spec's own example), not a
// smarter digit-extraction — callers only invoke this when rollNumber is currently empty, and must
// never call it again once a real value (auto-init or student-set) exists.
function initRollNumberFromRegistration(registrationNumber) {
  const cleaned = String(registrationNumber || "").trim();
  if (cleaned.length < 3) return null;
  return cleaned.slice(-3);
}

// Roll Number must be unique within one Academic Group (Institute + Batch + Department + Section)
// but duplicates ARE expected across different groups — so collision-avoidance is scoped by
// whatever `takenRollNumbers` set the caller passes in (that group's other students' current Roll
// Numbers). Tries the default last-3-characters first, then slides that 3-character window one
// position left through the rest of the PRN on each collision — but only while every candidate
// stays all-digits. A PRN's numeric suffix is usually short (a handful of trailing digits) with an
// alphabetic institute/batch/department code before it; sliding past the digits used to keep
// going and hand out that alphabetic code's fragments as "Roll Numbers" — e.g. a batch of PRNs
// like "...UMXF2001".."...UMXF2005" collided on their shared last-3 zone and produced "MXF"/"UMX"
// once several students in the group needed to slide. Once the digit run is exhausted, fall back
// to the first free zero-padded sequential number (numeric, never a DUP prefix concern since it's
// clearly not derived from anyone's PRN) rather than ever returning a letter-containing candidate.
function resolveRollNumberAvoidingCollisions(registrationNumber, takenRollNumbers) {
  const cleaned = String(registrationNumber || "").trim();
  if (cleaned.length < 3) return null;
  const taken = takenRollNumbers instanceof Set ? takenRollNumbers : new Set(takenRollNumbers || []);
  for (let end = cleaned.length; end - 3 >= 0; end--) {
    const candidate = cleaned.slice(end - 3, end);
    if (!/^\d{3}$/.test(candidate)) break; // hit a non-digit — the PRN's numeric suffix is exhausted
    if (!taken.has(candidate)) return candidate;
  }
  for (let n = 0; n <= 999; n++) {
    const candidate = String(n).padStart(3, "0");
    if (!taken.has(candidate)) return candidate;
  }
  return cleaned.slice(-3); // group has genuinely exhausted all 1000 3-digit codes — give up gracefully
}

// Ascending Roll Number comparator for bounded, already-fetched lists (a class roster, one Talent
// Pool's members, one exam's entries). Numeric roll numbers sort first in ascending numeric order
// ("1, 2, 3 ... 60", not lexicographic "1, 10, 2..."); non-numeric or blank values sort last, tied
// values fall back to name.
function compareRollNumbers(a, b) {
  const ra = a && a.rollNumber != null ? String(a.rollNumber) : "";
  const rb = b && b.rollNumber != null ? String(b.rollNumber) : "";
  const na = /^\d+$/.test(ra) ? Number(ra) : null;
  const nb = /^\d+$/.test(rb) ? Number(rb) : null;
  if (na !== null && nb !== null) {
    if (na !== nb) return na - nb;
  } else if (na !== null) {
    return -1;
  } else if (nb !== null) {
    return 1;
  } else if (ra !== rb) {
    if (!ra) return 1;
    if (!rb) return -1;
    return ra.localeCompare(rb);
  }
  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

// --- Same-group collision checks + the concurrency lock guarding them ---
// Previously duplicated between routes/users.js (the admin-facing create/edit paths) and
// routes/profile.js (the student self-service path) as two separately-written, functionally-
// similar-but-not-identical implementations — consolidated here so there is exactly one real
// definition of "does this Roll Number collide within this Academic Group," used everywhere a
// Roll Number can be set (admin single-create, admin edit, bulk-upload, and student self-edit).
const prisma = require("../prisma");

// `client` defaults to the module-level `prisma` (every pre-existing call site keeps working
// unchanged) but accepts a transaction client (`tx`) too — see withRollNumberLock below, which
// passes one so the read happens *inside* the same advisory-locked transaction as the write that
// follows it, closing the check-then-create race a plain pre-check can't.
async function fetchTakenRollNumbers(academicGroupId, excludeUserId, client = prisma) {
  if (!academicGroupId) return new Set();
  const rows = await client.user.findMany({
    where: { academicGroupId, role: "STUDENT", rollNumber: { not: null }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { rollNumber: true },
  });
  return new Set(rows.map((r) => r.rollNumber));
}

// Used only when a Roll Number is manually typed/edited (not the auto-derive path) — a same-group
// collision is a real mistake, so it's rejected outright with a specific error rather than
// silently resolved, per the platform's error-message-quality standard.
async function findRollNumberClash(academicGroupId, rollNumber, excludeUserId, client = prisma) {
  if (!academicGroupId || !rollNumber) return null;
  const clash = await client.user.findFirst({
    where: { academicGroupId, role: "STUDENT", rollNumber, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { name: true },
  });
  return clash?.name || null;
}

// Closes the real concurrent-request gap this feature's spec describes: two requests could
// otherwise both pass their pre-check (neither sees the other's not-yet-committed row) and both
// succeed — there is deliberately no DB-level unique constraint on (academicGroupId, rollNumber)
// yet (see schema.prisma's User.rollNumber comment: pre-existing production conflicts must be
// resolved by an admin first, per this feature's own explicit "do not auto-rename" requirement,
// before that constraint can be safely added). A Postgres transaction-scoped advisory lock, keyed
// on the whole *academic group* (not one specific roll number) via hashtextextended (64-bit,
// negligible collision risk vs. hashtext's 32-bit), gives the same real mutual-exclusion guarantee
// in the meantime — group-scoped rather than number-scoped is deliberate: the auto-derive path
// (resolveRollNumberAvoidingCollisions) doesn't know its target number until it has already read
// what's taken, so two concurrent auto-derives for the *same* group must be serialized entirely,
// not just when they happen to land on the same candidate. A second transaction targeting the
// identical group simply blocks until the first commits or rolls back, at which point its own
// re-check (run inside `fn`, using the same `tx`) correctly sees whatever the first just did. A
// lock on a *different* group never contends with this one.
async function withRollNumberLock(academicGroupId, fn) {
  if (!academicGroupId) return fn(prisma); // no group to serialize within (e.g. no academic group assigned)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rollnumber-group:${academicGroupId}`}, 0))`;
    return fn(tx);
  });
}

module.exports = {
  initRollNumberFromRegistration,
  resolveRollNumberAvoidingCollisions,
  compareRollNumbers,
  isValidRollNumber,
  REGISTRATION_NUMBER_RE,
  ROLL_NUMBER_RE,
  ROLL_NUMBER_MAX_LENGTH,
  fetchTakenRollNumbers,
  findRollNumberClash,
  withRollNumberLock,
};
