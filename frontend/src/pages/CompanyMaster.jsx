import { useEffect, useState } from "react";
import { Building, Plus, X, ExternalLink } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };

const EMPTY_FORM = { name: "", logoUrl: "", companyType: "", website: "" };

export default function CompanyMaster() {
  const toast = useToast();
  const [companies, setCompanies] = useState(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api.get("/companies").then((res) => setCompanies(res.data)).catch(() => setCompanies([]));
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function startEdit(c) {
    setEditingId(c.id);
    setForm({ name: c.name || "", logoUrl: c.logoUrl || "", companyType: c.companyType || "", website: c.website || "" });
    setError("");
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Company name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await api.patch(`/companies/${editingId}`, form);
        toast.success("Company updated.");
      } else {
        await api.post("/companies", form);
        toast.success("Company added.");
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save company");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c) {
    try {
      await api.patch(`/companies/${c.id}`, { isActive: !c.isActive });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update company");
    }
  }

  const filtered = (companies || []).filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Company Master</h1>
            <ChalkUnderline />
            <p style={{ color: "var(--ink-dim)", marginTop: 8 }}>Companies available for placement records, offers, and employment history across the platform.</p>
          </div>
          <button className="btn btn-primary" onClick={startCreate}><Plus size={15} /> Add Company</button>
        </div>

        <input
          style={{ ...inputStyle, marginTop: 24 }}
          placeholder="Search companies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {showForm && (
          <div className="card" style={{ padding: 24, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 16 }}>{editingId ? "Edit Company" : "New Company"}</h3>
              <button className="btn btn-ghost" style={{ padding: 6 }} onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={save}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Company Name *</label>
                  <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div>
                  <label style={labelStyle}>Logo URL</label>
                  <input style={inputStyle} value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…" />
                </div>
                <div>
                  <label style={labelStyle}>Type (optional)</label>
                  <input style={inputStyle} value={form.companyType} onChange={(e) => setForm({ ...form, companyType: e.target.value })} placeholder="Product, Service, Startup…" />
                </div>
                <div>
                  <label style={labelStyle}>Website (optional)</label>
                  <input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
                </div>
              </div>
              {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 10 }}>{error}</p>}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
          {companies === null ? (
            <p style={{ color: "var(--ink-dim)" }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
              {companies.length === 0 ? "No companies yet. Add the first one." : "No companies match your search."}
            </div>
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, opacity: c.isActive ? 1 : 0.55 }}>
                {c.logoUrl ? (
                  <img src={c.logoUrl} alt={c.name} style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 6 }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Building size={18} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.name} {!c.isActive && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                    {c.companyType || "—"}
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "var(--mint)" }}>
                        Website <ExternalLink size={11} style={{ verticalAlign: "middle" }} />
                      </a>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => startEdit(c)}>Edit</button>
                  <button className="btn btn-ghost" onClick={() => toggleActive(c)}>{c.isActive ? "Deactivate" : "Activate"}</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
