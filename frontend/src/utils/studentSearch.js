// Case-insensitive, whitespace-tolerant student search used by the test results leaderboard. Every space-separated word must appear in the student's name,
// roll number, PRN/registration number or e-mail (the fields the table shows). Plain substring tests only, never a regex built from the input.
// Kept identical to matchesStudentQuery in backend/src/modules/tests/tests.domain.js so the on-screen rows and the downloaded file always agree.
const norm = (v) => String(v ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function matchesStudentQuery(student, query) {
  const words = norm(query).slice(0, 100).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const fields = [student?.name, student?.rollNumber, student?.registrationNumber, student?.email].map(norm);
  return words.every((w) => fields.some((f) => f.includes(w)));
}
