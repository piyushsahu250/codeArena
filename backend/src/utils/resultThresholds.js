// Validation of an examination's marks thresholds (total marks, passing marks, passing percentage) for result management. Creating an examination validated only
// "total marks > 0"; editing one only coerced the values to numbers, so an edit could set total marks to 0, negative or NaN, a passing percentage of 150 or -5, passing
// marks above the total, or lower the total below marks that were already entered (stored and published as a percentage over 100). Returns an error message, or null.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// `values` holds the thresholds as they will be AFTER the change: { totalMarks, passingMarks, passingPercent } (passing values may be null/undefined = not set).
// `highestEnteredMarks` (optional) is the largest obtained mark among PRESENT entries, so a lowered total can be refused when it would put an entry over 100%.
function validateExamThresholds({ totalMarks, passingMarks, passingPercent }, { highestEnteredMarks = null } = {}) {
  if (!isNum(totalMarks) || totalMarks <= 0) return "Total marks must be a number greater than 0";
  if (passingPercent != null) {
    if (!isNum(passingPercent) || passingPercent < 0 || passingPercent > 100) return "Passing percentage must be a number between 0 and 100";
  }
  if (passingMarks != null) {
    if (!isNum(passingMarks) || passingMarks < 0) return "Passing marks must be a number that is not negative";
    if (passingMarks > totalMarks) return `Passing marks cannot exceed the total marks (${totalMarks})`;
  }
  if (isNum(highestEnteredMarks) && highestEnteredMarks > totalMarks) {
    return `Marks have already been entered above this total (highest entered: ${highestEnteredMarks}). Correct those entries first, or keep the total at ${highestEnteredMarks} or more.`;
  }
  return null;
}

module.exports = { validateExamThresholds };
