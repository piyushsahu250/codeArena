import { useEffect, useState } from "react";
import api from "../api";
import { useToast } from "../context/ToastContext";
import { isValidEmail, normalizeEmail } from "../utils/emailValidation";

const MOBILE_RE = /^\+?[0-9]{10,15}$/;

// Edit form for a Staff/Clerk account's identity fields — a separate component from
// EditStudentProfileModal.jsx since that one hardcodes student-only fields (rollNumber, batch,
// section). Both call the same PATCH /users/:id route; only the field set differs.
export default function EditStaffClerkProfileModal({ userId, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [institutes, setInstitutes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/staff-clerk/${userId}`).then((res) => {
      const u = res.data;
      setForm({
        name: u.name || "", email: u.email || "", mobile: u.mobile || "", gender: u.gender || "",
        instituteId: u.institute?.id || "", department: u.department || "",
        employeeId: u.employeeId || "", designation: u.designation || "", profilePhotoUrl: u.profilePhotoUrl || "",
      });
    });
    api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {});
  }, [userId]);

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

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    if (!isValidEmail(normalizeEmail(form.email))) return setError("Please enter a valid email address");
    if (form.mobile.trim() && !MOBILE_RE.test(form.mobile.trim())) return setError("Please enter a valid mobile number");
    setSaving(true);
    try {
      await api.patch(`/users/${userId}`, form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update profile");
      toast.error(err.response?.data?.error || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Edit Profile</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        {!form ? (
          <p className="mono" style={{ color: "var(--ink-dim)", marginTop: 16 }}>Loading…</p>
        ) : (
          <form onSubmit={handleSave} style={{ marginTop: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Full Name</label>
                <input style={inputStyle} required value={form.name} onChange={updateField("name")} />
              </div>
              <div>
                <label style={labelStyle}>Email Address</label>
                <input style={inputStyle} type="email" required value={form.email} onChange={updateField("email")} />
              </div>
              <div>
                <label style={labelStyle}>Mobile Number</label>
                <input style={inputStyle} value={form.mobile} onChange={updateField("mobile")} placeholder="9876543210" />
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
              <div>
                <label style={labelStyle}>Employee ID</label>
                <input style={inputStyle} value={form.employeeId} onChange={updateField("employeeId")} />
              </div>
              <div>
                <label style={labelStyle}>Designation</label>
                <input style={inputStyle} value={form.designation} onChange={updateField("designation")} placeholder="e.g. Assistant Professor" />
              </div>
              <div>
                <label style={labelStyle}>Institute</label>
                <select style={inputStyle} value={form.instituteId} onChange={updateField("instituteId")}>
                  <option value="">— None —</option>
                  {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Department</label>
                <input style={inputStyle} value={form.department} onChange={updateField("department")} />
              </div>
            </div>

            <label style={labelStyle}>Profile Photo (optional)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {form.profilePhotoUrl && (
                <img src={form.profilePhotoUrl} alt="Profile preview" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
              )}
              <input type="file" accept="image/*" onChange={handlePhotoChange} />
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
