import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";

// Platform-level ADMIN/SUPER_ADMIN only (same gate as InstituteManagement.jsx). Reuses the two
// existing endpoints that already do the real work here -- POST /institutes and POST /users --
// this page invents no new backend route; it just chains the two steps a platform admin
// otherwise has to remember to do across two unrelated pages (create the institute, then
// separately go create its first Institute Admin somewhere else) into one guided flow, with a
// clear "what to do next" pointer at the end instead of a newly-created institute silently
// sitting there with nobody able to log into it.
const emptyInstitute = { name: "", code: "", address: "", contact: "" };
const emptyAdmin = { name: "", email: "", mobile: "" };

export default function OnboardInstitute() {
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1 = institute, 2 = first admin, 3 = done
  const [instituteForm, setInstituteForm] = useState(emptyInstitute);
  const [adminForm, setAdminForm] = useState(emptyAdmin);
  const [creatingInstitute, setCreatingInstitute] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [error, setError] = useState("");
  const [institute, setInstitute] = useState(null);
  const [adminResult, setAdminResult] = useState(null);

  async function createInstitute(e) {
    e.preventDefault();
    setError("");
    if (!instituteForm.name.trim()) return setError("Institute name is required");
    setCreatingInstitute(true);
    try {
      const { data } = await api.post("/institutes", instituteForm);
      setInstitute(data);
      setAdminForm((f) => ({ ...f, email: "" }));
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create institute");
    } finally {
      setCreatingInstitute(false);
    }
  }

  async function createAdmin(e) {
    e.preventDefault();
    setError("");
    if (!adminForm.name.trim() || !adminForm.email.trim()) return setError("Name and email are required");
    setCreatingAdmin(true);
    try {
      const { data } = await api.post("/users", {
        name: adminForm.name.trim(), email: adminForm.email.trim(), mobile: adminForm.mobile.trim() || undefined,
        role: "INSTITUTE_ADMIN", instituteId: institute.id,
      });
      setAdminResult(data);
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create the Institute Admin account");
    } finally {
      setCreatingAdmin(false);
    }
  }

  function skipAdmin() {
    setStep(3);
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Onboard a New Institute</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin/institutes" className="btn btn-ghost">← Institute Management</Link>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20, fontSize: 12.5, color: "var(--ink-dim)" }}>
          <StepDot n={1} label="Institute" active={step === 1} done={step > 1} />
          <StepDot n={2} label="First Admin" active={step === 2} done={step > 2} />
          <StepDot n={3} label="Done" active={step === 3} done={false} />
        </div>

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{error}</p>}

        {step === 1 && (
          <form onSubmit={createInstitute} className="card" style={{ padding: 20, marginTop: 20, display: "grid", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0 }}>
              Start with the institute's own details. You can fill in security policy, marksheet signatories,
              and feature toggles afterward from Institute Management / Feature Management — none of that is
              required before students or staff can be added.
            </p>
            <div>
              <label style={labelStyle}>Institute name</label>
              <input style={inputStyle} required autoFocus value={instituteForm.name} onChange={(e) => setInstituteForm({ ...instituteForm, name: e.target.value })} placeholder="e.g. ABC Engineering College" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Code (optional)</label>
                <input style={inputStyle} value={instituteForm.code} onChange={(e) => setInstituteForm({ ...instituteForm, code: e.target.value })} placeholder="e.g. ABC001" />
              </div>
              <div>
                <label style={labelStyle}>Contact (optional)</label>
                <input style={inputStyle} value={instituteForm.contact} onChange={(e) => setInstituteForm({ ...instituteForm, contact: e.target.value })} placeholder="Phone / email" />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Address (optional)</label>
              <input style={inputStyle} value={instituteForm.address} onChange={(e) => setInstituteForm({ ...instituteForm, address: e.target.value })} />
            </div>
            <button className="btn btn-primary" disabled={creatingInstitute} style={{ justifySelf: "start" }}>
              {creatingInstitute ? "Creating…" : "Create Institute →"}
            </button>
          </form>
        )}

        {step === 2 && institute && (
          <form onSubmit={createAdmin} className="card" style={{ padding: 20, marginTop: 20, display: "grid", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0 }}>
              <strong>{institute.name}</strong> is created. Give it a first Institute Admin so someone can actually
              log in and start adding staff/students — a freshly created institute with no admin account is
              otherwise unreachable until you come back and do this separately. A unique, randomly generated
              temporary password is created and emailed directly to them; it's never shown or shared here in a
              reusable form.
            </p>
            <div>
              <label style={labelStyle}>Admin's name</label>
              <input style={inputStyle} required autoFocus value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Admin's email</label>
              <input style={inputStyle} required type="email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Mobile (optional)</label>
              <input style={inputStyle} value={adminForm.mobile} onChange={(e) => setAdminForm({ ...adminForm, mobile: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-primary" disabled={creatingAdmin}>
                {creatingAdmin ? "Creating…" : "Create Institute Admin →"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={skipAdmin} disabled={creatingAdmin}>
                Skip for now
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div className="card" style={{ padding: 20, marginTop: 20 }}>
            <p style={{ fontSize: 14 }}>
              <strong>{institute?.name || "The institute"}</strong> is set up{adminResult ? " with its first Institute Admin" : ""}.
            </p>
            {adminResult && (
              <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
                {adminResult.emailSent
                  ? <>An account-credentials email was sent to <strong>{adminResult.email}</strong>.</>
                  : <>Account created, but the credentials email failed to send{adminResult.emailError ? ` (${adminResult.emailError})` : ""} — check Email Logs, or use Bulk Regenerate Password from Student Search to resend.</>}
              </div>
            )}
            {!adminResult && (
              <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
                No Institute Admin was created yet — add one anytime from Student Search / Staff &amp; Clerk
                Management (role: Institute Admin, institute: {institute?.name}).
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <Link to="/admin/institutes" className="btn btn-ghost">Configure security policy →</Link>
              <Link to="/admin/feature-management" className="btn btn-ghost">Configure feature flags →</Link>
              <button className="btn btn-primary" onClick={() => { setStep(1); setInstituteForm(emptyInstitute); setAdminForm(emptyAdmin); setInstitute(null); setAdminResult(null); }}>
                Onboard another institute
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDot({ n, label, active, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: active ? 700 : 400, color: active ? "var(--ink)" : done ? "var(--mint)" : "var(--ink-dim)" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%",
        border: `1px solid ${active ? "var(--ink)" : done ? "var(--mint)" : "var(--line)"}`, fontSize: 11,
      }}>
        {done ? "✓" : n}
      </span>
      {label}
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
