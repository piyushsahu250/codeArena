import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../api";
import useIsMobile from "../hooks/useIsMobile";

// Premium on-screen marksheet — the "View Marksheet" counterpart to MyResults.jsx's PDF-only
// download flow. Fetches the exact same payload the PDF generator uses (GET /results/me/:entryId,
// buildMarksheetData() server-side) so the on-screen view and the downloaded PDF never disagree
// about rank/class-average/attendance/verification-code.
export default function MarksheetView() {
  const { entryId } = useParams();
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [qrUrl, setQrUrl] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get(`/results/me/${entryId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load marksheet"));

    let objectUrl;
    api.get(`/results/me/${entryId}/qr.png`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setQrUrl(objectUrl);
      })
      .catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entryId]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await api.get(`/results/me/${entryId}/marksheet.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(data?.examination?.title || "marksheet").replace(/[^a-z0-9]+/gi, "-")}-marksheet.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download marksheet");
    } finally {
      setDownloading(false);
    }
  }

  async function share() {
    if (!data?.verifyUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Marksheet Verification", url: data.verifyUrl }); } catch {}
    } else {
      navigator.clipboard.writeText(data.verifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (error) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px 24px" }}>
          <p style={{ color: "var(--rust)" }}>{error}</p>
          <Link to="/results" className="btn btn-ghost" style={{ marginTop: 16 }}>Back to My Results</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px 24px", color: "var(--ink-dim)" }}>Loading…</div>
      </div>
    );
  }

  const { examination, entry, student, institute, department, division, rank, totalStudents, classAverage, attendancePercent, signatories, generatedAt } = data;
  const resultLabel = entry.passed ? examination.passLabel : examination.failLabel;
  const resultColor = entry.passed ? "var(--mint)" : "var(--rust)";

  const stats = [
    { label: "Obtained / Total", value: `${entry.obtainedMarks} / ${examination.totalMarks}` },
    { label: "Percentage", value: `${entry.percentage}%` },
    entry.grade ? { label: "Grade", value: entry.grade } : null,
    { label: "Result", value: resultLabel, color: resultColor },
    typeof rank === "number" ? { label: "Rank", value: totalStudents ? `${rank} of ${totalStudents}` : rank } : null,
    typeof classAverage === "number" ? { label: "Class Average", value: classAverage } : null,
    typeof attendancePercent === "number" ? { label: "Attendance", value: `${attendancePercent}%` } : null,
  ].filter(Boolean);

  return (
    <div>
      <Navbar />
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #marksheet-print-area, #marksheet-print-area * { visibility: visible; }
          #marksheet-print-area { position: absolute; top: 0; left: 0; width: 100%; }
          #marksheet-actions { display: none !important; }
        }
      `}</style>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px 64px" }}>
        <div id="marksheet-actions" style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <Link to="/results" className="btn btn-ghost" style={{ fontSize: 13 }}>← Back</Link>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => window.print()}>Print</button>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={share}>{copied ? "Link Copied" : "Share"}</button>
          {examination.allowPdfDownload && (
            <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={downloadPdf} disabled={downloading}>
              {downloading ? "Downloading…" : "Download PDF"}
            </button>
          )}
        </div>

        <div id="marksheet-print-area" className="card" style={{ padding: isMobile ? 20 : 32 }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {institute?.logoUrl && <img src={institute.logoUrl} alt="" style={{ width: 48, height: 48, objectFit: "contain" }} />}
              <div>
                <div style={{ fontWeight: 700, fontSize: 19 }}>{institute?.name || "Institute"}</div>
                <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                  Examination Marksheet{examination.semester ? ` • Semester: ${examination.semester}` : ""}
                </div>
              </div>
            </div>
            {student.profilePhotoUrl && (
              <img src={student.profilePhotoUrl} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: "1px solid var(--line)" }} />
            )}
          </div>

          <h2 style={{ marginTop: 18, fontSize: 16 }}>{examination.title}</h2>
          {examination.description && <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 4 }}>{examination.description}</p>}

          {/* Student info card */}
          <div style={{ marginTop: 20, background: "var(--card-bg, #F7F5EF)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <InfoRow label="Student Name" value={student.name} />
            <InfoRow label="Registration Number (PRN)" value={student.registrationNumber || "—"} />
            <InfoRow label="Roll Number" value={student.rollNumber || "—"} />
            <InfoRow label="Department" value={department || "—"} />
            <InfoRow label="Division / Section" value={division || "—"} />
            <InfoRow label="Batch" value={examination.batch || "—"} />
          </div>

          {/* Result summary stat cards */}
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.color || "inherit", marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Subject-wise table */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Subject-wise Performance</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--card-bg, #F7F5EF)" }}>
                    <th style={thStyle}>Subject</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Max Marks</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Marks Obtained</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdStyle}>{examination.title}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{examination.totalMarks}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{entry.obtainedMarks}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: resultColor, fontWeight: 700 }}>{resultLabel}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Remarks — admin-entered only, never fabricated */}
          {entry.remarks && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Remarks</div>
              <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 4 }}>{entry.remarks}</p>
            </div>
          )}

          {/* Verification */}
          <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            {qrUrl && <img src={qrUrl} alt="Verification QR code" style={{ width: 84, height: 84 }} />}
            <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              <div><strong>Marksheet ID:</strong> {entry.verificationCode || "—"}</div>
              <div style={{ marginTop: 2 }}>Scan the QR code to verify this marksheet is genuine.</div>
              <div style={{ marginTop: 2 }}>Generated: {new Date(generatedAt).toLocaleString()}</div>
            </div>
          </div>

          {/* Signatures */}
          {Array.isArray(signatories) && signatories.length > 0 && (
            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: `repeat(${Math.min(signatories.length, isMobile ? 2 : 4)}, 1fr)`, gap: 16 }}>
              {signatories.slice(0, 4).map((sig, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  {sig.signatureImageUrl && <img src={sig.signatureImageUrl} alt="" style={{ height: 32, objectFit: "contain", marginBottom: 4 }} />}
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{sig.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>{sig.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{value}</div>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--line)", fontSize: 11.5, color: "var(--ink-dim)" };
const tdStyle = { padding: "10px", borderBottom: "1px solid var(--line)" };
