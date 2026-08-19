import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eye, History } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useAuth } from "../context/AuthContext";
import useIsMobile from "../hooks/useIsMobile";

// Renders at /admin/exports, /staff/exports, /clerk/exports (basePath controls the back link) —
// Staff get an institute-scoped export (see attachRequesterInstitute in
// backend/src/routes/exports.js), Admin gets institute-scoped or, for a platform-level Super
// Admin account, everything. Clerk's export access is restricted server-side to the "students"
// entity only, mirrored here so Clerk never even sees a control for data outside that scope.
const ALL_ENTITIES = [
  { value: "students", label: "Students" },
  { value: "staff", label: "Staff & Admins" },
  { value: "results", label: "Test Results" },
  { value: "reports", label: "AI Interview Reports" },
  { value: "certificates", label: "Certificates" },
  { value: "questions", label: "Question Bank" },
  { value: "talentPools", label: "Talent Pool Members" },
];
const FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "json", label: "JSON" },
];
const DATE_RANGE_ENTITIES = new Set(["results", "reports", "certificates"]);
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 };

function toISODate(d) { return d.toISOString().slice(0, 10); }
function datePreset(preset) {
  const today = new Date();
  const start = new Date(today);
  if (preset === "yesterday") { start.setDate(start.getDate() - 1); return { dateFrom: toISODate(start), dateTo: toISODate(start) }; }
  if (preset === "thisWeek") { start.setDate(start.getDate() - start.getDay()); return { dateFrom: toISODate(start), dateTo: toISODate(today) }; }
  if (preset === "thisMonth") { start.setDate(1); return { dateFrom: toISODate(start), dateTo: toISODate(today) }; }
  return { dateFrom: toISODate(today), dateTo: toISODate(today) }; // "today"
}

