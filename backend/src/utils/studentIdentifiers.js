// Shared helpers for the Registration Number (PRN) / Roll Number split — Registration Number is
// the platform's permanent, system-wide unique student identifier; Roll Number is the classroom
// number used for attendance/display/sort ordering, intentionally non-unique (duplicates across
// departments/institutes are expected). Used by the migration script and every route that
// creates/sorts students, so the "last 3 characters" / numeric-sort rules only live in one place.

// Auto-init a blank Roll Number from the last 3 characters of a Registration Number (PRN), e.g.
// "2028COMP00123" -> "123". Verbatim last-3-characters (matching the spec's own example), not a
// smarter digit-extraction — callers only invoke this when rollNumber is currently empty, and must
// never call it again once a real value (auto-init or student-set) exists.
function initRollNumberFromRegistration(registrationNumber) {
  const cleaned = String(registrationNumber || "").trim();
  if (cleaned.length < 3) return null;
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

module.exports = { initRollNumberFromRegistration, compareRollNumbers };
