import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatementFields from "../components/ProblemStatementFields";
import TestCasesEditor from "../components/TestCasesEditor";
import useAiStatus from "../hooks/useAiStatus";
import {
  CATEGORIES, APTITUDE_CATS, PACKAGE_BANDS, PACKAGE_BAND_LABEL,
  EXPERIENCE_LEVELS, EXPERIENCE_LEVEL_LABEL, FREQUENCY_TAGS, FREQUENCY_TAG_LABEL,
  SOURCE_TYPE_LABEL, CONFIDENCE_LEVEL_COLOR,
} from "../constants/interviewCategories";

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 4 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" };

// Admin review queue for AI-drafted interview content — the AI-Powered Auto-Updating Mock
// Interview System's approval gate. Nothing generated here (routes/interviewDrafts.js's
// InterviewQuestionDraft / CompanyPatternNote rows) is ever visible to a student until an admin
// explicitly approves it on this page; see the plan at radiant-forging-elephant.md for the full
// structural guarantee (pickQuestions() in interview.js only ever reads InterviewQuestion, never
// the draft tables).
export default function InterviewDraftReview() {
  const [tab, setTab] = useState("questions");

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>AI Draft Review</h1>
            <ChalkUnderline />
          </div>
          <Link to="/staff/interviews" className="btn btn-ghost">← Back to Interview Admin</Link>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 12 }}>
          AI-generated content lands here as a draft — original questions written in a similar style/difficulty to
          what's commonly discussed for a company/category, never a copy of a real problem. Nothing here reaches a
          student until you approve it.
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          <button className={`btn ${tab === "questions" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("questions")}>Question Drafts</button>
          <button className={`btn ${tab === "patterns" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("patterns")}>Company Pattern Notes</button>
          <button className={`btn ${tab === "company" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("company")}>Company Questions</button>
          <button className={`btn ${tab === "reports" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("reports")}>Candidate Reports</button>
        </div>

        {tab === "questions" && <QuestionDraftsTab />}
        {tab === "patterns" && <PatternDraftsTab />}
        {tab === "company" && <CompanyQuestionsTab />}
        {tab === "reports" && <CandidateReportsTab />}
      </div>
    </div>
  );
}

