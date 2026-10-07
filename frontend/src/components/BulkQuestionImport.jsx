import { useEffect, useState } from "react";
import api from "../api";

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };

// Shared Preview -> Validate -> Confirm bulk-question-upload UI, used by both the Question Bank
// page and the "attach questions to this test" flow — one implementation instead of two ad-hoc
// upload forms, so both places get Notepad/.txt support and the same never-write-until-confirmed
// behavior for free. Nothing is ever created on disk until the staff member explicitly clicks
// "Confirm Import" after reviewing the preview summary — the /preview endpoint only validates.
//
// `allowCoding` controls whether the Quiz/Coding/Combined kind toggle shows at all. Combined
// mode reads one uploaded file's "MCQ" and "CODING" sheets together (bulk-import-combined/*) and
// imports both in one Preview -> Confirm — without it, a Combined Template download (both sheets
// in one file, for convenience) had no matching "combined upload": a staff member had to upload
// the same file twice, once per kind, with nothing surfacing that the other sheet even existed.
export default function BulkQuestionImport({ allowCoding = false, folders, onCreateFolder, onImported, defaultFolderId = "" }) {
  const [questionKind, setQuestionKind] = useState("quiz"); // "quiz" | "coding" | "combined"
  const [uploadFormat, setUploadFormat] = useState("spreadsheet"); // "spreadsheet" | "notepad"
  const [file, setFile] = useState(null);
  // Optional images ZIP — only needed when at least one row fills in "Image File Name". Kept in
  // state (not just attached to the preview request and forgotten) so it can be re-sent unchanged
  // at Confirm time too: the preview step validates that every referenced image is actually in
  // the zip and is a real image, but never uploads anything to storage -- only Confirm does, so
  // the actual image bytes have to make the trip again.
  const [imagesZip, setImagesZip] = useState(null);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [duplicateAction, setDuplicateAction] = useState("skip");
  const [stage, setStage] = useState("pick"); // "pick" | "previewing" | "previewed" | "confirming" | "done"
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => setFolderId(defaultFolderId), [defaultFolderId]);

  function reset() {
    setFile(null);
    setImagesZip(null);
    setStage("pick");
    setPreview(null);
    setResult(null);
    setError("");
  }

  const previewEndpoint = questionKind === "combined" ? "/questions/bulk-import-combined/preview"
    : questionKind === "coding" ? "/questions/bulk-import-coding/preview" : "/questions/bulk-import/preview";
  const confirmEndpoint = questionKind === "combined" ? "/questions/bulk-import-combined/confirm"
    : questionKind === "coding" ? "/questions/bulk-import-coding/confirm" : "/questions/bulk-import/confirm";

  async function resolveFolderId() {
    if (folderId) return folderId;
    if (newFolderName.trim() && onCreateFolder) return onCreateFolder(newFolderName.trim());
    return "";
  }

  // type: "quiz" | "coding" | "combined" — "combined" always downloads the .xlsx workbook
  // regardless of the current Notepad/spreadsheet radio (the Notepad format is one question-type
  // per file by design, no combined variant there) since it exists purely so a faculty member
  // choosing between MCQ and Coding can grab both sheets in one download instead of two.
  async function downloadTemplate(type) {
    const isTxt = uploadFormat === "notepad" && type !== "combined";
    const res = await api.get("/questions/bulk-template", {
      params: { type: type === "quiz" ? undefined : type, format: isTxt ? "txt" : undefined },
      responseType: "blob",
    });
    const ext = isTxt ? "txt" : "xlsx";
    const name = type === "combined" ? "CodeArena_Question_Upload_Template" : type === "coding" ? "coding-template" : "question-bank-template";
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePreview(e) {
    e.preventDefault();
    if (!file) return;
    setStage("previewing");
    setError("");
    try {
      const targetFolderId = await resolveFolderId();
      const formData = new FormData();
      formData.append("file", file);
      if (imagesZip) formData.append("imagesZip", imagesZip);
      if (targetFolderId) formData.append("folderId", targetFolderId);
      formData.append("duplicateAction", duplicateAction);
      const { data } = await api.post(previewEndpoint, formData);
      setPreview(data);
      setStage("previewed");
    } catch (err) {
      setError(err.response?.data?.error || "Preview failed");
      setStage("pick");
    }
  }

  async function handleConfirm() {
    if (!preview?.createdCount) return;
    setStage("confirming");
    setError("");
    try {
      const targetFolderId = await resolveFolderId();
      const rowsPayload = questionKind === "combined"
        ? { mcqRows: preview.mcqValidRows, codingRows: preview.codingValidRows }
        : { rows: preview.validRows };
      // Only switch to multipart when there's actually an images ZIP to re-attach — the far more
      // common image-free case keeps posting plain JSON, exactly as it always has.
      let body;
      if (imagesZip) {
        body = new FormData();
        for (const [key, value] of Object.entries(rowsPayload)) body.append(key, JSON.stringify(value));
        body.append("imagesZip", imagesZip);
        if (targetFolderId) body.append("folderId", targetFolderId);
        body.append("duplicateAction", duplicateAction);
      } else {
        body = { ...rowsPayload, folderId: targetFolderId || undefined, duplicateAction };
      }
      const { data } = await api.post(confirmEndpoint, body);
      setResult(data);
      setStage("done");
      if (data.created?.length) onImported?.(data.created);
    } catch (err) {
      setError(err.response?.data?.error || "Import failed");
      setStage("previewed");
    }
  }

  function downloadReport(rows) {
    const lines = [
      ...(rows.errors || []).map((e) => ["Failed", e.row, e.reason]),
      ...(rows.skipped || []).map((e) => ["Skipped", e.row, e.reason]),
    ];
    const header = ["Status", "Row", "Reason"];
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...lines].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bulk-upload-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const accept = uploadFormat === "notepad" ? ".txt" : ".xlsx,.xls,.csv";
  const kinds = [
    { id: "quiz", label: "Quiz", hint: "MCQ, True/False, Multi-select" },
    ...(allowCoding ? [{ id: "coding", label: "Coding", hint: "Problems with test cases" }, { id: "combined", label: "Combined", hint: "MCQ + Coding in one file" }] : []),
  ];
  const kindLabel = questionKind === "combined" ? "Combined" : questionKind === "coding" ? "Coding" : "MCQ";
  const templateExt = uploadFormat === "notepad" && questionKind !== "combined" ? ".txt" : ".xlsx";
  const kindHelp = questionKind === "combined"
    ? 'One spreadsheet with an "MCQ" sheet and a "CODING" sheet. Both are read and imported together.'
    : questionKind === "coding"
    ? "Title, problem statement, difficulty, BTL level, 2 sample cases and at least 5 hidden test cases per question. A row can name its own Question Bank; otherwise the folder below is used."
    : "Multiple Choice, True/False and Multiple Select questions, including BTL level.";
  const busy = stage === "previewing" || stage === "confirming";

  function chooseFile(f) {
    setError("");
    if (!f) { setFile(null); return; }
    const ok = uploadFormat === "notepad" ? /\.txt$/i.test(f.name) : /\.(xlsx|xls|csv)$/i.test(f.name);
    if (!ok) { setFile(null); setError(`That file type isn't supported here. Please choose ${uploadFormat === "notepad" ? "a .txt file" : "an .xlsx, .xls or .csv file"}.`); return; }
    setFile(f);
  }
  const sizeLabel = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  const stepHead = (n, title, aside) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--slate-900, #1c2b24)", color: "var(--chalk, #fff)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{n}</span>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      {aside && <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{aside}</span>}
    </div>
  );
  const segBtn = (active) => ({
    flex: "1 1 120px", textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13,
    border: `1.5px solid ${active ? "var(--amber-dark)" : "var(--line)"}`, background: active ? "var(--warning-bg)" : "transparent", color: "var(--ink)",
  });
  const tile = (value, label, color) => (
    <div style={{ flex: "1 1 110px", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", borderTop: `3px solid ${color || "var(--line)"}` }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: color || "var(--ink)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
    </div>
  );
  const footer = { position: "sticky", bottom: 0, background: "var(--card-bg, var(--paper, #fff))", paddingTop: 12, paddingBottom: 4, marginTop: 16, borderTop: "1px solid var(--line)", display: "flex", gap: 8, zIndex: 1 };

  return (
    <div>
      {stage === "pick" && (
        <form onSubmit={handlePreview}>
          <section aria-label="Step 1: what you are uploading" style={{ marginBottom: 18 }}>
            {stepHead(1, allowCoding ? "What are you uploading?" : "Question type")}
            {allowCoding ? (
              <div role="radiogroup" aria-label="Question type" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {kinds.map((k) => (
                  <button key={k.id} type="button" role="radio" aria-checked={questionKind === k.id} style={segBtn(questionKind === k.id)}
                    onClick={() => { setQuestionKind(k.id); if (k.id === "combined") setUploadFormat("spreadsheet"); reset(); }}>
                    <div style={{ fontWeight: 700 }}>{k.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 2 }}>{k.hint}</div>
                  </button>
                ))}
              </div>
            ) : null}
            <p style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 8 }}>{kindHelp} Nothing is saved until you review the preview and confirm.</p>
          </section>

          <section aria-label="Step 2: file format" style={{ marginBottom: 18 }}>
            {stepHead(2, "File format")}
            <div role="radiogroup" aria-label="File format" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" role="radio" aria-checked={uploadFormat === "spreadsheet"} style={segBtn(uploadFormat === "spreadsheet")} onClick={() => { setUploadFormat("spreadsheet"); reset(); }}>
                <div style={{ fontWeight: 700 }}>Spreadsheet</div><div style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 2 }}>.xlsx, .xls or .csv</div>
              </button>
              {questionKind !== "combined" && (
                <button type="button" role="radio" aria-checked={uploadFormat === "notepad"} style={segBtn(uploadFormat === "notepad")} onClick={() => { setUploadFormat("notepad"); reset(); }}>
                  <div style={{ fontWeight: 700 }}>Notepad</div><div style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 2 }}>.txt, one question type per file</div>
                </button>
              )}
            </div>
          </section>

          <section aria-label="Step 3: template" style={{ marginBottom: 18 }}>
            {stepHead(3, "Start from a template", "(optional, but it avoids column mistakes)")}
            <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => downloadTemplate(questionKind)}>
              ⬇ Download {kindLabel} template ({templateExt})
            </button>
            {allowCoding && (
              <span style={{ fontSize: 12, color: "var(--ink-dim)", marginLeft: 10 }}>
                Other templates:{" "}
                {kinds.filter((k) => k.id !== questionKind).map((k, i) => (
                  <button key={k.id} type="button" onClick={() => downloadTemplate(k.id)} style={{ background: "none", border: "none", padding: 0, marginRight: 10, color: "var(--ink)", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
                    {i > 0 ? "" : ""}{k.label}
                  </button>
                ))}
              </span>
            )}
          </section>

          <section aria-label="Step 4: your file" style={{ marginBottom: 12 }}>
            {stepHead(4, "Upload your file")}
            <label
              htmlFor="bulk-import-file"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); chooseFile(e.dataTransfer.files?.[0] || null); }}
              style={{ position: "relative", display: "block", border: `2px dashed ${dragOver ? "var(--amber-dark)" : file ? "var(--mint)" : "var(--line)"}`, borderRadius: 12, padding: "22px 16px", textAlign: "center", cursor: "pointer", background: dragOver ? "var(--warning-bg)" : "transparent" }}
            >
              {file ? (
                <>
                  <div style={{ fontWeight: 700, wordBreak: "break-all" }}>✓ {file.name}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{sizeLabel(file.size)} · click to choose a different file</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 700 }}>Drag a file here, or click to browse</div>
                  <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{uploadFormat === "notepad" ? ".txt" : ".xlsx, .xls, .csv"}</div>
                </>
              )}
              <input id="bulk-import-file" type="file" accept={accept} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} onChange={(e) => { chooseFile(e.target.files?.[0] || null); e.target.value = ""; }} />
            </label>
            {file && <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 6 }} onClick={() => setFile(null)}>Remove file</button>}
          </section>

          <details style={{ marginBottom: 8, border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              More options <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}>— Question Bank folder, duplicates{uploadFormat === "spreadsheet" ? ", images" : ""}</span>
            </summary>
            <div style={{ marginTop: 10 }}>
              {folders !== undefined && (
                <>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600 }} htmlFor="bulk-import-folder-id">
                    Save to Question Bank
                    {questionKind === "coding" && <span style={{ color: "var(--ink-dim)", fontWeight: 400 }}> (used when a row names no Question Bank)</span>}
                  </label>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select id="bulk-import-folder-id" style={{ ...inputStyle, flex: "1 1 200px" }} value={folderId} onChange={(e) => { setFolderId(e.target.value); setNewFolderName(""); }}>
                      <option value="">Uncategorized (no folder)</option>
                      {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    {onCreateFolder && (
                      <input aria-label="New folder name" style={{ ...inputStyle, flex: "1 1 200px" }} placeholder="…or type a new folder name" value={newFolderName} onChange={(e) => { setNewFolderName(e.target.value); setFolderId(""); }} />
                    )}
                  </div>
                </>
              )}
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginTop: 14 }} htmlFor="bulk-import-duplicate-action">If a question already exists (same text, same Subject/Unit)</label>
              <select id="bulk-import-duplicate-action" style={{ ...inputStyle, marginTop: 6 }} value={duplicateAction} onChange={(e) => setDuplicateAction(e.target.value)}>
                <option value="skip">Skip duplicates</option>
                <option value="import">Import anyway</option>
              </select>
              {uploadFormat === "spreadsheet" && (
                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600 }} htmlFor="bulk-import-images-zip">Images (ZIP) <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}>— only if a row fills in "Image File Name"</span></label>
                  <input id="bulk-import-images-zip" type="file" accept=".zip" style={{ marginTop: 6 }} onChange={(e) => setImagesZip(e.target.files?.[0] || null)} />
                  {imagesZip && <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>✓ {imagesZip.name} ({sizeLabel(imagesZip.size)})</div>}
                  <p style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 4 }}>
                    Each "Image File Name" cell must exactly match a file inside the ZIP (folders inside are fine; only the file name is matched). A row naming a file the ZIP does not contain is reported as a row error, never silently imported without its image.
                  </p>
                </div>
              )}
            </div>
          </details>

          {error && <p role="alert" style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{error}</p>}
          <div style={footer}>
            <button className="btn btn-primary" style={{ flex: 1, padding: "12px 16px" }} disabled={!file || busy}>
              {busy ? "Checking your file…" : file ? "Preview questions →" : "Choose a file to continue"}
            </button>
          </div>
        </form>
      )}

      {stage === "previewing" && <p role="status" className="mono" style={{ marginTop: 14 }}>Checking your file… this can take a few seconds for large files.</p>}

      {(stage === "previewed" || stage === "confirming") && preview && (
        <div aria-live="polite">
          <h4 style={{ fontSize: 15, margin: "0 0 10px" }}>Review before importing</h4>
          {preview.structureHint && (
            <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, background: "var(--warning-bg)", color: "var(--amber-dark)", fontSize: 13 }}>⚠ {preview.structureHint}</div>
          )}
          {preview.unknownColumns?.length > 0 && (
            <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", color: "var(--ink-dim)", fontSize: 12.5 }}>
              Unknown column{preview.unknownColumns.length === 1 ? "" : "s"} ignored (not imported): <strong>{preview.unknownColumns.join(", ")}</strong>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tile(preview.total, "Rows in file")}
            {tile(preview.createdCount, "Ready to import", "var(--mint)")}
            {preview.autoFixedCount > 0 && tile(preview.autoFixedCount, "Auto-fixed", "var(--amber-dark)")}
            {preview.skippedCount > 0 && tile(preview.skippedCount, "Duplicates (skipped)", "var(--amber-dark)")}
            {preview.errorCount > 0 && tile(preview.errorCount, "Invalid (not imported)", "var(--rust)")}
            {preview.imagesValidatedCount > 0 && tile(preview.imagesValidatedCount, "Images checked", "var(--mint)")}
          </div>
          {questionKind === "combined" && (preview.mcqCount > 0 || preview.codingCount > 0) && (
            <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>{preview.mcqCount} MCQ and {preview.codingCount} Coding questions</p>
          )}
          {preview.createdCount === 0 && <p style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>Nothing in this file can be imported yet. Fix the issues below and choose the file again.</p>}

          {preview.autoFixed?.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--amber-dark)" }}>
                {preview.autoFixed.length} correction{preview.autoFixed.length === 1 ? "" : "s"} applied automatically — review
              </summary>
              <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                {preview.autoFixed.map((f, i) => (
                  <div key={i} style={{ fontSize: 11.5, marginTop: 2 }} className="mono">
                    Row {f.row} ({f.field}): <span style={{ color: "var(--ink-dim)" }}>"{f.before}"</span> → <strong>"{f.after}"</strong>
                  </div>
                ))}
              </div>
            </details>
          )}

          {(preview.errors?.length > 0 || preview.skipped?.length > 0) && (
            <details open={preview.errors?.length > 0} style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Issues ({(preview.errors?.length || 0) + (preview.skipped?.length || 0)})</summary>
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadReport(preview)}>⬇ Download issue report (CSV)</button>
                <div style={{ marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
                  {(preview.errors || []).map((e, i) => <div key={`e${i}`} style={{ fontSize: 11.5, color: "var(--rust)" }} className="mono">✕ Row {e.row}: {e.reason}</div>)}
                  {(preview.skipped || []).map((e, i) => <div key={`s${i}`} style={{ fontSize: 11.5, color: "var(--amber-dark)" }} className="mono">↷ Row {e.row} (skipped): {e.reason}</div>)}
                </div>
              </div>
            </details>
          )}

          {error && <p role="alert" style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{error}</p>}
          <div style={footer}>
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={stage === "confirming"}>← Choose a different file</button>
            <button type="button" className="btn btn-primary" style={{ flex: 1, padding: "12px 16px" }} disabled={!preview.createdCount || stage === "confirming"} onClick={handleConfirm}>
              {stage === "confirming" ? "Importing… please keep this window open" : `Import ${preview.createdCount} question${preview.createdCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div role="status" aria-live="polite">
          <div style={{ border: "1px solid var(--mint)", borderRadius: 12, padding: 16, background: "var(--success-bg)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--mint)" }}>✓ Import complete</div>
            <p style={{ fontSize: 14, marginTop: 6 }}>
              <strong>{result.createdCount}</strong> question{result.createdCount === 1 ? "" : "s"} created out of {result.total}.
              {questionKind === "combined" && (result.mcqCount > 0 || result.codingCount > 0) && <span style={{ color: "var(--ink-dim)" }}> ({result.mcqCount} MCQ, {result.codingCount} Coding)</span>}
            </p>
            {result.errorCount > 0 && <p style={{ fontSize: 13, color: "var(--rust)", marginTop: 4 }}>{result.errorCount} failed at the last moment (the data may have changed since the preview).</p>}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
              {result.errors.map((e, i) => <div key={i} style={{ fontSize: 11.5, color: "var(--rust)" }} className="mono">✕ Row {e.row}: {e.reason}</div>)}
            </div>
          )}
          <div style={footer}>
            <button type="button" className="btn btn-ghost" onClick={reset}>Import more questions</button>
          </div>
        </div>
      )}
    </div>
  );
}
