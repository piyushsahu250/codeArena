import { inputText, outputText } from "../utils/caseText";

// Shared judge-result renderer for every coding surface (Coding Tests, Module Coding Tests,
// Practice Coding, Mock Interview coding) — one visual format for Run/Submit results platform-wide,
// per-case input/expected/actual/status/time/memory, and the same compile/runtime-error and
// TLE/MLE presentation everywhere, so switching between features doesn't feel like a different tool.
export default function CodeResultBlock({ title, result, hideCaseCount, submittedAt }) {
  if (!result) return null;
  if (result.error) {
    return <p style={{ color: "var(--rust)" }} className="mono">{title ? `${title}: ` : ""}{result.error}</p>;
  }
  if (result.errorSummary) {
    return (
      <div>
        <div className="mono" style={{ fontWeight: 700, color: "var(--rust)" }}>
          {title ? `${title}: ` : ""}{result.errorSummary.type}{result.errorSummary.line ? ` (line ${result.errorSummary.line})` : ""}
        </div>
        {result.errorSummary.message && (
          <div className="mono" style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{result.errorSummary.message}</div>
        )}
        {result.errorSummary.hint && (
          <div style={{ fontSize: 12, marginTop: 6, color: "var(--ink-dim)" }}>Suggested fix: {result.errorSummary.hint}</div>
        )}
      </div>
    );
  }
  const color = result.verdict === "ACCEPTED" ? "var(--mint)" : result.verdict === "PARTIAL" ? "var(--amber-dark)" : "var(--rust)";
  const label = result.verdict === "ACCEPTED" ? "Correct" : result.verdict === "PARTIAL" ? "Partially correct" : result.verdict;
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>✓ Compiled successfully</div>
      <div className="mono" style={{ fontWeight: 700, color, marginTop: 2 }}>
        {title ? `${title}: ` : ""}{label}
        {!hideCaseCount && ` — ${result.passedCases}/${result.totalCases} test cases passed`}
      </div>
      {submittedAt && (
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
          Submitted {new Date(submittedAt).toLocaleString()}
        </div>
      )}
      {(result.maxTimeMs != null || result.maxMemoryKb != null) && (
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
          {result.maxTimeMs != null && `⏱ ${result.maxTimeMs} ms`}
          {result.maxMemoryKb != null && ` · ${(result.maxMemoryKb / 1024).toFixed(1)} MB`}
        </div>
      )}
      {result.details?.map((d, i) => (
        <div key={i} style={{ fontSize: 12, marginTop: 8 }} className="mono">
          <span style={{ color: d.verdict === "PASSED" ? "var(--mint)" : "var(--rust)" }}>[{d.verdict}]</span>{" "}
          input: <span style={{ whiteSpace: "pre-wrap" }}>{inputText(d.input)}</span>
          {d.verdict === "PASSED" ? (
            <> | output: <span style={{ whiteSpace: "pre-wrap" }}>{outputText(d.actual)}</span></>
          ) : d.verdict === "WRONG_ANSWER" ? (
            <> | expected: <span style={{ whiteSpace: "pre-wrap" }}>{outputText(d.expected)}</span> | your output: <span style={{ whiteSpace: "pre-wrap" }}>{outputText(d.actual)}</span></>
          ) : (
            <> | {d.error || "no output"}</>
          )}
          {(d.timeMs != null || d.memoryKb != null) && (
            <span style={{ color: "var(--ink-dim)" }}>
              {" ("}{d.timeMs != null ? `${d.timeMs} ms` : ""}{d.timeMs != null && d.memoryKb != null ? ", " : ""}{d.memoryKb != null ? `${(d.memoryKb / 1024).toFixed(1)} MB` : ""}{")"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
