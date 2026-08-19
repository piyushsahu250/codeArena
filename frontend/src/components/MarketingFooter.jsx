import { Link } from "react-router-dom";
import ChalkUnderline from "./ChalkUnderline";

// The full public-page sitemap in one place — every marketing page links to every other one from
// here, which is what gives Google a clear internal-linking graph for the brand-search keywords
// (see the SEO spec's "internal linking" section) without cluttering the top nav.
const COLUMNS = [
  {
    heading: "Product",
    links: [
      { to: "/features", label: "Features" },
      { to: "/coding-platform", label: "Coding Platform" },
      { to: "/online-assessment", label: "Online Assessment" },
      { to: "/lms", label: "Learning Management" },
    ],
  },
  {
    heading: "Placement Prep",
    links: [
      { to: "/employability-readiness", label: "Employability Readiness" },
      { to: "/ai-mock-interview", label: "AI Mock Interview" },
      { to: "/coding-challenges", label: "Coding Challenges" },
    ],
  },
  {
    heading: "Company",
    links: [
      { to: "/for-institutions", label: "For Institutions" },
      { to: "/about", label: "About" },
      { to: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { to: "/privacy", label: "Privacy Policy" },
      { to: "/terms", label: "Terms of Service" },
      { to: "/login", label: "Sign in" },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="ca-landing-footer">
      <div className="ca-landing-footer-inner ca-landing-footer-columns">
        <div className="ca-landing-footer-brand">
          <div style={{ background: "#fdfbf5", borderRadius: 8, padding: "3px 10px", display: "inline-flex", alignItems: "center" }}>
            <img src="/branding/logo.png" alt="CodeArena" style={{ height: 26, width: "auto", display: "block" }} />
          </div>
          <ChalkUnderline width={90} />
          <p className="ca-landing-footer-tagline">
            An AI-powered coding, assessment, learning and employability platform for students and
            educational institutions.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.heading} className="ca-landing-footer-col">
            <div className="ca-landing-footer-col-head">{col.heading}</div>
            {col.links.map((l) => (
              <Link key={l.to} to={l.to}>{l.label}</Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="ca-landing-footer-bottom">
        © {new Date().getFullYear()} CodeArena. Empowering talent through smart coding assessments.
      </div>
    </footer>
  );
}
