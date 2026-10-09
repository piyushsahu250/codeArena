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
import FullscreenExitNotice from "./components/FullscreenExitNotice";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
const About = lazy(() => import("./pages/marketing/About"));
const Contact = lazy(() => import("./pages/marketing/Contact"));
const Privacy = lazy(() => import("./pages/marketing/Privacy"));
const Terms = lazy(() => import("./pages/marketing/Terms"));
const ForInstitutions = lazy(() => import("./pages/marketing/ForInstitutions"));
const Features = lazy(() => import("./pages/marketing/Features"));
const CodingPlatform = lazy(() => import("./pages/marketing/CodingPlatform"));
const OnlineAssessment = lazy(() => import("./pages/marketing/OnlineAssessment"));
const Lms = lazy(() => import("./pages/marketing/Lms"));
const EmployabilityReadinessMkt = lazy(() => import("./pages/marketing/EmployabilityReadiness"));
const AiMockInterview = lazy(() => import("./pages/marketing/AiMockInterview"));
const CodingChallengesMkt = lazy(() => import("./pages/marketing/CodingChallenges"));
import Login from "./pages/Login";
import Register from "./pages/Register";
import StudentDashboard from "./pages/StudentDashboard";
const StudentTestResult = lazy(() => import("./pages/StudentTestResult"));

