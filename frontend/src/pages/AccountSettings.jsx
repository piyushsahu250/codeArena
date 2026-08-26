import { useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { Laptop, Smartphone, Tablet, LogOut } from "lucide-react";
import { isValidEmail, normalizeEmail } from "../utils/emailValidation";
import FileUpload from "../components/FileUpload";
import { compressImageToDataUrl } from "../utils/imageCompression";

const DEVICE_ICON = { Mobile: Smartphone, Tablet: Tablet, Desktop: Laptop };

export default function AccountSettings() {
  const { user, login, updateUser } = useAuth();
  // Name/mobile/photo/LinkedIn are STUDENT-editable from StudentProfile.jsx already (a richer page
  // with academic fields this page doesn't have) — this section is the equivalent for every other
  // role, which previously had no way at all to set a name, photo, phone, or LinkedIn on their own account.
  const isStudent = user.role === "STUDENT";
  const [profileName, setProfileName] = useState(user.name || "");
  const [profileMobile, setProfileMobile] = useState(user.mobile || "");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(user.profilePhotoUrl || "");
  const [profileLinkedin, setProfileLinkedin] = useState(user.linkedinUrl || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");

  async function saveProfile(e) {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess("");
    setProfileSaving(true);
    try {
      const { data } = await api.patch("/profile/me/account", {
        name: profileName, mobile: profileMobile, profilePhotoUrl, linkedinUrl: profileLinkedin,
      });
      updateUser({ name: data.user.name, mobile: data.user.mobile, profilePhotoUrl: data.user.profilePhotoUrl, linkedinUrl: data.user.linkedinUrl });
      setProfileSuccess("Profile updated.");
    } catch (err) {
      setProfileError(err.response?.data?.error || "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState(user.email);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const [sessions, setSessions] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [pendingEmail, setPendingEmail] = useState(user.pendingEmail || null);
  const [resending, setResending] = useState(false);

  async function resendVerification() {
    setResending(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post("/users/me/resend-verification");
      setSuccess(data.message);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to resend verification email");
    } finally {
      setResending(false);
    }
  }

  function loadSessions() {
    api.get("/users/me/sessions").then((res) => setSessions(res.data)).catch(() => setSessions([]));
  }
  useEffect(loadSessions, []);

  async function revokeSession(id) {
    setRevokingId(id);
    try {
      await api.delete(`/users/me/sessions/${id}`);
      loadSessions();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to sign out that session");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword && newPassword !== confirmPassword) {
      return setError("New password and confirmation don't match");
    }

    const normalizedEmail = normalizeEmail(newEmail);
    const payload = { currentPassword };
    if (normalizedEmail && normalizedEmail !== user.email) {
      if (!isValidEmail(normalizedEmail)) return setError("Please enter a valid email address");
      payload.newEmail = normalizedEmail;
    }
    if (newPassword) payload.newPassword = newPassword;

    if (!payload.newEmail && !payload.newPassword) {
      return setError("Change the email and/or password before saving");
    }

    setSaving(true);
    try {
      const { data } = await api.patch("/users/me", payload);
      login(data.token, data.user);
      // The backend never overwrites the live sign-in email immediately -- data.message explains
      // whether a verification link was sent to the new address (and that the old one stays
      // active until it's confirmed), so surface that instead of a generic "Account updated."
      setSuccess(data.message || "Account updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Always reflect the account's actual (still-current) email, not whatever was just typed --
      // a requested change stays pending/unverified, so the field shouldn't imply it's already live.
      setNewEmail(data.user.email);
      if (payload.newEmail) setPendingEmail(data.user.pendingEmail ?? payload.newEmail);
      loadSessions();
    } catch (err) {
      setError(err.response?.data?.error || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Account settings</h1>
        <ChalkUnderline />

        {!isStudent && (
          <>
            <h2 style={{ fontSize: 16, marginTop: 24 }}>Profile</h2>
            <form onSubmit={saveProfile} style={{ marginTop: 8 }}>
              <div style={{ maxWidth: 200 }}>
                <FileUpload
                  accept="image/png,image/jpeg,image/webp"
                  maxSizeMB={8}
                  imagePreview
                  existingPreviewUrl={profilePhotoUrl || null}
                  label="Upload a photo"
                  onFileSelected={async (file) => {
                    if (!file) { setProfilePhotoUrl(""); return; }
                    try {
                      setProfilePhotoUrl(await compressImageToDataUrl(file));
                    } catch {
                      setProfileError("Could not process that image. Please try a different file.");
                    }
                  }}
                />
              </div>

              <label style={labelStyle}>Full name</label>
              <input style={inputStyle} required value={profileName} onChange={(e) => setProfileName(e.target.value)} />

              <label style={labelStyle}>Mobile number</label>
              <input style={inputStyle} value={profileMobile} onChange={(e) => setProfileMobile(e.target.value)} placeholder="9876543210" />

              <label style={labelStyle}>LinkedIn profile URL</label>
              <input style={inputStyle} type="url" value={profileLinkedin} onChange={(e) => setProfileLinkedin(e.target.value)} placeholder="https://linkedin.com/in/yourname" />

              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
                Role: <span className="mono">{user.role}</span>{user.institute?.name && ` · ${user.institute.name}`}
              </p>

              {profileError && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{profileError}</p>}
              {profileSuccess && <p style={{ color: "var(--mint)", fontSize: 13, marginTop: 8 }}>{profileSuccess}</p>}

              <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={profileSaving}>
                {profileSaving ? "Saving…" : "Save profile"}
              </button>
            </form>
            <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "28px 0" }} />
          </>
        )}

        <h2 style={{ fontSize: 16 }}>Sign-in details</h2>
        <p style={{ color: "var(--ink-dim)", fontSize: 14, marginTop: 8 }}>
          Change your sign-in email and/or password. Your current password is required to confirm the change.
        </p>

        {pendingEmail && (
          <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "var(--sand, #FFF8E1)", border: "1px solid #FCE8A8", fontSize: 13, color: "#7A5B00" }}>
            <strong>{pendingEmail}</strong> is awaiting confirmation — check that inbox for a verification link. Your current email keeps working until then.{" "}
            <button type="button" onClick={resendVerification} disabled={resending} style={{ border: "none", background: "none", color: "#7A5B00", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>
              {resending ? "Sending…" : "Resend link"}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onBlur={() => {
              const trimmed = normalizeEmail(newEmail);
              if (trimmed && !isValidEmail(trimmed)) setError("Please enter a valid email address");
              else if (error === "Please enter a valid email address") setError("");
            }}
          />

          <label style={labelStyle}>New password (optional)</label>
          <input style={inputStyle} type="password" minLength={8} placeholder="Leave blank to keep current password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          {newPassword && (
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              At least 8 characters, with uppercase, lowercase, a number, and a special character.
            </p>
          )}

          {newPassword && (
            <>
              <label style={labelStyle}>Confirm new password</label>
              <input style={inputStyle} type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </>
          )}

          <label style={labelStyle}>Current password</label>
          <input style={inputStyle} type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Required to confirm this change" />

          {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}
          {success && <p style={{ color: "var(--mint)", fontSize: 13, marginTop: 8 }}>{success}</p>}

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "12px 0" }} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>

        <h2 style={{ fontSize: 18, marginTop: 40 }}>Active sessions</h2>
        <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 4 }}>
          Devices currently signed in to your account. If you don't recognize one, sign it out.
        </p>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions === null && <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Loading…</p>}
          {sessions?.length === 0 && <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>No session history yet.</p>}
          {sessions?.map((s) => {
            const Icon = DEVICE_ICON[s.device] || Laptop;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, opacity: s.isActive ? 1 : 0.55 }}>
                <Icon size={18} style={{ flexShrink: 0, color: "var(--ink-dim)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {s.browser} on {s.os} {s.isCurrent && <span style={{ color: "var(--mint)", fontWeight: 700 }}>· This device</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                    {s.ip || "unknown IP"} · {s.isActive ? "Active since" : "Signed out —"} {new Date(s.loginAt).toLocaleString()}
                  </div>
                </div>
                {s.isActive && !s.isCurrent && (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "6px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
                    onClick={() => revokeSession(s.id)}
                    disabled={revokingId === s.id}
                  >
                    <LogOut size={13} /> {revokingId === s.id ? "Signing out…" : "Sign out"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
