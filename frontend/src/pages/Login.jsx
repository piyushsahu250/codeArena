import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Award, Code2, Mic, ShieldCheck } from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import PasswordRequirements from "../components/PasswordRequirements";
import { passwordMeetsPolicy } from "../utils/passwordPolicy";
import { consumeReturnTo } from "../utils/returnTo";
import {
  MATCH_MESSAGE, MISMATCH_MESSAGE, NOT_CHANGED_MESSAGE, SIGN_IN_AGAIN_MESSAGE, SUCCESS_MESSAGE,
  canSubmitPasswordChange, changeIntro, confirmStatus, currentPasswordLabel, describeChangeFailure, describeLoginFailure, normalizeReason,
} from "../utils/firstLogin";
import "./login.css";

// SUPER_ADMIN lands on the same platform-wide dashboard ADMIN always has — it's a rename of
// that same platform-level capability, not a new destination. INSTITUTE_ADMIN doesn't have
// a dedicated dashboard yet either, so it lands there too for now (still institute-scoped by
// the backend regardless of which page it renders).
const HOME_BY_ROLE = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin", CLERK: "/clerk", SUPER_ADMIN: "/admin", INSTITUTE_ADMIN: "/admin" };

// What the platform does, one line each, shown beside the sign-in form. Every line describes something the platform really has (coding tests judged automatically, proctored exams,
// the AI mock interview, courses with verifiable certificates); nothing here is a number or a promise that could go out of date.
const HIGHLIGHTS = [
  { icon: Code2, title: "Coding assessments", text: "Write, run and submit code in the browser, with automated judging." },
  { icon: ShieldCheck, title: "Secure examinations", text: "Proctored tests with fullscreen, camera checks and server-side timing." },
  { icon: Mic, title: "AI mock interviews", text: "Practise HR and technical interviews by voice or text, and get detailed feedback." },
  { icon: Award, title: "Learning and certificates", text: "Complete courses and earn certificates that anyone can verify online." },
];

