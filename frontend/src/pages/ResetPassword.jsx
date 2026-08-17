import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import api from "../api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) return setError("Passwords don't match");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword });
      // The backend now revokes every session on this account the moment the reset succeeds, but
      // if this same browser happened to still be holding a token/user from an earlier login on
      // this account (e.g. the student reset their password in a second tab while still logged in
      // on the first), that stale token would otherwise linger in localStorage doing nothing
      // useful until the next request 401s it out — clear it up front instead so this device
      // genuinely requires the new password on its very next login, same as every other device.
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px", minHeight: "100vh", background: "var(--paper)" }}>
        <div style={{ maxWidth: 380 }}>
          <p>This reset link is missing its token. Request a new one from the <Link to="/forgot-password" style={{ color: "var(--amber-dark)", fontWeight: 600 }}>forgot password</Link> page.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px", minHeight: "100vh", background: "var(--paper)" }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 380 }}>
        <h2>Reset your password</h2>

        {success ? (
          <p style={{ color: "var(--mint)", fontSize: 14, marginTop: 12 }}>Password reset successfully. Please log in with your new password — you'll need to sign in again on any other devices too.</p>
        ) : (
          <>
            <label style={labelStyle}>New password</label>
            <input style={inputStyle} type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />

            <label style={labelStyle}>Confirm new password</label>
            <input style={inputStyle} type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />

            {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}

            <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "12px 0" }} disabled={loading}>
              {loading ? "Saving…" : "Reset password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
