import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import Badge from "../components/Badge";
import { useAuth } from "../context/AuthContext";

// Registered exam devices for LOCKDOWN exams: register a lab PC (the device secret is shown ONCE), see its last heartbeat and the
// capabilities it last attested, and revoke it. Institute admins manage their own institute only; a platform admin names the institute.
const CAP_SHORT = { kiosk: "Kiosk", appRestriction: "Apps", browserRestriction: "Browser", networkRestriction: "Network", clipboard: "Clipboard", fullscreen: "Fullscreen", devtoolsDisabled: "DevTools off", screenCaptureProtection: "Capture block" };
const ago = (d) => {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export default function SecureDevices() {
  const { user } = useAuth();
  const isAdmin = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"].includes(user?.role);
  const platformLevel = ["ADMIN", "SUPER_ADMIN"].includes(user?.role) && !user?.instituteId;
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [form, setForm] = useState({ label: "", deviceId: "", instituteId: "" });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/secure-exam/devices")
      .then((r) => setState({ loading: false, error: "", data: r.data }))
      .catch((e) => setState({ loading: false, error: e.response?.data?.error || (e.response ? "Could not load devices" : "You appear to be offline"), data: null }));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function register(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/secure-exam/devices", { label: form.label, deviceId: form.deviceId || undefined, instituteId: platformLevel ? form.instituteId : undefined });
      setCreated(data);
      setForm({ label: "", deviceId: "", instituteId: form.instituteId });
      load();
    } catch (err) { alert(err.response?.data?.error || "Could not register the device"); } finally { setBusy(false); }
  }
  async function setStatus(d, status) {
    if (status === "REVOKED" && !confirm(`Revoke ${d.label}? Any exam running on it loses its secure session.`)) return;
    try { await api.patch(`/secure-exam/devices/${d.id}`, { status }); load(); } catch (err) { alert(err.response?.data?.error || "Could not update the device"); }
  }

  const d = state.data;
  return (
    <div>
      <Navbar />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 64px" }}>
        <h1 style={{ fontSize: 24 }}>Secure exam devices</h1>
        <p style={{ color: "var(--ink-dim)", margin: "6px 0 16px", maxWidth: 720 }}>
          Computers registered for LOCKDOWN exams. A student can only start a lockdown exam from a registered, active device running the CodeArena Secure Exam Client.
        </p>
        {isAdmin && (
          <form onSubmit={register} className="card" style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 220px" }}>
              <label htmlFor="dev-label" style={{ fontSize: 12, display: "block" }}>Name (for example Lab 3 PC 14)</label>
              <input id="dev-label" required style={{ width: "100%", padding: 8 }} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label htmlFor="dev-id" style={{ fontSize: 12, display: "block" }}>Device id (optional)</label>
              <input id="dev-id" style={{ width: "100%", padding: 8 }} placeholder="LAB3-PC14" value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} />
            </div>
            {platformLevel && (
              <div style={{ flex: "1 1 220px" }}>
                <label htmlFor="dev-inst" style={{ fontSize: 12, display: "block" }}>Institute id</label>
                <input id="dev-inst" required style={{ width: "100%", padding: 8 }} value={form.instituteId} onChange={(e) => setForm({ ...form, instituteId: e.target.value })} />
              </div>
            )}
            <button className="btn btn-primary" disabled={busy}>{busy ? "Registering…" : "Register device"}</button>
          </form>
        )}
        {created && (
          <div role="alert" className="card" style={{ padding: 16, marginTop: 14, border: "1px solid var(--amber-dark)" }}>
            <strong>Device registered: {created.device.label}</strong>
            <p className="mono" style={{ fontSize: 13, marginTop: 8 }}>Device id: {created.device.deviceId}</p>
            <p className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>Device secret: {created.deviceSecret}</p>
            <p style={{ fontSize: 12.5, marginTop: 8 }}>{created.note} Put both values in the secure client's configuration (see the lab setup guide).</p>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setCreated(null)}>I have saved it — hide</button>
          </div>
        )}
        {state.error && <div role="alert" className="card" style={{ padding: 16, marginTop: 14 }}><p style={{ color: "var(--rust)" }}>{state.error}</p><button className="btn btn-primary" onClick={load}>Retry</button></div>}
        {state.loading && <p className="mono" style={{ marginTop: 14 }}>Loading…</p>}
        {d && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
              <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                {["Name", "Device id", "Status", "Last seen", "Client", "Attested capabilities", ""].map((h) => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px" }}>{r.label}</td>
                    <td style={{ padding: "8px 10px" }} className="mono">{r.deviceId}</td>
                    <td style={{ padding: "8px 10px" }}><Badge tone={r.status === "ACTIVE" ? "success" : "danger"}>{r.status === "ACTIVE" ? "Active" : "Revoked"}</Badge></td>
                    <td style={{ padding: "8px 10px" }}>{ago(r.lastHeartbeatAt)}</td>
                    <td style={{ padding: "8px 10px" }} className="mono">{r.clientVersion || "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12 }}>
                      {r.capabilities ? Object.entries(CAP_SHORT).map(([k, label]) => <span key={k} style={{ marginRight: 8, color: r.capabilities[k] ? "var(--mint)" : "var(--ink-dim)" }}>{r.capabilities[k] ? "✓" : "✗"} {label}</span>) : "not attested yet"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {isAdmin && (r.status === "ACTIVE"
                        ? <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setStatus(r, "REVOKED")}>Revoke</button>
                        : <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setStatus(r, "ACTIVE")}>Re-enable</button>)}
                    </td>
                  </tr>
                ))}
                {d.rows.length === 0 && <tr><td colSpan={7} style={{ padding: 16 }}>No devices registered yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ marginTop: 24, fontSize: 12, color: "var(--ink-dim)" }}><Link to="/staff/learning">Back to Learning Management</Link></p>
      </main>
    </div>
  );
}
