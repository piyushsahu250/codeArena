import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

const FEATURES = [
  {
    to: "/coding-platform",
    title: "Coding Platform",
    body: "A real compiler for Java, Python, C, C++, and JavaScript, plus SQL judged against an isolated database, hidden test cases, and a Run/Submit workflow.",
  },
  {
    to: "/online-assessment",
    title: "Online Assessment",
    body: "Proctored, timed exams — fullscreen enforcement, tab-switch and copy-paste detection, per-student shuffled questions, and detailed per-question grading.",
  },
  {
    to: "/lms",
    title: "Learning Management",
    body: "Structured courses with module-end coding tests that gate progress, course-completion certificates, and a practice streak with XP-based gamification.",
  },
  {
    to: "/employability-readiness",
    title: "Employability Readiness",
    body: "A structured readiness assessment scored across cognitive dimensions, giving faculty and placement cells a consistent, comparable readiness signal.",
  },
  {
    to: "/ai-mock-interview",
    title: "AI Mock Interview",
    body: "Seven interview tracks evaluated by heuristic and AI-assisted scoring, including company-round simulations tagged to real recruiter formats.",
  },
  {
    to: "/coding-challenges",
    title: "Coding Challenges",
    body: "Daily and weekly coding challenges with streak tracking, plus company-tagged tests that mirror real recruiter problem sets.",
  },
  {
    to: "/for-institutions",
    title: "For Institutions",
    body: "Student and staff management, attendance, a question bank, reports, and talent pool management — the admin side of the whole platform.",
  },
];

export default function Features() {
  useSeoHead({
    title: "Features",
    description:
      "Everything on CodeArena: a real coding compiler, proctored online assessments, a learning management system, employability readiness scoring, AI mock interviews, and coding challenges.",
    path: "/features",
  });
  return (
    <MarketingPageShell
      eyebrow="Features"
      title="Everything CodeArena does, in one place."
      intro="Coding practice, proctored assessments, a learning management system, and placement preparation — each explained in full on its own page."
      wide
    >
      <div className="ca-grid-3" style={{ marginTop: 8 }}>
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="card ca-audience-card" style={{ padding: "24px 22px", textDecoration: "none", color: "inherit" }}>
            <h3 style={{ fontSize: 16.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {f.title}
              <ArrowRight size={16} color="var(--ink-dim)" />
            </h3>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13.5, color: "var(--ink-dim)" }}>{f.body}</p>
          </Link>
        ))}
      </div>
    </MarketingPageShell>
  );
}
