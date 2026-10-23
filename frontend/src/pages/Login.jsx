import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import PasswordRequirements from "../components/PasswordRequirements";
import { passwordMeetsPolicy } from "../utils/passwordPolicy";
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
    navigate(HOME_BY_ROLE[data.user.role] || "/login");
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
      <div
        style={{
          background: "var(--slate-900)",
          color: "var(--chalk)",
          padding: "64px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ background: "#fdfbf5", borderRadius: 16, padding: "20px 28px", display: "inline-flex", alignItems: "center", maxWidth: 320 }}>
          <img src="/branding/logo.png" alt="CodeArena" style={{ width: "100%", height: "auto", display: "block" }} />
        </div>
        <p style={{ color: "var(--chalk-dim)", maxWidth: 420, marginTop: 24, lineHeight: 1.6, fontSize: 17 }}>
          Empowering Talent Through Smart Coding Assessments.
        </p>
      </div>

      {/* Form panel */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 360 }} aria-busy={loading}>
          <h2 style={{ fontSize: 26, color: "var(--ink)" }}>Sign in</h2>
          {creating ? (
            <p className="ca-login-callout" id="login-intro">{changeIntro(reason)}</p>
          ) : (
            <p style={{ color: "var(--ink-dim)", marginTop: -4, marginBottom: 24, fontSize: 14 }}>
              Use your university email to continue.
            </p>
          )}
          {/* Heard by screen readers when the step changes or the password was changed without a session; the visible text above is not a live region on purpose. */}
          <div className="ca-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

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
            placeholder="you@codearena.edu.in"
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="login-password">{creating ? currentPasswordLabel(reason) : "Password"}</label>
            {!creating && (
              <Link to="/forgot-password" style={{ fontSize: 12, color: "var(--warning-text)", fontWeight: 600 }}>
                Forgot password?
              </Link>
            )}
          </div>
          <input
            id="login-password"
            name="password"
            ref={passwordInput}
            style={inputStyle}
            type={creating && showPasswords ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={creating ? undefined : "••••••••"}
          />

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

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "12px 0" }} disabled={loading || !canSubmit}>
            {creating ? (loading ? "Changing password…" : "Change Password & Login") : loading ? "Signing in…" : "Sign in"}
          </button>
          {creating && (
            <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 10, padding: "10px 0" }} disabled={loading} onClick={() => backToSignIn()}>
              Back to sign in
            </button>
          )}

          <p style={{ marginTop: 20, fontSize: 14, color: "var(--ink-dim)" }}>
            Don't have an account? Contact your admin to get one created.
          </p>
          {/* No opacity here: --ink-dim at 75% opacity measured about 3.1:1 on the light page (AA needs 4.5:1 for text this small); at full strength it is about 5.2:1 light and 7.0:1 dark. */}
          <p style={{ marginTop: 32, fontSize: 12, color: "var(--ink-dim)", textAlign: "center" }}>
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
