// Filter rules for the staff Interview Reports page (list, analytics and Excel export all use them, so the cards, the charts, the table and the file always describe the same set of
// interviews). Pure: no Prisma client, no Express, so test/interviewReportFilters.test.js can check every rule.
//
// What this fixes over the inline version:
//  - Date From / Date To were read in the server's time zone (UTC), but staff pick calendar days in India. An interview at 02:00 IST on the 29th was counted on the 28th, and "Date To"
//    kept the first 5.5 hours of the next day. A day is now the Asia/Kolkata day, and "Date To" includes all of it.
//  - Batch Year and Department only looked at the student's own columns. Students placed in an academic group usually have those empty (the group carries them), so they were
//    silently left out of the filtered table, cards and charts even though the table displayed their batch and department. Both now match either place, and match part of the text
//    ("2025" finds the group batch "2025-2028"; "computer" finds "Computer Science").
//  - A non-numeric Min/Max Score became NaN and the database call failed with a 500. It is now a clear 400, and Min above Max is refused instead of returning an empty page.

const IST_OFFSET_MIN = 330;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

class FilterError extends Error {
  constructor(message) { super(message); this.name = "FilterError"; this.badFilter = true; this.status = 400; }
}

// A real calendar date. Date.parse alone is not enough: it reads "2026-02-31" as 3 March, so the date is rebuilt and compared.
function isYmd(s) {
  if (!YMD.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}
// The instant a calendar day starts in India, as a UTC Date.
function istDayStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MIN * 60000);
}

// -> { gte?: Date, lt?: Date } for submittedAt, or null when no date filter was given.
function dateRange(dateFrom, dateTo) {
  const from = dateFrom ? String(dateFrom).trim() : "";
  const to = dateTo ? String(dateTo).trim() : "";
  if (!from && !to) return null;
  if (from && !isYmd(from)) throw new FilterError("Date From must be a valid date.");
  if (to && !isYmd(to)) throw new FilterError("Date To must be a valid date.");
  if (from && to && from > to) throw new FilterError("Date From cannot be after Date To.");
  const range = {};
  if (from) range.gte = istDayStart(from);
  if (to) range.lt = new Date(istDayStart(to).getTime() + 24 * 3600 * 1000); // the whole of the last day
  return range;
}

// -> { gte?: number, lte?: number } for report.overallScore, or null.
function scoreBounds(min, max) {
  const parse = (v, label) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new FilterError(`${label} must be a number from 0 to 100.`);
    return n;
  };
  const lo = parse(min, "Min Score");
  const hi = parse(max, "Max Score");
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null && lo > hi) throw new FilterError("Min Score cannot be above Max Score.");
  return { ...(lo !== null ? { gte: lo } : {}), ...(hi !== null ? { lte: hi } : {}) };
}

const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());

// The Prisma `where` for the student of an interview.
function studentWhere({ instituteId, academicGroupId, classId, batchYear, department, search } = {}) {
  const where = { role: "STUDENT" };
  const and = [];
  if (instituteId) where.instituteId = instituteId;
  if (academicGroupId) where.academicGroupId = academicGroupId;
  if (classId) where.classId = classId; // legacy class picker, still honoured
  const batch = clean(batchYear);
  if (batch) and.push({ OR: [{ batchYear: { contains: batch, mode: "insensitive" } }, { academicGroup: { is: { batch: { contains: batch, mode: "insensitive" } } } }] });
  const dept = clean(department);
  if (dept) and.push({ OR: [{ department: { contains: dept, mode: "insensitive" } }, { academicGroup: { is: { department: { is: { name: { contains: dept, mode: "insensitive" } } } } } }] });
  const q = clean(search);
  if (q) and.push({ OR: [
    { name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { rollNumber: { contains: q, mode: "insensitive" } },
    { registrationNumber: { contains: q, mode: "insensitive" } }, { mobile: { contains: q, mode: "insensitive" } },
  ] });
  if (and.length) where.AND = and;
  return where;
}

// "2026-10-29 20:51" in India time, whatever the server's own zone and locale are (the Excel file used the server's, which showed UTC clock times as if they were local).
function formatIst(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60000).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 16)}`;
}

module.exports = { FilterError, IST_OFFSET_MIN, istDayStart, dateRange, scoreBounds, studentWhere, formatIst };
