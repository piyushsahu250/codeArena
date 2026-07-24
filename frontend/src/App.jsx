import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { GamificationProvider } from "./context/GamificationContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { ConfirmProvider } from "./context/ConfirmContext";
import { SidebarUIProvider } from "./context/SidebarContext";
import LoadingScreen from "./components/LoadingScreen";
import Sidebar from "./components/Sidebar";
import Landing from "./pages/Landing";
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
const ModuleCodingAssessment = lazy(() => import("./pages/ModuleCodingAssessment"));
// Lazy-loaded: these pull in recharts, which every student/login/account-settings page load was
// previously downloading regardless of whether that user ever visits a chart-bearing page.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const StaffDashboard = lazy(() => import("./pages/StaffDashboard"));
const StudentPerformance = lazy(() => import("./pages/StudentPerformance"));
const InterviewProgress = lazy(() => import("./pages/InterviewProgress"));
const InterviewReports = lazy(() => import("./pages/InterviewReports"));
import CreateQuestion from "./pages/CreateQuestion";
import QuestionBank from "./pages/QuestionBank";
import CreateTest from "./pages/CreateTest";
import TestResults from "./pages/TestResults";
import TestPreview from "./pages/TestPreview";
import AccountSettings from "./pages/AccountSettings";
import BulkUpload from "./pages/BulkUpload";
import AcademicGroups from "./pages/AcademicGroups";
import InstituteManagement from "./pages/InstituteManagement";
import AttendanceStructure from "./pages/AttendanceStructure";
import AttendanceHome from "./pages/AttendanceHome";
import AttendanceAssignmentDetail from "./pages/AttendanceAssignmentDetail";
import ExecuteAttendance from "./pages/ExecuteAttendance";
import AttendanceReports from "./pages/AttendanceReports";
import MyAttendance from "./pages/MyAttendance";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ForceChangePassword from "./pages/ForceChangePassword";
import StudentSearch from "./pages/StudentSearch";
import LearningHub from "./pages/LearningHub";
import CourseOverview from "./pages/CourseOverview";
import CourseCertificate from "./pages/CourseCertificate";
import CourseCertificateVerify from "./pages/CourseCertificateVerify";
import LearningManagement from "./pages/LearningManagement";
import Achievements from "./pages/Achievements";
import GamificationManagement from "./pages/GamificationManagement";
import ResumeBuilder from "./pages/ResumeBuilder";
import ResumeAdmin from "./pages/ResumeAdmin";
import InterviewHub from "./pages/InterviewHub";
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

const HOME_BY_ROLE = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin" };

