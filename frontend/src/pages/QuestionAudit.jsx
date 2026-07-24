import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const SOURCE_LABEL = { Question: "Formal Test / Question Bank", PracticeQuestion: "Learning Module Practice", InterviewQuestion: "Mock Interview" };

export default function QuestionAudit() {
  const [data, setData] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("");

  useEffect(() => {
    api.get("/admin/question-audit").then((res) => setData(res.data));
  }, []);

  const items = (data?.items || []).filter((i) => !sourceFilter || i.source === sourceFilter);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Question Completeness Audit</h1>
            <ChalkUnderline />
          </div>
          <Link to="/admin" className="btn btn-ghost">← Back to Admin</Link>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
          Every coding question on the platform, checked against the same mandatory-field bar new questions are
          already held to at creation (description, input/output format, constraints, tags, starter code, 2+
          visible / 10+ hidden test cases). This only reports gaps — it never fills them in, since generating
          missing content on a question no one has reviewed isn't something to do silently.
        </p>

        {data && (
          <p className="mono" style={{ fontSize: 13, marginTop: 12 }}>
            {data.summary.incompleteCount} of {data.summary.totalScanned} coding questions have at least one missing field.
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {["", "Question", "PracticeQuestion", "InterviewQuestion"].map((s) => (
            <button
              key={s || "all"}
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "6px 12px", background: sourceFilter === s ? "var(--amber)" : undefined }}
              onClick={() => setSourceFilter(s)}
            >
              {s ? SOURCE_LABEL[s] : "All"}
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Title</th>
                <th style={{ padding: "10px 12px" }}>Source</th>
                <th style={{ padding: "10px 12px" }}>Missing Fields</th>
                <th style={{ padding: "10px 12px" }}>ID</th>
              </tr>
            </thead>
            <tbody>
              {data === null && (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }} className="mono">Scanning…</td></tr>
              )}
              {items.map((item) => (
                <tr key={`${item.source}-${item.id}`} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td style={{ padding: "10px 12px" }}>{item.title}</td>
                  <td style={{ padding: "10px 12px" }}>{SOURCE_LABEL[item.source] || item.source}</td>
                  <td style={{ padding: "10px 12px", color: "var(--rust)" }}>{item.missingFields.join(", ")}</td>
                  <td className="mono" style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-dim)" }}>{item.id}</td>
                </tr>
              ))}
              {data && items.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>
                  {sourceFilter ? "Nothing incomplete in this source." : "Every coding question meets the mandatory-field bar."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
