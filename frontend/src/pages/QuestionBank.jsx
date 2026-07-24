import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Folder } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid } from "../components/Skeleton";

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select" };

// activeFolder: null = root folder-picker view; { id: "__all__", name: "All Questions" };
// { id: "__none__", name: "Uncategorized" }; or a real folder row from GET /questions/folders
// (id, name, category, description, parentId, _count: { questions, children }).
export default function QuestionBank() {
  const [folders, setFolders] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderCategory, setNewFolderCategory] = useState("");
  const [newFolderDescription, setNewFolderDescription] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergingId, setMergingId] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState("");

  const [questions, setQuestions] = useState([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ subjects: [], topics: [], creators: [] });
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [createdById, setCreatedById] = useState("");
  const [loading, setLoading] = useState(true);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);

  function loadFolders() {
    api.get("/questions/folders").then((res) => setFolders(res.data));
  }
  useEffect(loadFolders, []);

  useEffect(() => {
    api.get("/questions/meta/filters").then((res) => setMeta(res.data));
  }, []);

  // Debounce free-text search — previously fired one API call per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subject, topic, difficulty, questionType, createdById, activeFolder]);

  useEffect(() => {
    if (activeFolder) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subject, topic, difficulty, questionType, createdById, activeFolder, page]);

  const foldersById = useMemo(() => new Map((folders || []).map((f) => [f.id, f])), [folders]);

  // Recursive question count per folder (a folder's own questions plus every descendant's) —
  // powers the "Total Questions" figure on folder cards, matching the spec's worked example
  // where a parent bank's total sums across all its subtopics.
  const totalCounts = useMemo(() => {
    const map = new Map();
    function totalFor(id) {
      if (map.has(id)) return map.get(id);
      const folder = foldersById.get(id);
      if (!folder) return 0;
      let total = folder._count?.questions || 0;
      for (const child of folders.filter((f) => f.parentId === id)) total += totalFor(child.id);
      map.set(id, total);
      return total;
    }
    (folders || []).forEach((f) => totalFor(f.id));
    return map;
  }, [folders, foldersById]);

  function breadcrumbFor(folder) {
    const path = [];
    let cur = folder;
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? foldersById.get(cur.parentId) : null;
    }
    return path;
  }

  function load() {
    setLoading(true);
    const params = { page, pageSize: 50 };
    if (q) params.q = q;
    if (subject) params.subject = subject;
    if (topic) params.topic = topic;
    if (difficulty) params.difficulty = difficulty;
    if (questionType) params.questionType = questionType;
    if (createdById) params.createdById = createdById;
    if (activeFolder?.id === "__none__") params.folderId = "__none__";
    else if (activeFolder && activeFolder.id !== "__all__") params.folderId = activeFolder.id;
    api.get("/questions", { params }).then((res) => {
      setQuestions(res.data.rows);
      setPageMeta({ page: res.data.page, totalPages: res.data.totalPages, total: res.data.total });
      setLoading(false);
    });
  }

  async function createFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const parentId = activeFolder && activeFolder.id !== "__all__" && activeFolder.id !== "__none__" ? activeFolder.id : undefined;
      await api.post("/questions/folders", {
        name: newFolderName.trim(),
        category: newFolderCategory.trim() || undefined,
        description: newFolderDescription.trim() || undefined,
        parentId,
      });
      setNewFolderName("");
      setNewFolderCategory("");
      setNewFolderDescription("");
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function renameFolder(id) {
    if (!renameValue.trim()) return;
    try {
      await api.patch(`/questions/folders/${id}`, { name: renameValue.trim() });
      setRenamingId(null);
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to rename folder");
    }
  }

  async function deleteFolder(folder) {
    if (!confirm(`Delete "${folder.name}"? A question bank must be empty (no questions or sub-banks) before it can be deleted — move or merge its contents first.`)) return;
    try {
      await api.delete(`/questions/folders/${folder.id}`);
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete folder");
    }
  }

  async function mergeFolder(sourceId) {
    if (!mergeTargetId) return;
    try {
      await api.post(`/questions/folders/${sourceId}/merge`, { targetId: mergeTargetId });
      setMergingId(null);
      setMergeTargetId("");
      if (activeFolder?.id === sourceId) setActiveFolder(null);
      loadFolders();
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to merge folders");
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function moveSelected() {
    setMoving(true);
    try {
      await api.post("/questions/bulk-move", { questionIds: selectedIds, folderId: moveTargetId || null });
      setSelectedIds([]);
      setMoveTargetId("");
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to move questions");
    } finally {
      setMoving(false);
    }
  }

  async function handleDelete(question) {
    try {
      await api.delete(`/questions/${question.id}`);
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete question");
    }
  }

  async function downloadFile(url, filename) {
    const params = { q, subject, topic, difficulty, questionType, createdById };
    if (activeFolder?.id === "__none__") params.folderId = "__none__";
    else if (activeFolder && activeFolder.id !== "__all__") params.folderId = activeFolder.id;
    const res = await api.get(url, { responseType: "blob", params });
    const blobUrl = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  async function handleImport(e) {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      if (activeFolder && activeFolder.id !== "__all__" && activeFolder.id !== "__none__") {
        formData.append("folderId", activeFolder.id);
      }
      const { data } = await api.post("/questions/bulk-import", formData);
      setImportResult(data);
      setImportFile(null);
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function downloadErrorReport() {
    const rows = (importResult.errors || []).map((e) => ["Failed", e.row, e.reason]);
    const header = ["Status", "Row", "Reason"];
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bulk-import-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const isRealFolder = activeFolder && activeFolder.id !== "__all__" && activeFolder.id !== "__none__";
  const childFolders = isRealFolder ? (folders || []).filter((f) => f.parentId === activeFolder.id) : [];
  const rootFolders = (folders || []).filter((f) => !f.parentId);
  const otherFoldersForMerge = (folders || []).filter((f) => f.id !== mergingId);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Question Bank</h1>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link to="/staff" className="btn btn-ghost">← Staff control room</Link>
            <Link to="/staff/questions/new" className="btn btn-primary">+ Add question</Link>
          </div>
        </div>

        {!activeFolder ? (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 20 }}>
              Question banks are private to your institute and can be nested (e.g. "Aptitude" &gt; "Percentages"). Open a folder to browse, or create a new top-level one.
            </p>
            <NewFolderForm
              name={newFolderName} setName={setNewFolderName}
              category={newFolderCategory} setCategory={setNewFolderCategory}
              description={newFolderDescription} setDescription={setNewFolderDescription}
              onSubmit={createFolder} submitting={creatingFolder}
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginTop: 20 }}>
              <FolderCard folder={{ id: "__all__", name: "All Questions" }} onClick={() => setActiveFolder({ id: "__all__", name: "All Questions" })} />
              <FolderCard folder={{ id: "__none__", name: "Uncategorized" }} onClick={() => setActiveFolder({ id: "__none__", name: "Uncategorized" })} />
              {folders === null && <SkeletonGrid count={4} minWidth={220} />}
              {rootFolders.map((f) => (
                <FolderManageCard
                  key={f.id} folder={f} totalCount={totalCounts.get(f.id) ?? f._count.questions}
                  onOpen={() => setActiveFolder(f)}
                  renamingId={renamingId} renameValue={renameValue} setRenamingId={setRenamingId} setRenameValue={setRenameValue} onRename={renameFolder}
                  onDelete={() => deleteFolder(f)}
                  mergingId={mergingId} setMergingId={setMergingId} mergeTargetId={mergeTargetId} setMergeTargetId={setMergeTargetId}
                  mergeOptions={otherFoldersById(folders, f.id)} onMerge={() => mergeFolder(f.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20, flexWrap: "wrap", fontSize: 13 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setActiveFolder(null)}>← All banks</button>
              {isRealFolder && breadcrumbFor(activeFolder).map((f, i) => (
                <span key={f.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--ink-dim)" }}>/</span>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "4px 10px", fontWeight: i === breadcrumbFor(activeFolder).length - 1 ? 700 : 400 }}
                    onClick={() => setActiveFolder(f)}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
            <h3 style={{ fontSize: 16, marginTop: 12 }}>{activeFolder.name}</h3>
            {isRealFolder && activeFolder.description && (
              <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>{activeFolder.description}</p>
            )}
            {isRealFolder && (
              <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 4 }}>
                Total Questions: {totalCounts.get(activeFolder.id) ?? activeFolder._count?.questions ?? 0}
                {activeFolder.category ? ` · ${activeFolder.category}` : ""}
              </p>
            )}

            {isRealFolder && (
              <>
                <div style={{ marginTop: 16, fontWeight: 700, fontSize: 13 }}>Sub-banks</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 8 }}>
                  {childFolders.map((f) => (
                    <FolderManageCard
                      key={f.id} folder={f} totalCount={totalCounts.get(f.id) ?? f._count.questions}
                      onOpen={() => setActiveFolder(f)}
                      renamingId={renamingId} renameValue={renameValue} setRenamingId={setRenamingId} setRenameValue={setRenameValue} onRename={renameFolder}
                      onDelete={() => deleteFolder(f)}
                      mergingId={mergingId} setMergingId={setMergingId} mergeTargetId={mergeTargetId} setMergeTargetId={setMergeTargetId}
                      mergeOptions={otherFoldersById(folders, f.id)} onMerge={() => mergeFolder(f.id)}
                    />
                  ))}
                  {childFolders.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>No sub-banks yet.</p>}
                </div>
                <NewFolderForm
                  name={newFolderName} setName={setNewFolderName}
                  category={newFolderCategory} setCategory={setNewFolderCategory}
                  description={newFolderDescription} setDescription={setNewFolderDescription}
                  onSubmit={createFolder} submitting={creatingFolder}
                  placeholder={`New sub-bank inside "${activeFolder.name}"…`}
                />
              </>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <input
                style={{ ...inputStyle, flex: "1 1 220px" }}
                placeholder="Search questions…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <select style={selectStyle} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">All categories (subject)</option>
                {meta.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select style={selectStyle} value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">All subcategories (topic)</option>
                {meta.topics.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select style={selectStyle} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">All difficulties</option>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
              <select style={selectStyle} value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
                <option value="">All types</option>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select style={selectStyle} value={createdById} onChange={(e) => setCreatedById(e.target.value)}>
                <option value="">Created by (anyone)</option>
                {meta.creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={() => downloadFile("/questions/export", "question-bank-export.xlsx")}>
                ⬇ Export ({pageMeta.total})
              </button>
              <button className="btn btn-ghost" onClick={() => downloadFile("/questions/bulk-template", "question-bank-template.xlsx")}>
                ⬇ Download import template
              </button>
              <button className="btn btn-ghost" onClick={() => setShowImport((s) => !s)}>
                {showImport ? "Hide import" : "⬆ Bulk import (quiz types)"}
              </button>
            </div>

            {showImport && (
              <div className="card" style={{ padding: 20, marginTop: 12 }}>
                <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
                  Import Multiple Choice, True/False, and Multiple Select questions from an .xlsx/.csv file. Coding
                  questions aren't supported via import — use "+ Add question" for those.
                  {isRealFolder && ` Imported questions will be saved into "${activeFolder.name}".`}
                </p>
                <form onSubmit={handleImport} style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                  <button className="btn btn-primary" disabled={!importFile || importing}>
                    {importing ? "Importing…" : "Import"}
                  </button>
                </form>
                {importResult && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 14 }}>
                      <strong>{importResult.createdCount}</strong> question{importResult.createdCount === 1 ? "" : "s"} created
                      out of {importResult.total}.{importResult.errorCount > 0 && ` ${importResult.errorCount} failed.`}
                    </p>
                    {importResult.errors.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={downloadErrorReport}>
                          ⬇ Download error report
                        </button>
                        <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                          {importResult.errors.map((e, i) => (
                            <div key={i} style={{ fontSize: 12, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {selectedIds.length > 0 && (
              <div className="card" style={{ padding: 12, marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{selectedIds.length} selected</span>
                <select style={{ ...selectStyle, minWidth: 200 }} value={moveTargetId} onChange={(e) => setMoveTargetId(e.target.value)}>
                  <option value="">Move to: Uncategorized</option>
                  {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={moveSelected} disabled={moving}>
                  {moving ? "Moving…" : "Move Selected"}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setSelectedIds([])}>Clear selection</button>
              </div>
            )}

            <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
              {loading && <SkeletonGrid count={6} minWidth={200} />}
              {!loading && questions.map((question) => (
                <div key={question.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <input type="checkbox" checked={selectedIds.includes(question.id)} onChange={() => toggleSelect(question.id)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Q{question.questionNumber}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{question.title || "(untitled)"}</span>
                      <span className="badge">{TYPE_LABELS[question.questionType]}</span>
                      <span className={`badge badge-${question.difficulty.toLowerCase()}`}>{question.difficulty}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[question.subject, question.topic].filter(Boolean).join(" · ") || "—"} · {question.description}
                      {question.createdBy?.name ? ` · by ${question.createdBy.name}` : ""}
                    </p>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", whiteSpace: "nowrap" }}>
                    {question.points} marks{question.questionType === "CODING" ? ` · ${question._count.testCases} cases` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Link to={`/staff/questions/${question.id}/edit`} className="btn btn-ghost">Edit</Link>
                    <button className="btn btn-ghost" style={{ color: "var(--rust)", borderColor: "var(--rust)" }} onClick={() => handleDelete(question)}>Delete</button>
                  </div>
                </div>
              ))}
              {!loading && questions.length === 0 && (
                <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
                  No questions match. Try clearing filters, or add your first question.
                </div>
              )}
            </div>

            {!loading && pageMeta.totalPages > 1 && (
              <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center", alignItems: "center" }}>
                <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <span className="mono" style={{ fontSize: 13 }}>Page {pageMeta.page} / {pageMeta.totalPages} ({pageMeta.total} total)</span>
                <button className="btn btn-ghost" disabled={page >= pageMeta.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function otherFoldersById(folders, excludeId) {
  return (folders || []).filter((f) => f.id !== excludeId);
}

function NewFolderForm({ name, setName, category, setCategory, description, setDescription, onSubmit, submitting, placeholder }) {
  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
      <input
        style={{ ...inputStyle, flex: "1 1 220px" }}
        placeholder={placeholder || "New bank name (e.g. Aptitude, DBMS Midterm)…"}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        style={{ ...inputStyle, flex: "0 1 160px" }}
        placeholder="Category (optional)"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <input
        style={{ ...inputStyle, flex: "1 1 200px" }}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button className="btn btn-primary" disabled={!name.trim() || submitting}>
        {submitting ? "Creating…" : "+ New Bank"}
      </button>
    </form>
  );
}

function FolderCard({ folder, onClick }) {
  return (
    <div className="card" style={{ padding: 16, cursor: "pointer" }} onClick={onClick}>
      <div style={{ fontSize: 28 }}>{folder.name.split(" ")[0]}</div>
      <div style={{ fontWeight: 700, marginTop: 6 }}>{folder.name.split(" ").slice(1).join(" ")}</div>
    </div>
  );
}

function FolderManageCard({
  folder, totalCount, onOpen, renamingId, renameValue, setRenamingId, setRenameValue, onRename, onDelete,
  mergingId, setMergingId, mergeTargetId, setMergeTargetId, mergeOptions, onMerge,
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      {renamingId === folder.id ? (
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...inputStyle, flex: 1, padding: "6px 8px" }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => onRename(folder.id)}>Save</button>
        </div>
      ) : (
        <>
          <div onClick={onOpen} style={{ cursor: "pointer" }}>
            <Folder size={28} />
            <div style={{ fontWeight: 700, marginTop: 6 }}>{folder.name}</div>
            {folder.category && <div className="badge" style={{ marginTop: 4, fontSize: 10 }}>{folder.category}</div>}
            <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              Total Questions: {totalCount}{folder._count.children > 0 ? ` · ${folder._count.children} sub-bank${folder._count.children === 1 ? "" : "s"}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => { setRenamingId(folder.id); setRenameValue(folder.name); }}>Rename</button>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setMergingId(mergingId === folder.id ? null : folder.id)}>Merge</button>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px", color: "var(--rust)" }} onClick={onDelete}>Delete</button>
          </div>
          {mergingId === folder.id && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <select style={{ ...inputStyle, flex: 1, padding: "6px 8px", fontSize: 12 }} value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                <option value="">Merge into…</option>
                {mergeOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 8px" }} disabled={!mergeTargetId} onClick={onMerge}>Go</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
const selectStyle = { ...inputStyle, minWidth: 140 };