// One page, two steps, ONE form element. Step "signin" is the long-standing sign-in. When the server answers a correct email and password with "this account must choose a new
// password first" (an administrator-issued temporary password, or one past the institute's expiry window) the page stays where it is and the same form gains the new-password
// fields (step "create"). The server decides that, on every request: nothing here can skip it, because until the password has been changed the server issues no session at all.
// The inputs for the email and the current password are the same elements in both steps, and the form is never swapped for another, so a browser's password manager sees one
// username / current-password / new-password form instead of a sign-in that "succeeded" followed by an unrelated one.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); // the sign-in password; on the second step the same field holds the temporary password
  const [step, setStep] = useState("signin");
  const [reason, setReason] = useState("TEMPORARY_PASSWORD");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(false);
  const busy = useRef(false); // set synchronously, so a double click cannot start a second request before the next render disables the button
  const passwordInput = useRef(null);
  const focusNewPassword = useRef(false); // set just before the new-password field is first shown, which then takes focus as it mounts
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  // Set by api.js's response interceptor when it force-redirects here after a dead
  // token/session (expired JWT, forced logout elsewhere, revoked single-session login) — tells
  // the student/staff/admin why they landed back on this page instead of leaving them guessing.
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";
  const registrationNotice = searchParams.get("notice") === "registration";
  const creating = step === "create";

  const canSubmit = !creating || canSubmitPasswordChange({ email, temporaryPassword: password, newPassword, confirmPassword });
  const match = confirmStatus(newPassword, confirmPassword);

  function finishSignIn(data) {
    login(data.token, data.user);
    // A server that still issues a session to an account that must change its password (the page was deployed before the server) is handled the way it always was.
    if (data.user.mustChangePassword) {
      navigate("/change-password");
      return;
    }
    // After an expired session, go back to the page they were on (same account only; see utils/returnTo.js), otherwise to their home page.
    navigate(consumeReturnTo(data.user.id) || HOME_BY_ROLE[data.user.role] || "/login");
  }

  function backToSignIn(message = "") {
    setStep("signin");
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPasswords(false);
    setError("");
    setNotice(message);
    setAnnouncement(message);
    passwordInput.current?.focus(); // the same input element in both steps, so it can take focus right away
  }

  async function signIn() {
    busy.current = true;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.passwordChangeRequired) {
        const why = normalizeReason(data.reason);
        setReason(why);
        focusNewPassword.current = true;
        setStep("create");
        setAnnouncement(`${changeIntro(why)} Enter and confirm your new password.`);
        return;
      }
      finishSignIn(data);
    } catch (err) {
      // No response at all means the request never reached the backend: a platform-down situation, not a login mistake, so it gets an honest maintenance message instead of
      // the generic fallback, which once read as "Login failed" and looked exactly like a wrong password to a student with perfectly correct credentials.
      setError(describeLoginFailure(err));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  // After a request that got no usable answer the change may still have gone through, so the new password is tried once before the student is told it failed.
  // "signed-in" (it had), "not-changed" (the server answered and refused the new password), or "unknown" (still no answer).
  async function trySigningInWithNewPassword() {
    try {
      const { data } = await api.post("/auth/login", { email, password: newPassword }, { timeout: 15000 });
      if (data && data.token && data.user && !data.passwordChangeRequired) {
        toast.success(SUCCESS_MESSAGE);
        finishSignIn(data);
        return "signed-in";
      }
      return "not-changed";
    } catch (err) {
      return err && err.response && err.response.status === 401 ? "not-changed" : "unknown";
    }
  }

  async function changePassword() {
    if (!canSubmitPasswordChange({ email, temporaryPassword: password, newPassword, confirmPassword })) return;
    busy.current = true;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/change-temporary-password", { email, temporaryPassword: password, newPassword, confirmPassword });
      if (data && data.token && data.user) {
        toast.success(SUCCESS_MESSAGE);
        finishSignIn(data);
      } else {
        // The password WAS changed, but the server could not open a session for it: say so, and ask for the new password on the sign-in step.
        backToSignIn(SIGN_IN_AGAIN_MESSAGE);
      }
    } catch (err) {
      const failure = describeChangeFailure(err);
      if (failure.kind === "network" || failure.kind === "server") {
        const outcome = await trySigningInWithNewPassword();
        if (outcome === "signed-in") return;
        setError(outcome === "not-changed" ? NOT_CHANGED_MESSAGE : failure.message);
      } else {
        setError(failure.message);
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (busy.current) return;
    if (creating) changePassword();
    else signIn();
  }

  return (
    <div className="ca-login-grid">
      {/* Blackboard panel */}
      <div className="ca-login-brand">
        <div className="ca-login-brand-inner">
          <div className="ca-login-logo">
            <img src="/branding/logo.png" alt="CodeArena" />
          </div>
          <p className="ca-login-tagline">Empowering Talent Through Smart Coding Assessments.</p>
          <ul className="ca-login-points" aria-label="What CodeArena offers">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="ca-login-point-icon" aria-hidden="true"><Icon size={18} /></span>
                <span><strong>{title}</strong><span className="ca-login-point-text">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Form panel */}
      <div className="ca-login-formpane">
        <form onSubmit={handleSubmit} className="ca-login-card" aria-busy={loading}>
          <h1 style={{ fontSize: 26, color: "var(--ink)" }}>Sign in</h1>
          {creating ? (
            <p className="ca-login-callout" id="login-intro">{changeIntro(reason)}</p>
          ) : (
            <p className="ca-login-sub">
              Sign in with the email address your institute registered for you.
            </p>
          )}
          {/* Heard by screen readers when the step changes or the password was changed without a session; the visible text above is not a live region on purpose. */}
          <div className="ca-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

          {registrationNotice && !creating && (
            <p role="status" data-testid="registration-notice" style={{ color: "var(--ink)", fontSize: 13, marginTop: 4, marginBottom: 8 }}>
              Accounts are created by your institute administrator. Ask them for your login credentials, then sign in here.
            </p>
          )}

          {sessionExpired && !creating && (
            <p style={{ color: "var(--warning-text)", fontSize: 13, marginTop: 4, marginBottom: 8 }}>
              Your session expired or was signed out elsewhere — please sign in again.
            </p>
          )}

          <label style={labelStyle} htmlFor="login-email">{creating ? "Email Address" : "Email"}</label>
          <input
            id="login-email"
            name="username"
            className={creating ? "ca-login-readonly" : undefined}
            style={inputStyle}
            type="email"
            autoComplete="username"
            required
            readOnly={creating}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your registered email address"
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="login-password">{creating ? currentPasswordLabel(reason) : "Password"}</label>
            {!creating && (
              <Link to="/forgot-password" className="ca-tap-link" style={{ fontSize: 12, color: "var(--warning-text)", fontWeight: 600 }}>
                Forgot password?
              </Link>
            )}
          </div>
          <input
            id="login-password"
            name="password"
            ref={passwordInput}
            style={inputStyle}
            type={showPasswords ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={creating ? undefined : "Your password"}
          />
          {/* A checkbox, not a button: the sign-in button stays the first button in the form, and the second step keeps its own "Show passwords" below. */}
          {!creating && (
            <label className="ca-pw-show ca-pw-show-signin">
              <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
              Show password
            </label>
          )}

          {creating && (
            <>
              <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="login-new-password">New Password</label>
              <input
                id="login-new-password"
                name="new-password"
                ref={(node) => {
                  if (node && focusNewPassword.current) {
                    focusNewPassword.current = false;
                    node.focus();
                  }
                }}
                style={inputStyle}
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-describedby="login-password-rules"
                aria-invalid={newPassword !== "" && !passwordMeetsPolicy(newPassword) ? "true" : undefined}
              />
              <PasswordRequirements id="login-password-rules" password={newPassword} />

              <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="login-confirm-password">Confirm New Password</label>
              <input
                id="login-confirm-password"
                name="confirm-password"
                style={inputStyle}
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-describedby="login-confirm-status"
                aria-invalid={match === "mismatch" ? "true" : undefined}
              />
              {/* A live region that is always present, so a change in its text is announced. Empty (and silent) until the confirmation field has something in it. */}
              <p id="login-confirm-status" className={`ca-pw-status ${match || ""}`} role="status">
                {match && <span aria-hidden="true">{match === "match" ? "✓" : "✕"}</span>}
                {match === "match" ? MATCH_MESSAGE : match === "mismatch" ? MISMATCH_MESSAGE : ""}
              </p>

              <label className="ca-pw-show">
                <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
                Show passwords
              </label>
            </>
          )}

          {error && <p className="ca-login-error" role="alert">{error}</p>}
          {notice && <p className="ca-login-notice">{notice}</p>}

          <button className="btn btn-primary ca-login-submit" disabled={loading || !canSubmit}>
            {creating ? (loading ? "Changing password…" : "Change Password & Login") : loading ? "Signing in…" : "Sign in"}
          </button>
          {creating && (
            <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 10, padding: "10px 0" }} disabled={loading} onClick={() => backToSignIn()}>
              Back to sign in
            </button>
          )}

          <p className="ca-login-help">
            Don't have an account? Accounts are created by your institute administrator. Contact your admin to get one created.
          </p>
          {/* No opacity here: --ink-dim at 75% opacity measured about 3.1:1 on the light page (AA needs 4.5:1 for text this small); at full strength it is about 5.2:1 light and 7.0:1 dark. */}
          <p className="ca-login-powered">
            Powered by Acrosoft Webtech Solution Pvt. Ltd.
          </p>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6, color: "var(--ink)" };
const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 14,
  fontFamily: "var(--font-body)",
};
