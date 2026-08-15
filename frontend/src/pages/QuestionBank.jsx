import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Folder, BookOpen, Layers, AlertTriangle } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import UploadProgressBar from "../components/UploadProgressBar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid } from "../components/Skeleton";
import SubjectUnitPicker from "../components/SubjectUnitPicker";
import { useConfirm } from "../context/ConfirmContext";
import { useAuth } from "../context/AuthContext";

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select" };

// activeFolder: null = root folder-picker view; { id: "__all__", name: "All Questions" };
// { id: "__none__", name: "Uncategorized" }; or a real folder row from GET /questions/folders
// (id, name, category, description, parentId, _count: { questions, children }).
export default function QuestionBank() {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const { user } = useAuth();
  // Subject/Unit/Topic is now the mandatory, primary organizing axis (spec section 5's Subject ->
  // Unit -> count tree); QuestionFolder stays available as a secondary, optional grouping (e.g.
  // "Midterm Prep" spanning subjects) — neither replaces the other, see the approved plan's design
  // decision. "subjects" is the default view a staff member lands on.
  const [viewMode, setViewMode] = useState("subjects"); // "subjects" | "folders"
  const [subjects, setSubjects] = useState(null);
  const [activeSubject, setActiveSubject] = useState(null); // a row from GET /subjects, or null
  const [activeUnit, setActiveUnit] = useState(null); // a unit from activeSubject.units, the synthetic "__none__" bucket, or null
  const [subjectAssignments, setSubjectAssignments] = useState(null); // ADMIN-only: StaffSubjectAssignment rows for activeSubject
  const [grantStaffId, setGrantStaffId] = useState("");
  const [staffDirectory, setStaffDirectory] = useState(null);
  const [granting, setGranting] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkSubjectId, setBulkSubjectId] = useState(null);
  const [bulkUnitId, setBulkUnitId] = useState(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [creatingSubjectRoot, setCreatingSubjectRoot] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [creatingUnitInSubject, setCreatingUnitInSubject] = useState(false);

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
  const [topicId, setTopicId] = useState("");
  const [unitTopics, setUnitTopics] = useState([]);
  const [difficulty, setDifficulty] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [createdById, setCreatedById] = useState("");
  const [questionStatus, setQuestionStatus] = useState("");
  const [aiGeneratedOnly, setAiGeneratedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);
  const [copyTargetId, setCopyTargetId] = useState("");
  const [copying, setCopying] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatusUpdating, setBulkStatusUpdating] = useState(false);
  const [clearingFolder, setClearingFolder] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState("skip");

  function loadFolders() {
    api.get("/questions/folders").then((res) => setFolders(res.data));
  }
  useEffect(loadFolders, []);

  function loadSubjects() {
    return api.get("/subjects").then((res) => {
      setSubjects(res.data);
      return res.data;
    });
  }
  useEffect(() => { loadSubjects(); }, []);

  async function createSubjectRoot(e) {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setCreatingSubjectRoot(true);
    try {
      const { data } = await api.post("/subjects", { name: newSubjectName.trim() });
      setNewSubjectName("");
      const fresh = await loadSubjects();
      setActiveSubject(fresh.find((s) => s.id === data.id) || data);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create subject");
    } finally {
      setCreatingSubjectRoot(false);
    }
  }

  async function createUnitInSubject(e) {
    e.preventDefault();
    if (!newUnitName.trim() || !activeSubject) return;
    setCreatingUnitInSubject(true);
    try {
      await api.post(`/subjects/${activeSubject.id}/units`, { name: newUnitName.trim() });
      setNewUnitName("");
      const fresh = await loadSubjects();
      setActiveSubject(fresh.find((s) => s.id === activeSubject.id) || activeSubject);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create unit");
    } finally {
      setCreatingUnitInSubject(false);
    }
  }

  // ADMIN-only: who currently has authoring access to activeSubject (spec section 10's actual UI).
  function loadAssignments(subjectId) {
    setSubjectAssignments(null);
    api.get(`/subjects/${subjectId}/assignments`).then((res) => setSubjectAssignments(res.data));
    if (!staffDirectory) {
      api.get("/tests/staff-directory").then((res) => setStaffDirectory(res.data)).catch(() => setStaffDirectory([]));
    }
  }

  async function grantSubjectAccess() {
    if (!grantStaffId || !activeSubject) return;
    setGranting(true);
    try {
      await api.post(`/subjects/${activeSubject.id}/assignments`, { staffId: grantStaffId });
      setGrantStaffId("");
      loadAssignments(activeSubject.id);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to grant access");
    } finally {
      setGranting(false);
    }
  }

  async function revokeSubjectAccess(staffId) {
    if (!activeSubject) return;
    try {
      await api.delete(`/subjects/${activeSubject.id}/assignments/${staffId}`);
      loadAssignments(activeSubject.id);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to revoke access");
    }
  }

  // Bulk "Assign Subject/Unit" — clears the backfill script's "needs classification" backlog
  // (spec section 15) for a selected batch of questions without opening each one's edit form.
  async function bulkAssignSubject() {
    if (!bulkSubjectId || !bulkUnitId) return;
    setBulkAssigning(true);
    try {
      const { data } = await api.post("/questions/bulk-assign-subject", {
        questionIds: selectedIds, subjectId: bulkSubjectId, unitId: bulkUnitId,
      });
      if (data.skippedCount > 0) alert(`Assigned ${data.updatedCount} question(s). ${data.skippedCount} skipped (not yours to update).`);
      setSelectedIds([]);
      setShowBulkAssign(false);
      setBulkSubjectId(null);
      setBulkUnitId(null);
      load();
      loadSubjects();
      reloadMeta();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to assign subject/unit");
    } finally {
      setBulkAssigning(false);
    }
  }

  function reloadMeta() {
    api.get("/questions/meta/filters").then((res) => setMeta(res.data));
  }
  useEffect(reloadMeta, []);

  // Debounce free-text search — previously fired one API call per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const isBrowsing = viewMode === "folders" ? !!activeFolder : !!activeUnit;

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subject, topic, topicId, difficulty, questionType, createdById, questionStatus, aiGeneratedOnly, activeFolder, activeUnit]);

  useEffect(() => {
    if (isBrowsing) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subject, topic, topicId, difficulty, questionType, createdById, questionStatus, aiGeneratedOnly, activeFolder, activeUnit, page]);

  // Topic filter within a Unit — a real cascading list (from Topic rows under the active Unit),
  // distinct from the legacy free-text `topic` filter used in Folders mode/for unclassified questions.
  useEffect(() => {
    setTopicId("");
    if (viewMode === "subjects" && activeUnit && activeUnit.id !== "__none__" && activeUnit.id !== "__no_subject__") {
      api.get(`/subjects/units/${activeUnit.id}/topics`).then((res) => setUnitTopics(res.data)).catch(() => setUnitTopics([]));
    } else {
      setUnitTopics([]);
    }
  }, [viewMode, activeUnit]);

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
    if (topicId) params.topicId = topicId;
    if (difficulty) params.difficulty = difficulty;
    if (questionType) params.questionType = questionType;
    if (createdById) params.createdById = createdById;
    if (questionStatus) params.questionStatus = questionStatus;
    if (aiGeneratedOnly) params.aiGenerated = "true";
    if (viewMode === "folders") {
      if (activeFolder?.id === "__none__") params.folderId = "__none__";
      else if (activeFolder && activeFolder.id !== "__all__") params.folderId = activeFolder.id;
    } else if (viewMode === "subjects" && activeUnit) {
      if (activeUnit.id === "__no_subject__") params.subjectId = "__none__";
      else {
        params.subjectId = activeSubject.id;
        params.unitId = activeUnit.id === "__none__" ? "__none__" : activeUnit.id;
      }
    }
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
    let preview;
    try {
      const { data } = await api.get(`/questions/folders/${folder.id}/delete-preview`);
      preview = data;
    } catch (err) {
      alert(err.response?.data?.error || "Failed to check this bank's contents");
      return;
    }
    const parts = [`Questions: ${preview.questionCount}`, `Sub-banks: ${preview.subBankCount}`];
    if (preview.blockedCount > 0) {
      parts.push(`${preview.blockedCount} question${preview.blockedCount === 1 ? "" : "s"} used in a Test will be kept, and this bank won't be fully deleted`);
    }
    const ok = await confirmDialog({
      title: `Delete "${folder.name}"?`,
      message: `This permanently deletes everything inside this question bank — ${parts.join(" · ")}. This action cannot be undone.`,
      confirmLabel: "Delete Permanently",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/questions/folders/${folder.id}`);
      if (activeFolder?.id === folder.id) setActiveFolder(null);
      loadFolders();
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete folder");
    }
  }

  async function clearFolder(folder) {
    const ok = await confirmDialog({
      title: "Clear All Questions?",
      message: "All questions inside this folder will be permanently deleted. This action cannot be undone.",
      confirmLabel: "Clear All",
      danger: true,
    });
    if (!ok) return;
    setClearingFolder(true);
    try {
      const { data } = await api.post(`/questions/folders/${folder.id}/clear`);
      if (data.blocked?.length > 0) {
        alert(`Cleared ${data.clearedCount} question(s). ${data.blocked.length} question(s) used in a Test couldn't be deleted and remain in this bank.`);
      }
      setSelectedIds([]);
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to clear this bank");
    } finally {
      setClearingFolder(false);
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

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.length === questions.length ? [] : questions.map((q) => q.id)));
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

  async function copySelected() {
    if (!copyTargetId) return;
    setCopying(true);
    try {
      const { data } = await api.post("/questions/bulk-copy", { questionIds: selectedIds, folderId: copyTargetId });
      setSelectedIds([]);
      setCopyTargetId("");
      if (data.skippedCount > 0) alert(`Copied ${data.copiedCount} question(s). ${data.skippedCount} skipped (already in that bank, or not yours to copy).`);
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to copy questions");
    } finally {
      setCopying(false);
    }
  }

  // Bulk review-status transition — the review-queue action: filter by Draft/Under Review,
  // select a batch, Verify or Archive in one click instead of opening each question's edit
  // form. No confirm dialog for Verify (reversible, same weight as any other edit); Archive gets
  // one since it pulls the question out of every assessment surface until re-published.
  async function setBulkStatus(questionStatus) {
    if (questionStatus === "ARCHIVED") {
      const ok = await confirmDialog({
        title: `Archive ${selectedIds.length} Question${selectedIds.length === 1 ? "" : "s"}?`,
        message: "Archived questions are excluded from Readiness assessments until re-published. They stay visible here and can still be manually added to a Formal Test if you choose. You can change this back later.",
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    setBulkStatusUpdating(true);
    try {
      const { data } = await api.post("/questions/bulk-status", { questionIds: selectedIds, questionStatus });
      if (Array.isArray(data.blocked) && data.blocked.length > 0) {
        const lines = data.blocked.map((b) => `• ${b.title}: ${b.reasons.join("; ")}`).join("\n");
        alert(`Updated ${data.updatedCount} question(s). ${data.blocked.length} couldn't be marked VERIFIED yet:\n\n${lines}`);
      } else if (data.skippedCount > 0) {
        alert(`Updated ${data.updatedCount} question(s). ${data.skippedCount} skipped (not yours to update).`);
      }
      setSelectedIds([]);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update review status");
    } finally {
      setBulkStatusUpdating(false);
    }
  }

  async function deleteSelected() {
    const ok = await confirmDialog({
      title: `Delete ${selectedIds.length} Question${selectedIds.length === 1 ? "" : "s"}?`,
      message: "These questions will be permanently removed from the question bank. This action cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const { data } = await api.post("/questions/bulk-delete", { questionIds: selectedIds });
      if (data.blocked?.length > 0) {
        alert(`Deleted ${data.deletedCount} question(s). ${data.blocked.length} question(s) used in a Test couldn't be deleted.`);
      }
      setSelectedIds([]);
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete questions");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function exportSelected() {
    await downloadFile("/questions/export", "question-bank-export-selected.xlsx", { questionIds: selectedIds.join(",") });
  }

  function addSelectedToTest() {
    navigate("/staff/tests/new", { state: { prefillQuestionIds: selectedIds } });
  }

  async function handleDelete(question) {
    const ok = await confirmDialog({
      title: "Delete Question?",
      message: "This question will be permanently removed from the question bank. This action cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/questions/${question.id}`);
      setSelectedIds((prev) => prev.filter((id) => id !== question.id));
      load();
      loadFolders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete question");
    }
  }

  async function downloadFile(url, filename, overrideParams) {
    const params = overrideParams || { q, subject, topic, difficulty, questionType, createdById };
    if (!overrideParams) {
      if (viewMode === "folders") {
        if (activeFolder?.id === "__none__") params.folderId = "__none__";
        else if (activeFolder && activeFolder.id !== "__all__") params.folderId = activeFolder.id;
      } else if (viewMode === "subjects" && activeUnit) {
        if (activeUnit.id === "__no_subject__") params.subjectId = "__none__";
        else {
          params.subjectId = activeSubject.id;
          params.unitId = activeUnit.id === "__none__" ? "__none__" : activeUnit.id;
        }
      }
    }
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
      if (viewMode === "folders") {
        if (activeFolder && activeFolder.id !== "__all__" && activeFolder.id !== "__none__") {
          formData.append("folderId", activeFolder.id);
        }
      }
      // Note: bulk-import resolves Subject/Unit per-row from the file's own columns (see
      // resolveSubjectUnitTopicByName in questions.js), not from a request param — browsing into
      // a specific Unit before importing doesn't pre-target the import, it only pre-fills nothing.
      // Uploaded rows must name their own Subject/Unit regardless of where the modal was opened from.
      formData.append("duplicateAction", duplicateAction);
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

        {!isBrowsing && (
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button
              className={viewMode === "subjects" ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: 13 }}
              onClick={() => setViewMode("subjects")}
            >
              <BookOpen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />By Subject
            </button>
            <button
              className={viewMode === "folders" ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: 13 }}
              onClick={() => setViewMode("folders")}
            >
              <Folder size={14} style={{ verticalAlign: -2, marginRight: 6 }} />My Folders
            </button>
          </div>
        )}

        {!isBrowsing && viewMode === "subjects" && (
          !activeSubject ? (
            <>
              <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
                Every question lives under a Subject &gt; Unit &gt; (optional) Topic — this keeps "Unit 1" in Java
                and "Unit 1" in DBMS from ever being confused with each other. Open a subject to browse its units,
                or create a new one.
              </p>
              <form onSubmit={createSubjectRoot} style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <input
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                  placeholder="New subject name (e.g. Java, DBMS)…"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                />
                <button className="btn btn-primary" disabled={!newSubjectName.trim() || creatingSubjectRoot}>
                  {creatingSubjectRoot ? "Creating…" : "+ New Subject"}
                </button>
              </form>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginTop: 20 }}>
                {subjects === null && <SkeletonGrid count={4} minWidth={220} />}
                {subjects?.map((s) => (
                  <div key={s.id} className="card" style={{ padding: 16, cursor: "pointer" }} onClick={() => setActiveSubject(s)}>
                    <Layers size={26} />
                    <div style={{ fontWeight: 700, marginTop: 6 }}>{s.name}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {s._count.questions} question{s._count.questions === 1 ? "" : "s"} · {s.units.length} unit{s.units.length === 1 ? "" : "s"}
                    </div>
                    {s.createdBy?.name && (
                      <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>by {s.createdBy.name}</div>
                    )}
                  </div>
                ))}
                {meta.noSubjectCount > 0 && (
                  <div
                    className="card"
                    style={{ padding: 16, cursor: "pointer", borderColor: "var(--rust)" }}
                    onClick={() => setActiveUnit({ id: "__no_subject__", name: "Needs Subject Assignment" })}
                  >
                    <AlertTriangle size={26} color="var(--rust)" />
                    <div style={{ fontWeight: 700, marginTop: 6 }}>Needs Subject Assignment</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {meta.noSubjectCount} question{meta.noSubjectCount === 1 ? "" : "s"} from before this taxonomy existed
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20, flexWrap: "wrap", fontSize: 13 }}>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setActiveSubject(null)}>← All subjects</button>
              </div>
              <h3 style={{ fontSize: 16, marginTop: 12 }}>{activeSubject.name}</h3>
              <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 4 }}>
                {activeSubject._count.questions} question{activeSubject._count.questions === 1 ? "" : "s"} across {activeSubject.units.length} unit{activeSubject.units.length === 1 ? "" : "s"}
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 16 }}>
                {activeSubject.units.map((u) => (
                  <div key={u.id} className="card" style={{ padding: 16, cursor: "pointer" }} onClick={() => setActiveUnit(u)}>
                    <div style={{ fontWeight: 700 }}>{u.name}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {u._count.questions} question{u._count.questions === 1 ? "" : "s"}{u._count.topics > 0 ? ` · ${u._count.topics} topic${u._count.topics === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                ))}
                {activeSubject.units.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>No units yet — add one below.</p>}
                {activeSubject._count.questions > activeSubject.units.reduce((sum, u) => sum + u._count.questions, 0) && (
                  <div
                    className="card"
                    style={{ padding: 16, cursor: "pointer", borderColor: "var(--rust)" }}
                    onClick={() => setActiveUnit({ id: "__none__", name: "Needs Unit Assignment" })}
                  >
                    <AlertTriangle size={22} color="var(--rust)" />
                    <div style={{ fontWeight: 700, marginTop: 6 }}>Needs Unit Assignment</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {activeSubject._count.questions - activeSubject.units.reduce((sum, u) => sum + u._count.questions, 0)} question(s) not yet sorted into a unit
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={createUnitInSubject} style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <input
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                  placeholder={`New unit name (under "${activeSubject.name}")…`}
                  value={newUnitName}
                  onChange={(e) => setNewUnitName(e.target.value)}
                />
                <button className="btn btn-primary" disabled={!newUnitName.trim() || creatingUnitInSubject}>
                  {creatingUnitInSubject ? "Creating…" : "+ New Unit"}
                </button>
              </form>

              {user?.role === "ADMIN" && (
                <div className="card" style={{ padding: 16, marginTop: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Who can author under "{activeSubject.name}"?</div>
                  <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                    {activeSubject.createdBy?.name || "The creator"} always has access. Grant other staff here — access is
                    checked on the server, not just hidden in the UI.
                  </p>
                  {subjectAssignments === null && !subjectAssignments && (
                    <button className="btn btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={() => loadAssignments(activeSubject.id)}>
                      Manage access
                    </button>
                  )}
                  {subjectAssignments && (
                    <>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <select style={{ ...selectStyle, minWidth: 200 }} value={grantStaffId} onChange={(e) => setGrantStaffId(e.target.value)}>
                          <option value="">Select staff to grant…</option>
                          {(staffDirectory || [])
                            .filter((s) => !subjectAssignments.some((a) => a.staffId === s.id) && s.id !== activeSubject.createdById)
                            .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!grantStaffId || granting} onClick={grantSubjectAccess}>
                          {granting ? "Granting…" : "Grant"}
                        </button>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        {subjectAssignments.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>No additional staff granted yet.</p>}
                        {subjectAssignments.map((a) => (
                          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                            <span>{a.staff.name}</span>
                            <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => revokeSubjectAccess(a.staffId)}>Revoke</button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )
        )}

        {!isBrowsing && viewMode === "folders" && (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 16 }}>
              Folders are a secondary, optional way to group questions (e.g. "Midterm Prep" spanning several subjects) — Subject/Unit above stays the primary organization. Open a folder to browse, or create a new top-level one.
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
        )}

        {isBrowsing && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20, flexWrap: "wrap", fontSize: 13 }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => (viewMode === "folders" ? setActiveFolder(null) : setActiveUnit(null))}
              >
                ← {viewMode === "folders" ? "All banks" : (activeUnit?.id === "__no_subject__" ? "All subjects" : activeSubject?.name || "Subject")}
              </button>
              {viewMode === "subjects" && activeUnit?.id !== "__no_subject__" && (
                <>
                  <span style={{ color: "var(--ink-dim)" }}>/</span>
                  <span style={{ fontWeight: 700 }}>{activeUnit?.name}</span>
                </>
              )}
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
            <h3 style={{ fontSize: 16, marginTop: 12 }}>{viewMode === "folders" ? activeFolder.name : (activeUnit?.id === "__no_subject__" ? "Needs Subject Assignment" : `${activeSubject?.name} → ${activeUnit?.name}`)}</h3>
            {isRealFolder && activeFolder.description && (
              <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>{activeFolder.description}</p>
            )}
            {isRealFolder && (
              <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 4 }}>
                Total Questions: {totalCounts.get(activeFolder.id) ?? activeFolder._count?.questions ?? 0}
                {activeFolder.category ? ` · ${activeFolder.category}` : ""}
              </p>
            )}
            {isRealFolder && activeFolder._count?.questions > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, marginTop: 8, color: "var(--rust)", borderColor: "var(--rust)" }}
                disabled={clearingFolder}
                onClick={() => clearFolder(activeFolder)}
              >
                {clearingFolder ? "Clearing…" : "Clear All Questions"}
              </button>
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
              {viewMode === "folders" ? (
                <>
                  <select style={selectStyle} value={subject} onChange={(e) => setSubject(e.target.value)}>
                    <option value="">All categories (subject)</option>
                    {meta.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select style={selectStyle} value={topic} onChange={(e) => setTopic(e.target.value)}>
                    <option value="">All subcategories (topic)</option>
                    {meta.topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </>
              ) : unitTopics.length > 0 && (
                <select style={selectStyle} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                  <option value="">All topics</option>
                  {unitTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
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
              {meta.creators.length > 0 && (
                <select style={selectStyle} value={createdById} onChange={(e) => setCreatedById(e.target.value)}>
                  <option value="">Created by (anyone)</option>
                  {meta.creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <select style={selectStyle} value={questionStatus} onChange={(e) => setQuestionStatus(e.target.value)}>
                <option value="">All review statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="VERIFIED">Verified</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "0 6px" }}>
                <input type="checkbox" checked={aiGeneratedOnly} onChange={(e) => setAiGeneratedOnly(e.target.checked)} />
                AI-generated only
              </label>
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
                <form onSubmit={handleImport} style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                  <select style={{ ...selectStyle, minWidth: 200 }} value={duplicateAction} onChange={(e) => setDuplicateAction(e.target.value)}>
                    <option value="skip">Skip duplicate questions</option>
                    <option value="import">Import duplicates anyway</option>
                  </select>
                  <button className="btn btn-primary" disabled={!importFile || importing}>
                    {importing ? "Importing…" : "Import"}
                  </button>
                </form>
                <UploadProgressBar active={importing} />
                {importResult && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 14 }}>
                      <strong>{importResult.createdCount}</strong> question{importResult.createdCount === 1 ? "" : "s"} created
                      out of {importResult.total}.
                      {importResult.skippedCount > 0 && ` ${importResult.skippedCount} duplicate${importResult.skippedCount === 1 ? "" : "s"} skipped.`}
                      {importResult.errorCount > 0 && ` ${importResult.errorCount} failed.`}
                    </p>
                    {importResult.skipped?.length > 0 && (
                      <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                        {importResult.skipped.map((s, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--ink-dim)" }} className="mono">Row {s.row}: {s.reason}</div>
                        ))}
                      </div>
                    )}
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

            {!loading && questions.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedIds.length === questions.length} onChange={toggleSelectAll} />
                Select All ({questions.length})
              </label>
            )}

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
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
                      {question.questionStatus && question.questionStatus !== "PUBLISHED" && (
                        <span className="mono" style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)", color: "var(--ink-dim)" }}>
                          {question.questionStatus.replace(/_/g, " ")}
                        </span>
                      )}
                      {question.aiGenerated && (
                        <span className="mono" style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#8b5cf622", color: "#8b5cf6" }}>
                          AI
                        </span>
                      )}
                      {question.subjectRef ? (
                        <span className="mono" style={{ fontSize: 11, color: "var(--mint)" }}>
                          {question.subjectRef.name} → {question.unitRef?.name || "?"}{question.topicRef ? ` → ${question.topicRef.name}` : ""}
                        </span>
                      ) : (
                        <span className="mono" style={{ fontSize: 11, color: "var(--rust)" }}>
                          {question.subject ? `${question.subject}${question.topic ? ` · ${question.topic}` : ""} (needs classification)` : "Needs classification"}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {question.description}
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

            {selectedIds.length > 0 && (
              <div
                className="card"
                style={{
                  position: "sticky", bottom: 0, padding: 12, marginTop: 16, display: "flex", alignItems: "center",
                  gap: 10, flexWrap: "wrap", zIndex: 10, boxShadow: "0 -4px 12px rgba(0,0,0,0.08)",
                }}
              >
                <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{selectedIds.length} Selected</span>
                <select style={{ ...selectStyle, minWidth: 180 }} value={moveTargetId} onChange={(e) => setMoveTargetId(e.target.value)}>
                  <option value="">Move to: Uncategorized</option>
                  {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={moveSelected} disabled={moving}>
                  {moving ? "Moving…" : "Move"}
                </button>
                <select style={{ ...selectStyle, minWidth: 180 }} value={copyTargetId} onChange={(e) => setCopyTargetId(e.target.value)}>
                  <option value="">Copy to…</option>
                  {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={copySelected} disabled={copying || !copyTargetId}>
                  {copying ? "Copying…" : "Copy"}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={exportSelected}>Export</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addSelectedToTest}>Add to Test</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowBulkAssign((s) => !s)}>
                  Assign Subject/Unit
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "#16a34a", borderColor: "#16a34a" }}
                  onClick={() => setBulkStatus("VERIFIED")}
                  disabled={bulkStatusUpdating}
                  title="Mark as reviewed and eligible for live assessments"
                >
                  {bulkStatusUpdating ? "Updating…" : "Verify"}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => setBulkStatus("ARCHIVED")}
                  disabled={bulkStatusUpdating}
                  title="Remove from live assessment surfaces until re-published"
                >
                  {bulkStatusUpdating ? "Updating…" : "Archive"}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "var(--rust)", borderColor: "var(--rust)" }}
                  onClick={deleteSelected}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? "Deleting…" : "Delete"}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setSelectedIds([])}>Deselect All</button>
              </div>
            )}

            {showBulkAssign && selectedIds.length > 0 && (
              <div className="card" style={{ padding: 16, marginTop: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                  Assign Subject/Unit to {selectedIds.length} question{selectedIds.length === 1 ? "" : "s"}
                </div>
                <SubjectUnitPicker
                  subjectId={bulkSubjectId} unitId={bulkUnitId} showTopic={false}
                  onChange={({ subjectId, unitId }) => { setBulkSubjectId(subjectId); setBulkUnitId(unitId); }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!bulkSubjectId || !bulkUnitId || bulkAssigning} onClick={bulkAssignSubject}>
                    {bulkAssigning ? "Assigning…" : "Assign"}
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowBulkAssign(false)}>Cancel</button>
                </div>
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
