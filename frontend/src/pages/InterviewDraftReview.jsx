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
  EXPERIENCE_LEVELS, FREQUENCY_TAGS, FREQUENCY_TAG_LABEL,
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

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className={`btn ${tab === "questions" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("questions")}>Question Drafts</button>
          <button className={`btn ${tab === "patterns" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("patterns")}>Company Pattern Notes</button>
        </div>

        {tab === "questions" ? <QuestionDraftsTab /> : <PatternDraftsTab />}
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

function DraftQuestionCard({ draft, onChanged }) {
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
        <div>
          <span className="badge">{draft.category}{draft.company ? ` · ${draft.company}` : ""} · {draft.difficulty}</span>
          <div style={{ marginTop: 6, fontWeight: 600 }}>{draft.title || draft.prompt.slice(0, 80)}</div>
          <div style={{ marginTop: 4, color: "var(--ink-dim)" }}>{draft.prompt.slice(0, 160)}{draft.prompt.length > 160 ? "…" : ""}</div>
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
