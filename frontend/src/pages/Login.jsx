import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  // Set by api.js's response interceptor when it force-redirects here after a dead
  // token/session (expired JWT, forced logout elsewhere, revoked single-session login) — tells
  // the student/staff/admin why they landed back on this page instead of leaving them guessing.
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      login(data.token, data.user);
      if (data.user.mustChangePassword) {
        navigate("/change-password");
        return;
      }
      // SUPER_ADMIN lands on the same platform-wide dashboard ADMIN always has — it's a rename of
      // that same platform-level capability, not a new destination. INSTITUTE_ADMIN doesn't have
      // a dedicated dashboard yet either, so it lands there too for now (still institute-scoped by
      // the backend regardless of which page it renders).
      const homeByRole = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin", CLERK: "/clerk", SUPER_ADMIN: "/admin", INSTITUTE_ADMIN: "/admin" };
      navigate(homeByRole[data.user.role] || "/login");
    } catch (err) {
      // err.response only exists if the server actually answered (even with an error status) --
      // no response at all means the request never reached the backend (network failure, DNS
      // failure, connection refused, timeout). That's a platform-down situation, not a login
      // mistake, so it gets an honest maintenance message instead of the generic fallback, which
      // previously read as "Login failed" and looked exactly like a wrong password to a student
      // with perfectly correct credentials.
      if (!err.response) {
        setError("CodeArena is temporarily unavailable. We're working on it — please try again in a few minutes.");
      } else {
        setError(err.response.data?.error || "Login failed");
      }
    } finally {
      setLoading(false);
    }
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
        <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 360 }}>
          <h2 style={{ fontSize: 26, color: "var(--ink)" }}>Sign in</h2>
          <p style={{ color: "var(--ink-dim)", marginTop: -4, marginBottom: 24, fontSize: 14 }}>
            Use your university email to continue.
          </p>

          {sessionExpired && (
            <p style={{ color: "var(--amber-dark)", fontSize: 13, marginTop: 4, marginBottom: 8 }}>
              Your session expired or was signed out elsewhere — please sign in again.
            </p>
          )}

          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@codearena.edu.in"
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label style={{ ...labelStyle, marginTop: 14 }}>Password</label>
            <Link to="/forgot-password" style={{ fontSize: 12, color: "var(--amber-dark)", fontWeight: 600 }}>
              Forgot password?
            </Link>
          </div>
          <input
            style={inputStyle}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          {error && (
            <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 4 }}>{error}</p>
          )}

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "12px 0" }} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p style={{ marginTop: 20, fontSize: 14, color: "var(--ink-dim)" }}>
            Don't have an account? Contact your admin to get one created.
          </p>
          <p style={{ marginTop: 32, fontSize: 12, color: "var(--ink-dim)", opacity: 0.75, textAlign: "center" }}>
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