// Lazy-loaded: pulls in @tensorflow/tfjs + blazeface for face detection, which is only
// needed once a student actually opens a test — bundling it eagerly would add that weight
// to every page load for every user (login, admin, staff included).
const TestTaking = lazy(() => import("./pages/TestTaking"));
// Lazy-loaded: pulls in Monaco (code editor), only needed for coding practice questions.
const LessonView = lazy(() => import("./pages/LessonView"));
const InterviewSession = lazy(() => import("./pages/InterviewSession"));
// AI Voice Interview module (separate from the InterviewSession above — different backend
// tables/engine, feature key ai_voice_interview). Lazy-loaded: pulls in the Web Audio capture code
// only needed once a student actually starts a voice interview.
const AiInterviewSession = lazy(() => import("./pages/AiInterviewSession"));
const ReadinessAssessment = lazy(() => import("./pages/ReadinessAssessment"));
const ModuleCodingAssessment = lazy(() => import("./pages/ModuleCodingAssessment"));
const ProjectView = lazy(() => import("./pages/ProjectView"));
// Lazy-loaded: these pull in recharts, which every student/login/account-settings page load was
// previously downloading regardless of whether that user ever visits a chart-bearing page.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminHome = lazy(() => import("./pages/command/AdminHome"));
const InstituteCommand = lazy(() => import("./pages/command/InstituteCommand"));
const StaffHome = lazy(() => import("./pages/command/StaffHome"));
const ClerkHome = lazy(() => import("./pages/command/ClerkHome"));
const StaffDashboard = lazy(() => import("./pages/StaffDashboard"));
const StudentPerformance = lazy(() => import("./pages/StudentPerformance"));
const InterviewProgress = lazy(() => import("./pages/InterviewProgress"));
const InterviewReports = lazy(() => import("./pages/InterviewReports"));
const ReadinessAnalytics = lazy(() => import("./pages/ReadinessAnalytics"));
const CreateQuestion = lazy(() => import("./pages/CreateQuestion"));
const QuestionBank = lazy(() => import("./pages/QuestionBank"));
const ReadinessSubjects = lazy(() => import("./pages/ReadinessSubjects"));
const CreateTest = lazy(() => import("./pages/CreateTest"));
const TestResults = lazy(() => import("./pages/TestResults"));
const TestPreview = lazy(() => import("./pages/TestPreview"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const BulkUpload = lazy(() => import("./pages/BulkUpload"));
const AcademicGroups = lazy(() => import("./pages/AcademicGroups"));
const CourseAssignments = lazy(() => import("./pages/CourseAssignments"));
const InstituteManagement = lazy(() => import("./pages/InstituteManagement"));
const OnboardInstitute = lazy(() => import("./pages/OnboardInstitute"));
const FeatureManagement = lazy(() => import("./pages/FeatureManagement"));
const AttendanceStructure = lazy(() => import("./pages/AttendanceStructure"));
const AttendanceHome = lazy(() => import("./pages/AttendanceHome"));
const AttendanceAssignmentDetail = lazy(() => import("./pages/AttendanceAssignmentDetail"));
const ExecuteAttendance = lazy(() => import("./pages/ExecuteAttendance"));
const AttendanceReports = lazy(() => import("./pages/AttendanceReports"));
const MyAttendance = lazy(() => import("./pages/MyAttendance"));
const TalentPools = lazy(() => import("./pages/TalentPools"));
const MyTalentPools = lazy(() => import("./pages/MyTalentPools"));
const ResultManagement = lazy(() => import("./pages/ResultManagement"));
const StaffClerkManagement = lazy(() => import("./pages/StaffClerkManagement"));
const StaffClerkProfile = lazy(() => import("./pages/StaffClerkProfile"));
const MyResults = lazy(() => import("./pages/MyResults"));
const MarksheetView = lazy(() => import("./pages/MarksheetView"));
const MarksheetVerify = lazy(() => import("./pages/MarksheetVerify"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const ForceChangePassword = lazy(() => import("./pages/ForceChangePassword"));
const StudentSearch = lazy(() => import("./pages/StudentSearch"));
const RollNumberConflicts = lazy(() => import("./pages/RollNumberConflicts"));
const LearningHub = lazy(() => import("./pages/LearningHub"));
const MyNotes = lazy(() => import("./pages/MyNotes"));
const CourseOverview = lazy(() => import("./pages/CourseOverview"));
const PracticeCourse = lazy(() => import("./pages/PracticeCourse"));
const CourseCertificate = lazy(() => import("./pages/CourseCertificate"));
const CourseCertificateVerify = lazy(() => import("./pages/CourseCertificateVerify"));
const LearningManagement = lazy(() => import("./pages/LearningManagement"));
const ExamSecurityMonitor = lazy(() => import("./pages/ExamSecurityMonitor"));
const TestSecurityMonitor = lazy(() => import("./pages/TestSecurityMonitor"));
const SecureDevices = lazy(() => import("./pages/SecureDevices"));
const Achievements = lazy(() => import("./pages/Achievements"));
const GamificationManagement = lazy(() => import("./pages/GamificationManagement"));
const ResumeBuilder = lazy(() => import("./pages/ResumeBuilder"));
const MyPortfolio = lazy(() => import("./pages/MyPortfolio"));
const SkillGraph = lazy(() => import("./pages/SkillGraph"));
const ResumeAdmin = lazy(() => import("./pages/ResumeAdmin"));
const InterviewHub = lazy(() => import("./pages/InterviewHub"));
const AiInterviewSetup = lazy(() => import("./pages/AiInterviewSetup"));
const AiInterviewReport = lazy(() => import("./pages/AiInterviewReport"));
const ReadinessHub = lazy(() => import("./pages/ReadinessHub")); // pulls recharts -- lazy so it is not in every first load
const ReadinessReport = lazy(() => import("./pages/ReadinessReport"));
const InterviewReport = lazy(() => import("./pages/InterviewReport"));
const InterviewHistory = lazy(() => import("./pages/InterviewHistory"));
const InterviewLeaderboard = lazy(() => import("./pages/InterviewLeaderboard"));
const InterviewCertificate = lazy(() => import("./pages/InterviewCertificate"));
const InterviewVerify = lazy(() => import("./pages/InterviewVerify"));
const InterviewAdmin = lazy(() => import("./pages/InterviewAdmin"));
const InterviewDraftReview = lazy(() => import("./pages/InterviewDraftReview"));
const InterviewCompanies = lazy(() => import("./pages/InterviewCompanies"));
const ChallengeAdmin = lazy(() => import("./pages/ChallengeAdmin"));
const DailyChallenge = lazy(() => import("./pages/DailyChallenge")); // pulls Monaco
const WeeklyChallenge = lazy(() => import("./pages/WeeklyChallenge")); // pulls Monaco
const CompanyTests = lazy(() => import("./pages/CompanyTests"));
const InterviewReportDetail = lazy(() => import("./pages/InterviewReportDetail"));
const EmailLogs = lazy(() => import("./pages/EmailLogs"));
const QuestionAudit = lazy(() => import("./pages/QuestionAudit"));
const PasswordResetHistory = lazy(() => import("./pages/PasswordResetHistory"));
const SystemMonitoring = lazy(() => import("./pages/SystemMonitoring"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const MyCertificates = lazy(() => import("./pages/MyCertificates"));
const CertificateVerify = lazy(() => import("./pages/CertificateVerify"));
const CertificateAdmin = lazy(() => import("./pages/CertificateAdmin"));
const Backups = lazy(() => import("./pages/Backups"));
const ExportCenter = lazy(() => import("./pages/ExportCenter"));
const StudentProfile = lazy(() => import("./pages/StudentProfile"));
const ClerkDashboard = lazy(() => import("./pages/ClerkDashboard")); // pulls recharts
const CompanyMaster = lazy(() => import("./pages/CompanyMaster"));
const IssueReports = lazy(() => import("./pages/IssueReports"));
const PlatformHealth = lazy(() => import("./pages/PlatformHealth"));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard"));
const Announcements = lazy(() => import("./pages/Announcements"));

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
  // Bug fixed 2026-09-08: reported as "Weekly Challenge shows a white screen when signed in as
  // Super Admin" -- /challenges/weekly is <Protected roles={["STUDENT"]}>, so a non-student role
  // was never meant to render it at all. This branch used to silently chain two `replace`
  // navigations in the same pass (here to "/", then Home() immediately to HOME_BY_ROLE[user.role])
  // with nothing visible in between -- on a role this route was never going to admit, that reads
  // exactly like the reported symptom even though the destination it eventually lands on (the
  // user's own dashboard) is correct. Same "never leave a gap with nothing informative in it"
  // principle as FeatureProtected's loading-state fix just above it in this same investigation --
  // shows a clear, immediate message and a real link out instead of an invisible hop through
  // another route entirely. This is a UX improvement everywhere Protected's role check fails, not
  // special-cased to this one route.
  if (!roleSatisfied) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16 }}>This page isn't available for your account type.</p>
          <a href={HOME_BY_ROLE[user.role] || "/"} className="btn btn-primary" style={{ marginTop: 16, display: "inline-block" }}>
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }
  return (
    <>
      {/* Keyboard users otherwise must Tab through the entire sidebar (up to 25+ links for
          ADMIN) on every single page before reaching content — this is the very first
          focusable element on any authenticated page, hidden until Tab reaches it (see
          .ca-skip-link, theme.css). Rendered even when noChrome hides the sidebar itself, since
          #main-content below still exists either way and skipping "nothing" is harmless. */}
      <a href="#main-content" className="ca-skip-link">Skip to main content</a>
      {!noChrome && <Sidebar role={user.role} profileGateActive={profileGateActive(user)} />}
      {!noChrome && <ReportProblemWidget />}
      {/* Keyed by path so this remounts (and re-triggers the fade-in) on every navigation,
          instead of silently reusing the same DOM node with stale animation state. A real <main>
          landmark (was a plain <div>) so screen-reader users have a way to jump straight to page
          content and the skip link above has something to land on. */}
      <main id="main-content" key={location.pathname} className="ca-page-enter">
        {children}
      </main>
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
        <Suspense fallback={<LoadingScreen />}>
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
          <Route path="/challenges/daily" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="coding_challenge"><ErrorBoundary title="We hit a temporary problem" message="Unable to load the Daily Challenge. Reloading usually fixes this."><Suspense fallback={<LoadingScreen />}><DailyChallenge /></Suspense></ErrorBoundary></FeatureProtected></Protected>} />
          <Route path="/challenges/weekly" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="coding_challenge"><ErrorBoundary title="We hit a temporary problem" message="Unable to load the Weekly Challenge. Reloading usually fixes this."><Suspense fallback={<LoadingScreen />}><WeeklyChallenge /></Suspense></ErrorBoundary></FeatureProtected></Protected>} />
          <Route path="/company-tests" element={<Protected roles={["STUDENT"]}><CompanyTests /></Protected>} />
          <Route path="/resume" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="resume_builder" featureLabel="Resume Builder"><ResumeBuilder /></FeatureProtected></Protected>} />
          <Route path="/portfolio" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="resume_builder" featureLabel="Resume Builder"><MyPortfolio /></FeatureProtected></Protected>} />
          <Route path="/readiness" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="readiness_test"><Suspense fallback={<LoadingScreen />}><ReadinessHub /></Suspense></FeatureProtected></Protected>} />
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
          {/* AI Voice Interview — separate module from /interview above (different backend
              tables/engine, feature key ai_voice_interview). noChrome + ErrorBoundary on the live
              session route for the same reason /interview/session/:id has them: a long-lived,
              high-stakes screen shouldn't render inside the normal sidebar chrome, and a render
              crash mid-interview must degrade to a recoverable message, not a blank screen. */}
          <Route path="/ai-interview" element={<Protected roles={["STUDENT"]}><FeatureProtected featureKey="ai_voice_interview" featureLabel="AI Voice Interview"><AiInterviewSetup /></FeatureProtected></Protected>} />
          <Route
            path="/ai-interview/session/:id"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <ErrorBoundary title="We hit a temporary problem" message="Your interview progress up to your last answered question is saved. Reloading this page will let you reconnect.">
                  <Suspense fallback={<LoadingScreen />}>
                    <AiInterviewSession />
                  </Suspense>
                </ErrorBoundary>
              </Protected>
            }
          />
          <Route path="/ai-interview/report/:id" element={<Protected roles={["STUDENT"]}><AiInterviewReport /></Protected>} />

          {/* Learning module — browsable by Student, Admin, and Staff (admin/staff preview content they manage) */}
          <Route path="/learning" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><LearningHub /></FeatureProtected></Protected>} />
          <Route path="/learning/:slug/practice" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><PracticeCourse view="course" /></FeatureProtected></Protected>} />
          <Route path="/learning/:slug/practice/section/:sectionId" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><PracticeCourse view="section" /></FeatureProtected></Protected>} />
          <Route path="/learning/:slug/practice/topic/:topicId" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><PracticeCourse view="topic" /></FeatureProtected></Protected>} />
          <Route path="/learning/:slug/practice/analytics" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><PracticeCourse view="analytics" /></FeatureProtected></Protected>} />
          <Route path="/learning/:slug" element={<Protected roles={["STUDENT", "ADMIN", "STAFF"]}><FeatureProtected featureKey="lms"><CourseOverview /></FeatureProtected></Protected>} />
          <Route
            path="/learning/:slug/lesson/:lessonId"
            element={
              <Protected roles={["STUDENT", "ADMIN", "STAFF"]}>
                <FeatureProtected featureKey="lms">
                  <ErrorBoundary title="We hit a temporary problem" message="Unable to load this lesson. Reloading usually fixes this; if it keeps happening, tell your faculty.">
                  <Suspense fallback={<LoadingScreen label="Loading lesson…" />}>
                    <LessonView />
                  </Suspense>
                  </ErrorBoundary>
                </FeatureProtected>
              </Protected>
            }
          />
          <Route path="/learning/notes" element={<Protected roles={["STUDENT"]}><MyNotes /></Protected>} />
          <Route path="/learning/:slug/skill-graph" element={<Protected roles={["STUDENT"]}><SkillGraph /></Protected>} />
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
          <Route
            path="/learning/:slug/level/:levelId/coding-assessment"
            element={
              <Protected roles={["STUDENT"]} noChrome>
                <Suspense fallback={<LoadingScreen />}>
                  <ModuleCodingAssessment />
                </Suspense>
              </Protected>
            }
          />
          <Route
            path="/learning/:slug/module/:moduleId/project/:projectId"
            element={
              <Protected roles={["STUDENT"]}>
                <Suspense fallback={<LoadingScreen />}>
                  <ProjectView />
                </Suspense>
              </Protected>
            }
          />

          {/* Staff (and Admin, who can also manage tests/questions) */}
          <Route path="/staff" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><StaffHome /></Suspense></Protected>} />
          <Route path="/staff/tests" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><StaffDashboard /></Suspense></Protected>} />
          <Route path="/staff/learning" element={<Protected roles={["ADMIN", "STAFF"]}><LearningManagement /></Protected>} />
          <Route path="/staff/exam-security/:testId" element={<Protected roles={["ADMIN", "STAFF"]}><ExamSecurityMonitor /></Protected>} />
          <Route path="/staff/exam-security/test/:testId" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><TestSecurityMonitor /></Suspense></Protected>} />
          <Route path="/staff/exam-security/readiness/:testId" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><TestSecurityMonitor kind="readiness" /></Suspense></Protected>} />
          <Route path="/staff/exam-security/interviews" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><TestSecurityMonitor kind="interviews" /></Suspense></Protected>} />
          <Route path="/staff/exam-security/ai-interviews" element={<Protected roles={["ADMIN", "STAFF"]}><Suspense fallback={<LoadingScreen />}><TestSecurityMonitor kind="ai" /></Suspense></Protected>} />
          <Route path="/staff/secure-devices" element={<Protected roles={["ADMIN", "STAFF"]}><SecureDevices /></Protected>} />
          <Route path="/staff/gamification" element={<Protected roles={["ADMIN", "STAFF"]}><GamificationManagement /></Protected>} />
          <Route path="/staff/resumes" element={<Protected roles={["ADMIN", "STAFF"]}><ResumeAdmin /></Protected>} />
          <Route path="/staff/interviews" element={<Protected roles={["ADMIN", "STAFF"]}><InterviewAdmin /></Protected>} />
          <Route path="/staff/interview-drafts" element={<Protected roles={["ADMIN", "STAFF"]}><FeatureProtected featureKey="ai_draftview"><InterviewDraftReview /></FeatureProtected></Protected>} />
          <Route path="/staff/challenges" element={<Protected roles={["ADMIN", "STAFF"]}><ErrorBoundary title="We hit a temporary problem" message="Unable to load Coding Challenges. Reloading usually fixes this."><ChallengeAdmin /></ErrorBoundary></Protected>} />
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
          <Route path="/admin" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><AdminHome /></Suspense></Protected>} />
          <Route path="/admin/users" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><AdminDashboard /></Suspense></Protected>} />
          <Route path="/admin/institutes/:instituteId/overview" element={<Protected roles={["ADMIN"]}><Suspense fallback={<LoadingScreen />}><InstituteCommand /></Suspense></Protected>} />
          <Route path="/admin/bulk-upload" element={<Protected roles={["ADMIN"]}><BulkUpload /></Protected>} />
          <Route path="/admin/academic-groups" element={<Protected roles={["ADMIN"]}><AcademicGroups /></Protected>} />
          <Route path="/admin/course-assignments" element={<Protected roles={["ADMIN"]}><CourseAssignments /></Protected>} />
          <Route path="/admin/institutes" element={<Protected roles={["ADMIN"]}><InstituteManagement /></Protected>} />
          <Route path="/admin/institutes/onboard" element={<Protected roles={["ADMIN"]}><OnboardInstitute /></Protected>} />
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
          <Route path="/admin/announcements" element={<Protected roles={["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"]}><Announcements /></Protected>} />

          {/* Placement Clerk — always institute-scoped, Placement Cell operations only (no
              Learning/Test Management access — those routes above simply never list CLERK). */}
          <Route path="/clerk" element={<Protected roles={["CLERK"]}><Suspense fallback={<LoadingScreen />}><ClerkHome /></Suspense></Protected>} />
          <Route path="/clerk/placement-analytics" element={<Protected roles={["CLERK"]}><Suspense fallback={<LoadingScreen />}><ClerkDashboard /></Suspense></Protected>} />
          <Route path="/clerk/students" element={<Protected roles={["CLERK"]}><StudentSearch basePath="/clerk" /></Protected>} />
          <Route path="/clerk/students/:id" element={<Protected roles={["CLERK"]}><Suspense fallback={<LoadingScreen />}><StudentPerformance basePath="/clerk" /></Suspense></Protected>} />
          <Route path="/clerk/companies" element={<Protected roles={["CLERK"]}><CompanyMaster /></Protected>} />
          <Route path="/clerk/results" element={<Protected roles={["CLERK"]}><ResultManagement /></Protected>} />
          <Route path="/clerk/audit-log" element={<Protected roles={["CLERK"]}><AuditLogPage basePath="/clerk" /></Protected>} />
          <Route path="/clerk/exports" element={<Protected roles={["CLERK"]}><FeatureProtected featureKey="export_center"><ExportCenter basePath="/clerk" /></FeatureProtected></Protected>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        <FullscreenExitNotice />
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
