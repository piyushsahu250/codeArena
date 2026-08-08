// Shared helpers for the Registration Number (PRN) / Roll Number split — Registration Number is
// the platform's permanent, system-wide unique student identifier; Roll Number is the classroom
// number used for attendance/display/sort ordering, intentionally non-unique (duplicates across
// departments/institutes are expected). Used by the migration script and every route that
// creates/sorts students, so the "last 3 characters" / numeric-sort rules only live in one place.

// Registration Number (PRN): 9-12 alphanumeric characters, stored exactly as entered.
const REGISTRATION_NUMBER_RE = /^[A-Za-z0-9]{9,12}$/;
// Roll Number: capped at 3 characters platform-wide.
const ROLL_NUMBER_MAX_LENGTH = 3;

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
// position left through the rest of the PRN on each collision — every candidate is always a real
// substring of this student's own PRN, so the platform's "never a DUP prefix" rule is never
// violated. Falls back to the plain last-3 value (accepting a rare residual collision) only if the
// entire PRN is exhausted, rather than blocking account creation outright.
function resolveRollNumberAvoidingCollisions(registrationNumber, takenRollNumbers) {
  const cleaned = String(registrationNumber || "").trim();
  if (cleaned.length < 3) return null;
  const taken = takenRollNumbers instanceof Set ? takenRollNumbers : new Set(takenRollNumbers || []);
  for (let end = cleaned.length; end - 3 >= 0; end--) {
    const candidate = cleaned.slice(end - 3, end);
    if (!taken.has(candidate)) return candidate;
  }
  return cleaned.slice(-3);
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

module.exports = { initRollNumberFromRegistration, resolveRollNumberAvoidingCollisions, compareRollNumbers, REGISTRATION_NUMBER_RE, ROLL_NUMBER_MAX_LENGTH };
