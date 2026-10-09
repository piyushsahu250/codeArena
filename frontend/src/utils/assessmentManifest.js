// Checks that the questions the browser received are exactly the set the server assigned to this attempt (the manifest in GET /tests/:id).
// Returns null when complete, otherwise a message the student can act on. A response without a manifest (staff preview, older server) is not checked.
export function manifestProblem(test) {
  const manifest = test?.manifest;
  if (!manifest) return null;
  const received = Array.isArray(test.questions) ? test.questions : [];
  const ids = received.map((tq) => tq.questionId ?? tq.question?.id);
  if (new Set(ids).size !== ids.length) {
    return "This assessment loaded with a repeated question, so it was not started. Press Begin again; if it happens again, tell your faculty.";
  }
  if (received.length === manifest.expectedCount) return null;
  if (manifest.unavailableCount > 0) {
    return `${manifest.unavailableCount} of the ${manifest.expectedCount} questions assigned to you can no longer be loaded. Your saved answers are safe. Please tell your faculty so it can be corrected before you continue.`;
  }
  return `Only ${received.length} of the ${manifest.expectedCount} questions loaded (slow or interrupted connection). Your progress is safe. Check your connection and press Begin again.`;
}
