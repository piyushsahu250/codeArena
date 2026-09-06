// Shared "is this test actually ready to go live" check — extracted from the original inline
// validation in routes/tests.js's PATCH /:id/publish (spec section 21's own worked example:
// "Question 7 has no correct answer.") so the new scheduled-publish path
// (testScheduledPublishScheduler.js) can enforce the exact same rules a manual publish click
// already does, rather than a second, independently-drifting copy.
//
// Expects `test` loaded with:
//   questions: { select: { id: true, question: { select: {
//     questionNumber, title, questionType, points, correctAnswer, testCases: { select: { id: true } }
//   } } } }
// (the same include the publish route already uses).
function validateTestForPublish(test) {
  const problems = [];
  // RANDOM mode still requires questions[] populated (see Test.questionSelectionMode's schema
  // comment — it's the bank random subsets are drawn from, not shown to students directly), so
  // this check applies the same way regardless of mode.
  if (test.questions.length === 0) problems.push("Add at least one question before publishing.");
  if (!(test.durationMin > 0)) problems.push("Set a test duration greater than 0 minutes.");
  if (test.startTime && test.endTime && new Date(test.startTime) >= new Date(test.endTime)) {
    problems.push("End time must be after start time.");
  }
  if (test.questionSelectionMode === "RANDOM" && !(test.randomQuestionsPerStudent > 0)) {
    problems.push("Set how many random questions each student should receive.");
  }
  const questionLabel = (q) => `Question ${q.question.questionNumber}${q.question.title ? ` ("${q.question.title}")` : ""}`;
  for (const tq of test.questions) {
    const q = tq.question;
    if (!(q.points > 0)) problems.push(`${questionLabel(tq)} has no marks set.`);
    if (["MCQ", "TRUE_FALSE", "MULTISELECT", "SQL"].includes(q.questionType)) {
      const correct = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
      if (correct.length === 0) problems.push(`${questionLabel(tq)} has no correct answer selected.`);
    } else if (q.questionType === "CODING") {
      if (!q.testCases || q.testCases.length === 0) problems.push(`${questionLabel(tq)} has no test cases.`);
    }
  }
  return problems;
}

const TEST_PUBLISH_VALIDATION_INCLUDE = {
  questions: {
    select: {
      id: true,
      question: { select: { questionNumber: true, title: true, questionType: true, points: true, correctAnswer: true, testCases: { select: { id: true } } } },
    },
  },
};

module.exports = { validateTestForPublish, TEST_PUBLISH_VALIDATION_INCLUDE };
