import { useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const ALL_SECTIONS = [
  { key: "personal", label: "Personal Details" }, { key: "summary", label: "Professional Summary" },
  { key: "education", label: "Education" }, { key: "skills", label: "Skills" }, { key: "projects", label: "Projects" },
  { key: "experience", label: "Experience" }, { key: "certifications", label: "Certifications" },
  { key: "achievements", label: "Achievements" }, { key: "languages", label: "Languages" },
];

export default function ResumeAdmin() {
  const { user } = useAuth();
  const isAdmin = user.role === "ADMIN";
  const [stats, setStats] = useState(null);
  const [students, setStudents] = useState(null);
  const [config, setConfig] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [feedbackText, setFeedbackText] = useState("");

  function loadAll() {
    api.get("/resume/admin/stats").then((res) => setStats(res.data));
    api.get("/resume/admin/students").then((res) => setStudents(res.data));
    api.get("/resume/field-config").then((res) => setConfig(res.data));
  }
  useEffect(loadAll, []);

  function viewStudent(s) {
    setSelected(s);
    setDetail(null);
    api.get(`/resume/admin/${s.studentId}`).then((res) => setDetail(res.data)).catch((err) => setDetail({ error: err.response?.data?.error || "Failed to load" }));
  }

  async function downloadPdf(studentId, name) {
    try {
      const { data } = await api.get(`/resume/admin/${studentId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${name || "resume"}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to download");
    }
  }

  async function sendFeedback() {
    if (!feedbackText.trim()) return;
    try {
      await api.post(`/resume/admin/${selected.studentId}/feedback`, { message: feedbackText.trim() });
      setFeedbackText("");
      alert("Feedback sent.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to send feedback");
    }
  }

  function toggleMandatory(key) {
    if (!isAdmin || !config) return;
    const next = config.mandatorySections.includes(key)
      ? config.mandatorySections.filter((k) => k !== key)
      : [...config.mandatorySections, key];
    api.patch("/resume/field-config", { mandatorySections: next }).then((res) => setConfig(res.data));
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Resume Builder — Admin</h1>
        <ChalkUnderline />

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 24 }}>
            <StatCard label="Students" value={stats.totalStudents} />
            <StatCard label="Resumes Started" value={stats.resumesStarted} />
            <StatCard label="Average Completion" value={`${stats.averageCompletion}%`} />
            <StatCard label="Fully Complete" value={stats.fullyComplete} />
          </div>
        )}

        {config && (
          <div className="card" style={{ padding: 16, marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mandatory Sections {!isAdmin && "(read-only — Admin only)"}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALL_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  className={config.mandatorySections.includes(s.key) ? "btn btn-dark" : "btn btn-ghost"}
                  style={{ fontSize: 12 }}
                  onClick={() => toggleMandatory(s.key)}
                  disabled={!isAdmin}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 24, marginTop: 24, alignItems: "start" }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Students</div>
            <div style={{ display: "grid", gap: 8, maxHeight: 500, overflowY: "auto" }}>
              {(students || []).map((s) => (
                <div
                  key={s.studentId}
                  onClick={() => viewStudent(s)}
                  className="card"
                  style={{
                    padding: 10, cursor: "pointer",
                    background: selected?.studentId === s.studentId ? "var(--warning-bg)" : "var(--card-bg)",
                    color: selected?.studentId === s.studentId ? "var(--amber-dark)" : "var(--ink)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{s.name}</span>
                    <span className="mono" style={{ color: s.completion === 100 ? "var(--mint)" : "var(--ink-dim)" }}>{s.hasResume ? `${s.completion}%` : "Not started"}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{s.rollNumber || s.email}</div>
                </div>
              ))}
              {students && students.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No students found.</p>}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            {!selected && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Select a student to view their resume.</p>}
            {selected && !detail && <p className="mono" style={{ fontSize: 13 }}>Loading…</p>}
            {selected && detail?.error && <p style={{ color: "var(--rust)", fontSize: 13 }}>{detail.error}</p>}
            {selected && detail && !detail.error && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>{detail.resume.fullName || selected.name}</div>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadPdf(selected.studentId, detail.resume.fullName)}>⬇ Download PDF</button>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{detail.resume.email} · {detail.resume.mobile}</div>
                <div className="mono" style={{ fontSize: 12, marginTop: 8 }}>
                  Completion: {detail.completion.percent}% · ATS Score: {detail.atsScore.score}/100 ({detail.atsScore.status})
                </div>
                {detail.completion.missingSections.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>Missing: {detail.completion.missingSections.join(", ")}</div>
                )}

                <div style={{ marginTop: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Send feedback</label>
                  <textarea
                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 6, minHeight: 60 }}
                    placeholder="e.g. Add more measurable achievements to your projects section."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                  />
                  <button className="btn btn-primary" style={{ fontSize: 12, marginTop: 8 }} onClick={sendFeedback}>Send</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}
