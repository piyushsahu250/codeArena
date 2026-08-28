import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ClipboardList, FolderOpen, Folder, Upload } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import { SkeletonGrid } from "../components/Skeleton";
import FolderPicker from "../components/FolderPicker";
import SubjectUnitPicker from "../components/SubjectUnitPicker";
import AcademicGroupPicker from "../components/AcademicGroupPicker";
import StaffPicker from "../components/StaffPicker";
import BulkQuestionImport from "../components/BulkQuestionImport";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useUnsavedChangesGuard } from "../context/UnsavedChangesContext";

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select" };

const emptyForm = {
  title: "", code: "", description: "", instructions: "", company: "", durationMin: 60, passingMarks: "", showResults: true, startTime: "", endTime: "",
  subject: "", unit: "", program: "",
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
  const confirmDialog = useConfirm();
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
  // Only meaningful for a platform-level creator (see isPlatformLevel above) — lets them scope an
  // otherwise-platform-wide test to one institute directly, without hand-picking every academic
  // group at that institute. Institute-scoped Staff/Admin never see or send this; their tests are
  // always bound to their own institute server-side regardless of this field.
  const [instituteId, setInstituteId] = useState("");
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
  // Subject isolation additions — testOwnerId gates whether the Shared With panel renders at all
  // (only the test's own creator, or an Admin, may manage sharing — see POST/DELETE
  // /tests/:id/shares's own backend check, mirrored here just for UI visibility, never trusted as
  // the real authorization boundary).
  const [testOwnerId, setTestOwnerId] = useState(null);
  const [shares, setShares] = useState([]); // [{ staffId, staff: { id, name } }]
  // Create-mode sharing picks (edit mode keeps its existing shares/syncShares -- see that
  // section's own comment for why: an EXISTING test's sharing already applies live, per pick, via
  // its own dedicated section below, unchanged). This is a separate, deferred-to-Save selection
  // used only while creating a brand-new test, where there's no test id yet to call
  // POST /tests/:id/shares against. Root cause this closes: the "Shared With" section was
  // previously only ever rendered when isEdit is true, so a newly-created test had genuinely no
  // way to be shared with staff in the same flow that created it -- an admin had to separately
  // navigate to Manage Tests, find the just-created test, and open Edit before any sharing UI
  // existed at all. Applied right after creation succeeds, the same way talentPoolIds already is.
  const [shareStaffIds, setShareStaffIds] = useState([]);
  const [subjectId, setSubjectId] = useState(null);
  const [unitId, setUnitId] = useState(null);
  // Optimistic-concurrency guard (spec: "protect against two staff members editing the same test
  // simultaneously") — the version read when this test was loaded; sent back on save so the
  // backend can detect someone else saved in between (see tests.js's PATCH /:id).
  const [version, setVersion] = useState(0);
  const { setGuard } = useUnsavedChangesGuard() || {};

  useEffect(() => {
    api.get("/academic-groups").then((res) => setAcademicGroups(res.data));
    api.get("/talent-pools").then((res) => setTalentPools(res.data)).catch(() => setTalentPools([]));
  }, []);

  // Dirty-state tracking: a full snapshot of every piece of test configuration (not just
  // title/questions) taken once the form is at its "last known saved" state — on mount for a new
  // test (starts empty), or once the edit-mode fetch below finishes populating everything. Any
  // difference from that snapshot means real unsaved work exists, covering the full list this was
  // asked to track (title, instructions, subject/unit, questions added/removed, marks, duration,
  // difficulty distribution, and every other field bundled in here) without hand-maintaining a
  // separate boolean per field.
  const savedSnapshotRef = useRef(null);
  const currentSnapshot = useMemo(
    () => JSON.stringify({ form, selected, subjectId, unitId, academicGroupIds, talentPoolIds, groupType, instituteId, shareStaffIds }),
    [form, selected, subjectId, unitId, academicGroupIds, talentPoolIds, groupType, instituteId, shareStaffIds]
  );
  const isDirty = savedSnapshotRef.current !== null && currentSnapshot !== savedSnapshotRef.current;

  useEffect(() => {
    if (!loading) savedSnapshotRef.current = currentSnapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Two protections, same dirty signal:
  // 1. beforeunload — browser refresh / tab close / typed-URL navigation (native browser dialog,
  //    text isn't customizable by design of the API).
  // 2. UnsavedChangesContext guard — in-app Sidebar navigation (Link clicks), where a real "Stay /
  //    Leave" confirm dialog IS possible — see Sidebar.jsx's handleNavClick and
  //    UnsavedChangesContext.jsx for why this is a Link-click intercept rather than
  //    react-router-dom's useBlocker (this app uses <BrowserRouter>, not a data router — see that
  //    file's comment for the full reasoning). Cleared on unmount so it can never leak into
  //    whatever page staff land on next, regardless of which route got them there.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (saving || !isDirty) return; // an in-flight save shouldn't also trigger "are you sure"
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, saving]);

  useEffect(() => {
    setGuard?.(!saving && isDirty, "Your test contains unsaved information. Do you want to leave this page?");
  }, [isDirty, saving, setGuard]);
  useEffect(() => () => setGuard?.(false), [setGuard]);

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
        subject: t.subject || "", unit: t.unit || "", program: t.program || "",
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
      setVersion(t.version || 0);
      setSubjectId(t.subjectId || null);
      setUnitId(t.unitId || null);
      setInstituteId(t.instituteId || "");
      setTestOwnerId(t.createdById || null);
      setShares(t.shares || []);
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

  // Fires add/remove calls immediately on each picker toggle (not batched into the main form
  // save) — sharing is a standalone action, same as the assign/unassign pattern used elsewhere on
  // this platform (e.g. Readiness subject academic-group assignment). Refetches afterward for the
  // shared staff member's name rather than tracking it locally, since StaffPicker's onChange only
  // returns ids, and this is a low-frequency action where an extra round-trip is a non-issue.
  async function syncShares(nextIds) {
    const currentIds = shares.map((s) => s.staffId);
    const toAdd = nextIds.filter((sid) => !currentIds.includes(sid));
    const toRemove = currentIds.filter((sid) => !nextIds.includes(sid));
    try {
      await Promise.all([
        toAdd.length ? api.post(`/tests/${id}/shares`, { staffIds: toAdd }) : null,
        ...toRemove.map((sid) => api.delete(`/tests/${id}/shares/${sid}`)),
      ]);
      const { data: fresh } = await api.get(`/tests/${id}`);
      setShares(fresh.shares || []);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update sharing");
    }
  }

  const totalMarks = selected.reduce((sum, qId) => {
    const q = questions.find((qq) => qq.id === qId);
    return sum + (q?.points || 0);
  }, 0);

  // "3 groups selected — 145 students affected" (spec section 14) — derived entirely from
  // academicGroups' already-fetched _count.users, no extra request needed.
  const affectedStudentCount = academicGroupIds.reduce((sum, gid) => {
    const g = academicGroups.find((ag) => ag.id === gid);
    return sum + (g?._count?.users || 0);
  }, 0);

  const institutes = [];
  const seenInstituteIds = new Set();
  for (const g of academicGroups) {
    if (g.institute && !seenInstituteIds.has(g.institute.id)) {
      seenInstituteIds.add(g.institute.id);
      institutes.push(g.institute);
    }
  }

  const isRandomMode = form.questionSelectionMode === "RANDOM";
  const [bankCount, setBankCount] = useState(null);
  useEffect(() => {
    if (!isRandomMode || !form.randomBankFolderId) { setBankCount(null); return; }
    api.get("/questions", { params: { folderId: form.randomBankFolderId, questionType: "CODING", pageSize: 1 } })
      .then((res) => setBankCount(res.data.total))
      .catch(() => setBankCount(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRandomMode, form.randomBankFolderId]);

  async function handleSubmit(e, allowDuplicate = false) {
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
        subjectId, unitId,
        academicGroupIds: groupType === "ACADEMIC" ? academicGroupIds : [],
        instituteId: isPlatformLevel ? (instituteId || null) : undefined,
        randomQuestionsPerStudent: isRandomMode ? Number(form.randomQuestionsPerStudent) : undefined,
        difficultyDistribution: isRandomMode && distributionSum > 0
          ? { easy: Number(form.randomEasy || 0), medium: Number(form.randomMedium || 0), hard: Number(form.randomHard || 0) }
          : undefined,
        allowDuplicate: allowDuplicate || undefined,
        version: isEdit ? version : undefined,
      };
      let testId = id;
      if (isEdit) {
        const { data: updated } = await api.patch(`/tests/${id}`, payload);
        setVersion(updated.version);
      } else {
        const { data: created } = await api.post("/tests", payload);
        testId = created.id;
        // Apply whatever staff were picked in the create-mode Shared With section (see
        // shareStaffIds's own declaration comment) -- edit mode already applies its shares live,
        // per pick, so this only ever fires for a brand-new test.
        if (shareStaffIds.length) {
          try {
            await api.post(`/tests/${testId}/shares`, { staffIds: shareStaffIds });
          } catch (shareErr) {
            alert(shareErr.response?.data?.error || "Test created, but sharing it with the selected staff failed — share it from the Edit screen.");
          }
        }
      }

      const desiredPoolIds = groupType === "TALENT_POOL" ? talentPoolIds : [];
      const toAssign = desiredPoolIds.filter((pid) => !initialTalentPoolIds.includes(pid));
      const toUnassign = initialTalentPoolIds.filter((pid) => !desiredPoolIds.includes(pid));
      await Promise.all([
        ...toAssign.map((pid) => api.post(`/talent-pools/${pid}/tests`, { testId })),
        ...toUnassign.map((pid) => api.delete(`/talent-pools/${pid}/tests/${testId}`)),
      ]);

      savedSnapshotRef.current = currentSnapshot; // reset dirty state on a successful save
      setGuard?.(false);
      navigate("/staff");
    } catch (err) {
      // Create-only duplicate warning (never fires on edit, or once already confirmed) — mirrors
      // CreateQuestion.jsx's identical 409 { duplicate, existing } handling for the Question Bank.
      if (isEdit && err.response?.status === 409 && err.response?.data?.conflict) {
        alert("This test was modified by another user (possibly in another tab). Please refresh the page and re-apply your changes before saving.");
        setSaving(false);
        return;
      }
      if (!isEdit && err.response?.status === 409 && err.response?.data?.duplicate) {
        const existing = err.response.data.existing;
        const ok = await confirmDialog({
          title: "Duplicate Test Detected",
          message: `You already have a test named "${existing.title}" for ${existing.subject}${existing.unit ? ` · ${existing.unit}` : ""}. Create this one anyway?`,
          confirmLabel: "Create Anyway",
        });
        setSaving(false);
        if (ok) return handleSubmit(e, true);
        return;
      }
      alert(err.response?.data?.error || "Failed to save test");
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  if (loading) return <div><Navbar /><div style={{ maxWidth: 720, margin: "0 auto", padding: 48 }}><SkeletonGrid count={3} minWidth={220} /></div></div>;

  // Lightweight progress indicator (spec section 1) — deliberately NOT a literal multi-step
  // wizard with separate mounted steps: this page's existing single-scroll form already preserves
  // all state reliably across Subject/Unit/Topic creation, question-bank/bulk-upload modals, etc.
  // (confirmed via the audit before this change), and rebuilding it as discrete steps would risk
  // that continuity for a purely cosmetic navigation improvement. This is a step/completion
  // overlay on top of the same form, not a replacement for it — a click just scrolls to that
  // section; nothing unmounts or resets.
  const steps = [
    { id: "step-basic", label: "Basic Info", done: !!form.title.trim() },
    { id: "step-subject", label: "Subject", done: !!subjectId },
    { id: "step-config", label: "Configuration", done: !!form.durationMin },
    { id: "step-questions", label: "Questions", done: isRandomMode ? !!form.randomBankFolderId : selected.length > 0 },
    { id: "step-assign", label: "Assignment", done: groupType === "TALENT_POOL" ? talentPoolIds.length > 0 : true },
    { id: "step-schedule", label: "Schedule", done: !!form.startTime && !!form.endTime },
    { id: "step-security", label: "Security", done: true },
  ];

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <h1>{isEdit ? "Edit test" : "New test"}</h1>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16, position: "sticky", top: 0, background: "var(--paper)", zIndex: 5, paddingBottom: 8 }}>
          {steps.map((s, i) => (
            <button
              key={s.id} type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 999,
                border: "1px solid var(--line)", background: s.done ? "var(--success-bg)" : "transparent",
                color: s.done ? "var(--mint)" : "var(--ink-dim)", cursor: "pointer",
              }}
            >
              <span className="mono">{s.done ? "✓" : i + 1}</span> {s.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <div id="step-basic" />
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} required value={form.title} onChange={updateField("title")} />

          <label style={labelStyle}>Test code (optional)</label>
          <input style={inputStyle} value={form.code} onChange={updateField("code")} placeholder="e.g. MCA-DS-MID1" />

          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 14 }}>
            Test names are not required to be unique — "Unit 1 Test" for Java and "Unit 1 Test" for DBMS are two
            separate tests, told apart by Subject + Unit + who created them, never by the title alone.
          </p>
          <div id="step-subject" />
          <SubjectUnitPicker
            subjectId={subjectId}
            unitId={unitId}
            showTopic={false}
            onChange={({ subjectId: s, unitId: u, subjectName, unitName }) => {
              setSubjectId(s);
              setUnitId(u);
              // Keep the legacy free-text subject/unit fields in sync — Test's own duplicate-name
              // check (POST /tests) and any pre-migration display still reads these strings.
              setForm((f) => ({ ...f, subject: subjectName || "", unit: unitName || "" }));
            }}
          />
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Program (optional)</label>
            <input style={inputStyle} value={form.program} onChange={updateField("program")} placeholder="e.g. B.Tech CSE" />
          </div>

          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={form.description} onChange={updateField("description")} />

          <label style={labelStyle}>Instructions for students (optional)</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.instructions} onChange={updateField("instructions")} />

          <label style={labelStyle}>Company (optional — marks this as a company-specific placement round, e.g. "TCS", "Amazon")</label>
          <input style={inputStyle} value={form.company} onChange={updateField("company")} placeholder="Leave blank for a regular test" />

          <div id="step-config" />
          <div id="step-schedule" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
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

          <div id="step-security" style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>Proctoring Settings</div>
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

          <div id="step-assign" style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>Assign to</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
            Choose exactly one Group Type. A Talent-Pool-exclusive test is only visible to that pool's members — any
            Academic Group assignment is ignored while Talent Pools is selected.
          </p>

          {isPlatformLevel && (
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Institute</label>
              <select style={inputStyle} value={instituteId} onChange={(e) => setInstituteId(e.target.value)}>
                <option value="">All institutes (platform-wide)</option>
                {institutes.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                Scope this test to one institute without hand-picking every academic group there. Leave as
                "All institutes" only if this test should genuinely be visible platform-wide.
              </p>
            </div>
          )}

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
                  ? (instituteId
                      ? "Leave all unchecked to make this test visible to every group at the selected institute."
                      : "Leave all unchecked to make this test visible to every group, platform-wide (default).")
                  : "Leave all unchecked to make this test visible to every group in your institute (default)."}
              </p>
              <div style={{ marginTop: 8 }}>
                <AcademicGroupPicker multi groups={academicGroups} value={academicGroupIds} onChange={setAcademicGroupIds} />
              </div>
              {academicGroupIds.length > 0 && (
                <p className="mono" style={{ fontSize: 12, color: "var(--mint)", marginTop: 8, fontWeight: 600 }}>
                  {academicGroupIds.length} group{academicGroupIds.length === 1 ? "" : "s"} selected — {affectedStudentCount} student{affectedStudentCount === 1 ? "" : "s"} affected
                </p>
              )}
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

          {/* Matches the backend's actual POST/DELETE /tests/:id/shares authorization (ADMIN,
              SUPER_ADMIN, and INSTITUTE_ADMIN may all manage sharing on any test in their
              institute regardless of who created it -- only STAFF is creator-restricted) --
              previously ADMIN-only here, which incorrectly hid this whole section from a Super
              Admin or Institute Admin managing a test they didn't personally create themselves. */}
          {isEdit && (["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"].includes(user.role) || testOwnerId === user.id) && (
            <>
              <div style={{ marginTop: 24, fontWeight: 700, fontSize: 14 }}>Shared With</div>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                Private by default — only you (and Admins at your institute) can see and manage this test. Add a
                staff member here to also let them view/manage it; unchecking removes their access immediately.
              </p>
              {shares.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {shares.map((s) => (
                    <span key={s.staffId} className="badge" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {s.staff?.name || "Unknown"}
                      <button
                        type="button"
                        onClick={() => syncShares(shares.filter((x) => x.staffId !== s.staffId).map((x) => x.staffId))}
                        style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <StaffPicker value={shares.map((s) => s.staffId)} onChange={syncShares} />
              </div>
            </>
          )}

          {/* Create-mode equivalent -- see shareStaffIds's own declaration comment for the root
              cause this closes. Every role that can reach this form at all (POST /tests's own
              requireRole list) is also allowed to share the test they're about to create, since
              they're unconditionally its creator -- no testOwnerId/role gate needed here the way
              the edit-mode section above needs one. Deferred to the Save button, exactly like
              Talent Pool assignment above, rather than applied immediately (there's no test id to
              apply it against until the test actually exists). */}
          {!isEdit && (
            <>
              <div style={{ marginTop: 24, fontWeight: 700, fontSize: 14 }}>Share With</div>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                Private by default — only you (and Admins at your institute) can see and manage this test once
                created. Optionally check staff members below so they can view/manage it too — applied the moment
                you create the test; you can add or remove more later from its Edit screen.
                {shareStaffIds.length > 0 && ` ${shareStaffIds.length} staff member${shareStaffIds.length === 1 ? "" : "s"} selected.`}
              </p>
              <div style={{ marginTop: 8 }}>
                <StaffPicker value={shareStaffIds} onChange={setShareStaffIds} />
              </div>
            </>
          )}

          <div id="step-questions" style={{ marginTop: 24, fontWeight: 700, fontSize: 14 }}>Question Selection Mode</div>
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
          subjectId={subjectId}
          unitId={unitId}
          subjectLabel={form.subject && form.unit ? `${form.subject} → ${form.unit}` : form.subject || null}
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
function QuestionBankPickerModal({ selected, onToggle, onQuestionsSeen, onClose, subjectId, unitId, subjectLabel }) {
  const [folders, setFolders] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null); // null = folder list
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [q, setQ] = useState("");
  // Defaults to filtering by the test's own Subject/Unit when both are set — spec section 11:
  // "It must NOT show DBMS -> Unit 1 questions when Java -> Unit 1 is selected." A staff member
  // can still opt out (e.g. reusing a question written under a different Subject) via the toggle.
  const [filterToSubject, setFilterToSubject] = useState(!!(subjectId && unitId));

  useEffect(() => {
    api.get("/questions/folders").then((res) => setFolders(res.data));
  }, []);

  useEffect(() => {
    if (!activeFolder) return;
    setLoadingItems(true);
    const params = { q: q || undefined, pageSize: 200 };
    if (activeFolder.id === "__none__") params.folderId = "__none__";
    else if (activeFolder.id !== "__all__") params.folderId = activeFolder.id;
    if (filterToSubject && subjectId && unitId) {
      params.subjectId = subjectId;
      params.unitId = unitId;
    }
    api.get("/questions", { params }).then((res) => {
      setItems(res.data.rows);
      onQuestionsSeen(res.data.rows);
      setLoadingItems(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder, q, filterToSubject]);

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
              {subjectId && unitId && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8, color: "var(--ink-dim)" }}>
                  <input type="checkbox" checked={filterToSubject} onChange={(e) => setFilterToSubject(e.target.checked)} />
                  Only show questions from this test's Subject/Unit{subjectLabel ? ` (${subjectLabel})` : ""}
                </label>
              )}
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
// test); the folder picker inside BulkQuestionImport only controls whether they're also filed
// for future reuse or left unfiled.
function BulkUploadModal({ onImported, onClose }) {
  const [folders, setFolders] = useState(null);

  useEffect(() => {
    api.get("/questions/folders").then((res) => setFolders(res.data));
  }, []);

  async function createFolder(name) {
    const { data: folder } = await api.post("/questions/folders", { name });
    setFolders((prev) => [...(prev || []), folder]);
    return folder.id;
  }

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div className="ca-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Bulk Upload Questions</h3>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>Uploaded questions are added to this test immediately once confirmed.</p>
        <BulkQuestionImport allowCoding folders={folders || []} onCreateFolder={createFolder} onImported={onImported} />
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
