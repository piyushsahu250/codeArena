// Indeterminate progress indicator for the ~8 bulk-upload/import flows across the platform, all of
// which are a single request/response XLSX parse-and-import with no chunked-upload architecture —
// there's no real percentage to report, so this shows honest "still working" motion instead of a
// fabricated number. Renders nothing when `active` is false, so it's a drop-in replacement for a
// page's existing static "Uploading…" text without needing new state.
export default function UploadProgressBar({ active, label = "Uploading…" }) {
  if (!active) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 4 }}>{label}</div>
      <div className="upload-progress-track">
        <div className="upload-progress-fill" />
      </div>
    </div>
  );
}
