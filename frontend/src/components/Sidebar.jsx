import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, BarChart3, Mic, FileText, History, Award, Trophy, Settings,
  Users, FileQuestion, Building2, School, Upload, ChevronLeft, ChevronRight, ClipboardList,
  Mail, Activity, Download, CalendarDays, CalendarRange, Briefcase, Sparkles, CheckSquare, Layers,
  CalendarCheck, Share2, UserCircle, Building,
} from "lucide-react";
import { useSidebarUI } from "../context/SidebarContext";

// Every entry links to a real, already-shipped route (confirmed against App.jsx's route table) —
// nothing here points at a "Contests" or standalone "Coding Practice" section since neither
// exists as a feature in this codebase yet; see the redesign's scope notes.
const MENU = {
  STUDENT: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
      { label: "Profile", to: "/profile", icon: UserCircle },
      { label: "Learning", to: "/learning", icon: BookOpen },
      { label: "My Performance", to: "/dashboard/performance", icon: BarChart3 },
      { label: "My Attendance", to: "/attendance", icon: CalendarCheck },
    ] },
    { group: "Placement Prep", items: [
      { label: "Daily Challenge", to: "/challenges/daily", icon: CalendarDays },
      { label: "Weekly Challenge", to: "/challenges/weekly", icon: CalendarRange },
      { label: "Company Tests", to: "/company-tests", icon: Briefcase },
      { label: "Mock Interview", to: "/interview", icon: Mic },
      { label: "Resume Builder", to: "/resume", icon: FileText },
      { label: "Interview History", to: "/interview/history", icon: History },
      { label: "Certificates", to: "/certificates", icon: Award },
      { label: "Achievements", to: "/achievements", icon: Trophy },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
  CLERK: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/clerk", icon: LayoutDashboard },
      { label: "Student Search", to: "/clerk/students", icon: Users },
      { label: "Company Master", to: "/clerk/companies", icon: Building },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
  STAFF: [
    { group: "Main", items: [
      { label: "Dashboard", to: "/staff", icon: LayoutDashboard },
      { label: "Learning Management", to: "/staff/learning", icon: BookOpen },
      { label: "Question Bank", to: "/staff/questions", icon: FileQuestion },
      { label: "Gamification", to: "/staff/gamification", icon: Trophy },
      { label: "Coding Challenges", to: "/staff/challenges", icon: CalendarDays },
    ] },
    { group: "Students", items: [
      { label: "Student Search", to: "/staff/students", icon: Users },
      { label: "Password Reset History", to: "/staff/password-reset-history", icon: History },
      { label: "Audit Log", to: "/staff/audit-log", icon: History },
      { label: "Certificates", to: "/staff/certificates", icon: Award },
      { label: "Export Center", to: "/staff/exports", icon: Download },
      { label: "Resumes", to: "/staff/resumes", icon: FileText },
      { label: "Mock Interviews", to: "/staff/interviews", icon: Mic },
      { label: "AI Draft Review", to: "/staff/interview-drafts", icon: Sparkles },
      { label: "Interview Reports", to: "/staff/interview-reports", icon: ClipboardList },
    ] },
    { group: "Attendance", items: [
      { label: "Mark Attendance", to: "/staff/attendance", icon: CheckSquare },
      { label: "Attendance Reports", to: "/staff/attendance/reports", icon: ClipboardList },
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
    ] },
    { group: "Attendance", items: [
      { label: "Attendance Setup", to: "/admin/attendance-structure", icon: Layers },
      { label: "Mark Attendance", to: "/staff/attendance", icon: CheckSquare },
      { label: "Attendance Reports", to: "/staff/attendance/reports", icon: ClipboardList },
    ] },
    { group: "Content", items: [
      { label: "Learning Management", to: "/staff/learning", icon: BookOpen },
      { label: "Course Assignments", to: "/admin/course-assignments", icon: Share2 },
      { label: "Question Bank", to: "/staff/questions", icon: FileQuestion },
      { label: "Gamification", to: "/staff/gamification", icon: Trophy },
      { label: "Coding Challenges", to: "/staff/challenges", icon: CalendarDays },
      { label: "Resumes", to: "/staff/resumes", icon: FileText },
      { label: "Mock Interviews", to: "/staff/interviews", icon: Mic },
      { label: "AI Draft Review", to: "/staff/interview-drafts", icon: Sparkles },
      { label: "Interview Reports", to: "/staff/interview-reports", icon: ClipboardList },
    ] },
    { group: "System", items: [
      { label: "Email Logs", to: "/admin/email-logs", icon: Mail },
      { label: "Question Audit", to: "/admin/question-audit", icon: CheckSquare },
      { label: "Password Reset History", to: "/admin/password-reset-history", icon: History },
      { label: "Audit Log", to: "/admin/audit-log", icon: History },
      { label: "Certificates", to: "/admin/certificates", icon: Award },
      { label: "Monitoring", to: "/admin/monitoring", icon: Activity },
      { label: "Backups", to: "/admin/backups", icon: Download },
      { label: "Export Center", to: "/admin/exports", icon: Download },
    ] },
    { group: "", items: [{ label: "Settings", to: "/account", icon: Settings }] },
  ],
};

export default function Sidebar({ role, profileGateActive = false }) {
  const location = useLocation();
  const { mobileOpen, closeMobile } = useSidebarUI();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("caSidebarCollapsed") === "1");

  useEffect(() => {
    document.body.classList.add("has-sidebar");
    return () => document.body.classList.remove("has-sidebar");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem("caSidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => { closeMobile(); }, [location.pathname, closeMobile]);

  // While the mandatory Personal Academic & Info section is incomplete, only Profile remains in
  // the sidebar — matching "Only allow: Profile Page, Logout" (Logout stays reachable via the
  // Navbar's account dropdown regardless, so it doesn't need a sidebar entry here).
  const rawGroups = MENU[role] || [];
  const groups = profileGateActive
    ? rawGroups
        .map((g) => ({ ...g, items: g.items.filter((item) => item.to === "/profile") }))
        .filter((g) => g.items.length > 0)
    : rawGroups;

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
                    onClick={closeMobile}
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