export default function ExportCenter({ basePath }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const ENTITIES = useMemo(() => (user?.role === "CLERK" ? ALL_ENTITIES.filter((e) => e.value === "students") : ALL_ENTITIES), [user?.role]);

  const [entity, setEntity] = useState(ENTITIES[0]?.value || "students");
  const [format, setFormat] = useState("csv");
  const [filters, setFilters] = useState({ batch: "", placementParticipation: "", offerVerificationStatus: "", poolId: "", dateFrom: "", dateTo: "" });
  const [pools, setPools] = useState([]);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null); // { rowCount } | { empty: true } | null
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (entity === "talentPools" && user?.role !== "CLERK") {
      api.get("/talent-pools").then((res) => setPools(res.data.rows || res.data || [])).catch(() => setPools([]));
    }
  }, [entity, user?.role]);

  useEffect(() => { loadHistory(); }, []);

  function loadHistory() {
    setHistoryLoading(true);
    api.get("/export/history/mine", { params: { pageSize: 10 } })
      .then((res) => setHistory(res.data))
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  }

  function set(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
    setPreview(null); // any filter/entity change invalidates a prior preview
  }
  function changeEntity(value) {
    setEntity(value);
    setPreview(null);
    setError("");
  }

  function activeParams() {
    const params = { format };
    if (entity === "students") {
      if (filters.batch) params.batch = filters.batch;
      if (filters.placementParticipation) params.placementParticipation = filters.placementParticipation;
      if (filters.offerVerificationStatus) params.offerVerificationStatus = filters.offerVerificationStatus;
    }
    if (entity === "talentPools" && filters.poolId) params.poolId = filters.poolId;
    if (DATE_RANGE_ENTITIES.has(entity)) {
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
    }
    return params;
  }

  async function runPreview() {
    if (entity === "talentPools" && !filters.poolId) { setError("Pick a Talent Pool first."); return; }
    setPreviewing(true);
    setError("");
    setPreview(null);
    try {
      const res = await api.get(`/export/${entity}`, { params: { ...activeParams(), format: "json" }, responseType: "blob" });
      if (res.status === 204) { setPreview({ empty: true }); return; }
      const text = await res.data.text();
      const rows = JSON.parse(text);
      setPreview({ rowCount: Array.isArray(rows) ? rows.length : 0 });
    } catch (err) {
      setError(await blobError(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function runExport() {
    setGenerating(true);
    setError("");
    try {
      const res = await api.get(`/export/${entity}`, { params: activeParams(), responseType: "blob" });
      if (res.status === 204) { setPreview({ empty: true }); return; }
      const mime = format === "json" ? "application/json" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
      const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `codearena-${entity}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPreview(null);
      loadHistory();
    } catch (err) {
      setError(await blobError(err));
    } finally {
      setGenerating(false);
    }
  }

  async function blobError(err) {
    if (err.response?.data instanceof Blob) {
      try { return JSON.parse(await err.response.data.text()).error || "Export failed"; }
      catch { return "Export failed"; }
    }
    return err.response?.data?.error || "Export failed";
  }

  const entityLabel = ENTITIES.find((e) => e.value === entity)?.label || entity;
  const formatLabel = FORMATS.find((f) => f.value === format)?.label || format;
  const filterSummary = Object.entries(filters).filter(([k, v]) => {
    if (!v) return false;
    if (k === "batch" || k === "placementParticipation" || k === "offerVerificationStatus") return entity === "students";
    if (k === "poolId") return entity === "talentPools";
    if (k === "dateFrom" || k === "dateTo") return DATE_RANGE_ENTITIES.has(entity);
    return false;
  });

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: isMobile ? "32px 16px" : "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div><h1>Export Center</h1><ChalkUnderline /></div>
          <Link to={basePath || "/admin"} className="btn btn-ghost">← Back</Link>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 12 }}>
          Export platform data as CSV, Excel, or JSON — capped at 5,000 rows per export, newest
          first. Preview the record count before generating. For a complete untruncated copy of
          everything, see the full database backup.
        </p>

        <div className="card" style={{ padding: 20, marginTop: 24, display: "grid", gap: 14 }}>
          <div>
            <label style={labelStyle}>Data</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ENTITIES.map((e) => (
                <button
                  key={e.value}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "6px 12px", background: entity === e.value ? "var(--amber)" : undefined }}
                  onClick={() => changeEntity(e.value)}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          {entity === "students" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
              <div>
                <label style={labelStyle}>Batch</label>
                <input style={inputStyle} placeholder="e.g. 2026" value={filters.batch} onChange={(e) => set("batch", e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Placement Participation</label>
                <select style={inputStyle} value={filters.placementParticipation} onChange={(e) => set("placementParticipation", e.target.value)}>
                  <option value="">All</option>
                  <option value="INTERESTED">Registered</option>
                  <option value="NOT_INTERESTED">Not Registered</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Offer Verification</label>
                <select style={inputStyle} value={filters.offerVerificationStatus} onChange={(e) => set("offerVerificationStatus", e.target.value)}>
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="VERIFIED">Verified</option>
                </select>
              </div>
            </div>
          )}

          {entity === "talentPools" && (
            <div>
              <label style={labelStyle}>Talent Pool</label>
              <select style={inputStyle} value={filters.poolId} onChange={(e) => set("poolId", e.target.value)}>
                <option value="">Select a pool…</option>
                {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {DATE_RANGE_ENTITIES.has(entity) && (
            <div>
              <label style={labelStyle}>Date Range</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {[["today", "Today"], ["yesterday", "Yesterday"], ["thisWeek", "This Week"], ["thisMonth", "This Month"]].map(([key, label]) => (
                  <button key={key} type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}
                    onClick={() => setFilters((f) => ({ ...f, ...datePreset(key) }))}>
                    {label}
                  </button>
                ))}
                {(filters.dateFrom || filters.dateTo) && (
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", color: "var(--rust)" }}
                    onClick={() => { setFilters((f) => ({ ...f, dateFrom: "", dateTo: "" })); setPreview(null); }}>
                    Clear
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ ...labelStyle, fontWeight: 400, fontSize: 11 }}>From</label>
                  <input type="date" style={inputStyle} value={filters.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontWeight: 400, fontSize: 11 }}>To</label>
                  <input type="date" style={inputStyle} value={filters.dateTo} onChange={(e) => set("dateTo", e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>Format</label>
            <div style={{ display: "flex", gap: 8 }}>
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "6px 12px", background: format === f.value ? "var(--amber)" : undefined }}
                  onClick={() => { setFormat(f.value); setPreview(null); }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} disabled={previewing} onClick={runPreview}>
              <Eye size={16} />
              {previewing ? "Checking…" : "Preview"}
            </button>
            {preview && !preview.empty && (
              <button className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} disabled={generating} onClick={runExport}>
                <Download size={16} />
                {generating ? "Generating…" : "Generate Export"}
              </button>
            )}
          </div>

          {preview?.empty && (
            <p style={{ fontSize: 13, color: "var(--ink-dim)", background: "var(--paper-2, #f5f5f0)", padding: "10px 12px", borderRadius: 8 }}>
              No records found for the selected filters. Try widening them and preview again.
            </p>
          )}
          {preview && !preview.empty && (
            <div style={{ fontSize: 13, background: "var(--paper-2, #f5f5f0)", padding: "12px 14px", borderRadius: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Export: {entityLabel}</div>
              {filterSummary.length > 0 && (
                <div style={{ color: "var(--ink-dim)" }}>
                  Filters: {filterSummary.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                </div>
              )}
              <div>Records: <strong>{preview.rowCount.toLocaleString()}</strong></div>
              <div>Format: {formatLabel}</div>
            </div>
          )}
          {error && <p style={{ color: "var(--rust)", fontSize: 13 }}>{error}</p>}
        </div>

        <div style={{ marginTop: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <History size={16} />
            <h3 style={{ margin: 0, fontSize: 15 }}>Recent Exports</h3>
          </div>
          {historyLoading && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>}
          {!historyLoading && history && history.rows.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No exports yet.</p>
          )}
          {!historyLoading && history && history.rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", color: "var(--ink-dim)" }}>
                    <th style={{ padding: "6px 8px" }}>Data</th>
                    <th style={{ padding: "6px 8px" }}>Format</th>
                    <th style={{ padding: "6px 8px" }}>Requested By</th>
                    <th style={{ padding: "6px 8px" }}>Records</th>
                    <th style={{ padding: "6px 8px" }}>Status</th>
                    <th style={{ padding: "6px 8px" }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((h) => (
                    <tr key={h.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "6px 8px" }}>{ALL_ENTITIES.find((e) => e.value === h.entity)?.label || h.entity}</td>
                      <td style={{ padding: "6px 8px" }} className="mono">{h.format?.toUpperCase()}</td>
                      <td style={{ padding: "6px 8px" }}>{h.requestedByName}</td>
                      <td style={{ padding: "6px 8px" }}>{h.rowCount ?? "—"}</td>
                      <td style={{ padding: "6px 8px", fontWeight: 700, color: h.status === "COMPLETED" ? "var(--mint)" : h.status === "FAILED" ? "var(--rust)" : "var(--amber-dark)" }}>
                        {h.status}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{new Date(h.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6 }}>
                Generated files aren't stored on the server — re-run an export from above to get the file again.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
