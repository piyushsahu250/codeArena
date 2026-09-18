import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import "./interviewPrep.css";

export default function InterviewProgress() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/interview/progress").then((res) => setData(res.data)).catch(() => setError("Could not load your progress. Please try again later."));
  }, []);

  return (
    <div className="interview-prep">
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><h1>Progress</h1><ChalkUnderline /></div>
          <Link to="/interview" className="btn btn-ghost">← AI Mock Interview</Link>
        </div>

        {error && <div className="ip-glass" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--rust)" }}>{error}</div>}
        {!data && !error && <p className="mono" style={{ marginTop: 24 }}>Loading…</p>}
        {data && data.history.length === 0 && <div className="ip-glass" style={{ padding: 24, marginTop: 24, textAlign: "center" }}>Complete a few interviews to see your progress here.</div>}

        {data && data.weekly.length > 0 && (
          <div className="ip-glass" style={{ padding: 20, marginTop: 24 }}>
            <h4 style={{ fontSize: 14, marginBottom: 12 }}>Weekly Improvement</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ip-glass-border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="averageScore" stroke="var(--ip-accent, #4F9D6E)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {data && data.monthly.length > 0 && (
          <div className="ip-glass" style={{ padding: 20, marginTop: 20 }}>
            <h4 style={{ fontSize: 14, marginBottom: 12 }}>Monthly Improvement</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ip-glass-border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="averageScore" stroke="#C7852A" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {data && data.history.length > 0 && (
          <div className="ip-glass" style={{ marginTop: 20, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
                  <th style={{ padding: 10 }}>Date</th><th style={{ padding: 10 }}>Type</th><th style={{ padding: 10 }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {data.history.slice().reverse().map((h, i) => (
                  <tr key={i} style={{ fontSize: 13 }}>
                    <td className="mono" style={{ padding: 10 }}>{new Date(h.date).toLocaleDateString()}</td>
                    <td style={{ padding: 10 }}>{h.isMock ? "Mock" : h.category}</td>
                    <td className="mono" style={{ padding: 10 }}>{h.score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
