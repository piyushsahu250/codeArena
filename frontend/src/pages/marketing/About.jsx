import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function About() {
  useSeoHead({
    title: "About CodeArena",
    description:
      "CodeArena is an AI-powered coding, assessment, learning and employability platform built for students and educational institutions — one workspace instead of five separate tools.",
    path: "/about",
  });
  return (
    <MarketingPageShell
      eyebrow="About CodeArena"
      title="One platform, built for how a college actually runs."
      intro="CodeArena brings coding practice, proctored assessments, a learning management system, attendance, and placement preparation into a single product — instead of a different login for every tool an institute already uses."
    >
      <h2>Why CodeArena exists</h2>
      <p>
        Most colleges piece together their student-facing tools from separate products: one for
        coding practice, another for online exams, a third for attendance, a fourth for interview
        prep. Each has its own login, its own data, and none of them talk to each other. A
        student's practice history never informs their placement readiness score; a faculty
        member's attendance record lives in a spreadsheet nobody else can see.
      </p>
      <p>
        CodeArena was built to remove that fragmentation. Student, Staff, and Admin accounts share
        one underlying data model, so a student's coding streak, attendance record, exam results,
        and interview performance are all part of the same picture — visible to the right people,
        automatically, without anyone exporting a CSV and emailing it around.
      </p>

      <h2>What CodeArena actually is</h2>
      <p>CodeArena is a web platform with four connected parts:</p>
      <ul>
        <li>
          <strong>A real compiler and judge</strong> — students write and run code in Java,
          Python, C, C++, and JavaScript, plus SQL questions judged against an isolated database
          per attempt. See <Link to="/coding-platform">Coding Platform</Link>.
        </li>
        <li>
          <strong>Proctored online assessments</strong> — formal, timed exams with tab-switch
          detection, copy-paste blocking, and an optional face-presence check, run by faculty for
          their own classes. See <Link to="/online-assessment">Online Assessment</Link>.
        </li>
        <li>
          <strong>A learning management system</strong> — structured courses broken into modules
          that gate on a passing coding test, not just a "mark as complete" button. See{" "}
          <Link to="/lms">Learning Management</Link>.
        </li>
        <li>
          <strong>Placement preparation</strong> — AI-evaluated mock interviews across seven
          tracks, an employability readiness assessment, and daily/weekly coding challenges. See{" "}
          <Link to="/ai-mock-interview">AI Mock Interview</Link> and{" "}
          <Link to="/employability-readiness">Employability Readiness</Link>.
        </li>
      </ul>

      <h2>Who it's for</h2>
      <p>
        CodeArena has three account types: <strong>Student</strong>, <strong>Staff</strong> (an
        institute's faculty, who author question banks, run assessments, and manage attendance),
        and <strong>Admin</strong> (an institute's platform administrator, who provisions accounts
        and manages institute-wide settings). A fourth, narrower role — <strong>Placement
        Clerk</strong> — exists for institutes that separate placement-cell operations from
        general faculty access.
      </p>
      <p>
        There's no self-serve signup. Accounts are provisioned by an institute's own administrator
        — usually in bulk, from a spreadsheet, when a new batch is registered. If your institute
        already uses CodeArena, sign in from the homepage. If it doesn't yet,{" "}
        <Link to="/for-institutions">see what CodeArena offers institutions</Link> or{" "}
        <Link to="/contact">get in touch</Link>.
      </p>

      <h2>Where CodeArena is today</h2>
      <p>
        CodeArena is an actively developed product at <strong>codearena.site</strong>. We're
        candid that this is early-stage software from a small team, growing feature by feature
        based on what institutes actually ask for — not a claim to be the largest or most
        established platform in this space. Every capability described on this site is a real,
        shipped feature, not a roadmap item.
      </p>

      <h2>Who builds CodeArena</h2>
      <p>
        CodeArena is developed and operated by <strong>Acrosoft Webtech Solution Pvt. Ltd.</strong>
      </p>
    </MarketingPageShell>
  );
}
