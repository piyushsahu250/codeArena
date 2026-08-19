import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function CodingChallenges() {
  useSeoHead({
    title: "Coding Challenges",
    description:
      "Daily and weekly coding challenges with streak tracking, plus company-tagged coding tests that mirror real recruiter problem formats.",
    path: "/coding-challenges",
  });
  return (
    <MarketingPageShell
      eyebrow="Coding Challenges"
      title="Practice that builds a habit, not just a grade."
      intro="Daily and weekly coding challenges keep students practicing between formal assessments, and company-tagged tests mirror real recruiter problem formats."
    >
      <h2>Daily and Weekly Challenges</h2>
      <p>
        Outside of any course or formal test, every student has access to a rotating{" "}
        <strong>Daily Challenge</strong> and <strong>Weekly Challenge</strong> — a fresh coding
        problem on a schedule an institute's admin controls. Completing them builds a practice
        streak over time, turning consistent effort into something visible on a student's
        dashboard rather than an invisible habit only they know they're keeping up.
      </p>

      <h2>Company-tagged coding tests</h2>
      <p>
        Separately from the daily/weekly rotation, CodeArena hosts{" "}
        <strong>company-tagged coding tests</strong> — problem sets composed to mirror the actual
        format and difficulty of a specific recruiter's coding round, the same tagging system
        used for <Link to="/ai-mock-interview">AI Mock Interview</Link> company rounds. A student
        preparing for a specific company can practice against a set built to resemble what
        they'll actually see, not a generic "medium difficulty" label.
      </p>

      <h2>Same judge, same rigor</h2>
      <p>
        Every challenge runs through the same compiler and hidden-test-case grading described on
        the <Link to="/coding-platform">Coding Platform</Link> page — Run against visible
        examples while working, Submit against the full hidden suite when ready. There's no
        separate, lighter-weight grading path for "just practice" problems that would let a
        passing streak mean less than it should.
      </p>

      <h2>For faculty and admins</h2>
      <p>
        Staff schedule which challenges run on which days, review coverage across the topics
        students are actually practicing, and can bulk-upload challenge question sets the same
        way they bulk-upload a formal test's question bank.
      </p>
    </MarketingPageShell>
  );
}
