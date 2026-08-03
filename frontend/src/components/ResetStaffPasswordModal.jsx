import { useState } from "react";
import api from "../api";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

// Reusable Reset Password flow for the Staff & Clerk Management Dashboard — used from both the
// directory list (StaffClerkManagement.jsx) and the profile detail view (StaffClerkProfile.jsx),
// so the confirm→reset→reveal-once→copy flow only exists in one place. Hits the same
// POST /users/:id/reset-password route the Student reset flow already uses (StudentPerformance.jsx),
// extended here with an optional admin-entered custom temporary password.
export default function ResetStaffPasswordModal({ userId, userName, onClose, onDone }) {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [mode, setMode] = useState("auto"); // "auto" | "custom"
  const [customPassword, setCustomPassword] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState(null); // { password, emailSent, emailError }
  const [copied, setCopied] = useState(false);

  async function handleReset(e) {
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Reset Password",
      message: `Are you sure you want to reset this user's password? The user will be required to create a new password during the next login.${sendEmail ? " They will also be emailed the temporary password directly." : ""}`,
      confirmLabel: "Reset Password",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const { data } = await api.post(`/users/${userId}/reset-password`, {
        customPassword: mode === "custom" ? customPassword.trim() : undefined,
        sendEmail,
      });
      setResult({ password: data.defaultPassword, emailSent: data.emailSent, emailError: data.emailError });
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset password");
    } finally {
      setResetting(false);
    }
  }

  function copyCredential() {
    navigator.clipboard.writeText(`Password: ${result.password}\nLogin: ${window.location.origin}/login`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Reset Password{userName ? ` — ${userName}` : ""}</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        {result ? (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
              New temporary password (shown once — the user must change it on their next login):
            </p>
            <div className="mono card" style={{ padding: 12, fontSize: 15, fontWeight: 700, textAlign: "center" }}>{result.password}</div>
            <p style={{ fontSize: 12, marginTop: 8, color: result.emailSent === false ? "var(--rust)" : "var(--ink-dim)" }}>
              {result.emailSent === true && "Emailed to the user successfully."}
              {result.emailSent === false && `Email delivery failed${result.emailError ? `: ${result.emailError}` : "."}`}
              {result.emailSent === null && "Not emailed (share this password with the user directly)."}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={copyCredential}>
              {copied ? "Copied ✓" : "Copy Password"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleReset} style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={mode === "auto"} onChange={() => setMode("auto")} />
                Auto-generate a secure password
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
                Enter a custom temporary password
              </label>
            </div>
            {mode === "custom" && (
              <input
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, marginTop: 10 }}
                type="text"
                required
                minLength={8}
                placeholder="Temporary password"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
              />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 14 }}>
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Email the temporary password to the user
            </label>
            <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={resetting || (mode === "custom" && !customPassword.trim())}>
              {resetting ? "Resetting…" : "Reset Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