function QuestionDraftsTab() {
  const toast = useToast();
  const aiAvailable = useAiStatus();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [drafts, setDrafts] = useState(null);
  const [genForm, setGenForm] = useState({ category: "HR", company: "", count: 3, difficulty: "" });
  const [generating, setGenerating] = useState(false);

  function load() {
    api.get("/interview/admin/drafts/questions", { params: { status: statusFilter, pageSize: 100 } }).then((res) => setDrafts(res.data.rows));
  }
  useEffect(load, [statusFilter]);

  async function generate() {
    setGenerating(true);
    try {
      const { data } = await api.post("/interview/admin/drafts/questions/generate", {
        category: genForm.category, company: genForm.company || undefined, count: Number(genForm.count) || 3,
        difficulty: genForm.difficulty || undefined,
      });
      toast.success(`Generated ${data.created} draft question(s).`);
      if (statusFilter === "PENDING") load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to generate drafts");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Generate with AI</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={genForm.category} onChange={(e) => setGenForm({ ...genForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Company (optional — general pool if blank)</label>
            <input style={inputStyle} value={genForm.company} onChange={(e) => setGenForm({ ...genForm, company: e.target.value })} placeholder="e.g. Amazon" />
          </div>
          <div>
            <label style={labelStyle}>Difficulty (optional)</label>
            <select style={inputStyle} value={genForm.difficulty} onChange={(e) => setGenForm({ ...genForm, difficulty: e.target.value })}>
              <option value="">Any</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>How many (1-10)</label>
            <input type="number" min="1" max="10" style={inputStyle} value={genForm.count} onChange={(e) => setGenForm({ ...genForm, count: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={generating || aiAvailable !== true} onClick={generate}>
          {generating ? "Generating…" : "🤖 Generate drafts"}
        </button>
        {aiAvailable === false && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>AI generation isn't available on this server yet — set GEMINI_API_KEY to enable it.</p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        {["PENDING", "APPROVED", "REJECTED"].map((s) => (
          <button key={s} className={`btn ${statusFilter === s ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: 12 }} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {drafts === null ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>
        ) : drafts.length === 0 ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>No {statusFilter.toLowerCase()} drafts.</p>
        ) : (
          drafts.map((d) => <DraftQuestionCard key={d.id} draft={d} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

function DraftQuestionCard({ draft, onChanged, selectable, selected, onToggleSelect }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(draft);
  const [frequencyTag, setFrequencyTag] = useState("");
  const [packageBand, setPackageBand] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    setSaving(true);
    try {
      await api.patch(`/interview/admin/drafts/questions/${draft.id}`, form);
      toast.success("Draft updated.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update draft");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setSaving(true);
    try {
      await api.post(`/interview/admin/drafts/questions/${draft.id}/approve`, {
        frequencyTag: frequencyTag || undefined, packageBand: packageBand || undefined, experienceLevel: experienceLevel || undefined,
      });
      toast.success("Approved — now live in the question bank.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to approve draft");
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    const reason = prompt("Reason for rejecting (optional):") || "";
    // Previously fired with no loading state at all — a slow network made this look completely
    // unresponsive, and a fast double-click could fire two reject requests for the same draft.
    setSaving(true);
    try {
      await api.post(`/interview/admin/drafts/questions/${draft.id}/reject`, { reason });
      toast.success("Rejected.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reject draft");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({ title: "Delete this draft?", message: "This permanently removes the draft record.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete(`/interview/admin/drafts/questions/${draft.id}`);
      toast.success("Deleted.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete draft");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 14, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {selectable && (
            <input type="checkbox" checked={!!selected} onChange={onToggleSelect} style={{ marginTop: 4 }} aria-label="Select draft" />
          )}
          <div>
            <span className="badge">{draft.category}{draft.company ? ` · ${draft.company}` : ""} · {draft.difficulty}</span>
            {draft.role && <span className="badge" style={{ marginLeft: 6 }}>{draft.role}</span>}
            {draft.experienceLevel && <span className="badge" style={{ marginLeft: 6 }}>{EXPERIENCE_LEVEL_LABEL[draft.experienceLevel] || draft.experienceLevel}</span>}
            {draft.sourceType && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: CONFIDENCE_LEVEL_COLOR[draft.confidenceLevel] || "var(--ink-dim)" }}>
                {SOURCE_TYPE_LABEL[draft.sourceType] || draft.sourceType}
                {draft.confidenceLevel ? ` · ${draft.confidenceLevel} confidence` : ""}
                {draft.verificationCount > 0 ? ` · verified ×${draft.verificationCount}` : ""}
              </span>
            )}
            <div style={{ marginTop: 6, fontWeight: 600 }}>{draft.title || draft.prompt.slice(0, 80)}</div>
            <div style={{ marginTop: 4, color: "var(--ink-dim)" }}>{draft.prompt.slice(0, 160)}{draft.prompt.length > 160 ? "…" : ""}</div>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setExpanded((e) => !e)}>{expanded ? "Collapse" : "Edit"}</button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label style={labelStyle}>Prompt</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />

          {draft.category === "APTITUDE" && (
            <>
              <label style={labelStyle}>Aptitude Category</label>
              <select style={inputStyle} value={form.aptitudeCategory || ""} onChange={(e) => setForm({ ...form, aptitudeCategory: e.target.value })}>
                <option value="">Select…</option>
                {APTITUDE_CATS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <label style={labelStyle}>Options (one per line, or edit as JSON array)</label>
              <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: "var(--font-mono)" }} value={(form.options || []).join("\n")} onChange={(e) => setForm({ ...form, options: e.target.value.split("\n") })} />
              <label style={labelStyle}>Correct answer index (0-based)</label>
              <input type="number" min="0" style={inputStyle} value={form.correctAnswer?.[0] ?? ""} onChange={(e) => setForm({ ...form, correctAnswer: [Number(e.target.value)] })} />
            </>
          )}

          {["HR", "TECHNICAL", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL"].includes(draft.category) && (
            <>
              <label style={labelStyle}>Expected keywords (comma-separated)</label>
              <input style={inputStyle} value={(form.expectedKeywords || []).join(", ")} onChange={(e) => setForm({ ...form, expectedKeywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              <label style={labelStyle}>Model answer</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.modelAnswer || ""} onChange={(e) => setForm({ ...form, modelAnswer: e.target.value })} />
            </>
          )}

          {draft.category === "CODING" && (
            <>
              <div style={{ marginTop: 10 }}>
                <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
              </div>
              <TestCasesEditor testCases={form.testCases || []} onChange={(tc) => setForm({ ...form, testCases: tc })} minVisible={2} minHidden={10} />
            </>
          )}

          <button className="btn btn-ghost" style={{ marginTop: 10 }} disabled={saving} onClick={saveEdit}>Save changes</button>
        </div>
      )}

      {draft.status === "PENDING" && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={{ ...inputStyle, marginTop: 0, width: "auto" }} value={frequencyTag} onChange={(e) => setFrequencyTag(e.target.value)}>
            <option value="">No frequency tag</option>
            {FREQUENCY_TAGS.map((t) => <option key={t} value={t}>{FREQUENCY_TAG_LABEL[t]}</option>)}
          </select>
          <select style={{ ...inputStyle, marginTop: 0, width: "auto" }} value={packageBand} onChange={(e) => setPackageBand(e.target.value)}>
            <option value="">No package band</option>
            {PACKAGE_BANDS.map((b) => <option key={b} value={b}>{PACKAGE_BAND_LABEL[b]}</option>)}
          </select>
          <select style={{ ...inputStyle, marginTop: 0, width: "auto" }} value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)}>
            <option value="">No experience level</option>
            {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={approve}>{saving ? "Working…" : "✓ Approve"}</button>
          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} disabled={saving} onClick={reject}>{saving ? "Working…" : "✕ Reject"}</button>
        </div>
      )}
      {draft.status !== "APPROVED" && (
        <button style={{ marginTop: 10, background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} disabled={saving} onClick={remove}>{saving ? "Working…" : "Delete draft"}</button>
      )}
      {draft.status === "REJECTED" && draft.rejectionReason && (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>Reason: {draft.rejectionReason}</p>
      )}
    </div>
  );
}

function PatternDraftsTab() {
  const toast = useToast();
  const aiAvailable = useAiStatus();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [notes, setNotes] = useState(null);
  const [genForm, setGenForm] = useState({ company: "", category: "CODING" });
  const [generating, setGenerating] = useState(false);

  function load() {
    api.get("/interview/admin/drafts/patterns", { params: { status: statusFilter } }).then((res) => setNotes(res.data));
  }
  useEffect(load, [statusFilter]);

  async function generate() {
    if (!genForm.company.trim()) return toast.error("Enter a company name first.");
    setGenerating(true);
    try {
      await api.post("/interview/admin/drafts/patterns/generate", genForm);
      toast.success("Generated a pattern note draft.");
      if (statusFilter === "PENDING") load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to generate pattern note");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Generate a company hiring-pattern checklist with AI</div>
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
          AI-estimated from general public knowledge — always shown to students labeled as such, never presented as verified company data.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>Company</label>
            <input style={inputStyle} value={genForm.company} onChange={(e) => setGenForm({ ...genForm, company: e.target.value })} placeholder="e.g. Amazon" />
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={genForm.category} onChange={(e) => setGenForm({ ...genForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={generating || aiAvailable !== true} onClick={generate}>{generating ? "Generating…" : "🤖 Generate"}</button>
        {aiAvailable === false && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>AI generation isn't available on this server yet — set GEMINI_API_KEY to enable it.</p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        {["PENDING", "APPROVED", "REJECTED"].map((s) => (
          <button key={s} className={`btn ${statusFilter === s ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: 12 }} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {notes === null ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>
        ) : notes.length === 0 ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>No {statusFilter.toLowerCase()} pattern notes.</p>
        ) : (
          notes.map((n) => <PatternNoteCard key={n.id} note={n} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

function PatternNoteCard({ note, onChanged }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [items, setItems] = useState((note.checklistItems || []).join("\n"));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/interview/admin/drafts/patterns/${note.id}`, { checklistItems: items.split("\n").map((s) => s.trim()).filter(Boolean) });
      toast.success("Updated.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  // approve/reject/remove previously had NO loading state at all — no disabled attribute, no
  // label change — so a slow network made a click look completely unresponsive, and a fast
  // double-click could fire two requests for the same note. All three now share `saving` with
  // save() above, since only one action per card should ever be in flight at once.
  async function approve() {
    setSaving(true);
    try {
      await api.post(`/interview/admin/drafts/patterns/${note.id}/approve`);
      toast.success("Approved.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to approve");
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    setSaving(true);
    try {
      await api.post(`/interview/admin/drafts/patterns/${note.id}/reject`);
      toast.success("Rejected.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reject");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({ title: "Delete this pattern note?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete(`/interview/admin/drafts/patterns/${note.id}`);
      toast.success("Deleted.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 14, fontSize: 13 }}>
      <span className="badge">{note.company} · {note.category}</span>
      <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: "var(--font-mono)" }} value={items} onChange={(e) => setItems(e.target.value)} placeholder="One checklist item per line" />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {note.status === "PENDING" && (
          <>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={saving} onClick={save}>{saving ? "Working…" : "Save changes"}</button>
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={approve}>{saving ? "Working…" : "✓ Approve"}</button>
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} disabled={saving} onClick={reject}>{saving ? "Working…" : "✕ Reject"}</button>
          </>
        )}
        {note.status !== "APPROVED" && <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} disabled={saving} onClick={remove}>{saving ? "Working…" : "Delete"}</button>}
      </div>
    </div>
  );
}

// ============================================================
// Company-Specific Interview Question Intelligence System
// ============================================================

function CompanyQuestionsTab() {
  const toast = useToast();
  const aiAvailable = useAiStatus();
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState({ companyId: "", role: "", experienceLevel: "", round: "TECHNICAL", technology: "", count: 3 });
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [health, setHealth] = useState(null);

  function loadCompanies() { api.get("/companies").then((res) => setCompanies(res.data)).catch(() => {}); }
  useEffect(loadCompanies, []);

  function loadDrafts() {
    if (!form.companyId || !form.role.trim()) { setDrafts([]); return; }
    api.get("/interview/admin/drafts/questions", {
      params: { status: "PENDING", companyId: form.companyId, role: form.role.trim(), ...(form.experienceLevel ? { experienceLevel: form.experienceLevel } : {}) },
    }).then((res) => { setDrafts(res.data.rows); setSelected(new Set()); }).catch(() => setDrafts([]));
  }
  useEffect(loadDrafts, [form.companyId, form.role, form.experienceLevel]);

  function loadHealth() {
    api.get("/interview/admin/company-questions/health", { params: form.companyId ? { companyId: form.companyId } : undefined })
      .then((res) => setHealth(res.data)).catch(() => setHealth(null));
  }
  useEffect(loadHealth, [form.companyId]);

  async function updateQuestions() {
    if (!form.companyId) return toast.error("Select a company first.");
    if (!form.role.trim()) return toast.error("Enter a role first.");
    setGenerating(true);
    setLastResult(null);
    try {
      const { data } = await api.post("/interview/admin/company-questions/generate", {
        companyId: form.companyId, role: form.role.trim(), experienceLevel: form.experienceLevel || undefined,
        round: form.round, technology: form.technology || undefined, count: Number(form.count) || 0,
      });
      setLastResult(data.job);
      toast.success(`Update complete: ${data.job.resultSummary?.aiGenerated || 0} new draft(s) created.`);
      loadDrafts();
      loadHealth();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update company questions");
    } finally {
      setGenerating(false);
    }
  }

  function toggleSelect(id) {
    setSelected((s) => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function selectAll() { setDrafts((d) => { setSelected(new Set((d || []).map((x) => x.id))); return d; }); }

  async function addSelected() {
    if (selected.size === 0) return;
    setBulkWorking(true);
    try {
      const { data } = await api.post("/interview/admin/drafts/questions/bulk-approve", { ids: Array.from(selected) });
      toast.success(`Added ${data.approved} question(s) to the mock interview pool.${data.failed ? ` ${data.failed} failed — check them individually.` : ""}`);
      loadDrafts();
      loadHealth();
    } catch (err) {
      toast.error(err.response?.data?.error || "Bulk add failed");
    } finally {
      setBulkWorking(false);
    }
  }

  const companyHealth = health?.find((h) => h.companyId === form.companyId);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Update Company Questions</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link to="/admin/companies" className="btn btn-ghost" style={{ fontSize: 12 }}>+ Manage companies</Link>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={loadCompanies}>↻ Refresh list</button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
          Reviews existing questions for this company/role/level/round, flags stale ones, checks for likely
          duplicates, and drafts new AI-generated practice questions where there's a real gap — every result lands
          as a PENDING draft below for your review, nothing is published automatically.
        </p>
        {companies.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 6 }}>
            No active companies found. Add one via <Link to="/admin/companies">Manage companies</Link>, then Refresh above.
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>Company</label>
            <select style={inputStyle} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">{companies.length === 0 ? "No active companies yet" : "Select…"}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Role</label>
            <input style={inputStyle} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Software Engineer" />
          </div>
          <div>
            <label style={labelStyle}>Level (optional)</label>
            <select style={inputStyle} value={form.experienceLevel} onChange={(e) => setForm({ ...form, experienceLevel: e.target.value })}>
              <option value="">Any</option>
              {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{EXPERIENCE_LEVEL_LABEL[l]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Round</label>
            <select style={inputStyle} value={form.round} onChange={(e) => setForm({ ...form, round: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Technology (optional)</label>
            <input style={inputStyle} value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} placeholder="e.g. Graphs" />
          </div>
          <div>
            <label style={labelStyle}>New questions to draft (0-10)</label>
            <input type="number" min="0" max="10" style={inputStyle} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={generating || aiAvailable !== true} onClick={updateQuestions}>
          {generating ? "Updating…" : "🔄 Update Questions"}
        </button>
        {aiAvailable === false && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>AI generation isn't available on this server yet — set GEMINI_API_KEY to enable it.</p>
        )}
        {lastResult?.resultSummary && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-dim)" }}>
            Status: <strong>{lastResult.status}</strong> — reviewed {lastResult.resultSummary.existingReviewed} existing question(s)
            ({lastResult.resultSummary.staleFound} stale), skipped {lastResult.resultSummary.duplicatesSkipped} likely duplicate(s),
            drafted {lastResult.resultSummary.aiGenerated} new question(s).
          </div>
        )}
        {companyHealth && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-dim)" }}>
            Company Question Health — {companyHealth.total} total, {companyHealth.recent} recent, {companyHealth.stale} stale,{" "}
            {companyHealth.high} high / {companyHealth.medium} medium / {companyHealth.low} low confidence,{" "}
            {companyHealth.aiGenerated} AI-generated, {companyHealth.needsReview} needs review.
          </div>
        )}
      </div>

      {drafts !== null && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Pending drafts for this company/role/level{drafts.length ? ` (${drafts.length})` : ""}</div>
            {drafts.length > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={selectAll}>Select All</button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={selected.size === 0 || bulkWorking} onClick={addSelected}>
                  {bulkWorking ? "Adding…" : `Add Selected (${selected.size})`}
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {drafts.length === 0 ? (
              <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                {form.companyId && form.role.trim() ? "No pending drafts for this company/role/level." : "Select a company and enter a role to see drafts."}
              </p>
            ) : (
              drafts.map((d) => (
                <DraftQuestionCard key={d.id} draft={d} onChanged={() => { loadDrafts(); loadHealth(); }}
                  selectable selected={selected.has(d.id)} onToggleSelect={() => toggleSelect(d.id)} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CandidateReportsTab() {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [reports, setReports] = useState(null);

  function load() {
    api.get("/interview/admin/company-questions/reports", { params: { status: statusFilter } })
      .then((res) => setReports(res.data)).catch(() => setReports([]));
  }
  useEffect(load, [statusFilter]);

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
        Real interview questions students have reported after their own interviews. Verifying a report either
        corroborates an existing question (raising its confidence) or creates a new PENDING draft for review —
        either way, nothing reaches a student without a separate explicit approval on the tab above.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {["PENDING", "VERIFIED", "REJECTED"].map((s) => (
          <button key={s} className={`btn ${statusFilter === s ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: 12 }} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {reports === null ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>
        ) : reports.length === 0 ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>No {statusFilter.toLowerCase()} reports.</p>
        ) : (
          reports.map((r) => <CandidateReportCard key={r.id} report={r} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

function CandidateReportCard({ report, onChanged }) {
  const toast = useToast();
  const [working, setWorking] = useState(false);

  async function verify(status) {
    let rejectionReason;
    if (status === "REJECTED") {
      rejectionReason = prompt("Reason for rejecting this report:") || "";
      if (!rejectionReason.trim()) return toast.error("A reason is required to reject.");
    }
    setWorking(true);
    try {
      await api.patch(`/interview/admin/company-questions/reports/${report.id}/verify`, { status, rejectionReason });
      toast.success(status === "VERIFIED" ? "Verified." : "Rejected.");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to review report");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 14, fontSize: 13 }}>
      <span className="badge">{report.companyRef?.name || "Unknown"} · {report.role} · {report.round}</span>
      {report.experienceLevel && <span className="badge" style={{ marginLeft: 6 }}>{EXPERIENCE_LEVEL_LABEL[report.experienceLevel] || report.experienceLevel}</span>}
      <div style={{ marginTop: 6 }}>{report.questionText}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-dim)" }}>
        Reported by {report.student?.name || "a student"} · {report.interviewDate ? new Date(report.interviewDate).toLocaleDateString() : "date not given"}
        {report.technology ? ` · ${report.technology}` : ""}
      </div>
      {report.status === "PENDING" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={working} onClick={() => verify("VERIFIED")}>{working ? "Working…" : "✓ Verify"}</button>
          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} disabled={working} onClick={() => verify("REJECTED")}>{working ? "Working…" : "✕ Reject"}</button>
        </div>
      )}
      {report.status === "REJECTED" && report.rejectionReason && (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>Reason: {report.rejectionReason}</p>
      )}
    </div>
  );
}
