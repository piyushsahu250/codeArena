import { lazy, Suspense, useEffect } from "react";
import { announceTabPresence } from "./utils/tabPresence";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { GamificationProvider } from "./context/GamificationContext";
import { FeatureProvider } from "./context/FeatureContext";
import FeatureProtected from "./components/FeatureProtected";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import { ConfirmProvider } from "./context/ConfirmContext";
import { UnsavedChangesProvider } from "./context/UnsavedChangesContext";
import { SidebarUIProvider } from "./context/SidebarContext";
import LoadingScreen from "./components/LoadingScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import ReportProblemWidget from "./components/ReportProblemWidget";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import About from "./pages/marketing/About";
import Contact from "./pages/marketing/Contact";
import Privacy from "./pages/marketing/Privacy";
import Terms from "./pages/marketing/Terms";
import ForInstitutions from "./pages/marketing/ForInstitutions";
import Features from "./pages/marketing/Features";
import CodingPlatform from "./pages/marketing/CodingPlatform";
import OnlineAssessment from "./pages/marketing/OnlineAssessment";
import Lms from "./pages/marketing/Lms";
import EmployabilityReadinessMkt from "./pages/marketing/EmployabilityReadiness";
import AiMockInterview from "./pages/marketing/AiMockInterview";
import CodingChallengesMkt from "./pages/marketing/CodingChallenges";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StudentDashboard from "./pages/StudentDashboard";
import StudentTestResult from "./pages/StudentTestResult";

// Lazy-loaded: pulls in @tensorflow/tfjs + blazeface for face detection, which is only
// needed once a student actually opens a test — bundling it eagerly would add that weight
// to every page load for every user (login, admin, staff included).
const TestTaking = lazy(() => import("./pages/TestTaking"));
// Lazy-loaded: pulls in Monaco (code editor), only needed for coding practice questions.
const LessonView = lazy(() => import("./pages/LessonView"));
const InterviewSession = lazy(() => import("./pages/InterviewSession"));
const ReadinessAssessment = lazy(() => import("./pages/ReadinessAssessment"));
const ModuleCodingAssessment = lazy(() => import("./pages/ModuleCodingAssessment"));
// Lazy-loaded: these pull in recharts, which every student/login/account-settings page load was
// previously downloading regardless of whether that user ever visits a chart-bearing page.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const StaffDashboard = lazy(() => import("./pages/StaffDashboard"));
const StudentPerformance = lazy(() => import("./pages/StudentPerformance"));
const InterviewProgress = lazy(() => import("./pages/InterviewProgress"));
const InterviewReports = lazy(() => import("./pages/InterviewReports"));
const ReadinessAnalytics = lazy(() => import("./pages/ReadinessAnalytics"));
import CreateQuestion from "./pages/CreateQuestion";
import QuestionBank from "./pages/QuestionBank";
import ReadinessSubjects from "./pages/ReadinessSubjects";
import CreateTest from "./pages/CreateTest";
import TestResults from "./pages/TestResults";
import TestPreview from "./pages/TestPreview";
import AccountSettings from "./pages/AccountSettings";
import BulkUpload from "./pages/BulkUpload";
import AcademicGroups from "./pages/AcademicGroups";
import CourseAssignments from "./pages/CourseAssignments";
import InstituteManagement from "./pages/InstituteManagement";
import FeatureManagement from "./pages/FeatureManagement";
import AttendanceStructure from "./pages/AttendanceStructure";
import AttendanceHome from "./pages/AttendanceHome";
import AttendanceAssignmentDetail from "./pages/AttendanceAssignmentDetail";
import ExecuteAttendance from "./pages/ExecuteAttendance";
import AttendanceReports from "./pages/AttendanceReports";
import MyAttendance from "./pages/MyAttendance";
import TalentPools from "./pages/TalentPools";
import MyTalentPools from "./pages/MyTalentPools";
import ResultManagement from "./pages/ResultManagement";
import StaffClerkManagement from "./pages/StaffClerkManagement";
import StaffClerkProfile from "./pages/StaffClerkProfile";
import MyResults from "./pages/MyResults";
import MarksheetView from "./pages/MarksheetView";
import MarksheetVerify from "./pages/MarksheetVerify";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import ForceChangePassword from "./pages/ForceChangePassword";
import StudentSearch from "./pages/StudentSearch";
import RollNumberConflicts from "./pages/RollNumberConflicts";
import LearningHub from "./pages/LearningHub";
import MyNotes from "./pages/MyNotes";
import CourseOverview from "./pages/CourseOverview";
import CourseCertificate from "./pages/CourseCertificate";
import CourseCertificateVerify from "./pages/CourseCertificateVerify";
import LearningManagement from "./pages/LearningManagement";
import Achievements from "./pages/Achievements";
import GamificationManagement from "./pages/GamificationManagement";
import ResumeBuilder from "./pages/ResumeBuilder";
import ResumeAdmin from "./pages/ResumeAdmin";
import InterviewHub from "./pages/InterviewHub";
import ReadinessHub from "./pages/ReadinessHub";
import ReadinessReport from "./pages/ReadinessReport";
import InterviewReport from "./pages/InterviewReport";
import InterviewHistory from "./pages/InterviewHistory";
import InterviewLeaderboard from "./pages/InterviewLeaderboard";
import InterviewCertificate from "./pages/InterviewCertificate";
import InterviewVerify from "./pages/InterviewVerify";
import InterviewAdmin from "./pages/InterviewAdmin";
import InterviewDraftReview from "./pages/InterviewDraftReview";
import InterviewCompanies from "./pages/InterviewCompanies";
import ChallengeAdmin from "./pages/ChallengeAdmin";
import DailyChallenge from "./pages/DailyChallenge";
import WeeklyChallenge from "./pages/WeeklyChallenge";
import CompanyTests from "./pages/CompanyTests";
import InterviewReportDetail from "./pages/InterviewReportDetail";
import EmailLogs from "./pages/EmailLogs";
import QuestionAudit from "./pages/QuestionAudit";
import PasswordResetHistory from "./pages/PasswordResetHistory";
import SystemMonitoring from "./pages/SystemMonitoring";
import AuditLogPage from "./pages/AuditLogPage";
import MyCertificates from "./pages/MyCertificates";
import CertificateVerify from "./pages/CertificateVerify";
import CertificateAdmin from "./pages/CertificateAdmin";
import Backups from "./pages/Backups";
import ExportCenter from "./pages/ExportCenter";
import StudentProfile from "./pages/StudentProfile";
import ClerkDashboard from "./pages/ClerkDashboard";
import CompanyMaster from "./pages/CompanyMaster";
import IssueReports from "./pages/IssueReports";
import PlatformHealth from "./pages/PlatformHealth";
import SecurityDashboard from "./pages/SecurityDashboard";