// noChrome skips the persistent Sidebar — used for the three fullscreen/proctored routes
// (timed exam, mock interview session, module coding assessment) where offering navigation away
// from an active, monitored attempt would undermine the whole point of locking it down.
function Protected({ roles, children, noChrome = false }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return (
    <>
      {!noChrome && <Sidebar role={user.role} />}
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
  return <Navigate to={HOME_BY_ROLE[user.role] || "/login"} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
    <ConfirmProvider>
    <SidebarUIProvider>
    <AuthProvider>
      <GamificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/change-password" element={<ForceChangePassword />} />
          <Route path="/interview/verify/:code" element={<InterviewVerify />} />
          <Route path="/learning/certificate/verify/:code" element={<CourseCertificateVerify />} />
          <Route path="/certificate/verify/:code" element={<CertificateVerify />} />
          <Route path="/account" element={<Protected><AccountSettings /></Protected>} />
          <Route path="/certificates" element={<Protected roles={["STUDENT"]}><MyCertificates /></Protected>} />
          <Route path="/attendance" element={<Protected roles={["STUDENT"]}><MyAttendance /></Protected>} />

          {/* Student */}
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
          <Route path="/challenges/daily" element={<Protected roles={["STUDENT"]}><DailyChallenge /></Protected>} />
          <Route path="/challenges/weekly" element={<Protected roles={["STUDENT"]}><WeeklyChallenge /></Protected>} />
          <Route path="/company-tests" element={<Protected roles={["STUDENT"]}><CompanyTests /></Protected>} />
          <Route path="/resume" element={<Protected roles={["STUDENT"]}><ResumeBuilder /></Protected>} />
          <Route path="/interview" element={<Protected roles={["STUDENT"]}><InterviewHub /></Protected>} />
          <Route path="/interview/companies" element={<Protected roles={["STUDENT"]}><InterviewCompanies /></Protected>} />
          <Route
            path="/interview/session/:id"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <Suspense fallback={<LoadingScreen />}>
                  <InterviewSession />
                </Suspense>
              </Protected>
            }
          />
          <Route path="/interview/report/:id" element={<Protected roles={["STUDENT"]}><InterviewReport /></Protected>} />
          <Route path="/interview/history" element={<Protected roles={["STUDENT"]}><InterviewHistory /></Protected>} />
          <Route path="/interview/leaderboard" element={<Protected roles={["STUDENT"]}><InterviewLeaderboard /></Protected>} />
          <Route path="/interview/progress" element={<Protected roles={["STUDENT"]}><Suspense fallback={<LoadingScreen />}><InterviewProgress /></Suspense></Protected>} />
          <Route path="/interview/certificate" element={<Protected roles={["STUDENT"]}><InterviewCertificate /></Protected>} />

          {/* Learning module — browsable by Student, Admin, and Staff (admin/staff preview content they manage) */}
          <Route path="/learning" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><LearningHub /></Protected>} />
          <Route path="/learning/:slug" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><CourseOverview /></Protected>} />
          <Route
            path="/learning/:slug/lesson/:lessonId"
            element={
              <Protected roles={["STUDENT", "ADMIN", "STAFF"]}>
                <Suspense fallback={<LoadingScreen label="Loading lesson…" />}>
                  <LessonView />
                </Suspense>
              </Protected>
            }
          />
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
          <Route path="/staff/interview-drafts" element={<Protected roles={["ADMIN", "STAFF"]}><InterviewDraftReview /></Protected>} />
          <Route path="/staff/challenges" element={<Protected roles={["ADMIN", "STAFF"]}><ChallengeAdmin /></Protected>} />
          <Route path="/staff/interview-reports" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><InterviewReports /></Suspense></Protected>} />
          <Route path="/staff/interview-reports/:sessionId" element={<Protected roles={["ADMIN", "STAFF"]}><InterviewReportDetail /></Protected>} />
          <Route path="/staff/questions" element={<Protected roles={["ADMIN", "STAFF"]}><QuestionBank /></Protected>} />
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
          <Route path="/staff/exports" element={<Protected roles={["ADMIN", "STAFF"]}><ExportCenter basePath="/staff" /></Protected>} />
          <Route path="/staff/attendance" element={<Protected roles={["ADMIN", "STAFF"]}><AttendanceHome /></Protected>} />
          <Route path="/staff/attendance/reports" element={<Protected roles={["ADMIN", "STAFF"]}><AttendanceReports /></Protected>} />
          <Route path="/staff/attendance/:assignmentId" element={<Protected roles={["ADMIN", "STAFF"]}><AttendanceAssignmentDetail /></Protected>} />
          <Route path="/staff/attendance/:assignmentId/execute/:planId" element={<Protected roles={["ADMIN", "STAFF"]}><ExecuteAttendance /></Protected>} />

          {/* Admin only: account management */}
          <Route path="/admin" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><AdminDashboard /></Suspense></Protected>} />
          <Route path="/admin/bulk-upload" element={<Protected roles={["ADMIN"]}><BulkUpload /></Protected>} />
          <Route path="/admin/academic-groups" element={<Protected roles={["ADMIN"]}><AcademicGroups /></Protected>} />
          <Route path="/admin/institutes" element={<Protected roles={["ADMIN"]}><InstituteManagement /></Protected>} />
          <Route path="/admin/attendance-structure" element={<Protected roles={["ADMIN"]}><AttendanceStructure /></Protected>} />
          <Route path="/admin/email-logs" element={<Protected roles={["ADMIN"]}><EmailLogs /></Protected>} />
          <Route path="/admin/question-audit" element={<Protected roles={["ADMIN"]}><QuestionAudit /></Protected>} />
          <Route path="/admin/password-reset-history" element={<Protected roles={["ADMIN"]}><PasswordResetHistory basePath="/admin" /></Protected>} />
          <Route path="/admin/audit-log" element={<Protected roles={["ADMIN"]}><AuditLogPage basePath="/admin" /></Protected>} />
          <Route path="/admin/certificates" element={<Protected roles={["ADMIN"]}><CertificateAdmin basePath="/admin" /></Protected>} />
          <Route path="/admin/backups" element={<Protected roles={["ADMIN"]}><Backups /></Protected>} />
          <Route path="/admin/exports" element={<Protected roles={["ADMIN"]}><ExportCenter basePath="/admin" /></Protected>} />
          <Route path="/admin/monitoring" element={<Protected roles={["ADMIN"]}><SystemMonitoring /></Protected>} />
          <Route path="/admin/students" element={<Protected roles={["ADMIN"]}><StudentSearch basePath="/admin" /></Protected>} />
          <Route path="/admin/students/:id" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><StudentPerformance basePath="/admin" /></Suspense></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </GamificationProvider>
    </AuthProvider>
    </SidebarUIProvider>
    </ConfirmProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}
