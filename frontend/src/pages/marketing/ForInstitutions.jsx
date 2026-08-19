import { Link } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

const CAPABILITIES = [
  {
    title: "Student management",
    body: "Bulk-onboard an entire batch from a single spreadsheet, or create accounts one at a time. Institute, Batch, Department, and Section are derived automatically from the upload — nobody hand-builds a class list first.",
  },
  {
    title: "Staff management",
    body: "Admins provision Staff and Placement Clerk accounts, assign staff to specific classes and subjects, and control exactly which sections of the platform each role can reach.",
  },
  {
    title: "Attendance",
    body: "Faculty mark attendance per lecture against a plan tied to a subject and section, with Present / Absent / Late / Leave states, minimum-percentage rules your institute sets, and exportable reports.",
  },
  {
    title: "Learning management",
    body: "Structured courses with module-end coding tests that gate progress, so 'completed' means the student actually demonstrated the skill — not just clicked through the content.",
  },
  {
    title: "Assessments",
    body: "Faculty build and run proctored, timed tests — coding, MCQ, true/false, multi-select, and SQL questions, auto-graded, with shuffled questions/options per student and a live violation feed during the attempt.",
  },
  {
    title: "Coding challenges",
    body: "Daily and weekly coding challenges keep students practicing between formal assessments, with streaks and a leaderboard; company-tagged coding tests mirror real recruiter formats.",
  },
  {
    title: "Question bank",
    body: "A hierarchical, folder-based question bank scoped to your institute, with bulk CSV/XLSX import, duplicate detection, and reuse across multiple tests instead of re-authoring questions each time.",
  },
  {
    title: "AI mock interviews",
    body: "Seven interview tracks — HR, Technical, Coding, Aptitude, System Design, Behavioral, and Managerial — evaluated by heuristic and AI-assisted scoring, including company-round simulations tagged to real recruiter formats.",
  },
  {
    title: "Employability readiness",
    body: "A structured readiness assessment scored across cognitive dimensions (Bloom's Taxonomy levels), giving faculty and placement cells a consistent, comparable readiness signal across an entire batch.",
  },
  {
    title: "Certificates",
    body: "Course-completion, coding-assessment, and interview certificates with QR-verifiable authenticity — a recruiter or verifier can confirm a certificate is genuine without contacting your institute directly.",
  },
  {
    title: "Reports",
    body: "Exportable attendance, results, performance, and readiness reports in Excel/CSV/PDF, plus a full audit log of every account, password, and access change for compliance and oversight.",
  },
  {
    title: "Talent pool",
    body: "Group students across one or more institutes into a talent pool for placement drives, with eligibility rules, auto-selection based on performance, and scoped attendance/results visibility for the placement cell.",
  },
];

export default function ForInstitutions() {
  useSeoHead({
    title: "For Institutions",
    description:
      "CodeArena for colleges and universities — student and staff management, attendance, assessments, an LMS, AI mock interviews, employability readiness, certificates, reports, and talent pool management in one platform.",
    path: "/for-institutions",
  });
  return (
    <MarketingPageShell
      eyebrow="For Institutions"
      title="The academic structure, derived automatically."
      intro="One admin-controlled platform for coding practice, proctored assessments, an LMS, attendance, and placement preparation — instead of five disconnected tools your IT team has to maintain separately."
    >
      <h2>What your institute controls</h2>
      <p>
        Everything on CodeArena is scoped to your institute. Your administrator provisions
        accounts, assigns staff to classes, and configures which features are active — students
        and staff at other institutes never see your data, and vice versa. There's no self-serve
        signup on either side; onboarding starts with your admin, usually by bulk-uploading a
        student roster from a spreadsheet.
      </p>

      <h2>Everything in one place</h2>
      <div className="ca-grid-3" style={{ marginTop: 24 }}>
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="card ca-audience-card" style={{ padding: "22px 20px" }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5 }}>
              <CheckCircle2 size={17} color="var(--mint)" />
              {c.title}
            </h3>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13.5 }}>{c.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 56 }}>Why it's one platform, not five</h2>
      <p>
        Because these features share one data model, they reinforce each other automatically. A
        student's attendance, coding practice history, exam results, and interview performance
        all roll up into the same profile your placement cell already sees — nobody has to
        reconcile spreadsheets from four different vendors before a placement drive. When a staff
        member checks a student's performance, they're looking at real activity, not a manually
        updated summary.
      </p>

      <h2>Getting started</h2>
      <p>
        If your institute is evaluating CodeArena, <Link to="/contact">reach out</Link> — we'll
        walk through onboarding, including how bulk student/staff import works and which features
        you'd want active from day one. If you already have an account,{" "}
        <Link to="/login" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          sign in <ArrowRight size={14} />
        </Link>.
      </p>
    </MarketingPageShell>
  );
}
