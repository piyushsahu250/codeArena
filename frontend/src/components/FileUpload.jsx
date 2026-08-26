import { useRef, useState } from "react";
import { Upload, X, FileText } from "lucide-react";

// Real file-picker with client-side validation and an image preview — distinct from
// UploadProgressBar.jsx (progress-indicator only, no picker) and the raw `<input type="file"
// accept=".xlsx,.xls,.csv">` with zero client-side validation used in BulkUpload.jsx and similar
// pages. This is additive (those bulk-import flows can adopt it later); it doesn't replace them.
//
// accept: native file input accept string (e.g. "image/png,image/jpeg" or ".xlsx,.csv")
// maxSizeMB: rejected client-side with a real error message instead of only failing after upload
// imagePreview: when true and the file is an image, shows a thumbnail instead of just the filename
export default function FileUpload({ accept, maxSizeMB = 5, imagePreview = false, onFileSelected, label = "Choose file", existingPreviewUrl }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(existingPreviewUrl || null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  function validate(f) {
    if (!f) return "No file selected.";
    if (maxSizeMB && f.size > maxSizeMB * 1024 * 1024) return `File is too large — max ${maxSizeMB}MB.`;
    if (accept) {
      const accepted = accept.split(",").map((a) => a.trim().toLowerCase());
      const name = f.name.toLowerCase();
      const type = (f.type || "").toLowerCase();
      const ok = accepted.some((a) => (a.startsWith(".") ? name.endsWith(a) : type === a || (a.endsWith("/*") && type.startsWith(a.slice(0, -1)))));
      if (!ok) return `Unsupported file type. Accepted: ${accept}`;
    }
    return null;
  }

  function handleFile(f) {
    const err = validate(f);
    if (err) { setError(err); setFile(null); onFileSelected?.(null); return; }
    setError("");
    setFile(f);
    onFileSelected?.(f);
    if (imagePreview && f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setPreviewUrl(reader.result);
      reader.readAsDataURL(f);
    }
  }

  function clear() {
    setFile(null);
    setPreviewUrl(null);
    setError("");
    onFileSelected?.(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        role="button"
        tabIndex={0}
        style={{
          border: `1px dashed ${dragOver ? "var(--amber)" : "var(--line)"}`, borderRadius: 10, padding: 20,
          textAlign: "center", cursor: "pointer", background: dragOver ? "var(--warning-bg)" : "transparent",
        }}
      >
        {imagePreview && previewUrl ? (
          <img src={previewUrl} alt="Preview" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", margin: "0 auto 8px" }} />
        ) : file ? (
          <FileText size={24} style={{ color: "var(--ink-dim)", marginBottom: 6 }} />
        ) : (
          <Upload size={24} style={{ color: "var(--ink-dim)", marginBottom: 6 }} />
        )}
        <div style={{ fontSize: 13, fontWeight: 600 }}>{file ? file.name : label}</div>
        <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
          {file ? `${(file.size / 1024).toFixed(0)} KB` : `Click or drag a file here${maxSizeMB ? ` (max ${maxSizeMB}MB)` : ""}`}
        </div>
        <input ref={inputRef} type="file" accept={accept} onChange={(e) => handleFile(e.target.files?.[0])} style={{ display: "none" }} />
      </div>
      {(file || previewUrl) && (
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={clear}>
          <X size={12} /> Remove
        </button>
      )}
      {error && <p role="alert" style={{ fontSize: 12, color: "var(--rust)", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
