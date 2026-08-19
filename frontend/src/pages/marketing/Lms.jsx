import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function Lms() {
  useSeoHead({
    title: "Learning Management System",
    description:
      "CodeArena's LMS for engineering colleges: structured courses with module-end coding tests that gate progress, completion certificates, and progress visible to both students and faculty.",
    path: "/lms",
  });
  return (
    <MarketingPageShell
      eyebrow="Learning Management"
      title="Courses that gate on understanding, not just clicks."
      intro="Structured courses break into modules and lessons, each ending in a coding test a student has to actually pass before the next module unlocks."
    >
      <h2>Course structure</h2>
      <p>
        A course is organized into modules, and each module into a sequence of lessons. A student
        works through lessons in order; the final lesson of a module is a coding assessment
        that must be passed before the next module becomes available. This means a course's
        "completion" reflects demonstrated ability at each stage, not just that every lesson page
        was opened once.
      </p>

      <h2>Practice built into lessons</h2>
      <p>
        Lessons that include a coding component use the same Run/Submit split described on the{" "}
        <Link to="/coding-platform">Coding Platform</Link> page — a student can run their code
        against visible examples as many times as they like while working through a lesson, then
        submit against the hidden test suite when ready. Wrong attempts can surface progressive
        hints and an editorial explanation, so a stuck student has somewhere to go besides giving
        up.
      </p>

      <h2>Module coding assessments</h2>
      <p>
        The test that gates progress between modules runs under the same proctoring and grading
        infrastructure as a formal exam — timed, with tab-switch and copy-paste detection, and
        graded against hidden test cases per question. Passing it is what actually unlocks the
        next module; a student can see exactly how they scored on each question afterward.
      </p>

      <h2>Certificates and momentum</h2>
      <p>
        Completing a full course issues a <strong>QR-verifiable certificate</strong> — one per
        course, not per module — that a student can share, and a recruiter or verifier can confirm
        as genuine independently. Alongside coursework, a practice streak and XP-based
        gamification system track engagement over time, so progress is visible as more than a
        static percentage bar.
      </p>

      <h2>Visibility for faculty</h2>
      <p>
        Staff can see exactly where each student is in a course — which module they're on,
        attempt history on gated assessments, and time-based progress — the same detail a student
        sees about their own progress, so a faculty member doesn't have to ask a student how far
        along they are.
      </p>
    </MarketingPageShell>
  );
}
