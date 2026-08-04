import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ClipboardList, FolderOpen, Folder, Upload } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import { SkeletonGrid } from "../components/Skeleton";
import FolderPicker from "../components/FolderPicker";
import AcademicGroupPicker from "../components/AcademicGroupPicker";
import UploadProgressBar from "../components/UploadProgressBar";
import { useAuth } from "../context/AuthContext";

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select" };

const emptyForm = {
  title: "", code: "", description: "", instructions: "", company: "", durationMin: 60, passingMarks: "", showResults: true, startTime: "", endTime: "",
  requireFullscreen: true, requireWebcam: false, requireMicrophone: false, attendanceMandatory: false,
  shuffleQuestions: true, shuffleOptions: false,
  questionSelectionMode: "FIXED", randomBankFolderId: "", randomQuestionsPerStudent: "",
  randomEasy: "", randomMedium: "", randomHard: "",
};

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateTest() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Only the platform-level account (no instituteId — see backend/src/middleware/institute.js)
  // may ever produce a truly platform-wide test; every institute-scoped Staff/Admin's "leave
  // empty" default is now institute-bounded server-side (see Test.instituteId in schema.prisma).
  const isPlatformLevel = !user?.instituteId;

  const [questions, setQuestions] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [academicGroups, setAcademicGroups] = useState([]);
  const [academicGroupIds, setAcademicGroupIds] = useState([]);
  // Group Type is mutually exclusive per the spec — "Only one Group Type should be selected for
  // an assessment" — since testEligibilityWhere already treats any TalentPoolTest link as a full
  // override of the academicGroup/class check, not an OR with it (see backend/src/utils/
  // testEligibility.js). Switching to Talent Pools here doesn't invent a new assignment mechanism —
  // it just calls the existing POST/DELETE /talent-pools/:id/tests routes after the test itself is
  // saved, diffed against whatever pools this test was already linked to.
  const [groupType, setGroupType] = useState("ACADEMIC");
  const [talentPools, setTalentPools] = useState([]);
  const [talentPoolIds, setTalentPoolIds] = useState([]);
  const [initialTalentPoolIds, setInitialTalentPoolIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);

  useEffect(() => {
    api.get("/academic-groups").then((res) => setAcademicGroups(res.data));
    api.get("/talent-pools").then((res) => setTalentPools(res.data)).catch(() => setTalentPools([]));
  }, []);

  useEffect(() => {
    api.get("/questions", { params: { ...(search ? { q: search } : {}), pageSize: 100 } }).then((res) => setQuestions(res.data.rows));
  }, [search]);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/tests/${id}`).then((res) => {
      const t = res.data;
      setForm({
        title: t.title || "", code: t.code || "", description: t.description || "",
        instructions: t.instructions || "", company: t.company || "", durationMin: t.durationMin, passingMarks: t.passingMarks ?? "",
        showResults: t.showResults, startTime: toLocalInputValue(t.startTime), endTime: toLocalInputValue(t.endTime),
        requireFullscreen: t.requireFullscreen !== false, requireWebcam: !!t.requireWebcam, requireMicrophone: !!t.requireMicrophone,
        attendanceMandatory: !!t.attendanceMandatory,
        shuffleQuestions: t.shuffleQuestions !== false, shuffleOptions: !!t.shuffleOptions,
        questionSelectionMode: t.questionSelectionMode || "FIXED",
        randomBankFolderId: t.randomBankFolderId || "",
        randomQuestionsPerStudent: t.randomQuestionsPerStudent ?? "",
        randomEasy: t.difficultyDistribution?.easy ?? "",
        randomMedium: t.difficultyDistribution?.medium ?? "",
        randomHard: t.difficultyDistribution?.hard ?? "",
      });
      setAcademicGroupIds((t.academicGroups || []).map((g) => g.academicGroupId));
      const poolIds = (t.talentPools || []).map((tp) => tp.poolId);
      setTalentPoolIds(poolIds);
      setInitialTalentPoolIds(poolIds);
      setGroupType(poolIds.length > 0 ? "TALENT_POOL" : "ACADEMIC");
      const qIds = t.questions.map((tq) => tq.question.id);
      setSelected(qIds);
      setQuestions((prev) => {
        const known = new Set(prev.map((q) => q.id));
        const extra = t.questions.map((tq) => tq.question).filter((q) => !known.has(q.id));
        return [...extra, ...prev];
      });
      setLoading(false);
    });
  }, [id, isEdit]);

  function toggle(qId) {
    setSelected((prev) => (prev.includes(qId) ? prev.filter((id2) => id2 !== qId) : [...prev, qId]));
  }

  // Merges questions discovered while browsing the bank modal (which may fetch questions the
  // page's own `questions` list hasn't loaded, e.g. from a different folder) so totalMarks and
  // the submit payload always resolve every selected id to real data, regardless of where it was
  // found.
  function mergeQuestions(found) {
    setQuestions((prev) => {
      const known = new Set(prev.map((q) => q.id));
      const extra = found.filter((q) => !known.has(q.id));
      return extra.length ? [...prev, ...extra] : prev;
    });
  }

  // Arriving from Question Bank's bulk-select "Add to Test" action pre-seeds `selected` with
  // whatever the admin/staff had checked there — same mechanism the bank picker modal already
  // uses (fetch + mergeQuestions), just triggered on mount instead of from that modal.
  useEffect(() => {
    const ids = location.state?.prefillQuestionIds;
    if (!isEdit && Array.isArray(ids) && ids.length > 0) {
      Promise.all(ids.map((qId) => api.get(`/questions/${qId}`).then((res) => res.data).catch(() => null))).then((results) => {
        const found = results.filter(Boolean);
        mergeQuestions(found);
        setSelected((prev) => [...new Set([...prev, ...found.map((q) => q.id)])]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  const totalMarks = selected.reduce((sum, qId) => {
    const q = questions.find((qq) => qq.id === qId);
    return sum + (q?.points || 0);
  }, 0);

  const isRandomMode = form.questionSelectionMode === "RANDOM";
  const [bankCount, setBankCount] = useState(null);
  useEffect(() => {
    if (!isRandomMode || !form.randomBankFolderId) { setBankCount(null); return; }
    api.get("/questions", { params: { folderId: form.randomBankFolderId, questionType: "CODING", pageSize: 1 } })
      .then((res) => setBankCount(res.data.total))
      .catch(() => setBankCount(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRandomMode, form.randomBankFolderId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isRandomMode && selected.length === 0) return alert("Select at least one question");
    if (isRandomMode) {
      if (!form.randomBankFolderId) return alert("Select a Question Bank for random question selection");
      if (!form.randomQuestionsPerStudent || Number(form.randomQuestionsPerStudent) < 1) return alert("Set how many questions each student should receive");
    }
    setSaving(true);
    try {
      const distributionSum = Number(form.randomEasy || 0) + Number(form.randomMedium || 0) + Number(form.randomHard || 0);
      const payload = {
        ...form,
        durationMin: Number(form.durationMin),
        passingMarks: form.passingMarks === "" ? "" : Number(form.passingMarks),
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
        questionIds: isRandomMode ? undefined : selected,
        academicGroupIds: groupType === "ACADEMIC" ? academicGroupIds : [],
        randomQuestionsPerStudent: isRandomMode ? Number(form.randomQuestionsPerStudent) : undefined,
        difficultyDistribution: isRandomMode && distributionSum > 0
          ? { easy: Number(form.randomEasy || 0), medium: Number(form.randomMedium || 0), hard: Number(form.randomHard || 0) }
          : undefined,
      };
      let testId = id;
      if (isEdit) {
        await api.patch(`/tests/${id}`, payload);
      } else {
        const { data: created } = await api.post("/tests", payload);
        testId = created.id;
      }

      const desiredPoolIds = groupType === "TALENT_POOL" ? talentPoolIds : [];
      const toAssign = desiredPoolIds.filter((pid) => !initialTalentPoolIds.includes(pid));
      const toUnassign = initialTalentPoolIds.filter((pid) => !desiredPoolIds.includes(pid));
      await Promise.all([
        ...toAssign.map((pid) => api.post(`/talent-pools/${pid}/tests`, { testId })),
        ...toUnassign.map((pid) => api.delete(`/talent-pools/${pid}/tests/${testId}`)),
      ]);

      navigate("/staff");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save test");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div><Navbar /><div style={{ maxWidth: 720, margin: "0 auto", padding: 48 }}><SkeletonGrid count={3} minWidth={220} /></div></div>;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <h1>{isEdit ? "Edit test" : "New test"}</h1>
        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} required value={form.title} onChange={updateField("title")} />

          <label style={labelStyle}>Test code (optional)</label>
          <input style={inputStyle} value={form.code} onChange={updateField("code")} placeholder="e.g. MCA-DS-MID1" />

          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={form.description} onChange={updateField("description")} />

          <label style={labelStyle}>Instructions for students (optional)</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.instructions} onChange={updateField("instructions")} />

          <label style={labelStyle}>Company (optional — marks this as a company-specific placement round, e.g. "TCS", "Amazon")</label>
          <input style={inputStyle} value={form.company} onChange={updateField("company")} placeholder="Leave blank for a regular test" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Duration (min)</label>
              <input style={inputStyle} type="number" value={form.durationMin} onChange={updateField("durationMin")} />
            </div>
            <div>
              <label style={labelStyle}>Start time</label>
              <input style={inputStyle} type="datetime-local" required value={form.startTime} onChange={updateField("startTime")} />
            </div>
            <div>
              <label style={labelStyle}>End time</label>
              <input style={inputStyle} type="datetime-local" required value={form.endTime} onChange={updateField("endTime")} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Passing marks (optional)</label>
              <input style={inputStyle} type="number" value={form.passingMarks} onChange={updateField("passingMarks")} placeholder={`Total: ${totalMarks}`} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={form.showResults} onChange={(e) => setForm({ ...form, showResults: e.target.checked })} />
                Show results to students after submission
              </label>
            </div>
          </div>

          <div style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>Proctoring Settings</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            Tab switching is always tracked and disabled for every test, regardless of these settings.
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.requireFullscreen} onChange={(e) => setForm({ ...form, requireFullscreen: e.target.checked })} /> Require full screen
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.requireWebcam} onChange={(e) => setForm({ ...form, requireWebcam: e.target.checked })} /> Enable webcam monitoring (face detection)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.requireMicrophone} onChange={(e) => setForm({ ...form, requireMicrophone: e.target.checked })} /> Enable microphone monitoring
            </label>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.attendanceMandatory} onChange={(e) => setForm({ ...form, attendanceMandatory: e.target.checked })} /> Attendance Mandatory
            </label>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            When checked, this test only appears in the Attendance module's Practice Test/Exam "Select Test" list, and a
            student must be marked Present for the linked lecture before they can start it.
          </p>

          <div style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>Question Order</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            Every student gets the exact same questions — this only controls the order, to reduce the chances of
            students sitting together comparing answers question-by-question. Generated once per student when they
            start the test, and stays fixed for that attempt (refresh, logout/login, and auto-save recovery all keep
            the same order).
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.shuffleQuestions} onChange={(e) => setForm({ ...form, shuffleQuestions: e.target.checked })} /> Shuffle questions for every student
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.shuffleOptions} onChange={(e) => setForm({ ...form, shuffleOptions: e.target.checked })} /> Shuffle answer options (MCQ / Multiple Select)
            </label>
          </div>

          <div style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>Assign to</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            Choose exactly one Group Type. A Talent-Pool-exclusive test is only visible to that pool's members — any
            Academic Group assignment is ignored while Talent Pools is selected.
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="radio" name="groupType" checked={groupType === "ACADEMIC"} onChange={() => setGroupType("ACADEMIC")} />
              Academic Groups
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="radio" name="groupType" checked={groupType === "TALENT_POOL"} onChange={() => setGroupType("TALENT_POOL")} />
              Talent Pools
            </label>
          </div>

          {groupType === "ACADEMIC" ? (
            <>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 10 }}>
                {isPlatformLevel
                  ? "Leave all unchecked to make this test visible to every group, platform-wide (default)."
                  : "Leave all unchecked to make this test visible to every group in your institute (default)."}
              </p>
              <div style={{ marginTop: 8 }}>
                <AcademicGroupPicker multi groups={academicGroups} value={academicGroupIds} onChange={setAcademicGroupIds} />
              </div>
            </>
          ) : (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {talentPools.map((p) => (
                <label key={p.id} className="card" style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={talentPoolIds.includes(p.id)}
                    onChange={() => setTalentPoolIds((ids) => (ids.includes(p.id) ? ids.filter((i) => i !== p.id) : [...ids, p.id]))}
                  />
                  {p.name}
                </label>
              ))}
              {talentPools.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No Talent Pools exist yet — create one from the Talent Pools admin page first.</p>}
            </div>
          )}

          <div style={{ marginTop: 24, fontWeight: 700, fontSize: 14 }}>Question Selection Mode</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            Fixed: every student gets the same questions you pick below (the order can still be shuffled per
            student, see Question Order above). Random: every student gets their own random subset drawn from a
            Question Bank — still the same underlying question pool, just a different combination per student, so
            copying between students becomes far less useful.
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="radio" name="selMode" checked={!isRandomMode} onChange={() => setForm({ ...form, questionSelectionMode: "FIXED" })} />
              Fixed Questions (same for all students)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="radio" name="selMode" checked={isRandomMode} onChange={() => setForm({ ...form, questionSelectionMode: "RANDOM" })} />
              Random Questions from Question Bank
            </label>
          </div>

          {isRandomMode && (
            <div className="card" style={{ padding: 16, marginTop: 12 }}>
              <label style={labelStyle}>Question Bank</label>
              <FolderPicker value={form.randomBankFolderId} onChange={(folderId) => setForm({ ...form, randomBankFolderId: folderId })} />
              {form.randomBankFolderId && (
                <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
                  {bankCount === null ? "Checking bank size…" : `${bankCount} coding question${bankCount === 1 ? "" : "s"} available in this bank`}
                </p>
              )}

              <label style={labelStyle}>Questions per student</label>
              <input
                style={{ ...inputStyle, maxWidth: 160 }}
                type="number"
                min={1}
                value={form.randomQuestionsPerStudent}
                onChange={(e) => setForm({ ...form, randomQuestionsPerStudent: e.target.value })}
              />

              <label style={labelStyle}>Difficulty distribution (optional — leave blank for plain random selection)</label>
              <div style={{ display: "flex", gap: 12 }}>
                <div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Easy</span>
                  <input style={{ ...inputStyle, marginTop: 4 }} type="number" min={0} value={form.randomEasy} onChange={(e) => setForm({ ...form, randomEasy: e.target.value })} />
                </div>
                <div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Medium</span>
                  <input style={{ ...inputStyle, marginTop: 4 }} type="number" min={0} value={form.randomMedium} onChange={(e) => setForm({ ...form, randomMedium: e.target.value })} />
                </div>
                <div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>Hard</span>
                  <input style={{ ...inputStyle, marginTop: 4 }} type="number" min={0} value={form.randomHard} onChange={(e) => setForm({ ...form, randomHard: e.target.value })} />
                </div>
              </div>
              {(Number(form.randomEasy || 0) + Number(form.randomMedium || 0) + Number(form.randomHard || 0)) > 0
                && form.randomQuestionsPerStudent
                && (Number(form.randomEasy || 0) + Number(form.randomMedium || 0) + Number(form.randomHard || 0)) !== Number(form.randomQuestionsPerStudent) && (
                <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 6 }}>
                  Easy + Medium + Hard ({Number(form.randomEasy || 0) + Number(form.randomMedium || 0) + Number(form.randomHard || 0)}) must add up to Questions per
                  student ({form.randomQuestionsPerStudent})
                </p>
              )}
            </div>
          )}

          {!isRandomMode && (
            <>
              <div style={{ marginTop: 24, fontWeight: 700, fontSize: 14 }}>
                Selected questions ({selected.length}) <span className="mono" style={{ fontWeight: 400, color: "var(--ink-dim)" }}>· Total marks: {totalMarks}</span>
              </div>
              {selected.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {selected.map((qId) => {
                    const q = questions.find((qq) => qq.id === qId);
                    return (
                      <span key={qId} className="badge" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {q?.title || q?.description?.slice(0, 30) || "(loading…)"}
                        <button type="button" onClick={() => toggle(qId)} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button type="button" className="btn btn-primary" onClick={() => setShowBankModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Folder size={14} /> Add from Question Bank</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowBulkModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Upload size={14} /> Bulk Upload Questions</button>
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Add as many as you need — coding and quiz questions can be mixed. Candidates get the full test duration to split across all questions however they like, and can move between questions freely.</p>

              <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600 }}>Quick add (recent questions)</div>
              <input
                style={{ ...inputStyle, marginTop: 8 }}
                placeholder="Search questions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div style={{ display: "grid", gap: 8, marginTop: 10, maxHeight: 280, overflowY: "auto" }}>
                {questions.map((q) => (
                  <label key={q.id} className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} />
                    {q.title || "(untitled)"}
                    <span className="badge">{TYPE_LABELS[q.questionType]}</span>
                    <span className={`badge badge-${q.difficulty.toLowerCase()}`}>{q.difficulty}</span>
                    <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-dim)" }}>
                      {q.points} pts{q.questionType === "CODING" && q._count ? ` · ${q._count.testCases} cases` : ""}
                    </span>
                  </label>
                ))}
                {questions.length === 0 && <p style={{ color: "var(--ink-dim)" }}>No questions in the bank yet — create one first.</p>}
              </div>
            </>
          )}

          <button className="btn btn-primary" style={{ marginTop: 24 }} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create test"}
          </button>
        </form>
      </div>

      {showBankModal && (
        <QuestionBankPickerModal
          selected={selected}
          onToggle={toggle}
          onQuestionsSeen={mergeQuestions}
          onClose={() => setShowBankModal(false)}
        />
      )}
      {showBulkModal && (
        <BulkUploadModal
          onImported={(created) => {
            mergeQuestions(created);
            setSelected((prev) => [...prev, ...created.map((c) => c.id)]);
          }}
          onClose={() => setShowBulkModal(false)}
        />
      )}
    </div>
  );
}

// Folder-browser modal for "Add from Question Bank" — selections persist in the page's own
// `selected` state (via onToggle), so switching folders never loses what was already picked, and
// closing/reopening the modal (or navigating between folders repeatedly) keeps the running total.
function QuestionBankPickerModal({ selected, onToggle, onQuestionsSeen, onClose }) {
  const [folders, setFolders] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null); // null = folder list
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/questions/folders").then((res) => setFolders(res.data));
  }, []);

  useEffect(() => {
    if (!activeFolder) return;
    setLoadingItems(true);
    const params = { q: q || undefined, pageSize: 200 };
    if (activeFolder.id === "__none__") params.folderId = "__none__";
    else if (activeFolder.id !== "__all__") params.folderId = activeFolder.id;
    api.get("/questions", { params }).then((res) => {
      setItems(res.data.rows);
      onQuestionsSeen(res.data.rows);
      setLoadingItems(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder, q]);

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 640, maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{activeFolder ? activeFolder.name : "Question Bank Folders"}</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="mono" style={{ fontSize: 12, color: "var(--mint)", fontWeight: 700, marginTop: 6 }}>
          {selected.length} question{selected.length === 1 ? "" : "s"} selected so far
        </div>

        <div style={{ flex: 1, overflowY: "auto", marginTop: 14 }}>
          {!activeFolder ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              <button type="button" className="card" style={{ padding: 14, textAlign: "left", cursor: "pointer" }} onClick={() => setActiveFolder({ id: "__all__", name: "All Questions" })}>
                <ClipboardList size={22} />
                <div style={{ fontWeight: 700, marginTop: 4, fontSize: 13 }}>All Questions</div>
              </button>
              <button type="button" className="card" style={{ padding: 14, textAlign: "left", cursor: "pointer" }} onClick={() => setActiveFolder({ id: "__none__", name: "Uncategorized" })}>
                <FolderOpen size={22} />
                <div style={{ fontWeight: 700, marginTop: 4, fontSize: 13 }}>Uncategorized</div>
              </button>
              {folders === null && <SkeletonGrid count={4} minWidth={160} />}
              {folders?.map((f) => (
                <button type="button" key={f.id} className="card" style={{ padding: 14, textAlign: "left", cursor: "pointer" }} onClick={() => setActiveFolder(f)}>
                  <Folder size={22} />
                  <div style={{ fontWeight: 700, marginTop: 4, fontSize: 13 }}>{f.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>{f._count.questions} question{f._count.questions === 1 ? "" : "s"}</div>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setActiveFolder(null)}>← Back to folders</button>
                <input style={{ ...inputStyle, flex: 1 }} placeholder="Search this folder…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {loadingItems && <SkeletonGrid count={5} minWidth={280} />}
                {!loadingItems && items.map((qq) => (
                  <label key={qq.id} className="card" style={{ padding: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <input type="checkbox" checked={selected.includes(qq.id)} onChange={() => onToggle(qq.id)} />
                    {qq.title || qq.description?.slice(0, 40) || "(untitled)"}
                    <span className="badge">{TYPE_LABELS[qq.questionType]}</span>
                    <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-dim)" }}>{qq.points} pts</span>
                  </label>
                ))}
                {!loadingItems && items.length === 0 && <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>No questions here yet.</p>}
              </div>
            </>
          )}
        </div>

        {activeFolder && (
          <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setActiveFolder(null)}>
            Add Selected Questions — Back to Folders
          </button>
        )}
      </div>
    </div>
  );
}

// Bulk-upload modal — always creates real question rows (they must exist to attach to this
// test), the "save to bank" checkbox only controls whether they're filed into a folder for
// future reuse or left unfiled.
function BulkUploadModal({ onImported, onClose }) {
  const [questionKind, setQuestionKind] = useState("quiz"); // "quiz" | "coding"
  const [file, setFile] = useState(null);
  const [saveToBank, setSaveToBank] = useState(true);
  const [folders, setFolders] = useState(null);
  const [folderId, setFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get("/questions/folders").then((res) => setFolders(res.data));
  }, []);

  async function downloadTemplate() {
    const res = await api.get("/questions/bulk-template", { params: { type: questionKind }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = questionKind === "coding" ? "coding-question-template.xlsx" : "question-bank-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      let targetFolderId = saveToBank ? folderId : "";
      if (saveToBank && !targetFolderId && newFolderName.trim()) {
        const { data: folder } = await api.post("/questions/folders", { name: newFolderName.trim() });
        targetFolderId = folder.id;
      }
      const formData = new FormData();
      formData.append("file", file);
      if (targetFolderId) formData.append("folderId", targetFolderId);
      const endpoint = questionKind === "coding" ? "/questions/bulk-import-coding" : "/questions/bulk-import";
      const { data } = await api.post(endpoint, formData);
      setResult(data);
      if (data.created?.length) onImported(data.created);
    } catch (err) {
      alert(err.response?.data?.error || "Bulk upload failed");
    } finally {
      setImporting(false);
    }
  }

  function downloadErrorReport() {
    const rows = [
      ...(result.errors || []).map((e) => ["Failed", e.row, e.reason]),
      ...(result.skipped || []).map((e) => ["Skipped", e.row, e.reason]),
    ];
    const header = ["Status", "Row", "Reason"];
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bulk-upload-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Bulk Upload Questions</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" name="bulkKind" checked={questionKind === "quiz"} onChange={() => { setQuestionKind("quiz"); setResult(null); }} />
            Quiz (MCQ / True-False / Multi-select)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" name="bulkKind" checked={questionKind === "coding"} onChange={() => { setQuestionKind("coding"); setResult(null); }} />
            Coding
          </label>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
          {questionKind === "coding"
            ? "Coding questions from an .xlsx/.csv file — title, problem statement, difficulty, time/memory limits, sample + hidden test cases, and starter code per language. Each row can name its own Question Bank (created if new), or leave it blank to use the picker below."
            : "Multiple Choice, True/False, and Multiple Select questions from an .xlsx/.csv file."}
          {" "}Uploaded questions are added to this test immediately either way.
        </p>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={downloadTemplate}>⬇ Download template</button>

        <form onSubmit={handleUpload} style={{ marginTop: 14 }}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 14 }}>
            <input type="checkbox" checked={saveToBank} onChange={(e) => setSaveToBank(e.target.checked)} />
            Save uploaded questions to Question Bank
            {questionKind === "coding" && <span style={{ color: "var(--ink-dim)" }}>(fallback for rows with no Question Bank column)</span>}
          </label>

          {saveToBank && (
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <select style={{ ...inputStyle, flex: 1 }} value={folderId} onChange={(e) => { setFolderId(e.target.value); setNewFolderName(""); }}>
                <option value="">Uncategorized (no folder)</option>
                {folders?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="…or new folder name"
                value={newFolderName}
                onChange={(e) => { setNewFolderName(e.target.value); setFolderId(""); }}
              />
            </div>
          )}

          <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={!file || importing}>
            {importing ? "Uploading…" : "Upload"}
          </button>
          <UploadProgressBar active={importing} />
        </form>

        {result && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 700 }}>Upload Completed</p>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              <div>Questions Uploaded: <strong>{result.createdCount}</strong> of {result.total}</div>
              {result.skippedCount > 0 && <div>Skipped: <strong>{result.skippedCount}</strong></div>}
              {result.errorCount > 0 && <div style={{ color: "var(--rust)" }}>Failed: <strong>{result.errorCount}</strong></div>}
            </div>
            {(result.errors?.length > 0 || result.skipped?.length > 0) && (
              <>
                <button type="button" className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={downloadErrorReport}>
                  ⬇ Download import report
                </button>
                <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                  {(result.errors || []).map((e, i) => (
                    <div key={`e${i}`} style={{ fontSize: 11, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
                  ))}
                  {(result.skipped || []).map((e, i) => (
                    <div key={`s${i}`} style={{ fontSize: 11, color: "var(--amber-dark)" }} className="mono">Row {e.row} (skipped): {e.reason}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
