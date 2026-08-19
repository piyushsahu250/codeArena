import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function CodingPlatform() {
  useSeoHead({
    title: "Coding Platform",
    description:
      "CodeArena's coding platform: a real compiler for Java, Python, C, C++, and JavaScript, SQL questions judged against an isolated database, hidden test cases, and daily/weekly coding challenges.",
    path: "/coding-platform",
  });
  return (
    <MarketingPageShell
      eyebrow="Coding Platform"
      title="A real compiler, not a code snippet box."
      intro="Students write and run code against real test cases, in real languages, with real hidden-case grading — not a simplified quiz interface pretending to be a coding tool."
    >
      <h2>Languages and question types</h2>
      <p>
        CodeArena's judge runs submissions in <strong>Java, Python, C, C++, and JavaScript</strong>,
        each compiled or interpreted in an isolated environment per submission. Alongside coding
        questions, the platform supports MCQ, true/false, multi-select, fill-in-the-blank, and{" "}
        <strong>SQL questions</strong> — SQL submissions run against a real, isolated SQLite
        database created fresh for each attempt, not a string-matching approximation of the
        correct query.
      </p>

      <h2>Run vs. Submit</h2>
      <p>
        Every coding question separates <strong>Run</strong> from <strong>Submit</strong>. Run
        executes the student's code against the visible sample test cases only, giving instant
        feedback while they're still working. Submit runs the full hidden test-case suite — the
        same one used for grading — so the score a student sees after submitting reflects
        genuine correctness, not just passing the one or two examples shown up front.
      </p>

      <h2>Function-mode and full-program questions</h2>
      <p>
        Question authors can define a question either as a full program (the student writes a
        complete, runnable program that reads input and prints output) or in{" "}
        <strong>function mode</strong> — the student implements just one function against a
        declared signature, and CodeArena generates the driver code that calls it, similar to a
        LeetCode-style problem. Function-mode questions accept both a bare function submission and
        a full program that defines the same function, so students aren't penalized for either
        style.
      </p>

      <h2>Editor and workflow</h2>
      <p>
        The code editor supports per-language starter code, syntax highlighting, adjustable theme,
        font size, and word wrap, and — where a question defines them — post-wrong-attempt hints
        and an editorial explanation once the student has engaged with the problem, so getting
        stuck becomes a learning moment rather than a dead end.
      </p>

      <h2>Daily and weekly challenges</h2>
      <p>
        Outside of formal courses and assessments, students can practice against a{" "}
        <strong>Daily Challenge</strong> and a <strong>Weekly Challenge</strong> — separate,
        lighter-weight coding problems that build a practice streak over time, plus{" "}
        <Link to="/coding-challenges">company-tagged coding tests</Link> mirroring real recruiter
        problem formats.
      </p>

      <h2>Where this shows up elsewhere</h2>
      <p>
        The same judge and editor power coding questions across the platform — inside{" "}
        <Link to="/online-assessment">proctored formal assessments</Link>, module-end tests in the{" "}
        <Link to="/lms">learning management system</Link>, and coding rounds in{" "}
        <Link to="/ai-mock-interview">AI mock interviews</Link> — so a student practices, is
        assessed, and interviews on the same underlying compiler, not three different tools with
        three different quirks.
      </p>
    </MarketingPageShell>
  );
}
