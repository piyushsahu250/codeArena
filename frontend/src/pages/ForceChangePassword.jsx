import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import ChalkUnderline from "../components/ChalkUnderline";

const HOME_BY_ROLE = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin", CLERK: "/clerk" };

export default function ForceChangePassword() {
  const { user, login } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) return setError("New password and confirmation don't match");
    if (newPassword.length < 6) return setError("New password must be at least 6 characters");

    setSaving(true);
    try {
      const { data } = await api.patch("/users/me", { currentPassword, newPassword });
      login(data.token, data.user);
      navigate(HOME_BY_ROLE[data.user.role] || "/login", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 32 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 400 }}>
        <h2 style={{ fontSize: 26, color: "var(--ink)" }}>Set a new password</h2>
        <ChalkUnderline width={120} />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, marginBottom: 24, fontSize: 14 }}>
          Hi {user?.name}, this account was created by an administrator with a temporary password. Please set a new
          password before continuing.
        </p>

        <label style={labelStyle}>Temporary password</label>
        <input style={inputStyle} type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="The password you just signed in with" />

        <label style={labelStyle}>New password</label>
        <input style={inputStyle} type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />

        <label style={labelStyle}>Confirm new password</label>
        <input style={inputStyle} type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}

        <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "12px 0" }} disabled={saving}>
          {saving ? "Saving…" : "Set new password & continue"}
        </button>
      </form>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6, color: "var(--ink)" };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
