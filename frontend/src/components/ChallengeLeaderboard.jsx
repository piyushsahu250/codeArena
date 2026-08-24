// Shared by DailyChallenge.jsx and WeeklyChallenge.jsx — renders the response shape returned by
// GET /challenges/daily|weekly/:id/leaderboard ({ leaderboard: [{rank, studentId, name, isYou,
// solvedAt, timeMs}], yourRank }). Already institute-scoped and capped server-side; this component
// only ever renders what it's given.
export default function ChallengeLeaderboard({ leaderboard, yourRank }) {
  if (!leaderboard) return null;
  if (leaderboard.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>No one in your institute has solved this yet — be the first.</p>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      {yourRank && (
        <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 8 }}>
          Your rank: <strong style={{ color: "var(--ink)" }}>#{yourRank}</strong>
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {leaderboard.slice(0, 10).map((r) => (
          <div
            key={r.studentId}
            className="mono"
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "6px 10px", borderRadius: 6, fontSize: 12,
              background: r.isYou ? "var(--card-bg, #F7F7F5)" : "transparent",
              fontWeight: r.isYou ? 700 : 400,
            }}
          >
            <span>#{r.rank} {r.name}{r.isYou ? " (you)" : ""}</span>
            <span style={{ color: "var(--ink-dim)" }}>{r.timeMs != null ? `${r.timeMs}ms` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
