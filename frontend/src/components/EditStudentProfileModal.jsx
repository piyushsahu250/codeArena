import { useEffect, useState } from "react";
import api from "../api";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { isValidEmail, normalizeEmail } from "../utils/emailValidation";

const MOBILE_RE = /^\+?[0-9]{10,15}$/;
const REGISTRATION_NUMBER_RE = /^[A-Za-z0-9]{9,12}$/;
// Matches studentIdentifiers.js's ROLL_NUMBER_RE exactly — a Roll Number is always exactly 3
// numeric digits ("001", never "1" or "01" or "1A"), the platform's one consistent representation
// everywhere it's stored/displayed. Was previously only checked for max-length here, so a value
// like "1" passed frontend validation and only failed on save (backend-caught, no data-integrity
// risk, just a confusing two-step error instead of catching it immediately).
const ROLL_NUMBER_RE = /^\d{3}$/;

// The one student-profile edit form used everywhere a manager can edit a student — originally
// local to StudentPerformance.jsx, extracted so StudentSearch.jsx's hierarchical browse view can
// reuse the exact same edit flow (same fields, same validation, same PATCH /users/:id) instead of
// duplicating it or forcing a detour through the full dashboard just to fix one field.
export default function EditStudentProfileModal({ studentId, onClose, onSaved }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null); // snapshot as loaded — diffed against on save to build the confirmation message
  const [institutes, setInstitutes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState(null);

  useEffect(() => {
    api.get(`/users/${studentId}`).then((res) => {
      const u = res.data;
      const initial = {
        name: u.name || "", email: u.email || "", mobile: u.mobile || "", gender: u.gender || "",
        rollNumber: u.rollNumber || "", registrationNumber: u.registrationNumber || "",
        instituteId: u.institute?.id || "",
        department: u.department || "", program: u.program || "",
        batchYear: u.batchYear || "", section: u.section || "",
        isActive: u.isActive !== false, profilePhotoUrl: u.profilePhotoUrl || "",
      };
      setForm(initial);
      setOriginal({ ...initial, emailVerified: u.emailVerified, pendingEmail: u.pendingEmail || null });
    });
    api.get("/institutes").then((res) => setInstitutes(res.data));
  }, [studentId]);

  function updateField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, profilePhotoUrl: reader.result }));
    reader.readAsDataURL(file);
  }

  // Sensitive-identity fields — spec: these get an explicit old->new confirmation step before
  // saving, PRN doubly so ("this is a sensitive academic identifier..."), rather than saving
  // silently on submit like the rest of the form.
  async function confirmSensitiveChanges(normalizedEmail) {
    const changes = [];
    if (normalizedEmail !== original.email) changes.push({ label: "Email", old: original.email || "(none)", next: normalizedEmail });
    if (form.mobile.trim() !== (original.mobile || "")) changes.push({ label: "Mobile Number", old: original.mobile || "(none)", next: form.mobile.trim() || "(none)" });
    if (form.registrationNumber.trim() !== (original.registrationNumber || "")) {
      changes.push({ label: "Registration Number (PRN)", old: original.registrationNumber || "(none)", next: form.registrationNumber.trim() || "(none)" });
    }
    if (changes.length === 0) return true;

    const isPrnChange = changes.some((c) => c.label.startsWith("Registration"));
    const message = [
      ...changes.map((c) => `${c.label}: "${c.old}" → "${c.next}"`),
      isPrnChange ? "\nThis is a sensitive academic identifier. Changing it may affect how the student is identified across the platform — their existing test attempts, results, attendance, LMS progress, submissions, and certificates all stay attached to their account and will not be lost." : null,
      changes.some((c) => c.label === "Email") ? "\nThe new email will be marked unverified until confirmed." : null,
    ].filter(Boolean).join("\n");

    return confirmDialog({
      title: changes.length === 1 ? `Update student ${changes[0].label.toLowerCase()}?` : "Update sensitive student details?",
      message,
      confirmLabel: "Confirm Update",
      cancelLabel: "Cancel",
      danger: isPrnChange,
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    const normalizedEmail = normalizeEmail(form.email);
    if (!isValidEmail(normalizedEmail)) return setError("Please enter a valid email address");
    if (form.mobile.trim() && !MOBILE_RE.test(form.mobile.trim())) return setError("Please enter a valid mobile number");
    if (form.registrationNumber.trim() && !REGISTRATION_NUMBER_RE.test(form.registrationNumber.trim())) return setError("Registration Number (PRN) must be 9-12 alphanumeric characters");
    if (form.rollNumber.trim() && !ROLL_NUMBER_RE.test(form.rollNumber.trim())) return setError("Roll Number must be exactly 3 digits (e.g. \"001\")");

    if (!(await confirmSensitiveChanges(normalizedEmail))) return;

    setSaving(true);
    try {
      await api.patch(`/users/${studentId}`, { ...form, email: normalizedEmail });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update profile");
      toast.error(err.response?.data?.error || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    const ok = await confirmDialog({
      title: "Reset Password",
      message: `Generate a new, unique password for ${form?.name || "this student"} and email it to them? They will be required to set a new password on next login.`,
      confirmLabel: "Reset Password",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    setResetResult(null);
    try {
      const { data } = await api.post(`/users/${studentId}/reset-password`, { sendEmail: true });
      setResetResult({ emailSent: data.emailSent, emailError: data.emailError });
      toast.success(data.emailSent ? "New password emailed to the student." : "Password reset, but the email failed to send.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset password");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Edit Student Profile</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        {!form ? (
          <p className="mono" style={{ color: "var(--ink-dim)", marginTop: 16 }}>Loading…</p>
        ) : (
          <form onSubmit={handleSave} style={{ marginTop: 16 }}>
            <div style={sectionHeaderStyle}>Personal Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Full Name</label>
                <input style={inputStyle} required value={form.name} onChange={updateField("name")} />
              </div>
              <div>
                <label style={labelStyle}>Mobile Number</label>
                <input style={inputStyle} value={form.mobile} onChange={updateField("mobile")} placeholder="9876543210" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Email Address</label>
                <input style={inputStyle} type="email" required value={form.email} onChange={updateField("email")} />
                {original?.pendingEmail && (
                  <p style={{ fontSize: 11, color: "var(--ink-dim)", margin: "4px 0 0" }}>
                    A self-service change to <strong>{original.pendingEmail}</strong> is still awaiting the student's own verification click — editing here replaces that pending request.
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Gender (optional)</label>
                <select style={inputStyle} value={form.gender} onChange={updateField("gender")}>
                  <option value="">— Not specified —</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <label style={labelStyle}>Profile Photo (optional)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {form.profilePhotoUrl && (
                <img src={form.profilePhotoUrl} alt="Profile preview" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
              )}
              <input type="file" accept="image/*" onChange={handlePhotoChange} />
            </div>

            <div style={sectionHeaderStyle}>Academic Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Registration Number (PRN)</label>
                <input style={inputStyle} maxLength={12} value={form.registrationNumber} onChange={updateField("registrationNumber")} />
              </div>
              <div>
                <label style={labelStyle}>Roll Number</label>
                <input style={inputStyle} maxLength={3} value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value.slice(0, 3) })} placeholder="Max 3 characters" />
              </div>
              <div>
                <label style={labelStyle}>Institute</label>
                <select style={inputStyle} value={form.instituteId} onChange={updateField("instituteId")}>
                  <option value="">— None —</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Department (Branch)</label>
                <input style={inputStyle} value={form.department} onChange={updateField("department")} />
              </div>
              <div>
                <label style={labelStyle}>Course</label>
                <input style={inputStyle} value={form.program} onChange={updateField("program")} />
              </div>
              <div>
                <label style={labelStyle}>Batch / Academic Year</label>
                <input style={inputStyle} value={form.batchYear} onChange={updateField("batchYear")} />
              </div>
              <div>
                <label style={labelStyle}>Section</label>
                <input style={inputStyle} value={form.section} onChange={updateField("section")} />
              </div>
            </div>

            <div style={sectionHeaderStyle}>Account Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
              <div>
                <label style={labelStyle}>Student Status</label>
                <select style={inputStyle} value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Email Verification</label>
                <div style={{ padding: "10px 0", fontSize: 13 }}>
                  <span className="badge" style={{ background: original?.emailVerified ? "var(--success-bg, #e6f7ee)" : "var(--warn-bg, #fff8e1)", color: original?.emailVerified ? "var(--mint)" : "var(--amber-dark, #8a6d00)" }}>
                    {original?.emailVerified ? "Verified" : "Not verified"}
                  </span>
                  {/* This platform's admin-edit flow marks a changed email unverified immediately
                      (see PATCH /users/:id) but has no admin-triggered "send verification email"
                      action — only the student's own self-service PATCH /me flow sends one, via a
                      pendingEmail token. Documented here rather than implying a control exists. */}
                  {!original?.emailVerified && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-dim)" }}>No admin action to re-send verification — the student verifies from their own account.</span>
                  )}
                </div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Password</label>
                <button type="button" className="btn btn-ghost" disabled={resetting} onClick={resetPassword}>
                  {resetting ? "Resetting…" : "Reset Password"}
                </button>
                {resetResult && (
                  <p style={{ fontSize: 12, marginTop: 6, color: resetResult.emailSent ? "var(--mint)" : "var(--rust)" }}>
                    {resetResult.emailSent ? "New password emailed to the student." : `Password reset, but the email failed to send${resetResult.emailError ? `: ${resetResult.emailError}` : "."}`}
                  </p>
                )}
              </div>
            </div>

            {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}

            <button className="btn btn-primary" style={{ marginTop: 20 }} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginTop: 10, marginBottom: 4 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)" };
const sectionHeaderStyle = { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-dim)", marginTop: 22, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--line)" };
