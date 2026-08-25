import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, BarChart3, Mic, FileText, History, Award, Trophy, Settings,
  Users, FileQuestion, Building2, School, Upload, ChevronLeft, ChevronRight, ClipboardList,
  Mail, Activity, Download, CalendarDays, CalendarRange, Briefcase, Sparkles, CheckSquare, Layers,
  CalendarCheck, Share2, UserCircle, Building, Star, UserCog, Target, StickyNote,
} from "lucide-react";
import { useSidebarUI } from "../context/SidebarContext";
import { useUnsavedChangesGuard } from "../context/UnsavedChangesContext";
import { useConfirm } from "../context/ConfirmContext";
import { useFeatures } from "../context/FeatureContext";

// Every entry links to a real, already-shipped route (confirmed against App.jsx's route table) —
// nothing here points at a "Contests" or standalone "Coding Practice" section since neither
// exists as a feature in this codebase yet; see the redesign's scope notes.
const MENU = {
  STUDENT: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
      { label: "Profile", to: "/profile", icon: UserCircle },
      { label: "Learning", to: "/learning", icon: BookOpen, featureKey: "lms" },
      { label: "My Notes", to: "/learning/notes", icon: StickyNote, featureKey: "lms" },
      { label: "My Performance", to: "/dashboard/performance", icon: BarChart3 },
      { label: "My Attendance", to: "/attendance", icon: CalendarCheck, featureKey: "attendance" },
    ] },
    { group: "Placement Prep", items: [
      { label: "Readiness Assessment", to: "/readiness", icon: Target, featureKey: "readiness_test" },
      { label: "My Talent Pools", to: "/talent-pools", icon: Star, featureKey: "talent_pool" },
      { label: "Daily Challenge", to: "/challenges/daily", icon: CalendarDays, featureKey: "coding_challenge" },
      { label: "Weekly Challenge", to: "/challenges/weekly", icon: CalendarRange, featureKey: "coding_challenge" },
      { label: "Company Tests", to: "/company-tests", icon: Briefcase },
      { label: "My Results", to: "/results", icon: ClipboardList },
      { label: "Mock Interview", to: "/interview", icon: Mic, featureKey: "ai_mock_interview" },
      { label: "Resume Builder", to: "/resume", icon: FileText },
      { label: "Interview History", to: "/interview/history", icon: History },
      { label: "Certificates", to: "/certificates", icon: Award, featureKey: "certificates" },
      { label: "Achievements", to: "/achievements", icon: Trophy },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
  CLERK: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/clerk", icon: LayoutDashboard },
      { label: "Student Search", to: "/clerk/students", icon: Users },
      { label: "Company Master", to: "/clerk/companies", icon: Building },
      { label: "Results", to: "/clerk/results", icon: ClipboardList },
      { label: "Audit Log", to: "/clerk/audit-log", icon: History },
      { label: "Export Center", to: "/clerk/exports", icon: Download, featureKey: "export_center" },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
  STAFF: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/staff", icon: LayoutDashboard },
      { label: "Learning Management", to: "/staff/learning", icon: BookOpen },
      { label: "Question Bank", to: "/staff/questions", icon: FileQuestion, featureKey: "question_bank" },
      { label: "Readiness Tests", to: "/staff/readiness-subjects", icon: Target, featureKey: "readiness_test" },
      { label: "Readiness Analytics", to: "/staff/readiness-analytics", icon: BarChart3, featureKey: "readiness_test" },
      { label: "Gamification", to: "/staff/gamification", icon: Trophy },
      { label: "Coding Challenges", to: "/staff/challenges", icon: CalendarDays, featureKey: "coding_challenge" },
    ] },
    { group: "Students", items: [
      { label: "Student Search", to: "/staff/students", icon: Users },
      { label: "Talent Pools", to: "/admin/talent-pools", icon: Star, featureKey: "talent_pool" },
      { label: "Results", to: "/admin/results", icon: ClipboardList },
      { label: "Password Reset History", to: "/staff/password-reset-history", icon: History },
      { label: "Audit Log", to: "/staff/audit-log", icon: History },
      { label: "Certificates", to: "/staff/certificates", icon: Award, featureKey: "certificates" },
      { label: "Export Center", to: "/staff/exports", icon: Download, featureKey: "export_center" },
      { label: "Resumes", to: "/staff/resumes", icon: FileText },
      { label: "Mock Interviews", to: "/staff/interviews", icon: Mic, featureKey: "ai_mock_interview" },
      { label: "AI Draft Review", to: "/staff/interview-drafts", icon: Sparkles, featureKey: "ai_draftview" },
      { label: "Interview Reports", to: "/staff/interview-reports", icon: ClipboardList, featureKey: "ai_mock_interview" },
    ] },
    { group: "Attendance", items: [
      { label: "Mark Attendance", to: "/staff/attendance", icon: CheckSquare, featureKey: "attendance" },
      { label: "Attendance Reports", to: "/staff/attendance/reports", icon: ClipboardList, featureKey: "attendance" },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
  ADMIN: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
      { label: "Institutes", to: "/admin/institutes", icon: Building2 },
      { label: "Academic Groups", to: "/admin/academic-groups", icon: School },
      { label: "Bulk Upload", to: "/admin/bulk-upload", icon: Upload },
      { label: "Students", to: "/admin/students", icon: Users },
      { label: "Staff & Clerk", to: "/admin/staff-clerk", icon: UserCog },
      { label: "Talent Pools", to: "/admin/talent-pools", icon: Star },
    ] },
    { group: "Attendance", items: [
      { label: "Attendance Setup", to: "/admin/attendance-structure", icon: Layers },
      { label: "Mark Attendance", to: "/staff/attendance", icon: CheckSquare, featureKey: "attendance" },
      { label: "Attendance Reports", to: "/staff/attendance/reports", icon: ClipboardList, featureKey: "attendance" },
    ] },
    { group: "Content", items: [
      { label: "Learning Management", to: "/staff/learning", icon: BookOpen },
      { label: "Course Assignments", to: "/admin/course-assignments", icon: Share2 },
      { label: "Question Bank", to: "/staff/questions", icon: FileQuestion },
      { label: "Readiness Tests", to: "/staff/readiness-subjects", icon: Target },
      { label: "Readiness Analytics", to: "/staff/readiness-analytics", icon: BarChart3 },
      { label: "Gamification", to: "/staff/gamification", icon: Trophy },
      { label: "Coding Challenges", to: "/staff/challenges", icon: CalendarDays },
      { label: "Resumes", to: "/staff/resumes", icon: FileText },
      { label: "Mock Interviews", to: "/staff/interviews", icon: Mic },
      { label: "AI Draft Review", to: "/staff/interview-drafts", icon: Sparkles },
      { label: "Interview Reports", to: "/staff/interview-reports", icon: ClipboardList },
      { label: "Results", to: "/admin/results", icon: ClipboardList },
    ] },
    { group: "System", items: [
      { label: "Email Logs", to: "/admin/email-logs", icon: Mail },
      { label: "Question Audit", to: "/admin/question-audit", icon: CheckSquare },
      { label: "Password Reset History", to: "/admin/password-reset-history", icon: History },
      { label: "Audit Log", to: "/admin/audit-log", icon: History },
      { label: "Certificates", to: "/admin/certificates", icon: Award },
      { label: "Monitoring", to: "/admin/monitoring", icon: Activity },
      { label: "Backups", to: "/admin/backups", icon: Download },
      { label: "Export Center", to: "/admin/exports", icon: Download, featureKey: "export_center" },
      { label: "Feature Management", to: "/admin/feature-management", icon: Settings },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
  // INSTITUTE_ADMIN (added 2026-08-25) — a real, deliberately-scoped subset of MENU.ADMIN, not an
  // alias. Excludes exactly the platform-wide-only surfaces the backend rollout also excluded
  // this role from (see docs/INSTITUTE_ADMIN_ROLLOUT.md): Institutes (create/edit/delete other
  // institutes), Monitoring (platform process/host metrics), Backups (full DB), Question Audit
  // (scans every institute's question bank). Everything else here is backend-verified to already
  // scope correctly to this account's own institute regardless of which role reaches it.
  INSTITUTE_ADMIN: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
      { label: "Academic Groups", to: "/admin/academic-groups", icon: School },
      { label: "Bulk Upload", to: "/admin/bulk-upload", icon: Upload },
      { label: "Students", to: "/admin/students", icon: Users },
      { label: "Staff & Clerk", to: "/admin/staff-clerk", icon: UserCog },
      { label: "Talent Pools", to: "/admin/talent-pools", icon: Star },
    ] },
    { group: "Attendance", items: [
      { label: "Attendance Setup", to: "/admin/attendance-structure", icon: Layers },
      { label: "Mark Attendance", to: "/staff/attendance", icon: CheckSquare, featureKey: "attendance" },
      { label: "Attendance Reports", to: "/staff/attendance/reports", icon: ClipboardList, featureKey: "attendance" },
    ] },
    { group: "Content", items: [
      { label: "Learning Management", to: "/staff/learning", icon: BookOpen },
      { label: "Course Assignments", to: "/admin/course-assignments", icon: Share2 },
      { label: "Question Bank", to: "/staff/questions", icon: FileQuestion },
      { label: "Readiness Tests", to: "/staff/readiness-subjects", icon: Target },
      { label: "Readiness Analytics", to: "/staff/readiness-analytics", icon: BarChart3 },
      { label: "Gamification", to: "/staff/gamification", icon: Trophy },
      { label: "Coding Challenges", to: "/staff/challenges", icon: CalendarDays, featureKey: "coding_challenge" },
      { label: "Resumes", to: "/staff/resumes", icon: FileText },
      { label: "Mock Interviews", to: "/staff/interviews", icon: Mic, featureKey: "ai_mock_interview" },
      { label: "AI Draft Review", to: "/staff/interview-drafts", icon: Sparkles, featureKey: "ai_draftview" },
      { label: "Interview Reports", to: "/staff/interview-reports", icon: ClipboardList, featureKey: "ai_mock_interview" },
      { label: "Results", to: "/admin/results", icon: ClipboardList },
    ] },
    { group: "System", items: [
      { label: "Email Logs", to: "/admin/email-logs", icon: Mail },
      { label: "Password Reset History", to: "/admin/password-reset-history", icon: History },
      { label: "Audit Log", to: "/admin/audit-log", icon: History },
      { label: "Certificates", to: "/admin/certificates", icon: Award, featureKey: "certificates" },
      { label: "Export Center", to: "/admin/exports", icon: Download, featureKey: "export_center" },
      { label: "Feature Management", to: "/admin/feature-management", icon: Settings },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
};

// SUPER_ADMIN (added 2026-08-24) is a rename of the same platform-level capability ADMIN already
// had, not a new/reduced one — same menu, unlike INSTITUTE_ADMIN above (a real, separately-defined
// subset, not an alias).
MENU.SUPER_ADMIN = MENU.ADMIN;

export default function Sidebar({ role, profileGateActive = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { mobileOpen, closeMobile } = useSidebarUI();
  const { checkGuard, setGuard } = useUnsavedChangesGuard() || {};
  const confirmDialog = useConfirm();
  const { isFeatureEnabled } = useFeatures();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("caSidebarCollapsed") === "1");

  // Blocks in-app navigation away from a page with unsaved changes (currently: CreateTest.jsx) —
  // see UnsavedChangesContext.jsx for why this is a Link-click intercept rather than
  // react-router-dom's useBlocker (this app uses <BrowserRouter>, not a data router; useBlocker
  // requires one). No guard registered -> completely normal <Link> navigation, unchanged from
  // before this existed.
  async function handleNavClick(e, to) {
    const guard = checkGuard?.();
    if (!guard) { closeMobile(); return; }
    e.preventDefault();
    const leave = await confirmDialog({
      title: "You have unsaved changes",
      message: guard.message,
      confirmLabel: "Leave Without Saving",
      cancelLabel: "Stay and Continue Editing",
      danger: true,
    });
    if (leave) {
      setGuard?.(false);
      closeMobile();
      navigate(to);
    }
  }

  useEffect(() => {
    document.body.classList.add("has-sidebar");
    return () => document.body.classList.remove("has-sidebar");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem("caSidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => { closeMobile(); }, [location.pathname, closeMobile]);

  // While the mandatory Personal Academic & Info section is incomplete, only Profile and Resume
  // Builder remain in the sidebar — mandatory info spans both pages (personal/academic fields on
  // Profile, Education on Resume Builder). Logout stays reachable via the Navbar's account
  // dropdown regardless, so it doesn't need a sidebar entry here.
  const rawGroups = MENU[role] || [];
  const featureFiltered = rawGroups
    .map((g) => ({ ...g, items: g.items.filter((item) => !item.featureKey || isFeatureEnabled(item.featureKey)) }))
    .filter((g) => g.items.length > 0);
  const groups = profileGateActive
    ? featureFiltered
        .map((g) => ({ ...g, items: g.items.filter((item) => item.to === "/profile" || item.to === "/resume") }))
        .filter((g) => g.items.length > 0)
    : featureFiltered;

  return (
    <>
      <aside className={`ca-sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.group && !collapsed && <div className="ca-sidebar-group-label">{g.group}</div>}
              {g.items.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.to || (item.to !== "/staff" && item.to !== "/admin" && location.pathname.startsWith(item.to + "/"));
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`ca-sidebar-link ${active ? "active" : ""}`}
                    title={collapsed ? item.label : undefined}
                    onClick={(e) => handleNavClick(e, item.to)}
                  >
                    <Icon />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <button className="ca-sidebar-collapse-btn" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span style={{ fontSize: 12 }}>Collapse</span></>}
        </button>
      </aside>
      {mobileOpen && <div className="ca-sidebar-backdrop" onClick={closeMobile} />}
    </>
  );
}
