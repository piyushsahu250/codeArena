import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function OnlineAssessment() {
  useSeoHead({
    title: "Online Assessment",
    description:
      "Proctored online coding tests and exams for students — fullscreen enforcement, tab-switch and copy-paste detection, shuffled questions, and detailed per-question grading.",
    path: "/online-assessment",
  });
  return (
    <MarketingPageShell
      eyebrow="Proctored Assessments"
      title="Exams that hold up to scrutiny."
      intro="Formal, timed tests run inside a locked-down session with real proctoring signals — not an honor-system quiz link."
    >
      <h2>Proctoring, without a video recording</h2>
      <p>
        A proctored test enforces fullscreen mode and detects tab-switches and copy-paste
        attempts throughout the attempt. Where an institute enables it, an optional face-presence
        check runs a lightweight face-detection model entirely in the student's browser — it never
        uploads or records video, only reports whether a face is currently visible, which is
        logged as a signal alongside everything else. Every violation is written to a live feed
        faculty can watch during the exam, not just a summary afterward.
      </p>

      <h2>Randomization that's actually per-student</h2>
      <p>
        Question order and MCQ option order can each be shuffled independently, generated and
        stored per student at the moment they start the test — not a client-side shuffle that
        resets on refresh. When grading a shuffled MCQ, CodeArena translates the student's
        selected position back to the original option index before scoring, so results stay
        correct regardless of the order a given student saw.
      </p>
      <p>
        Tests also support a <strong>random question-selection mode</strong>, where each student
        receives a different random subset from a larger question pool — useful when you want
        every student assessed on the same syllabus without every student seeing an identical
        paper.
      </p>

      <h2>Question types and grading</h2>
      <p>
        A single test can mix coding, MCQ, true/false, multi-select, fill-in-the-blank, and SQL
        questions. Coding and SQL questions are graded by the same judge described on the{" "}
        <Link to="/coding-platform">Coding Platform</Link> page — auto-graded against hidden test
        cases, with a detailed per-question breakdown available once results are published, so a
        student can see exactly which cases passed and which didn't.
      </p>

      <h2>Timing that can't be gamed</h2>
      <p>
        Test timing is enforced server-side, synced against the server's clock rather than trusted
        from the student's browser — so a student can't extend their time by changing their
        system clock, and a slow connection or a brief disconnect doesn't unfairly cost them time
        either. Coding answers are auto-saved as the student works, so a browser crash or an
        accidental tab close doesn't lose their progress.
      </p>

      <h2>For faculty</h2>
      <p>
        Staff build tests from the institute's <Link to="/for-institutions">question bank</Link>{" "}
        or by bulk-uploading questions directly, configure proctoring settings per test, and
        review results with a full per-question, per-student breakdown — including the violation
        log for any flagged attempt — after the test closes.
      </p>
    </MarketingPageShell>
  );
}
