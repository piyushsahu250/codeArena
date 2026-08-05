import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import api from "../api";

// Student's own published exam/marksheet results — self-scoped entirely server-side (GET
// /results/me only ever returns entries whose examination.status is PUBLISHED), same
// "nothing to filter, just display" shape as MyTalentPools.jsx.
export default function MyResults() {
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    api.get("/results/me")
      .then((res) => setResults(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load your results"));
  }, []);

  async function downloadMarksheet(entryId, title) {
    setDownloadingId(entryId);
    try {
      const res = await api.get(`/results/me/${entryId}/marksheet.pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[^a-z0-9]+/gi, "-")}-marksheet.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download marksheet");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1>My Results</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Marksheets for offline/manually-conducted examinations your institute has published.
        </p>

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{error}</p>}
        {!results && !error && <p style={{ marginTop: 24, color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}

        {results && results.length === 0 && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            No results have been published for you yet.
          </div>
        )}

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          {results?.map((r) => (
            <div key={r.entryId} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{r.title}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>
                    {r.instituteName}{r.batch ? ` · ${r.batch}` : ""}
                  </div>
                  {r.description && <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{r.description}</div>}
                </div>
                <span
                  className="badge"
                  style={{ background: r.passed ? "var(--mint)" : "var(--rust)", color: "#fff", fontWeight: 700 }}
                >
                  {r.resultLabel}
                </span>
              </div>

              <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Marks</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{r.obtainedMarks} / {r.totalMarks}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Percentage</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{r.percentage}%</div>
                </div>
                {r.grade && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Grade</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{r.grade}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Exam Date</div>
                  <div style={{ fontSize: 14, marginTop: 3 }}>{new Date(r.examDate).toLocaleDateString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>Published</div>
                  <div style={{ fontSize: 14, marginTop: 3 }}>{r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : "—"}</div>
                </div>
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link to={`/results/${r.entryId}`} className="btn btn-primary" style={{ fontSize: 13 }}>
                  View Marksheet
                </Link>
                {r.allowPdfDownload && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 13 }}
                    disabled={downloadingId === r.entryId}
                    onClick={() => downloadMarksheet(r.entryId, r.title)}
                  >
                    {downloadingId === r.entryId ? "Downloading…" : "Download Marksheet (PDF)"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
