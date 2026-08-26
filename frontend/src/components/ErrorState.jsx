// Shared "failed to load, with a retry button" state — generalized from StudentDashboard.jsx's
// local `DashSummaryError`. Every API-driven section should distinguish loading/empty/error instead
// of silently showing nothing on failure.
export default function ErrorState({ title = "Unable to load this right now.", message = "Something went wrong loading this.", onRetry, retrying, style }) {
  return (
    <div className="card" style={{ padding: 28, textAlign: "center", ...style }}>
      <p style={{ fontSize: 14, fontWeight: 600 }}>{title}</p>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{message}</p>
      {onRetry && (
        <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={onRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Try again"}
        </button>
      )}
    </div>
  );
}
