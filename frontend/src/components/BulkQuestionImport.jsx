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
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [duplicateAction, setDuplicateAction] = useState("skip");
  const [stage, setStage] = useState("pick"); // "pick" | "previewing" | "previewed" | "confirming" | "done"
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => setFolderId(defaultFolderId), [defaultFolderId]);

  function reset() {
    setFile(null);
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
      const payload = questionKind === "combined"
        ? { mcqRows: preview.mcqValidRows, codingRows: preview.codingValidRows, folderId: targetFolderId || undefined, duplicateAction }
        : { rows: preview.validRows, folderId: targetFolderId || undefined, duplicateAction };
      const { data } = await api.post(confirmEndpoint, payload);
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

  return (
    <div>
      {allowCoding && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" name="bulkKind" checked={questionKind === "quiz"} onChange={() => { setQuestionKind("quiz"); reset(); }} />
            Quiz (MCQ / True-False / Multi-select)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" name="bulkKind" checked={questionKind === "coding"} onChange={() => { setQuestionKind("coding"); reset(); }} />
            Coding
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="radio" name="bulkKind" checked={questionKind === "combined"}
              onChange={() => { setQuestionKind("combined"); setUploadFormat("spreadsheet"); reset(); }}
            />
            Combined (MCQ + Coding, one file)
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: allowCoding ? 10 : 0 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="radio" name="bulkFormat" checked={uploadFormat === "spreadsheet"} onChange={() => { setUploadFormat("spreadsheet"); reset(); }} />
          Spreadsheet (.xlsx / .csv)
        </label>
        {questionKind !== "combined" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" name="bulkFormat" checked={uploadFormat === "notepad"} onChange={() => { setUploadFormat("notepad"); reset(); }} />
            Notepad (.txt)
          </label>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
        {questionKind === "combined"
          ? 'One spreadsheet with both an "MCQ" and a "CODING" sheet — both are read and imported together in a single Preview → Confirm, exactly like the Combined Template below.'
          : questionKind === "coding"
          ? "Coding questions — title, problem statement, difficulty, BTL level, 2 sample cases, and at least 5 hidden test cases. Each row/block can name its own Question Bank, or leave it blank to use the picker below."
          : "Multiple Choice, True/False, and Multiple Select questions, including BTL level."}
        {" "}Nothing is saved until you review the preview and confirm.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadTemplate("quiz")}>
          ⬇ Download MCQ Template
        </button>
        {allowCoding && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadTemplate("coding")}>
            ⬇ Download Coding Template
          </button>
        )}
        {allowCoding && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadTemplate("combined")}>
            ⬇ Download Combined Template (MCQ + Coding, one file)
          </button>
        )}
      </div>

      {stage === "pick" && (
        <form onSubmit={handlePreview} style={{ marginTop: 14 }}>
          <input type="file" accept={uploadFormat === "notepad" ? ".txt" : ".xlsx,.xls,.csv"} onChange={(e) => setFile(e.target.files?.[0] || null)} />

          {folders !== undefined && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 14 }}>
                Save to Question Bank
                {questionKind === "coding" && <span style={{ color: "var(--ink-dim)" }}>(fallback for rows with no Question Bank named)</span>}
              </label>
              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                <select style={{ ...inputStyle, flex: 1 }} value={folderId} onChange={(e) => { setFolderId(e.target.value); setNewFolderName(""); }}>
                  <option value="">Uncategorized (no folder)</option>
                  {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {onCreateFolder && (
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="…or new folder name"
                    value={newFolderName}
                    onChange={(e) => { setNewFolderName(e.target.value); setFolderId(""); }}
                  />
                )}
              </div>
            </>
          )}

          <label style={{ display: "block", fontSize: 13, marginTop: 14 }}>
            If a question already exists (same text, same Subject/Unit):
          </label>
          <select style={{ ...inputStyle, marginTop: 6 }} value={duplicateAction} onChange={(e) => setDuplicateAction(e.target.value)}>
            <option value="skip">Skip duplicates</option>
            <option value="import">Import anyway</option>
          </select>

          {error && <p style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{error}</p>}
          <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={!file || stage === "previewing"}>
            {stage === "previewing" ? "Checking…" : "Preview"}
          </button>
        </form>
      )}

      {stage === "previewed" && preview && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 14, fontWeight: 700 }}>Preview</p>
          {/* One clear, file-level diagnostic instead of burying the real problem in a pile of
              near-identical per-row errors -- see runQuizBulkImport's structureHint comment for
              the real upload this was built from. */}
          {preview.structureHint && (
            <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, background: "var(--warning-bg)", color: "var(--amber-dark)", fontSize: 13 }}>
              ⚠ {preview.structureHint}
            </div>
          )}
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <div>Total rows: <strong>{preview.total}</strong></div>
            <div style={{ color: "var(--mint)" }}>
              Ready to import: <strong>{preview.createdCount}</strong>
              {questionKind === "combined" && (preview.mcqCount > 0 || preview.codingCount > 0) && (
                <span style={{ color: "var(--ink-dim)", fontWeight: 400 }}> ({preview.mcqCount} MCQ, {preview.codingCount} Coding)</span>
              )}
            </div>
            {preview.skippedCount > 0 && <div style={{ color: "var(--amber-dark)" }}>Duplicates (will skip): <strong>{preview.skippedCount}</strong></div>}
            {preview.errorCount > 0 && <div style={{ color: "var(--rust)" }}>Invalid (will not import): <strong>{preview.errorCount}</strong></div>}
          </div>

          {(preview.errors?.length > 0 || preview.skipped?.length > 0) && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => downloadReport(preview)}>
                ⬇ Download issue report
              </button>
              <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                {(preview.errors || []).map((e, i) => (
                  <div key={`e${i}`} style={{ fontSize: 11, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
                ))}
                {(preview.skipped || []).map((e, i) => (
                  <div key={`s${i}`} style={{ fontSize: 11, color: "var(--amber-dark)" }} className="mono">Row {e.row} (skipped): {e.reason}</div>
                ))}
              </div>
            </div>
          )}

          {error && <p style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn btn-ghost" onClick={reset}>← Choose a different file</button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!preview.createdCount || stage === "confirming"}
              onClick={handleConfirm}
            >
              {stage === "confirming" ? "Importing…" : `Confirm Import (${preview.createdCount})`}
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 14, fontWeight: 700 }}>Import Complete</p>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <div>
              <strong>{result.createdCount}</strong> question{result.createdCount === 1 ? "" : "s"} created out of {result.total}.
              {questionKind === "combined" && (result.mcqCount > 0 || result.codingCount > 0) && (
                <span style={{ color: "var(--ink-dim)" }}> ({result.mcqCount} MCQ, {result.codingCount} Coding)</span>
              )}
            </div>
            {result.errorCount > 0 && <div style={{ color: "var(--rust)" }}>{result.errorCount} failed at the last moment (state may have changed since preview).</div>}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={reset}>Import more questions</button>
        </div>
      )}
    </div>
  );
}
