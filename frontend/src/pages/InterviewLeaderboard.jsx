import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import "./interviewPrep.css";

const SCOPES = [{ id: "group", label: "Group" }, { id: "institute", label: "Institute" }];

export default function InterviewLeaderboard() {
  const { user } = useAuth();
  const [scope, setScope] = useState("group");
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    api.get("/interview/leaderboard", { params: { scope } }).then((res) => setRows(res.data));
  }, [scope]);

  return (
    <div className="interview-prep">
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><h1>Aptitude Leaderboard</h1><ChalkUnderline /></div>
          <Link to="/interview" className="btn btn-ghost">← AI Mock Interview</Link>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {SCOPES.map((s) => (
            <button key={s.id} className={scope === s.id ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setScope(s.id)}>{s.label}</button>
          ))}
        </div>

        {!rows && <p className="mono" style={{ marginTop: 20 }}>Loading…</p>}
        {rows && rows.length === 0 && <div className="ip-glass" style={{ padding: 24, marginTop: 20, textAlign: "center" }}>No aptitude interviews completed yet in this scope.</div>}

        <div className="ip-glass" style={{ marginTop: 20, overflowX: "auto" }}>
          {rows && rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
                  <th style={{ padding: 12 }}>Rank</th><th style={{ padding: 12 }}>Student</th>
                  <th style={{ padding: 12 }}>Average Score</th><th style={{ padding: 12 }}>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.studentId} style={{ fontSize: 13, background: r.studentId === user.id ? "rgba(79,157,110,0.12)" : "transparent" }}>
                    <td className="mono" style={{ padding: 12, fontWeight: 700 }}>#{r.rank}</td>
                    <td style={{ padding: 12 }}>{r.name}{r.studentId === user.id ? " (you)" : ""}</td>
                    <td className="mono" style={{ padding: 12 }}>{r.averageScore}%</td>
                    <td className="mono" style={{ padding: 12 }}>{r.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
