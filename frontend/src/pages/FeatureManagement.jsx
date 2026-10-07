import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import Badge from "../components/Badge";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 4 };
const inputStyle = { width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 };

// Per-institute feature switches, plus the platform-admin tools (bulk change, copy configuration). Institute-scoped admins see only their
// own institute, so the cross-institute tools are hidden for them (the API refuses them too).
export default function FeatureManagement() {
  const confirm = useConfirm();
  const toast = useToast();
  const [institutes, setInstitutes] = useState(null); // null = loading
  const [institutesError, setInstitutesError] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [search, setSearch] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [features, setFeatures] = useState([]);
  const [featureSearch, setFeatureSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingWarning, setPendingWarning] = useState(null);
  const [busyKeys, setBusyKeys] = useState({});
  const loadSeq = useRef(0);

  // Bulk
  const [bulkFeatureKey, setBulkFeatureKey] = useState("");
  const [bulkEnabled, setBulkEnabled] = useState(true);
  const [bulkInstituteIds, setBulkInstituteIds] = useState([]);
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Copy
  const [copyFrom, setCopyFrom] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [copyPreview, setCopyPreview] = useState(null);
  const [copying, setCopying] = useState(false);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null);

  const loadInstitutes = useCallback(() => {
    setInstitutesError("");
    api.get("/institutes")
      .then((res) => setInstitutes(res.data))
      .catch((err) => { setInstitutes([]); setInstitutesError(err.response?.data?.error || (err.response ? "Could not load institutes" : "You appear to be offline")); });
  }, []);
  useEffect(() => { loadInstitutes(); }, [loadInstitutes]);
  // The feature catalog does not depend on an institute: the bulk picker works from the start.
  useEffect(() => { api.get("/features/catalog").then((r) => setCatalog(r.data.features)).catch(() => toast.error("Could not load the feature list")); /* eslint-disable-next-line */ }, []);

  const list = institutes || [];
  const crossInstitute = list.length > 1; // platform-level admins only

  const loadFeatures = useCallback((id) => {
    if (!id) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    setFeatures([]); // never show the previous institute's switches while this one loads
    api.get("/features", { params: { instituteId: id } })
      .then((res) => { if (seq === loadSeq.current) setFeatures(res.data.features); })
      .catch((err) => { if (seq === loadSeq.current) setError(err.response?.data?.error || "Failed to load feature configuration"); })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, []);

  function selectInstitute(inst) {
    setInstituteId(inst.id);
    setInstituteName(inst.name);
    setPendingWarning(null);
    setShowHistory(false);
    setHistory(null);
    setFeatureSearch("");
    loadFeatures(inst.id);
  }
  // An institute-scoped admin has exactly one institute: open it straight away.
  useEffect(() => { if (institutes && institutes.length === 1 && !instituteId) selectInstitute(institutes[0]); /* eslint-disable-next-line */ }, [institutes]);

  const filteredInstitutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  }, [list, search]);

  const visibleFeatures = useMemo(() => {
    const q = featureSearch.trim().toLowerCase();
    return q ? features.filter((f) => `${f.label} ${f.category} ${f.description || ""}`.toLowerCase().includes(q)) : features;
  }, [features, featureSearch]);
  const categories = useMemo(() => {
    const by = {};
    for (const f of visibleFeatures) (by[f.category] ||= []).push(f);
    return by;
  }, [visibleFeatures]);
  const enabledCount = features.filter((f) => f.enabled).length;
  const labelOf = (key) => catalog.find((c) => c.key === key)?.label || features.find((f) => f.key === key)?.label || key;

  async function toggleFeature(featureKey, enabled) {
    if (busyKeys[featureKey]) return;
    if (!enabled) {
      const feature = features.find((f) => f.key === featureKey);
      const dependents = features.filter((f) => f.dependsOn === featureKey && f.enabled).map((f) => f.label);
      const ok = await confirm({
        title: `Turn off ${feature?.label || featureKey} for ${instituteName}?`,
        message: `Students and staff of this institute will no longer be able to use it. Existing data is not deleted and you can turn it back on later.${dependents.length ? ` ${dependents.join(", ")} depend${dependents.length === 1 ? "s" : ""} on it and will also stop working.` : ""}`,
        confirmLabel: "Turn off", cancelLabel: "Cancel", danger: true,
      });
      if (!ok) return;
    }
    setPendingWarning(null);
    setBusyKeys((b) => ({ ...b, [featureKey]: true }));
    setFeatures((prev) => prev.map((f) => (f.key === featureKey ? { ...f, enabled } : f))); // optimistic
    try {
      const { data } = await api.patch("/features", { instituteId, featureKey, enabled });
      if (data.warning) setPendingWarning(data.warning);
      toast.success(`${labelOf(featureKey)} turned ${enabled ? "on" : "off"} for ${instituteName}.`);
      if (showHistory) loadHistory(true);
    } catch (err) {
      setFeatures((prev) => prev.map((f) => (f.key === featureKey ? { ...f, enabled: !enabled } : f)));
      toast.error(err.response?.data?.error || "Could not update the feature. Nothing was changed.");
    } finally {
      setBusyKeys((b) => { const n = { ...b }; delete n[featureKey]; return n; });
    }
  }

  function loadHistory(force) {
    const open = force === true ? true : !showHistory;
    setShowHistory(open);
    if (open) {
      setHistory(null);
      api.get("/features/audit", { params: { instituteId } }).then((res) => setHistory(res.data.logs)).catch(() => { setHistory([]); toast.error("Could not load the change history"); });
    }
  }
  const describeLog = (h) => {
    const d = h.details || {};
    if (d.featureKey) return `${labelOf(d.featureKey)}: ${d.previous ? "ON" : "OFF"} → ${d.new ? "ON" : "OFF"}${d.bulk ? ` (bulk, ${d.instituteCount} institutes)` : ""}`;
    if (d.copiedFrom) return `Configuration copied from ${list.find((i) => i.id === d.copiedFrom)?.name || "another institute"}`;
    return h.action;
  };

  // ---- bulk
  const bulkVisible = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  }, [list, bulkSearch]);
  const bulkFeature = catalog.find((c) => c.key === bulkFeatureKey);
  const catalogByCategory = useMemo(() => { const by = {}; for (const c of catalog) (by[c.category] ||= []).push(c); return by; }, [catalog]);
  useEffect(() => { setBulkConfirming(false); }, [bulkFeatureKey, bulkEnabled, bulkInstituteIds]);
  const toggleBulkInstitute = (id) => setBulkInstituteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function applyBulk() {
    if (!bulkFeatureKey || bulkInstituteIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const { data } = await api.post("/features/bulk", { instituteIds: bulkInstituteIds, featureKey: bulkFeatureKey, enabled: bulkEnabled });
      toast.success(`${bulkFeature?.label || bulkFeatureKey} turned ${bulkEnabled ? "on" : "off"} for ${data.updated} institute${data.updated === 1 ? "" : "s"}.${data.missing?.length ? ` ${data.missing.length} not found.` : ""}`);
      setBulkConfirming(false);
      setBulkInstituteIds([]);
      if (instituteId && bulkInstituteIds.includes(instituteId)) loadFeatures(instituteId);
    } catch (err) {
      toast.error(err.response?.data?.error || "Bulk update failed. No institute was changed.");
    } finally { setBulkBusy(false); }
  }

  // ---- copy
  async function loadCopyPreview() {
    if (!copyFrom || !copyTo || copyFrom === copyTo) return;
    try {
      const { data } = await api.get("/features/copy-preview", { params: { fromInstituteId: copyFrom, toInstituteId: copyTo } });
      setCopyPreview(data);
    } catch (err) { toast.error(err.response?.data?.error || "Could not build the preview"); }
  }
  async function applyCopy() {
    setCopying(true);
    try {
      await api.post("/features/copy", { fromInstituteId: copyFrom, toInstituteId: copyTo });
      setCopyPreview(null);
      if (instituteId === copyTo) loadFeatures(instituteId);
      toast.success("Configuration copied.");
    } catch (err) { toast.error(err.response?.data?.error || "Copy failed. Nothing was changed."); }
    finally { setCopying(false); }
  }

  const switchStyle = (on, busy) => ({
    position: "relative", width: 44, height: 24, borderRadius: 12, border: "none", cursor: busy ? "wait" : "pointer", padding: 0, flexShrink: 0,
    background: on ? "var(--mint)" : "var(--line)", transition: "background .15s", opacity: busy ? 0.6 : 1,
  });
  const knobStyle = (on) => ({ position: "absolute", top: 2, left: on ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" });

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 20px 64px" }}>
        <h1 className="mono" style={{ fontSize: 26 }}>Feature Management <ChalkUnderline /></h1>
        <p style={{ color: "var(--ink-dim)", fontSize: 14, marginBottom: 24 }}>Turn CodeArena features on or off per institute. A change only affects the institute you choose.</p>

        {institutes === null && <p className="mono" role="status">Loading institutes…</p>}
        {institutesError && (
          <div role="alert" className="card" style={{ padding: 16, marginBottom: 16 }}>
            <p style={{ color: "var(--rust)" }}>{institutesError}</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={loadInstitutes}>Retry</button>
          </div>
        )}

        {crossInstitute && (
          <div className="card" style={{ padding: 20, marginBottom: 24 }}>
            <label style={labelStyle} htmlFor="feature-mgmt-search-institute">Choose an institute</label>
            <input id="feature-mgmt-search-institute" style={inputStyle} placeholder="Type to filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div role="listbox" aria-label="Institutes" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, maxHeight: 170, overflowY: "auto" }}>
              {filteredInstitutes.map((inst) => (
                <button key={inst.id} type="button" role="option" aria-selected={inst.id === instituteId} className="btn btn-ghost"
                  style={{ fontSize: 13, ...(inst.id === instituteId ? { borderColor: "var(--mint)", background: "var(--success-bg)", fontWeight: 700 } : {}) }} onClick={() => selectInstitute(inst)}>
                  {inst.id === instituteId ? "✓ " : ""}{inst.name}
                </button>
              ))}
              {filteredInstitutes.length === 0 && <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>No institute matches "{search}".</span>}
            </div>
          </div>
        )}

        {!instituteId && institutes && institutes.length > 0 && <p style={{ color: "var(--ink-dim)", fontSize: 14, marginBottom: 24 }}>Select an institute above to see and change its features.</p>}

        {instituteId && (
          <div className="card" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{instituteName}</div>
                {features.length > 0 && <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{enabledCount} of {features.length} features on</div>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input aria-label="Search features" placeholder="Search features…" style={{ ...inputStyle, width: 200 }} value={featureSearch} onChange={(e) => setFeatureSearch(e.target.value)} />
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => loadHistory()}>{showHistory ? "Hide" : "View"} change history</button>
              </div>
            </div>

            {loading && <p role="status" className="mono" style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading features…</p>}
            {error && (
              <div role="alert" style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 13, color: "var(--rust)" }}>{error}</p>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 6 }} onClick={() => loadFeatures(instituteId)}>Retry</button>
              </div>
            )}
            {pendingWarning && (
              <div role="status" style={{ background: "var(--warning-bg)", border: "1px solid var(--amber-dark)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>⚠ {pendingWarning}</div>
            )}
            {!loading && !error && features.length > 0 && visibleFeatures.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No feature matches "{featureSearch}".</p>}

            {Object.entries(categories).map(([category, items]) => (
              <div key={category} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-dim)", marginBottom: 8 }}>{category}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {items.map((f) => {
                    const dep = f.dependsOn ? features.find((x) => x.key === f.dependsOn) : null;
                    const blocked = !!dep && !dep.enabled;
                    const busy = !!busyKeys[f.key];
                    return (
                      <div key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, opacity: blocked && f.enabled ? 0.75 : 1 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</div>
                          {f.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{f.description}</div>}
                          {dep && <div style={{ fontSize: 11.5, marginTop: 2, color: blocked ? "var(--amber-dark)" : "var(--ink-dim)" }}>{blocked ? `⚠ Needs ${dep.label}, which is off, so this is unavailable` : `Needs ${dep.label}`}</div>}
                          {f.updatedAt && <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Last changed {new Date(f.updatedAt).toLocaleString()}{f.updatedByName ? ` by ${f.updatedByName}` : ""}</div>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Badge tone={f.enabled && !blocked ? "success" : "default"}>{f.enabled ? (blocked ? "On, blocked" : "On") : "Off"}</Badge>
                          <button type="button" role="switch" aria-checked={f.enabled} aria-label={`${f.label} for ${instituteName}`} disabled={busy} style={switchStyle(f.enabled, busy)} onClick={() => toggleFeature(f.key, !f.enabled)}>
                            <span style={knobStyle(f.enabled)} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {showHistory && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 8 }}>Recent changes</div>
                {history === null && <p className="mono" style={{ fontSize: 12 }}>Loading…</p>}
                {history && history.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No changes recorded yet.</p>}
                <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                  {(history || []).map((h) => (
                    <div key={h.id} style={{ fontSize: 12.5 }}>
                      <span className="mono" style={{ color: "var(--ink-dim)" }}>{new Date(h.createdAt).toLocaleString()}</span> · {h.adminName || "Admin"} · {describeLog(h)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {crossInstitute && (
          <>
            <div className="card" style={{ padding: 20, marginBottom: 24 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Change one feature for several institutes</div>
              <p style={{ fontSize: 12.5, color: "var(--ink-dim)", marginBottom: 12 }}>Applies to exactly the institutes you tick; it all happens together or not at all.</p>
              <div style={grid2}>
                <div>
                  <label style={labelStyle} htmlFor="bulk-feature-key">Feature</label>
                  <select id="bulk-feature-key" style={inputStyle} value={bulkFeatureKey} onChange={(e) => setBulkFeatureKey(e.target.value)} disabled={catalog.length === 0}>
                    <option value="">{catalog.length === 0 ? "Loading features…" : "Select a feature…"}</option>
                    {Object.entries(catalogByCategory).map(([cat, items]) => (
                      <optgroup key={cat} label={cat}>{items.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <span style={labelStyle} id="bulk-set-to-label">Set to</span>
                  <div role="radiogroup" aria-labelledby="bulk-set-to-label" style={{ display: "flex", gap: 8 }}>
                    {[["on", "Turn ON", true], ["off", "Turn OFF", false]].map(([id, text, val]) => (
                      <button key={id} type="button" role="radio" aria-checked={bulkEnabled === val} onClick={() => setBulkEnabled(val)}
                        style={{ flex: 1, padding: "9px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: bulkEnabled === val ? 700 : 500, border: `1.5px solid ${bulkEnabled === val ? (val ? "var(--mint)" : "var(--rust)") : "var(--line)"}`, background: bulkEnabled === val ? (val ? "var(--success-bg)" : "var(--danger-bg)") : "transparent", color: "var(--ink)" }}>
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {bulkFeature?.dependsOn && <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>{bulkFeature.label} needs {labelOf(bulkFeature.dependsOn)} to be on to work.</p>}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 14, marginBottom: 6 }}>
                <span style={labelStyle}>Institutes ({bulkInstituteIds.length} selected)</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input aria-label="Filter institutes" placeholder="Filter…" style={{ ...inputStyle, width: 150, padding: "5px 8px" }} value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)} />
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => setBulkInstituteIds((prev) => [...new Set([...prev, ...bulkVisible.map((i) => i.id)])])}>Select {bulkSearch ? "shown" : "all"}</button>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => setBulkInstituteIds([])} disabled={bulkInstituteIds.length === 0}>Clear</button>
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 160, overflowY: "auto", marginBottom: 12 }}>
                {bulkVisible.map((inst) => (
                  <label key={inst.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, border: `1px solid ${bulkInstituteIds.includes(inst.id) ? "var(--mint)" : "var(--line)"}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", background: bulkInstituteIds.includes(inst.id) ? "var(--success-bg)" : "transparent" }}>
                    <input type="checkbox" checked={bulkInstituteIds.includes(inst.id)} onChange={() => toggleBulkInstitute(inst.id)} />
                    {inst.name}
                  </label>
                ))}
                {bulkVisible.length === 0 && <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>No institute matches.</span>}
              </div>

              {!bulkConfirming ? (
                <button type="button" className="btn btn-primary" disabled={!bulkFeatureKey || bulkInstituteIds.length === 0} onClick={() => setBulkConfirming(true)}>
                  {!bulkFeatureKey ? "Choose a feature first" : bulkInstituteIds.length === 0 ? "Choose at least one institute" : `Review: turn ${bulkEnabled ? "ON" : "OFF"} for ${bulkInstituteIds.length} institute${bulkInstituteIds.length === 1 ? "" : "s"}`}
                </button>
              ) : (
                <div role="alertdialog" aria-label="Confirm bulk change" style={{ border: `1px solid ${bulkEnabled ? "var(--mint)" : "var(--rust)"}`, borderRadius: 10, padding: 12 }}>
                  <p style={{ fontSize: 13.5 }}>
                    Turn <strong>{bulkFeature?.label}</strong> <strong style={{ color: bulkEnabled ? "var(--mint)" : "var(--rust)" }}>{bulkEnabled ? "ON" : "OFF"}</strong> for{" "}
                    <strong>{bulkInstituteIds.length}</strong> institute{bulkInstituteIds.length === 1 ? "" : "s"}:{" "}
                    {bulkInstituteIds.slice(0, 6).map((id) => list.find((i) => i.id === id)?.name).filter(Boolean).join(", ")}{bulkInstituteIds.length > 6 ? ` and ${bulkInstituteIds.length - 6} more` : ""}.
                    {!bulkEnabled && " Students and staff there lose access immediately; data is kept."}
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button type="button" className={`btn ${bulkEnabled ? "btn-primary" : "btn-danger"}`} style={!bulkEnabled ? { background: "var(--rust)", color: "#fff" } : undefined} disabled={bulkBusy} onClick={applyBulk}>{bulkBusy ? "Applying…" : "Confirm and apply"}</button>
                    <button type="button" className="btn btn-ghost" disabled={bulkBusy} onClick={() => setBulkConfirming(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Copy one institute's configuration to another</div>
              <p style={{ fontSize: 12.5, color: "var(--ink-dim)", marginBottom: 12 }}>Every feature on the target is set to match the source. You see exactly what would change first.</p>
              <div style={grid2}>
                <div>
                  <label style={labelStyle} htmlFor="copy-feature-from">Copy from</label>
                  <select id="copy-feature-from" style={inputStyle} value={copyFrom} onChange={(e) => { setCopyFrom(e.target.value); setCopyPreview(null); }}>
                    <option value="">Select institute…</option>
                    {list.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle} htmlFor="copy-feature-to">Apply to</label>
                  <select id="copy-feature-to" style={inputStyle} value={copyTo} onChange={(e) => { setCopyTo(e.target.value); setCopyPreview(null); }}>
                    <option value="">Select institute…</option>
                    {list.filter((i) => i.id !== copyFrom).map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
                  </select>
                </div>
              </div>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} disabled={!copyFrom || !copyTo || copyFrom === copyTo} onClick={loadCopyPreview}>Preview changes</button>

              {copyPreview && (
                <div style={{ marginTop: 12 }} aria-live="polite">
                  <p style={{ fontSize: 13, marginBottom: 8 }}>{copyPreview.changeCount === 0 ? "The target already matches the source. Nothing to change." : `${copyPreview.changeCount} feature${copyPreview.changeCount === 1 ? "" : "s"} will change:`}</p>
                  <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                    {copyPreview.changes.filter((c) => c.willChange).map((c) => (
                      <div key={c.key} style={{ fontSize: 13 }}>
                        <strong>{c.label}</strong>: <span className="mono">{c.from ? "ON" : "OFF"}</span> → <span className="mono" style={{ color: c.to ? "var(--mint)" : "var(--rust)", fontWeight: 700 }}>{c.to ? "ON" : "OFF"}</span>
                      </div>
                    ))}
                  </div>
                  {copyPreview.changeCount > 0 && <button type="button" className="btn btn-primary" disabled={copying} onClick={applyCopy}>{copying ? "Applying…" : "Apply copy"}</button>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
