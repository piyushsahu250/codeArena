import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function EmployabilityReadiness() {
  useSeoHead({
    title: "Employability Readiness Assessment",
    description:
      "A structured employability readiness assessment for students — scored across cognitive dimensions, with progress tracking and a consistent readiness signal for faculty and placement cells.",
    path: "/employability-readiness",
  });
  return (
    <MarketingPageShell
      eyebrow="Employability Readiness"
      title="A readiness score built on how a student actually thinks, not just what they got right."
      intro="A structured assessment that scores students across cognitive dimensions — giving faculty and placement cells a consistent signal instead of a single, opaque percentage."
    >
      <h2>Scored by cognitive dimension, not just topic</h2>
      <p>
        Questions in a readiness assessment are tagged against{" "}
        <strong>Bloom's Taxonomy levels</strong> — remembering, understanding, applying,
        analyzing, evaluating, and creating — so a student's report doesn't just say "62% in Data
        Structures." It distinguishes between recalling a definition and actually applying a
        concept to solve a novel problem, which is a much more honest signal of readiness for an
        interview or a job.
      </p>

      <h2>Subject-configurable, per-institute</h2>
      <p>
        An institute's admin or faculty configures which subjects are assessed and which academic
        groups (batch, department, section) each subject applies to — a readiness assessment for
        final-year Computer Science students can look entirely different from one for second-year
        Electronics students, without one institute's configuration leaking into another's.
      </p>

      <h2>What a student sees</h2>
      <p>
        After completing an assessment, a student gets a report broken down by dimension score
        and by subject, plus a set of concrete employability indicators — not just a raw number.
        Progress-over-time is tracked, so a student (and their faculty) can see whether readiness
        is actually improving between attempts, not just what the latest score happened to be.
      </p>

      <h2>Where it feeds into the rest of the platform</h2>
      <p>
        Readiness scores can factor into{" "}
        <Link to="/for-institutions">talent pool</Link> auto-selection rules, giving a placement
        cell a defensible, data-backed way to shortlist students for a drive rather than relying
        on informal faculty recommendations alone. Completing a readiness assessment can also
        issue a certificate, and weak areas surfaced by the report link back to relevant{" "}
        <Link to="/coding-platform">practice questions</Link> so a student knows exactly what to
        work on next.
      </p>

      <h2>For faculty and placement cells</h2>
      <p>
        Faculty and admin analytics dashboards surface batch-wide readiness trends, top
        performers, and assessment coverage — how much of a batch has actually completed the
        assessment — with Excel and PDF export for reporting up to placement committees or
        accreditation reviews.
      </p>
    </MarketingPageShell>
  );
}
