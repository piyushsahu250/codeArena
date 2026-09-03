import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const SEGMENT_LABELS = {
  dashboard: "Dashboard", performance: "Performance", learning: "Learning", lesson: "Lesson",
  certificate: "Certificate", interview: "AI Mock Interview", session: "Session", report: "Report",
  history: "History", leaderboard: "Leaderboard", progress: "Progress", resume: "Resume Builder",
  achievements: "Achievements", account: "Settings", staff: "Staff", admin: "Admin",
  students: "Students", classes: "Classes", institutes: "Institutes", questions: "Question Bank",
  new: "New", edit: "Edit", results: "Results", preview: "Preview", tests: "Tests",
  "bulk-upload": "Bulk Upload", gamification: "Gamification", resumes: "Resumes",
  interviews: "Mock Interview Admin", module: "Module", "coding-assessment": "Coding Assessment",
  test: "Test", verify: "Verify",
};

const DASHBOARD_PATHS = new Set(["/dashboard", "/staff", "/admin"]);

// Segments that are real, meaningful path components (so still worth naming in the trail) but
// have no listing page of their own at that exact URL. Clicking any of these landed on the 404
// page, which renders the logged-OUT marketing nav (no trace of the app shell) — indistinguishable
// from actually being signed out even though the session was never touched. Rendered as inert text
// instead of a dead link. Found by auditing every route in App.jsx for a literal (non-":param",
// non-opaque-id) segment that isn't the URL's last segment, then checking whether the path up to
// and including that segment matches any defined route on its own:
//   - "tests"  — /staff/tests/:id/edit|results|preview exist; bare /staff/tests doesn't (staff
//     browse tests from a tab on the Staff Dashboard itself, /staff, never a standalone route).
//   - "test"   — /test/:id/result exists (StudentTestResult.jsx, renders Navbar); bare /test doesn't.
//   - "lesson" — /learning/:slug/lesson/:lessonId exists (LessonView.jsx, renders Navbar); bare
//     /learning/:slug/lesson (no lessonId) doesn't.
// Every other multi-segment route either has a real page at each intermediate prefix already, has
// its middle segment's id skipped as an opaque uuid (isOpaqueId below) so the literal segment
// before it becomes the final, never-linked crumb, or never renders a Breadcrumb at all (the
// noChrome exam/interview/assessment routes, and the public certificate/result verify pages, none
// of which include <Navbar/>).
const NO_LINK_SEGMENTS = new Set(["tests", "test", "lesson"]);

// True for opaque ids (UUIDs and similar) — these have no human-readable name available from the
// URL alone, so they're skipped rather than shown as a raw id. Readable slugs (e.g. course slugs
// like "java") fall through to the titlecase fallback below instead.
function isOpaqueId(seg) {
  return /^[0-9a-f-]{16,}$/i.test(seg);
}

// Best-effort, path-derived breadcrumb — no per-page wiring required, so it's automatically
// present on every route. The tradeoff: dynamic segments that aren't opaque ids (course slugs,
// etc.) are shown titlecased rather than with their true display name (e.g. a lesson's actual
// title), since that data isn't available from the URL alone. A richer version would need each
// page to report its current item's display name via a small context — not built in this pass.
export default function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  if (DASHBOARD_PATHS.has(location.pathname)) return null;

  const homePath = user?.role === "ADMIN" ? "/admin" : user?.role === "STAFF" ? "/staff" : "/dashboard";
  const segments = location.pathname.split("/").filter(Boolean);
  let path = "";
  const crumbs = [{ label: "Dashboard", to: homePath, linkable: true }];
  for (const seg of segments) {
    path += `/${seg}`;
    if (isOpaqueId(seg)) continue;
    const label = SEGMENT_LABELS[seg] || seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push({ label, to: path, linkable: !NO_LINK_SEGMENTS.has(seg) });
  }

  return (
    <div className="ca-breadcrumb-row">
      <button className="ca-back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={14} /> Back
      </button>
      <span style={{ opacity: 0.3 }}>|</span>
      {crumbs.map((c, i) => (
        <span key={c.to} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {i > 0 && <span style={{ opacity: 0.4 }}>›</span>}
          {i === crumbs.length - 1 || !c.linkable ? (
            <span className="ca-crumb-current">{c.label}</span>
          ) : (
            <Link className="ca-crumb-link" to={c.to}>{c.label}</Link>
          )}
        </span>
      ))}
    </div>
  );
}