const HOME_BY_ROLE = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin", CLERK: "/clerk", SUPER_ADMIN: "/admin", INSTITUTE_ADMIN: "/admin" };

// Student Profile Completion gating — true only for a STUDENT whose institute has the toggle on
// and who hasn't finished the mandatory Personal Academic & Info section yet. Mirrors
// mustChangePassword's exact shape (a boolean the frontend already knows how to force-redirect on).
function profileGateActive(user) {
  return user.role === "STUDENT" && user.requireProfileCompletion && !user.profileComplete;
}

// noChrome skips the persistent Sidebar — used for the three fullscreen/proctored routes
// (timed exam, mock interview session, module coding assessment) where offering navigation away
// from an active, monitored attempt would undermine the whole point of locking it down.
function Protected({ roles, children, noChrome = false }) {
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToast();
  // Both Profile and Resume Builder stay reachable while gated — mandatory info spans both pages
  // (personal/academic fields on Profile, Education on Resume Builder), so locking the student to
  // just one of them would make it impossible to finish the other half.
  const blocked = !!user && profileGateActive(user) && location.pathname !== "/profile" && location.pathname !== "/resume";
  // Toast is a side effect, so it fires from an effect (once per blocked navigation attempt) even
  // though the actual redirect below is a synchronous <Navigate> in the same render.
  useEffect(() => {
    if (blocked) toast.error("Please complete your Profile and Resume Builder (Education) before continuing.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, location.pathname]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (blocked) return <Navigate to="/profile" replace />;
  // SUPER_ADMIN/INSTITUTE_ADMIN are new roles (added 2026-08-24) that don't appear in most
  // existing route `roles` lists yet — updating every one of those lists individually is a large,
  // ongoing rollout (see docs/INSTITUTE_ADMIN_ROLLOUT.md), so in the meantime both are treated as
  // satisfying any gate that already admits "ADMIN": SUPER_ADMIN is a straight rename of the
  // platform-level ADMIN capability that already existed, and INSTITUTE_ADMIN reuses the same
  // institute-scoped data access an institute-scoped ADMIN already had. The backend remains
  // authoritative either way — a page rendering here doesn't guarantee every API call inside it
  // has been extended yet; some may still 403 until that file's backend routes are rolled out.
  const roleSatisfied = !roles || roles.includes(user.role) || (roles.includes("ADMIN") && (user.role === "SUPER_ADMIN" || user.role === "INSTITUTE_ADMIN"));
  if (!roleSatisfied) return <Navigate to="/" replace />;
  return (
    <>
      {!noChrome && <Sidebar role={user.role} profileGateActive={profileGateActive(user)} />}
      {!noChrome && <ReportProblemWidget />}
      {/* Keyed by path so this remounts (and re-triggers the fade-in) on every navigation,
          instead of silently reusing the same DOM node with stale animation state. */}
      <div key={location.pathname} className="ca-page-enter">
        {children}
      </div>
    </>
  );
}

function Home() {
  const { user } = useAuth();
  // Signed-out visitors get the public marketing page; a signed-in user landing on "/" (e.g. via
  // the browser back button, or the catch-all 404 route below) still gets bounced straight to
  // their role's dashboard, same as before.
  if (!user) return <Landing />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (profileGateActive(user)) return <Navigate to="/profile" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || "/login"} replace />;
}

export default function App() {
  // Announces this tab's presence on a same-origin BroadcastChannel for the whole app lifetime, so
  // TestTaking's pre-start "other tabs open?" check (see utils/tabPresence.js) can detect a
  // Dashboard/LMS/etc. tab open elsewhere, not just another exam tab. A no-op cleanup on browsers
  // without BroadcastChannel, so this is always safe to mount unconditionally.
  useEffect(() => announceTabPresence(), []);
  return (
    <ThemeProvider>
    <ToastProvider>
    <ConfirmProvider>
    <UnsavedChangesProvider>
    <SidebarUIProvider>
    <AuthProvider>
      <FeatureProvider>
      <GamificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          {/* Public marketing pages — signed-out content, no auth wrapper. See docs/SEO for why
              these exist as real routes instead of anchors on "/" alone (per-page title/meta,
              indexable URLs, internal linking for brand-search SEO). */}
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/for-institutions" element={<ForInstitutions />} />
          <Route path="/features" element={<Features />} />
          <Route path="/coding-platform" element={<CodingPlatform />} />
          <Route path="/online-assessment" element={<OnlineAssessment />} />
          <Route path="/lms" element={<Lms />} />
          <Route path="/employability-readiness" element={<EmployabilityReadinessMkt />} />
          <Route path="/ai-mock-interview" element={<AiMockInterview />} />
          <Route path="/coding-challenges" element={<CodingChallengesMkt />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/change-password" element={<ForceChangePassword />} />
          <Route path="/interview/verify/:code" element={<InterviewVerify />} />
          <Route path="/learning/certificate/verify/:code" element={<CourseCertificateVerify />} />
          <Route path="/certificate/verify/:code" element={<CertificateVerify />} />
          <Route path="/results/verify/:code" element={<MarksheetVerify />} />
          <Route path="/account" element={<Protected><AccountSettings /></Protected>} />
          <Route path="/certificates" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="certificates"><MyCertificates /></FeatureProtected></Protected>} />
          <Route path="/attendance" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="attendance"><MyAttendance /></FeatureProtected></Protected>} />
          <Route path="/talent-pools" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="talent_pool"><MyTalentPools /></FeatureProtected></Protected>} />
          <Route path="/results" element={<Protected roles={["STUDENT"]}><MyResults /></Protected>} />
          <Route path="/results/:entryId" element={<Protected roles={["STUDENT"]}><MarksheetView /></Protected>} />

          {/* Student */}
          <Route path="/profile" element={<Protected roles={["STUDENT"]}><StudentProfile /></Protected>} />
          <Route path="/dashboard" element={<Protected roles={["STUDENT"]}><StudentDashboard /></Protected>} />
          <Route
            path="/test/:id"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <Suspense fallback={<LoadingScreen label="Loading test…" />}>
                  <TestTaking />
                </Suspense>
              </Protected>
            }
          />
          <Route path="/test/:id/result" element={<Protected roles={["STUDENT"]}><StudentTestResult /></Protected>} />
          <Route path="/dashboard/performance" element={<Protected roles={["STUDENT"]}><Suspense fallback={<LoadingScreen />}><StudentPerformance /></Suspense></Protected>} />
          <Route path="/achievements" element={<Protected roles={["STUDENT"]}><Achievements /></Protected>} />
          {/* Root-cause fix for "Weekly Challenge shows a blank screen": no error boundary
              wrapped these two routes (or almost any route besides /interview/session/:id) — any
              uncaught render exception, or a stale-deploy lazy-chunk load failure, unmounts
              straight to a blank white screen with zero recovery, matching the reported symptom
              exactly. Live testing today found no reproducible crash under the current data/code
              (empty week, a real scheduled challenge, mobile, hard nav — all render correctly),
              but that doesn't rule out a stale cached bundle or a data shape not covered by
              today's testing; this boundary makes the actual symptom (a permanent blank screen)
              structurally impossible going forward regardless of what trips it. */}
          <Route path="/challenges/daily" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="coding_challenge"><ErrorBoundary title="We hit a temporary problem" message="Unable to load the Daily Challenge. Reloading usually fixes this."><DailyChallenge /></ErrorBoundary></FeatureProtected></Protected>} />
          <Route path="/challenges/weekly" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="coding_challenge"><ErrorBoundary title="We hit a temporary problem" message="Unable to load the Weekly Challenge. Reloading usually fixes this."><WeeklyChallenge /></ErrorBoundary></FeatureProtected></Protected>} />
          <Route path="/company-tests" element={<Protected roles={["STUDENT"]}><CompanyTests /></Protected>} />
          <Route path="/resume" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="resume_builder" featureLabel="Resume Builder"><ResumeBuilder /></FeatureProtected></Protected>} />
          <Route path="/readiness" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="readiness_test"><ReadinessHub /></FeatureProtected></Protected>} />
          <Route
            path="/readiness/take/:assessmentId"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <Suspense fallback={<LoadingScreen />}>
                  <ReadinessAssessment />
                </Suspense>
              </Protected>
            }
          />
          <Route path="/readiness/report/:assessmentId" element={<Protected roles={["STUDENT"]}><ReadinessReport /></Protected>} />
          <Route path="/interview" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="ai_mock_interview"><InterviewHub /></FeatureProtected></Protected>} />
          <Route path="/interview/companies" element={<Protected roles={["STUDENT"]}><InterviewCompanies /></Protected>} />
          <Route
            path="/interview/session/:id"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <ErrorBoundary>
                  <Suspense fallback={<LoadingScreen />}>
                    <InterviewSession />
                  </Suspense>
                </ErrorBoundary>
              </Protected>
            }
          />
          <Route path="/interview/report/:id" element={<Protected roles={["STUDENT"]}><InterviewReport /></Protected>} />
          <Route path="/interview/history" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="interview_history" featureLabel="Interview History"><InterviewHistory /></FeatureProtected></Protected>} />
          <Route path="/interview/leaderboard" element={<Protected roles={["STUDENT"]}><InterviewLeaderboard /></Protected>} />
          <Route path="/interview/progress" element={<Protected roles={["STUDENT"]}><Suspense fallback={<LoadingScreen />}><InterviewProgress /></Suspense></Protected>} />
          <Route path="/interview/certificate" element={<Protected roles={["STUDENT"]}><InterviewCertificate /></Protected>} />

          {/* Learning module — browsable by Student, Admin, and Staff (admin/staff preview content they manage) */}
          <Route path="/learning" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><LearningHub /></FeatureProtected></Protected>} />
          <Route path="/learning/:slug" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><CourseOverview /></FeatureProtected></Protected>} />
          <Route
            path="/learning/:slug/lesson/:lessonId"
            element={
              <Protected roles={["STUDENT", "ADMIN", "STAFF"]}>
                <FeatureProtected featureKey="lms">
                  <Suspense fallback={<LoadingScreen label="Loading lesson…" />}>
                    <LessonView />
                  </Suspense>
                </FeatureProtected>
              </Protected>
            }
          />
          <Route path="/learning/notes" element={<Protected roles={["STUDENT"]}><MyNotes /></Protected>} />
          <Route path="/learning/:slug/certificate" element={<Protected roles={["STUDENT"]}><CourseCertificate /></Protected>} />
          <Route
            path="/learning/:slug/module/:moduleId/coding-assessment"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <Suspense fallback={<LoadingScreen />}>
                  <ModuleCodingAssessment />
                </Suspense>
              </Protected>
            }
          />

          {/* Staff (and Admin, who can also manage tests/questions) */}
          <Route path="/staff" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><StaffDashboard /></Suspense></Protected>} />
          <Route path="/staff/learning" element={<Protected roles={["ADMIN", "STAFF"]}><LearningManagement /></Protected>} />
          <Route path="/staff/gamification" element={<Protected roles={["ADMIN", "STAFF"]}><GamificationManagement /></Protected>} />
          <Route path="/staff/resumes" element={<Protected roles={["ADMIN", "STAFF"]}><ResumeAdmin /></Protected>} />
          <Route path="/staff/interviews" element={<Protected roles={["ADMIN", "STAFF"]}><InterviewAdmin /></Protected>} />
          <Route path="/staff/interview-drafts" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="ai_draftview"><InterviewDraftReview /></FeatureProtected></Protected>} />
          <Route path="/staff/challenges" element={<Protected roles={["ADMIN", "STAFF"]}><ChallengeAdmin /></Protected>} />
          <Route path="/staff/interview-reports" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><InterviewReports /></Suspense></Protected>} />
          <Route path="/staff/readiness-analytics" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><ReadinessAnalytics /></Suspense></Protected>} />
          <Route path="/staff/interview-reports/:sessionId" element={<Protected roles={["ADMIN", "STAFF"]}><InterviewReportDetail /></Protected>} />
          <Route path="/staff/questions" element={<Protected roles={["ADMIN", "STAFF"]}><QuestionBank /></Protected>} />
          <Route path="/staff/readiness-subjects" element={<Protected roles={["ADMIN", "STAFF"]}><ReadinessSubjects /></Protected>} />
          <Route path="/staff/questions/new" element={<Protected roles={["ADMIN", "STAFF"]}><CreateQuestion /></Protected>} />
          <Route path="/staff/questions/:id/edit" element={<Protected roles={["ADMIN", "STAFF"]}><CreateQuestion /></Protected>} />
          <Route path="/staff/tests/new" element={<Protected roles={["ADMIN", "STAFF"]}><CreateTest /></Protected>} />
          <Route path="/staff/tests/:id/edit" element={<Protected roles={["ADMIN", "STAFF"]}><CreateTest /></Protected>} />
          <Route path="/staff/tests/:id/results" element={<Protected roles={["ADMIN", "STAFF"]}><TestResults /></Protected>} />
          <Route path="/staff/tests/:id/preview" element={<Protected roles={["ADMIN", "STAFF"]}><TestPreview /></Protected>} />
          <Route path="/staff/students" element={<Protected roles={["ADMIN", "STAFF"]}><StudentSearch basePath="/staff" /></Protected>} />
          <Route path="/staff/students/:id" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><StudentPerformance basePath="/staff" /></Suspense></Protected>} />
          <Route path="/staff/password-reset-history" element={<Protected roles={["ADMIN", "STAFF"]}><PasswordResetHistory basePath="/staff" /></Protected>} />
          <Route path="/staff/audit-log" element={<Protected roles={["ADMIN", "STAFF"]}><AuditLogPage basePath="/staff" /></Protected>} />
          <Route path="/staff/certificates" element={<Protected roles={["ADMIN", "STAFF"]}><CertificateAdmin basePath="/staff" /></Protected>} />
          <Route path="/staff/exports" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="export_center"><ExportCenter basePath="/staff" /></FeatureProtected></Protected>} />
          <Route path="/staff/attendance" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="attendance"><AttendanceHome /></FeatureProtected></Protected>} />
          <Route path="/staff/attendance/reports" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="attendance"><AttendanceReports /></FeatureProtected></Protected>} />
          <Route path="/staff/attendance/:assignmentId" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="attendance"><AttendanceAssignmentDetail /></FeatureProtected></Protected>} />
          <Route path="/staff/attendance/:assignmentId/execute/:planId" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="attendance"><ExecuteAttendance /></FeatureProtected></Protected>} />

          {/* Admin only: account management */}
          <Route path="/admin" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><AdminDashboard /></Suspense></Protected>} />
          <Route path="/admin/bulk-upload" element={<Protected roles={["ADMIN"]}><BulkUpload /></Protected>} />
          <Route path="/admin/academic-groups" element={<Protected roles={["ADMIN"]}><AcademicGroups /></Protected>} />
          <Route path="/admin/course-assignments" element={<Protected roles={["ADMIN"]}><CourseAssignments /></Protected>} />
          <Route path="/admin/institutes" element={<Protected roles={["ADMIN"]}><InstituteManagement /></Protected>} />
          <Route path="/admin/feature-management" element={<Protected roles={["ADMIN"]}><FeatureManagement /></Protected>} />
          <Route path="/admin/attendance-structure" element={<Protected roles={["ADMIN"]}><AttendanceStructure /></Protected>} />
          <Route path="/admin/talent-pools" element={<Protected roles={["ADMIN", "STAFF"]}><TalentPools /></Protected>} />
          <Route path="/admin/results" element={<Protected roles={["ADMIN", "STAFF"]}><ResultManagement /></Protected>} />
          <Route path="/admin/email-logs" element={<Protected roles={["ADMIN"]}><EmailLogs /></Protected>} />
          <Route path="/admin/question-audit" element={<Protected roles={["ADMIN"]}><QuestionAudit /></Protected>} />
          <Route path="/admin/password-reset-history" element={<Protected roles={["ADMIN"]}><PasswordResetHistory basePath="/admin" /></Protected>} />
          <Route path="/admin/audit-log" element={<Protected roles={["ADMIN"]}><AuditLogPage basePath="/admin" /></Protected>} />
          <Route path="/admin/certificates" element={<Protected roles={["ADMIN"]}><CertificateAdmin basePath="/admin" /></Protected>} />
          <Route path="/admin/backups" element={<Protected roles={["ADMIN"]}><Backups /></Protected>} />
          <Route path="/admin/exports" element={<Protected roles={["ADMIN"]}><FeatureProtected featureKey="export_center"><ExportCenter basePath="/admin" /></FeatureProtected></Protected>} />
          <Route path="/admin/monitoring" element={<Protected roles={["ADMIN"]}><SystemMonitoring /></Protected>} />
          <Route path="/admin/students" element={<Protected roles={["ADMIN"]}><StudentSearch basePath="/admin" /></Protected>} />
          <Route path="/admin/students/:id" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><StudentPerformance basePath="/admin" /></Suspense></Protected>} />
          <Route path="/admin/roll-number-conflicts" element={<Protected roles={["ADMIN"]}><RollNumberConflicts /></Protected>} />
          <Route path="/admin/staff-clerk" element={<Protected roles={["ADMIN"]}><StaffClerkManagement /></Protected>} />
          <Route path="/admin/staff-clerk/:id" element={<Protected roles={["ADMIN"]}><StaffClerkProfile /></Protected>} />
          <Route path="/admin/companies" element={<Protected roles={["ADMIN"]}><CompanyMaster /></Protected>} />
          <Route path="/admin/issue-reports" element={<Protected roles={["ADMIN"]}><IssueReports basePath="/admin" /></Protected>} />
          <Route path="/admin/platform-health" element={<Protected roles={["SUPER_ADMIN"]}><PlatformHealth /></Protected>} />
          <Route path="/admin/security-dashboard" element={<Protected roles={["SUPER_ADMIN"]}><SecurityDashboard /></Protected>} />

          {/* Placement Clerk — always institute-scoped, Placement Cell operations only (no
              Learning/Test Management access — those routes above simply never list CLERK). */}
          <Route path="/clerk" element={<Protected roles={["CLERK"]}><ClerkDashboard /></Protected>} />
          <Route path="/clerk/students" element={<Protected roles={["CLERK"]}><StudentSearch basePath="/clerk" /></Protected>} />
          <Route path="/clerk/students/:id" element={<Protected roles={["CLERK"]}><Suspense fallback={<LoadingScreen />}><StudentPerformance basePath="/clerk" /></Suspense></Protected>} />
          <Route path="/clerk/companies" element={<Protected roles={["CLERK"]}><CompanyMaster /></Protected>} />
          <Route path="/clerk/results" element={<Protected roles={["CLERK"]}><ResultManagement /></Protected>} />
          <Route path="/clerk/audit-log" element={<Protected roles={["CLERK"]}><AuditLogPage basePath="/clerk" /></Protected>} />
          <Route path="/clerk/exports" element={<Protected roles={["CLERK"]}><FeatureProtected featureKey="export_center"><ExportCenter basePath="/clerk" /></FeatureProtected></Protected>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </GamificationProvider>
      </FeatureProvider>
    </AuthProvider>
    </SidebarUIProvider>
    </UnsavedChangesProvider>
    </ConfirmProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}
