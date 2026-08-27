import { useEffect, useMemo, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useConfirm } from "../context/ConfirmContext";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 4 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };

export default function FeatureManagement() {
  const confirm = useConfirm();
  const [institutes, setInstitutes] = useState([]);
  const [search, setSearch] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingWarning, setPendingWarning] = useState(null);

  // Bulk section
  const [bulkFeatureKey, setBulkFeatureKey] = useState("");
  const [bulkEnabled, setBulkEnabled] = useState(true);
  const [bulkInstituteIds, setBulkInstituteIds] = useState([]);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // Copy configuration section
  const [copyFrom, setCopyFrom] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [copyPreview, setCopyPreview] = useState(null);
  const [copying, setCopying] = useState(false);

  // Audit history
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.get("/institutes").then((res) => setInstitutes(res.data));
  }, []);

  const filteredInstitutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return institutes;
    return institutes.filter((i) => i.name.toLowerCase().includes(q));
  }, [institutes, search]);

  const categories = useMemo(() => {
    const byCategory = {};
    for (const f of features) {
      if (!byCategory[f.category]) byCategory[f.category] = [];
      byCategory[f.category].push(f);
    }
    return byCategory;
  }, [features]);

  function loadFeatures(id) {
    if (!id) return;
    setLoading(true);
    setError("");
    api.get("/features", { params: { instituteId: id } })
      .then((res) => setFeatures(res.data.features))
      .catch((err) => setError(err.response?.data?.error || "Failed to load feature configuration"))
      .finally(() => setLoading(false));
  }

  function selectInstitute(inst) {
    setInstituteId(inst.id);
    setInstituteName(inst.name);
    setPendingWarning(null);
    setShowHistory(false);
    loadFeatures(inst.id);
  }

  async function toggleFeature(featureKey, enabled) {
    if (!enabled) {
      const feature = features.find((f) => f.key === featureKey);
      const ok = await confirm({
        title: `Disable ${feature?.label || featureKey} for this institute?`,
        message: "Students will no longer be able to access the feature. Existing data will not be deleted. The feature can be enabled again later.",
        confirmLabel: "Disable Feature",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!ok) return;
    }
    setPendingWarning(null);
    // Optimistic update — the admin action itself is a single click and should feel instant;
    // reverted below if the request fails.
    setFeatures((prev) => prev.map((f) => (f.key === featureKey ? { ...f, enabled } : f)));
    try {
      const { data } = await api.patch("/features", { instituteId, featureKey, enabled });
      if (data.warning) setPendingWarning(data.warning);
    } catch (err) {
      setFeatures((prev) => prev.map((f) => (f.key === featureKey ? { ...f, enabled: !enabled } : f)));
      alert(err.response?.data?.error || "Failed to update feature");
    }
  }

  function toggleBulkInstitute(id) {
    setBulkInstituteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function applyBulk() {
    if (!bulkFeatureKey || bulkInstituteIds.length === 0) return;
    try {
      const { data } = await api.post("/features/bulk", { instituteIds: bulkInstituteIds, featureKey: bulkFeatureKey, enabled: bulkEnabled });
      setBulkResult(data);
      setBulkConfirming(false);
      if (instituteId && bulkInstituteIds.includes(instituteId)) loadFeatures(instituteId);
    } catch (err) {
      alert(err.response?.data?.error || "Bulk update failed");
    }
  }

  async function loadCopyPreview() {
    if (!copyFrom || !copyTo || copyFrom === copyTo) return;
    try {
      const { data } = await api.get("/features/copy-preview", { params: { fromInstituteId: copyFrom, toInstituteId: copyTo } });
      setCopyPreview(data);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to build preview");
    }
  }

  async function applyCopy() {
    setCopying(true);
    try {
      await api.post("/features/copy", { fromInstituteId: copyFrom, toInstituteId: copyTo });
      setCopyPreview(null);
      if (instituteId === copyTo) loadFeatures(instituteId);
      alert("Configuration copied.");
    } catch (err) {
      alert(err.response?.data?.error || "Copy failed");
    } finally {
      setCopying(false);
    }
  }

  function loadHistory() {
    setShowHistory((v) => !v);
    if (!showHistory) {
      api.get("/features/audit", { params: { instituteId } }).then((res) => setHistory(res.data.logs));
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 20px" }}>
        <h1 className="mono" style={{ fontSize: 26 }}>
          Feature Management <ChalkUnderline />
        </h1>
        <p style={{ color: "var(--ink-dim)", fontSize: 14, marginBottom: 24 }}>
          Turn CodeArena features ON/OFF per institute. Changes never affect any other institute.
        </p>

        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <label style={labelStyle}>Search Institute</label>
          <input style={inputStyle} placeholder="Sanjivani…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, maxHeight: 160, overflowY: "auto" }}>
            {filteredInstitutes.map((inst) => (
              <button
                key={inst.id}
                className="btn btn-ghost"
                style={{ fontSize: 13, ...(inst.id === instituteId ? { borderColor: "var(--mint)", background: "var(--mint-10, rgba(0,200,120,0.1))" } : {}) }}
                onClick={() => selectInstitute(inst)}
              >
                {inst.name}
              </button>
            ))}
            {filteredInstitutes.length === 0 && <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>No institutes match.</span>}
          </div>
        </div>

        {instituteId && (
          <div className="card" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>{instituteName}</div>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={loadHistory}>
                {showHistory ? "Hide" : "View"} Configuration History
              </button>
            </div>

            {loading && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>}
            {error && <p style={{ fontSize: 13, color: "var(--rust)" }}>{error}</p>}
            {pendingWarning && (
              <div style={{ background: "rgba(200,150,0,0.1)", border: "1px solid var(--amber-dark)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>
                ⚠ {pendingWarning}
              </div>
            )}

            {Object.entries(categories).map(([category, items]) => (
              <div key={category} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 8 }}>{category}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {items.map((f) => (
                    <div key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</div>
                        {f.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{f.description}</div>}
                        {f.updatedAt && (
                          <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                            Last changed {new Date(f.updatedAt).toLocaleString()}{f.updatedByName ? ` by ${f.updatedByName}` : ""}
                          </div>
                        )}
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <span className="mono" style={{ fontSize: 12, color: f.enabled ? "var(--mint)" : "var(--ink-dim)" }}>{f.enabled ? "ON" : "OFF"}</span>
                        <input type="checkbox" checked={f.enabled} onChange={(e) => toggleFeature(f.key, e.target.checked)} />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {showHistory && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 8 }}>Recent Changes</div>
                {history.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No changes recorded yet.</p>}
                <div style={{ display: "grid", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                  {history.map((h) => (
                    <div key={h.id} className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      {new Date(h.createdAt).toLocaleString()} — {h.adminName} — {h.details?.featureKey || h.details?.copiedFrom ? JSON.stringify(h.details) : h.action}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Bulk Institute Management</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Feature</label>
              <select style={inputStyle} value={bulkFeatureKey} onChange={(e) => setBulkFeatureKey(e.target.value)}>
                <option value="">Select feature…</option>
                {features.length > 0
                  ? features.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)
                  : null}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Set to</label>
              <select style={inputStyle} value={bulkEnabled ? "on" : "off"} onChange={(e) => setBulkEnabled(e.target.value === "on")}>
                <option value="on">ON</option>
                <option value="off">OFF</option>
              </select>
            </div>
          </div>
          <label style={labelStyle}>Select Institutes</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 140, overflowY: "auto", marginBottom: 10 }}>
            {institutes.map((inst) => (
              <label key={inst.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}>
                <input type="checkbox" checked={bulkInstituteIds.includes(inst.id)} onChange={() => toggleBulkInstitute(inst.id)} />
                {inst.name}
              </label>
            ))}
          </div>
          {!bulkConfirming ? (
            <button className="btn btn-primary" disabled={!bulkFeatureKey || bulkInstituteIds.length === 0} onClick={() => setBulkConfirming(true)}>
              Apply to {bulkInstituteIds.length} institute(s)
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13 }}>Set {bulkFeatureKey} = {bulkEnabled ? "ON" : "OFF"} for {bulkInstituteIds.length} institute(s)?</span>
              <button className="btn btn-primary" onClick={applyBulk}>Confirm</button>
              <button className="btn btn-ghost" onClick={() => setBulkConfirming(false)}>Cancel</button>
            </div>
          )}
          {bulkResult && <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Updated {bulkResult.updated} institute(s).{bulkResult.missing?.length ? ` ${bulkResult.missing.length} id(s) not found.` : ""}</p>}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Copy Feature Configuration</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Copy from</label>
              <select style={inputStyle} value={copyFrom} onChange={(e) => { setCopyFrom(e.target.value); setCopyPreview(null); }}>
                <option value="">Select institute…</option>
                {institutes.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Apply to</label>
              <select style={inputStyle} value={copyTo} onChange={(e) => { setCopyTo(e.target.value); setCopyPreview(null); }}>
                <option value="">Select institute…</option>
                {institutes.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-ghost" disabled={!copyFrom || !copyTo || copyFrom === copyTo} onClick={loadCopyPreview}>
            Preview Changes
          </button>

          {copyPreview && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, marginBottom: 8 }}>{copyPreview.changeCount} feature(s) will change:</p>
              <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                {copyPreview.changes.filter((c) => c.willChange).map((c) => (
                  <div key={c.key} className="mono" style={{ fontSize: 12 }}>{c.label}: {c.from ? "ON" : "OFF"} → {c.to ? "ON" : "OFF"}</div>
                ))}
                {copyPreview.changeCount === 0 && <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>Target already matches source.</span>}
              </div>
              {copyPreview.changeCount > 0 && (
                <button className="btn btn-primary" disabled={copying} onClick={applyCopy}>
                  {copying ? "Applying…" : "Apply Copy"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
