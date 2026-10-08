import { useEffect, useState } from "react";
import { Flame, Mountain, Trophy, Medal, Lock } from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const CATEGORY_LABEL = { LEARNING: "Learning", CODING: "Coding", ASSESSMENT: "Assessment", CONSISTENCY: "Consistency", SPECIAL: "Special" };
const SCOPES = [{ id: "group", label: "Group" }, { id: "department", label: "Department" }, { id: "institute", label: "Institute" }];
const METRICS = [{ id: "xp", label: "XP" }, { id: "problems", label: "Problems Solved" }, { id: "learning", label: "Learning Progress" }, { id: "streak", label: "Streak" }];

export default function Achievements() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("group");
  const [metric, setMetric] = useState("xp");
  const [leaderboard, setLeaderboard] = useState(null);
  const [lbError, setLbError] = useState("");

  useEffect(() => {
    api.get("/gamification/me").then((res) => setData(res.data)).catch(() => setError("Failed to load achievements"));
  }, []);

  useEffect(() => {
    setLeaderboard(null);
    setLbError("");
    api.get("/gamification/leaderboard", { params: { scope, metric } })
      .then((res) => setLeaderboard(res.data))
      .catch((err) => setLbError(err.response?.data?.error || "Failed to load leaderboard"));
  }, [scope, metric]);

  if (error) return <div><Navbar /><div style={{ maxWidth: 1000, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!data) return <div><Navbar /><div style={{ maxWidth: 1000, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const { level, streak, badges, history } = data;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Achievements</h1>
        <ChalkUnderline />

        {/* Level + XP */}
        <div className="card" style={{ padding: 24, marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>Level {level.level}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)" }}>{level.name}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--mint)" }}>{level.totalXp} XP</div>
              {level.nextLevelName && <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{level.xpToNext} XP to {level.nextLevelName}</div>}
            </div>
          </div>
          {level.nextLevelName && (
            <div style={{ height: 10, borderRadius: 5, background: "var(--line)", marginTop: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${level.progressPercent}%`, background: "var(--mint)", transition: "width 0.3s" }} />
            </div>
          )}
        </div>

        {/* Streak + rank */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 }}>
          <MiniCard icon={Flame} label="Current Streak" value={`${streak.current} day${streak.current === 1 ? "" : "s"}`} />
          <MiniCard icon={Mountain} label="Longest Streak" value={`${streak.longest} day${streak.longest === 1 ? "" : "s"}`} />
          <MiniCard icon={Trophy} label="Class Rank" value={data.leaderboardRank.rank ? `#${data.leaderboardRank.rank}/${data.leaderboardRank.totalStudents}` : "—"} />
          <MiniCard icon={Medal} label="Badges Earned" value={badges.earned.length} />
        </div>

        {/* Badges */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Badges</h3>
        {["LEARNING", "CODING", "ASSESSMENT", "CONSISTENCY", "SPECIAL"].map((cat) => {
          const earnedInCat = badges.earned.filter((b) => b.category === cat);
          const lockedInCat = badges.locked.filter((b) => b.category === cat);
          if (earnedInCat.length === 0 && lockedInCat.length === 0) return null;
          return (
            <div key={cat} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginBottom: 8 }}>{CATEGORY_LABEL[cat]}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                {earnedInCat.map((b) => (
                  <div key={b.code} className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 24 }}>{b.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{b.description}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--mint)", marginTop: 6 }}>Earned {new Date(b.earnedAt).toLocaleDateString()}</div>
                  </div>
                ))}
                {lockedInCat.map((b) => (
                  <div key={b.code} className="card" style={{ padding: 14, opacity: 0.45 }}>
                    <Lock size={24} />
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{b.description}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Leaderboard */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Leaderboard</h3>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {SCOPES.map((s) => (
              <button key={s.id} className={scope === s.id ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setScope(s.id)}>{s.label}</button>
            ))}
            <span style={{ width: 1, background: "var(--line)", margin: "0 4px" }} />
            {METRICS.map((m) => (
              <button key={m.id} className={metric === m.id ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setMetric(m.id)}>{m.label}</button>
            ))}
          </div>

          {lbError && <p style={{ color: "var(--rust)", fontSize: 13 }}>{lbError}</p>}
          {!lbError && !leaderboard && <p className="mono" style={{ fontSize: 13 }}>Loading…</p>}
          {leaderboard && leaderboard.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No students found for this scope.</p>}
          {leaderboard && leaderboard.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                    <th style={{ padding: "8px 6px" }}>Rank</th>
                    <th style={{ padding: "8px 6px" }}>Student</th>
                    <th style={{ padding: "8px 6px" }}>XP</th>
                    <th style={{ padding: "8px 6px" }}>Problems Solved</th>
                    <th style={{ padding: "8px 6px" }}>Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row) => (
                    <tr key={row.studentId} style={{ borderBottom: "1px solid var(--line)", fontSize: 13, background: row.studentId === user.id ? "rgba(232,163,61,0.08)" : "transparent" }}>
                      <td className="mono" style={{ padding: "8px 6px", fontWeight: 700 }}>#{row.rank}</td>
                      <td style={{ padding: "8px 6px" }}>{row.name}{row.studentId === user.id ? " (you)" : ""}</td>
                      <td className="mono" style={{ padding: "8px 6px" }}>{row.xp}</td>
                      <td className="mono" style={{ padding: "8px 6px" }}>{row.problemsSolved}</td>
                      <td className="mono" style={{ padding: "8px 6px" }}>{row.streak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Achievement history */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Achievement History</h3>
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Achievement</th>
                <th style={{ padding: "10px 12px" }}>Date Earned</th>
                <th style={{ padding: "10px 12px" }}>XP Awarded</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td style={{ padding: "10px 12px" }}>{h.label}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{new Date(h.date).toLocaleString()}</td>
                  <td className="mono" style={{ padding: "10px 12px", color: "var(--mint)" }}>+{h.xp}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={3} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No achievements yet — start a lesson or a test to earn your first XP.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ icon: Icon, label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <Icon size={18} />
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
}
