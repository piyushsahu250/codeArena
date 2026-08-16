import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import UploadProgressBar from "../components/UploadProgressBar";

// How long to keep polling a batch's live send status before giving up and pointing the admin at
// Email Logs instead — generous enough for a few hundred students at EMAIL_CONCURRENCY=5 without
// polling forever if something got stuck.
const BATCH_POLL_INTERVAL_MS = 3000;
const BATCH_POLL_MAX_ATTEMPTS = 20;

export default function BulkUpload() {
  const [file, setFile] = useState(null);
  const [sendCredentials, setSendCredentials] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [batchSummary, setBatchSummary] = useState(null);
  const fileInputRef = useRef(null);

  // Credential emails for this batch now send in the background after the upload response
  // already came back (see backend/src/routes/users.js's bulk-upload route) — so the sent/failed
  // counts aren't known at upload time. Poll the lightweight batch-summary endpoint until every
  // queued email reaches a terminal status, or the attempt cap is hit.
  useEffect(() => {
    if (!result?.batchId) { setBatchSummary(null); return; }
    let cancelled = false;
    let attempts = 0;
    setBatchSummary(null);

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const { data } = await api.get(`/admin/email-logs/batch/${result.batchId}/summary`);
        if (cancelled) return;
        setBatchSummary(data);
        const done = data.sent + data.failed >= result.emailsQueued;
        if (!done && attempts < BATCH_POLL_MAX_ATTEMPTS) setTimeout(poll, BATCH_POLL_INTERVAL_MS);
      } catch {
        if (attempts < BATCH_POLL_MAX_ATTEMPTS) setTimeout(poll, BATCH_POLL_INTERVAL_MS);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [result?.batchId]);

  async function downloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const res = await api.get("/users/bulk-template", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "student-upload-template.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download template");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  function downloadCsv(filename, headers, rows) {
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setError("");
    setResult(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sendCredentials", sendCredentials ? "true" : "false");
      const { data } = await api.post("/users/bulk-upload", formData);
      setResult(data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Bulk student upload</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>

        <p style={{ color: "var(--ink-dim)", marginTop: 16, fontSize: 14 }}>
          Upload an Excel (.xlsx) or CSV file to create student accounts for an entire batch at once. Each row's
          Institute must already exist (create it first under Institute Management) and needs a Batch/Year — each
          unique Institute + Batch + Department + Section combination is grouped automatically, with Department
          defaulting to "Unassigned" and Section to "Section A" when left blank. Every account gets its own
          unique, randomly generated password — never shared with any other account — and must be changed on
          first login. Download the full credentials list below after uploading.
        </p>

        <div className="card" style={{ padding: 24, marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Required columns</div>
              <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>
                Student Name, Registration Number (PRN), Official Email ID, Institute, Batch/Year — plus optional Mobile
                Number, Department, Program, Section, Gender, and Status (Active/Inactive — defaults to Active). Roll
                Number is not a template column — it's generated automatically from the last 3 characters of the
                Registration Number after import. Date of Birth and other personal details are collected separately
                via each student's own Profile page, not this template.
              </p>
            </div>
            <button className="btn btn-ghost" onClick={downloadTemplate} disabled={downloadingTemplate}>
              {downloadingTemplate ? "Downloading…" : "⬇ Download sample template"}
            </button>
          </div>

          <form onSubmit={handleUpload} style={{ marginTop: 20 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ display: "block" }}
            />

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13 }}>
              <input type="checkbox" checked={sendCredentials} onChange={(e) => setSendCredentials(e.target.checked)} />
              Email login credentials to each student's official email
            </label>

            {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}

            <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={!file || uploading}>
              {uploading ? "Uploading…" : "Upload and create accounts"}
            </button>
            <UploadProgressBar active={uploading} />
          </form>
        </div>

        {result && (
          <div style={{ marginTop: 24 }}>
            <div className="card" style={{ padding: 20 }}>
              <p style={{ fontSize: 15 }}>
                <strong>{result.createdCount}</strong> student account{result.createdCount === 1 ? "" : "s"} created
                successfully out of {result.total} record{result.total === 1 ? "" : "s"}.
                {result.duplicateCount > 0 && ` ${result.duplicateCount} skipped as duplicates.`}
                {result.errorCount > 0 && ` ${result.errorCount} failed validation.`}
              </p>
              {result.sendCredentials && result.emailsQueued > 0 && (
                <p style={{ fontSize: 13, marginTop: 8 }}>
                  {!batchSummary ? (
                    <span style={{ color: "var(--ink-dim)" }}>
                      {result.emailsQueued} credential email{result.emailsQueued === 1 ? "" : "s"} queued — sending now…
                    </span>
                  ) : (
                    <>
                      {batchSummary.sent > 0 && (
                        <span style={{ color: "var(--mint)", fontWeight: 600 }}>✓ {batchSummary.sent} sent. </span>
                      )}
                      {batchSummary.failed > 0 && (
                        <span style={{ color: "var(--rust)", fontWeight: 600 }}>
                          ✗ {batchSummary.failed} could not be delivered — see <Link to="/admin/email-logs">Email Logs</Link> for details and retry.{" "}
                        </span>
                      )}
                      {batchSummary.pending > 0 && (
                        <span style={{ color: "var(--ink-dim)" }}>{batchSummary.pending} still sending…</span>
                      )}
                    </>
                  )}
                </p>
              )}
            </div>

            {result.created?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--mint)" }}>Created accounts &amp; passwords</div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => downloadCsv(
                      "student-credentials.csv",
                      ["Name", "Email", "Registration Number", "Roll Number", "Temporary Password"],
                      result.created.map((u) => [u.name, u.email, u.registrationNumber, u.rollNumber, u.generatedPassword])
                    )}
                  >
                    ⬇ Download Credentials (CSV)
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                  Each student has a unique password — download this list now, since it won't be shown again once
                  you leave this page (passwords are never stored in plain text). They'll be asked to set a new
                  one on first login.
                </p>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                      <th style={{ padding: "6px 4px" }}>Roll no.</th>
                      <th>Name</th>
                      <th>Registration No. (PRN)</th>
                      <th>Email</th>
                      <th>Temporary password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.created.map((u, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                        <td className="mono" style={{ padding: "6px 4px" }}>{u.rollNumber}</td>
                        <td>{u.name}</td>
                        <td className="mono">{u.registrationNumber}</td>
                        <td className="mono">{u.email}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{u.generatedPassword}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(result.duplicates.length > 0 || result.errors.length > 0) && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 16 }}
                onClick={() => downloadCsv(
                  "bulk-upload-error-report.csv",
                  ["Row", "Type", "Roll Number", "Name", "Registration Number", "Email", "Reason"],
                  [
                    ...result.duplicates.map((r) => [r.row, "Duplicate", r.rollNumber, r.name, r.registrationNumber, r.email, r.reason]),
                    ...result.errors.map((r) => [r.row, "Error", r.rollNumber, r.name, r.registrationNumber, r.email, r.reason]),
                  ]
                )}
              >
                ⬇ Download Error Report (CSV)
              </button>
            )}
            {result.duplicates.length > 0 && (
              <ResultTable title="Duplicate records (skipped)" rows={result.duplicates} color="var(--amber-dark)" />
            )}
            {result.errors.length > 0 && (
              <ResultTable title="Failed records" rows={result.errors} color="var(--rust)" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultTable({ title, rows, color }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
            <th style={{ padding: "6px 4px" }}>Row</th>
            <th>Roll No.</th>
            <th>Name</th>
            <th>Reg. No. (PRN)</th>
            <th>Email</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <td className="mono" style={{ padding: "6px 4px" }}>{r.row}</td>
              <td className="mono">{r.rollNumber || "—"}</td>
              <td>{r.name || "—"}</td>
              <td className="mono">{r.registrationNumber || "—"}</td>
              <td className="mono">{r.email || "—"}</td>
              <td style={{ color }}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
