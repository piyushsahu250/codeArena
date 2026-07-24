import { useEffect, useState } from "react";
import api from "../api";
import { useToast } from "../context/ToastContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9]{10,15}$/;

// The one student-profile edit form used everywhere a manager can edit a student — originally
// local to StudentPerformance.jsx, extracted so StudentSearch.jsx's hierarchical browse view can
// reuse the exact same edit flow (same fields, same validation, same PATCH /users/:id) instead of
// duplicating it or forcing a detour through the full dashboard just to fix one field.
export default function EditStudentProfileModal({ studentId, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [institutes, setInstitutes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/users/${studentId}`).then((res) => {
      const u = res.data;
      setForm({
        name: u.name || "", email: u.email || "", mobile: u.mobile || "", gender: u.gender || "",
        rollNumber: u.rollNumber || "", registrationNumber: u.registrationNumber || "",
        instituteId: u.institute?.id || "",
        department: u.department || "", program: u.program || "",
        batchYear: u.batchYear || "", section: u.section || "",
        isActive: u.isActive !== false, profilePhotoUrl: u.profilePhotoUrl || "",
      });
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

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(form.email.trim())) return setError("Please enter a valid email address");
    if (form.mobile.trim() && !MOBILE_RE.test(form.mobile.trim())) return setError("Please enter a valid mobile number");
    setSaving(true);
    try {
      await api.patch(`/users/${studentId}`, form);
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
          <h3 style={{ margin: 0 }}>Edit Student Profile</h3>
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
                <label style={labelStyle}>Roll Number</label>
                <input style={inputStyle} value={form.rollNumber} onChange={updateField("rollNumber")} />
              </div>
              <div>
                <label style={labelStyle}>Registration Number</label>
                <input style={inputStyle} value={form.registrationNumber} onChange={updateField("registrationNumber")} />
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
              <div>
                <label style={labelStyle}>Student Status</label>
                <select style={inputStyle} value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
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
