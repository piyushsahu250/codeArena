import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import ProblemStatementFields from "../components/ProblemStatementFields";
import TestCasesEditor from "../components/TestCasesEditor";
import QuestionPreviewToggle from "../components/QuestionPreviewToggle";
import EvaluationTypeFields, { EMPTY_SIGNATURE } from "../components/EvaluationTypeFields";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 6 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginTop: 10, display: "block" };

// Content management for the Learning Module: drill down Course -> Module -> Lesson -> Practice
// Questions, all in one page since each level is a thin CRUD list. Admin gets full read/write;
// Staff gets the exact same navigable tree read-only (every panel below gates its own
// create/edit/delete/publish/reorder/import controls on isAdmin) with one exception — Reset
// Attempts inside CodingAttemptsPanel stays enabled for Staff, own institute only. This is one
// shared tree rather than a separate Staff screen so there's no duplicate browsing workflow to
// maintain; the backend enforces the same split (every mutating route is ADMIN-only, every GET
// route in this module is ADMIN+STAFF, except the reset route which is ADMIN+STAFF by design).
export default function LearningManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [moduleId, setModuleId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [codingTestModuleId, setCodingTestModuleId] = useState(null);
  const [chaptersModuleId, setChaptersModuleId] = useState(null); // which module's Chapter list to show
  const [chapter, setChapter] = useState(null); // selected chapter { id, moduleId, title, ... } for detail view

  const [courseDetail, setCourseDetail] = useState(null); // { course, modules: [{...lessons}] }

  function loadCourses() {
    api.get("/learning/courses").then((res) => setCourses(res.data));
  }
  useEffect(loadCourses, []);

  function loadCourseDetail(slug) {
    api.get(`/learning/courses/${slug}`).then((res) => setCourseDetail(res.data));
  }
  useEffect(() => {
    if (!courseId) return setCourseDetail(null);
    const c = courses.find((c) => c.id === courseId);
    if (c) loadCourseDetail(c.slug);
  }, [courseId, courses]);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const selectedModule = courseDetail?.modules.find((m) => m.id === moduleId);
  const selectedLesson = selectedModule?.lessons.find((l) => l.id === lessonId);

  function refresh() {
    if (selectedCourse) loadCourseDetail(selectedCourse.slug);
    loadCourses();
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1>Learning Management</h1>
            {!isAdmin && (
              <span className="badge" style={{ background: "#F0EEE3", color: "var(--ink-dim)", fontSize: 12 }}>Read-Only Access</span>
            )}
          </div>
          {/* Every course/module/chapter/lesson create/edit/delete is already recorded in the
              platform's Audit Log (action: COURSE_MANAGEMENT_CHANGED) — this just makes that
              existing "who changed what, when" record discoverable from inside the CMS itself
              instead of only from the separate Audit Log page. */}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => navigate(isAdmin ? "/admin/audit-log" : "/staff/audit-log")}>
            View Change History →
          </button>
        </div>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          {isAdmin
            ? "Manage courses, modules, lessons, and practice questions for the Learning module."
            : "Browse courses, modules, lessons, and coding assessments. You can search and view everything here — editing is Admin-only, except resetting a student's coding assessment attempts."}
        </p>

        <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 20 }}>
          <span style={{ cursor: "pointer", textDecoration: courseId ? "underline" : "none" }} onClick={() => { setCourseId(null); setModuleId(null); setLessonId(null); setCodingTestModuleId(null); setChaptersModuleId(null); setChapter(null); }}>Courses</span>
          {selectedCourse && <> / <span style={{ cursor: "pointer", textDecoration: (moduleId || codingTestModuleId || chaptersModuleId) ? "underline" : "none" }} onClick={() => { setModuleId(null); setLessonId(null); setCodingTestModuleId(null); setChaptersModuleId(null); setChapter(null); }}>{selectedCourse.name}</span></>}
          {selectedModule && !codingTestModuleId && <> / <span style={{ cursor: "pointer", textDecoration: lessonId ? "underline" : "none" }} onClick={() => setLessonId(null)}>{selectedModule.title}</span></>}
          {selectedLesson && <> / {selectedLesson.title}</>}
          {codingTestModuleId && <> / {courseDetail?.modules.find((m) => m.id === codingTestModuleId)?.title} / Coding Assessment</>}
          {chaptersModuleId && <> / <span style={{ cursor: "pointer", textDecoration: chapter ? "underline" : "none" }} onClick={() => setChapter(null)}>{courseDetail?.modules.find((m) => m.id === chaptersModuleId)?.title} / Chapters</span></>}
          {chapter && <> / {chapter.title}</>}
        </div>

        {!courseId && <CoursePanel courses={courses} onSelect={setCourseId} onRefresh={loadCourses} />}
        {courseId && !moduleId && !codingTestModuleId && !chaptersModuleId && courseDetail && (
          <ModulePanel course={selectedCourse} modules={courseDetail.modules} onSelect={setModuleId} onManageCoding={setCodingTestModuleId} onManageChapters={setChaptersModuleId} onRefresh={refresh} />
        )}
        {moduleId && !lessonId && selectedModule && (
          <LessonPanel mod={selectedModule} onSelect={setLessonId} onRefresh={refresh} />
        )}
        {lessonId && selectedLesson && (
          <LessonDetailPanel lessonId={lessonId} lessonSummary={selectedLesson} onRefresh={refresh} />
        )}
        {codingTestModuleId && (
          <CodingTestPanel moduleId={codingTestModuleId} />
        )}
        {chaptersModuleId && !chapter && (
          <ChapterListPanel moduleId={chaptersModuleId} onSelect={setChapter} />
        )}
        {chapter && (
          <ChapterDetailPanel chapter={chapter} onBack={() => setChapter(null)} />
        )}
      </div>
    </div>
  );
}

const COURSE_STATUS_OPTIONS = ["DRAFT", "UNDER_REVIEW", "PUBLISHED", "ARCHIVED", "INACTIVE"];
const COURSE_STATUS_LABELS = { DRAFT: "Draft", UNDER_REVIEW: "Under Review", PUBLISHED: "Published", ARCHIVED: "Archived", INACTIVE: "Inactive" };
const COURSE_STATUS_COLORS = {
  DRAFT: { bg: "#F0EEE3", color: "var(--ink-dim)" },
  UNDER_REVIEW: { bg: "#FCEFD9", color: "var(--amber-dark)" },
  PUBLISHED: { bg: "#E7F3EB", color: "var(--mint)" },
  ARCHIVED: { bg: "#F7E4E0", color: "var(--rust)" },
  INACTIVE: { bg: "#F0EEE3", color: "var(--ink-dim)" },
};
const DIFFICULTY_OPTIONS = ["EASY", "MEDIUM", "HARD"];
const EMPTY_COURSE_FORM = {
  slug: "", name: "", description: "", status: "DRAFT", category: "", thumbnailUrl: "", bannerUrl: "",
  instructorName: "", skillsCovered: "", estimatedDurationMin: "", difficulty: "", prerequisiteCourseIds: [],
};

// This whole Admin content-management tree (courses/modules/chapters/lessons/coding assessments)
// is only ever rendered for ADMIN — see LearningManagement()'s role branch at the top of this
// file. The isAdmin check below is redundant defense-in-depth, not a Staff-visibility gate.
function CoursePanel({ courses, onSelect, onRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const confirmDialog = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_COURSE_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  function startEdit(c) {
    setEditingId(c.id);
    setForm({
      slug: c.slug, name: c.name, description: c.description || "", status: c.status || "DRAFT",
      category: c.category || "", thumbnailUrl: c.thumbnailUrl || "", bannerUrl: c.bannerUrl || "",
      instructorName: c.instructorName || "", skillsCovered: Array.isArray(c.skillsCovered) ? c.skillsCovered.join(", ") : "",
      estimatedDurationMin: c.estimatedDurationMin ?? "", difficulty: c.difficulty || "",
      prerequisiteCourseIds: (c.prerequisites || []).map((p) => p.prerequisiteCourseId),
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_COURSE_FORM);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        skillsCovered: form.skillsCovered ? form.skillsCovered.split(",").map((s) => s.trim()).filter(Boolean) : null,
        estimatedDurationMin: form.estimatedDurationMin === "" ? null : Number(form.estimatedDurationMin),
        difficulty: form.difficulty || null,
      };
      if (editingId) {
        await api.patch(`/learning/courses/${editingId}`, payload);
        toast.success("Course saved.");
      } else {
        await api.post("/learning/courses", payload);
        toast.success("Course created successfully.");
      }
      cancelEdit();
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || (editingId ? "Failed to save course" : "Failed to create course"));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(c, status) {
    try {
      await api.patch(`/learning/courses/${c.id}`, { status });
      toast.success(`Course marked ${COURSE_STATUS_LABELS[status]}.`);
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update course status");
    }
  }

  async function remove(c) {
    const ok = await confirmDialog({
      title: "Delete course?",
      message: "This permanently deletes the course and all student progress/certificates under it. To retire a live course without losing data, use Archive (status) instead.\n\nAre you sure you want to permanently delete this course? This action cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/learning/courses/${c.id}`);
      toast.success("Course deleted successfully.");
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete course");
    }
  }

  const categories = [...new Set(courses.map((c) => c.category).filter(Boolean))];
  const filtered = courses.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.slug.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (categoryFilter && c.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: isAdmin ? "1fr 1.5fr" : "1fr", gap: 24, marginTop: 20, alignItems: "start" }}>
      {isAdmin && (
        <form onSubmit={save} className="card" style={{ padding: 20, maxHeight: "80vh", overflowY: "auto" }}>
          <h3 style={{ fontSize: 15 }}>{editingId ? "Edit course" : "Add course"}</h3>
          <label style={labelStyle}>Slug (URL id, e.g. "python")</label>
          <input style={inputStyle} required disabled={!!editingId} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {COURSE_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{COURSE_STATUS_LABELS[s]}</option>)}
          </select>
          <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>Only Published courses can be assigned to institutes or academic groups.</p>

          <label style={labelStyle}>Category</label>
          <input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Programming, Aptitude" />

          <label style={labelStyle}>Thumbnail URL (external image, optional)</label>
          <input style={inputStyle} value={form.thumbnailUrl} onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })} />
          <label style={labelStyle}>Banner URL (external image, optional)</label>
          <input style={inputStyle} value={form.bannerUrl} onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })} />

          <label style={labelStyle}>Instructor name</label>
          <input style={inputStyle} value={form.instructorName} onChange={(e) => setForm({ ...form, instructorName: e.target.value })} />
          <label style={labelStyle}>Skills covered (comma-separated)</label>
          <input style={inputStyle} value={form.skillsCovered} onChange={(e) => setForm({ ...form, skillsCovered: e.target.value })} placeholder="OOP, Collections, Multithreading" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Est. duration (min)</label>
              <input style={inputStyle} type="number" min="0" value={form.estimatedDurationMin} onChange={(e) => setForm({ ...form, estimatedDurationMin: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Difficulty</label>
              <select style={inputStyle} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                <option value="">—</option>
                {DIFFICULTY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <label style={labelStyle}>Prerequisites (must be completed first)</label>
          <div style={{ display: "grid", gap: 4, maxHeight: 120, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 8, marginTop: 6 }}>
            {courses.filter((c) => c.id !== editingId).map((c) => (
              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={form.prerequisiteCourseIds.includes(c.id)}
                  onChange={(e) => setForm({
                    ...form,
                    prerequisiteCourseIds: e.target.checked
                      ? [...form.prerequisiteCourseIds, c.id]
                      : form.prerequisiteCourseIds.filter((id) => id !== c.id),
                  })}
                />
                {c.name}
              </label>
            ))}
            {courses.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>No other courses yet.</span>}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create course"}</button>
            {editingId && <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>}
          </div>
        </form>
      )}

      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input style={{ ...inputStyle, marginTop: 0, flex: "2 1 180px" }} placeholder="Search by name or slug…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select style={{ ...inputStyle, marginTop: 0, flex: "1 1 130px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {COURSE_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{COURSE_STATUS_LABELS[s]}</option>)}
          </select>
          {categories.length > 0 && (
            <select style={{ ...inputStyle, marginTop: 0, flex: "1 1 130px" }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((c) => {
            const statusColor = COURSE_STATUS_COLORS[c.status] || COURSE_STATUS_COLORS.DRAFT;
            return (
              <div key={c.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div style={{ cursor: "pointer" }} onClick={() => onSelect(c.id)}>
                  <div style={{ fontWeight: 600 }}>{c.name} <span className="mono" style={{ fontWeight: 400, fontSize: 12, color: "var(--ink-dim)" }}>/{c.slug}</span></div>
                  <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{c.description}</div>
                  {c.category && <span className="badge" style={{ marginTop: 4, display: "inline-block", background: "#EAF1FB", color: "var(--ink)" }}>{c.category}</span>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {isAdmin ? (
                    <select
                      style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)", background: statusColor.bg, color: statusColor.color, fontWeight: 600 }}
                      value={c.status || "DRAFT"}
                      onChange={(e) => changeStatus(c, e.target.value)}
                    >
                      {COURSE_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{COURSE_STATUS_LABELS[s]}</option>)}
                    </select>
                  ) : (
                    <span className="badge" style={{ background: statusColor.bg, color: statusColor.color }}>{COURSE_STATUS_LABELS[c.status] || "Draft"}</span>
                  )}
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(c.id)}>Manage →</button>
                  {isAdmin && (
                    <button
                      className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}
                      disabled={c.status !== "PUBLISHED"}
                      title={c.status !== "PUBLISHED" ? "Only Published courses can be assigned" : undefined}
                      onClick={() => navigate(`/admin/course-assignments?courseId=${c.id}`)}
                    >
                      Assign →
                    </button>
                  )}
                  {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => startEdit(c)}>Edit</button>}
                  {isAdmin && (
                    <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(c)}>Delete</button>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No courses match this filter.</p>}
        </div>
      </div>
    </div>
  );
}

// This panel (like the rest of the Admin content-management tree) only ever renders for ADMIN —
// see LearningManagement()'s role branch. Module create/edit/delete is gated by isAdmin below
// purely as defense-in-depth, matching the ADMIN-only backend routes.
function ModulePanel({ course, modules, onSelect, onManageCoding, onManageChapters, onRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState({ title: "", description: "", order: modules.length });
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/learning/courses/${course.id}/modules`, form);
      setForm({ title: "", description: "", order: modules.length + 1 });
      toast.success("Module created successfully.");
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create module");
    } finally {
      setSaving(false);
    }
  }

  async function remove(m) {
    const ok = await confirmDialog({
      title: "Delete module?",
      message: `Are you sure you want to permanently delete "${m.title}" and all its lessons? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/learning/modules/${m.id}`);
      toast.success("Module deleted successfully.");
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete module");
    }
  }

  async function reorder(m, delta) {
    try {
      await api.patch(`/learning/modules/${m.id}`, { order: m.order + delta });
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reorder module");
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      {isAdmin && (
        <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 200px" }}>
            <label style={labelStyle}>New module title</label>
            <input style={inputStyle} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div style={{ flex: "3 1 260px" }}>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add module"}</button>
        </form>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {modules.sort((a, b) => a.order - b.order).map((m, i) => (
          <div key={m.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => onSelect(m.id)}>
              <div style={{ fontWeight: 600 }}>Module {i + 1}: {m.title}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>{m.totalCount} lesson{m.totalCount === 1 ? "" : "s"}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(m, -1)}>↑</button>}
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(m, 1)}>↓</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(m.id)}>{isAdmin ? "Manage →" : "View →"}</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onManageChapters(m.id)}>Chapters</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onManageCoding(m.id)}>Coding Assessment</button>
              {isAdmin && <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(m)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LessonPanel({ mod, onSelect, onRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [form, setForm] = useState({ title: "", estimatedMinutes: 10, order: mod.lessons.length });
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/learning/modules/${mod.id}/lessons`, form);
      setForm({ title: "", estimatedMinutes: 10, order: mod.lessons.length + 1 });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create lesson");
    } finally {
      setSaving(false);
    }
  }

  async function remove(l) {
    if (!confirm(`Delete lesson "${l.title}"?`)) return;
    await api.delete(`/learning/lessons/${l.id}`);
    onRefresh();
  }

  async function reorder(l, delta) {
    await api.patch(`/learning/lessons/${l.id}`, { order: l.order + delta });
    onRefresh();
  }

  return (
    <div style={{ marginTop: 20 }}>
      {isAdmin && (
        <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 200px" }}>
            <label style={labelStyle}>New lesson title</label>
            <input style={inputStyle} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <label style={labelStyle}>Est. minutes</label>
            <input style={inputStyle} type="number" min="1" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add lesson"}</button>
        </form>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {mod.lessons.sort((a, b) => a.order - b.order).map((l) => (
          <div key={l.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => onSelect(l.id)}>{l.title}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(l, -1)}>↑</button>}
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(l, 1)}>↓</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(l.id)}>{isAdmin ? "Edit →" : "View →"}</button>
              {isAdmin && <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(l)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Fetches its own full lesson detail (content, video/pdf links, un-sanitized practice
// questions) since the course-tree summary the parent holds only has title/order/estimate —
// the CMS needs the real content to edit, which /learning/courses/:slug intentionally omits.
function LessonDetailPanel({ lessonId, lessonSummary, onRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [full, setFull] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get(`/learning/lessons/${lessonId}`).then((res) => {
      setFull(res.data);
      const l = res.data.lesson;
      setForm({ title: l.title, content: l.content || "", videoUrl: l.videoUrl || "", pdfUrl: l.pdfUrl || "", estimatedMinutes: l.estimatedMinutes, isModuleTest: l.isModuleTest });
    });
  }
  useEffect(load, [lessonId]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/learning/lessons/${lessonId}`, form);
      load();
      onRefresh();
      alert("Lesson saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save lesson");
    } finally {
      setSaving(false);
    }
  }

  if (!full || !form) return <p className="mono" style={{ marginTop: 20 }}>Loading…</p>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginTop: 20, alignItems: "start" }}>
      <form onSubmit={save} className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ fontSize: 15 }}>{isAdmin ? "Edit lesson" : "Lesson"}</h3>
          {!isAdmin && <span className="badge" style={{ background: "#F0EEE3", color: "var(--ink-dim)", fontSize: 11 }}>Read-Only</span>}
        </div>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} disabled={!isAdmin} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <label style={labelStyle}>Content (HTML — headings, &lt;p&gt;, &lt;pre&gt;&lt;code&gt;, &lt;ul&gt;)</label>
        <textarea style={{ ...inputStyle, minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 12 }} disabled={!isAdmin} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        <label style={labelStyle}>Video URL (optional)</label>
        <input style={inputStyle} disabled={!isAdmin} value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} />
        <label style={labelStyle}>PDF URL (optional)</label>
        <input style={inputStyle} disabled={!isAdmin} value={form.pdfUrl} onChange={(e) => setForm({ ...form, pdfUrl: e.target.value })} />
        <label style={labelStyle}>Estimated minutes</label>
        <input style={inputStyle} type="number" min="1" disabled={!isAdmin} value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
          <input type="checkbox" disabled={!isAdmin} checked={!!form.isModuleTest} onChange={(e) => setForm({ ...form, isModuleTest: e.target.checked })} />
          This is the module's gating practice test (batch-submitted, must pass to unlock the next module)
        </label>
        {isAdmin && <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Saving…" : "Save lesson"}</button>}
      </form>

      <PracticeQuestionsPanel lesson={{ id: lessonId, questions: full.questions }} onRefresh={load} />
    </div>
  );
}

const EMPTY_Q = {
  type: "MCQ", prompt: "", options: ["", "", "", ""], correctAnswer: 0, explanation: "", starterCode: "",
  testCases: [{ input: "", expected: "", isHidden: false, explanation: "" }], language: "java",
  title: "", tags: "", estimatedTimeMin: null, realWorldScenario: "", constraints: "",
  inputFormat: "", outputFormat: "", notes: "", edgeCases: "", problemExplanation: "", evaluationType: "STDIO",
};

function PracticeQuestionsPanel({ lesson, onRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_Q);
  const [signature, setSignature] = useState(EMPTY_SIGNATURE);
  const [saving, setSaving] = useState(false);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, order: lesson.questions?.length || 0 };
      payload.tags = form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
      if (form.type === "CODING" && form.evaluationType === "FUNCTION") payload.functionSignature = signature;
      if (form.type !== "CODING") {
        payload.starterCode = undefined; payload.testCases = undefined; payload.language = undefined;
        payload.title = undefined; payload.tags = undefined;
        payload.estimatedTimeMin = undefined; payload.realWorldScenario = undefined; payload.constraints = undefined;
        payload.inputFormat = undefined; payload.outputFormat = undefined; payload.notes = undefined;
        payload.edgeCases = undefined; payload.problemExplanation = undefined;
        payload.evaluationType = undefined; payload.functionSignature = undefined;
        payload.hints = undefined; payload.timeComplexity = undefined; payload.spaceComplexity = undefined;
        payload.editorial = undefined; payload.similarQuestions = undefined;
      }
      if (form.type !== "MCQ" && form.type !== "DEBUG" && form.type !== "OUTPUT_PREDICTION") payload.options = undefined;
      if (form.type === "FILL_BLANK") payload.correctAnswer = form.correctAnswer;
      await api.post(`/learning/lessons/${lesson.id}/questions`, payload);
      setForm(EMPTY_Q);
      setSignature(EMPTY_SIGNATURE);
      setAdding(false);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add question");
    } finally {
      setSaving(false);
    }
  }

  async function remove(q) {
    if (!confirm("Delete this practice question?")) return;
    await api.delete(`/learning/practice/${q.id}`);
    onRefresh();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 15 }}>Practice questions</h3>
        {isAdmin && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add"}</button>
        )}
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {(lesson.questions || []).map((q) => (
          <div key={q.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <div>
              <span className="badge">{q.type}</span>
              {q.title && <span style={{ marginLeft: 8, fontWeight: 600 }}>{q.title}</span>}
              {q.type === "CODING" && Array.isArray(q.testCases) && (
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 8 }}>
                  {q.testCases.length} test case(s) — {q.testCases.filter((tc) => tc.isHidden).length} hidden
                </span>
              )}
              <div style={{ marginTop: 4 }}>{q.prompt}</div>
            </div>
            {isAdmin && (
              <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => remove(q)}>Delete</button>
            )}
          </div>
        ))}
        {(!lesson.questions || lesson.questions.length === 0) && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No practice questions yet.</p>}
      </div>

      {isAdmin && adding && (
        <form onSubmit={create} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="MCQ">Multiple Choice</option>
            <option value="DEBUG">Debugging (multiple choice)</option>
            <option value="OUTPUT_PREDICTION">Output Prediction (multiple choice)</option>
            <option value="FILL_BLANK">Fill in the Blank</option>
            <option value="CODING">Coding</option>
          </select>

          <label style={labelStyle}>Prompt</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} required value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />

          {(form.type === "MCQ" || form.type === "DEBUG" || form.type === "OUTPUT_PREDICTION") && (
            <>
              <label style={labelStyle}>Options (select the correct one)</label>
              {form.options.map((opt, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input type="radio" checked={form.correctAnswer === i} onChange={() => setForm({ ...form, correctAnswer: i })} />
                  <input
                    style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                    value={opt}
                    onChange={(e) => { const opts = [...form.options]; opts[i] = e.target.value; setForm({ ...form, options: opts }); }}
                  />
                </div>
              ))}
            </>
          )}

          {form.type === "FILL_BLANK" && (
            <>
              <label style={labelStyle}>Correct answer</label>
              <input style={inputStyle} value={form.correctAnswer} onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })} />
            </>
          )}

          {form.type === "CODING" && (
            <>
              <label style={labelStyle}>Title (optional)</label>
              <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <label style={labelStyle}>Tags (comma-separated, optional)</label>
              <input style={inputStyle} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Arrays, Loops" />

              <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

              <label style={labelStyle}>Default language</label>
              <select style={inputStyle} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="java">Java</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
              </select>

              <EvaluationTypeFields
                evaluationType={form.evaluationType}
                onEvaluationTypeChange={(v) => setForm({ ...form, evaluationType: v })}
                signature={signature}
                onSignatureChange={setSignature}
                starterCode={form.starterCode}
                onStarterCodeChange={(v) => setForm({ ...form, starterCode: v })}
              />

              <TestCasesEditor testCases={form.testCases} onChange={(tc) => setForm({ ...form, testCases: tc })} minVisible={2} minHidden={10} />

              <div style={{ marginTop: 10 }}>
                <QuestionPreviewToggle
                  question={{
                    ...form,
                    tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                    functionSignature: form.evaluationType === "FUNCTION" ? signature : null,
                    testCases: form.testCases.filter((tc) => !tc.isHidden),
                  }}
                />
              </div>
            </>
          )}

          <label style={labelStyle}>Explanation (shown after answering)</label>
          <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Adding…" : "Add question"}</button>
        </form>
      )}
    </div>
  );
}

// --- Mandatory Proctored Coding Test admin panel, reached from ModulePanel's "Coding
// Assessment" button. Not configured for most modules (only Module 1 & 2 are seeded) — creating
// one here is what turns on the gate; deleting it turns it back off, ungating the module.
const EMPTY_TEST_FORM = {
  title: "Module Coding Assessment", instructions: "",
  questionCount: 3, randomizeQuestions: true, passingPercent: 70, timeLimitMin: 45,
  maxAttempts: 3, cooldownMinutes: 0, maxViolations: 3,
  requireFullscreen: true, requireWebcam: false, requireMicrophone: false, allowResume: true,
  allowedLanguages: ["java", "python", "javascript", "c", "cpp"],
};

// Staff gets read-only access to the whole panel (Settings tab included, fields disabled) except
// there's nothing to create if no assessment exists yet — only Admin sees the create form. Create/
// edit/delete stay ADMIN-only, matching the backend RBAC restriction.
function CodingTestPanel({ moduleId }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [test, setTest] = useState(undefined); // undefined = loading, null = not configured yet
  const [form, setForm] = useState(EMPTY_TEST_FORM);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("config");

  function load() {
    api.get(`/module-coding/admin/module/${moduleId}`).then((res) => {
      setTest(res.data);
      if (res.data) {
        setForm({
          title: res.data.title, instructions: res.data.instructions || "",
          questionCount: res.data.questionCount, randomizeQuestions: res.data.randomizeQuestions,
          passingPercent: res.data.passingPercent, timeLimitMin: res.data.timeLimitMin,
          maxAttempts: res.data.maxAttempts ?? "", cooldownMinutes: res.data.cooldownMinutes,
          maxViolations: res.data.maxViolations, requireFullscreen: res.data.requireFullscreen,
          requireWebcam: res.data.requireWebcam, requireMicrophone: res.data.requireMicrophone, allowResume: res.data.allowResume,
          allowedLanguages: res.data.allowedLanguages, isActive: res.data.isActive,
        });
      }
    });
  }
  useEffect(load, [moduleId]);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/module-coding/admin/module/${moduleId}`, form);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create coding assessment");
    } finally {
      setSaving(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/module-coding/admin/tests/${test.id}`, form);
      load();
      alert("Saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this coding assessment and ALL student attempt history for it? This un-gates the module and cannot be undone.")) return;
    await api.delete(`/module-coding/admin/tests/${test.id}`);
    setTest(null);
  }

  function toggleLanguage(lang) {
    setForm((f) => ({
      ...f,
      allowedLanguages: f.allowedLanguages.includes(lang) ? f.allowedLanguages.filter((l) => l !== lang) : [...f.allowedLanguages, lang],
    }));
  }

  if (test === undefined) return <p className="mono" style={{ marginTop: 20 }}>Loading…</p>;

  if (test === null) {
    if (!isAdmin) return <p className="mono" style={{ marginTop: 20 }}>Not configured yet.</p>;
    return (
      <form onSubmit={create} className="card" style={{ padding: 20, marginTop: 20, maxWidth: 560 }}>
        <h3 style={{ fontSize: 15 }}>Configure a proctored coding assessment</h3>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 6 }}>
          Not configured yet — this module currently unlocks the next one on lesson completion alone. Creating an
          assessment here makes it mandatory: the next module stays locked until a student passes it.
        </p>
        <ConfigFields form={form} setForm={setForm} toggleLanguage={toggleLanguage} />
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Creating…" : "Create coding assessment"}</button>
      </form>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className={tab === "config" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("config")}>Settings</button>
        <button className={tab === "questions" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("questions")}>Questions ({test.questions.length})</button>
        <button className={tab === "attempts" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("attempts")}>Student Attempts</button>
        {!isAdmin && (
          <span className="badge" style={{ background: "#F0EEE3", color: "var(--ink-dim)", fontSize: 11 }}>Read-Only Access</span>
        )}
      </div>

      {tab === "config" && (
        <form onSubmit={save} className="card" style={{ padding: 20, marginTop: 16, maxWidth: 560 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" disabled={!isAdmin} checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active (required to unlock the next module)
          </label>
          <ConfigFields form={form} setForm={setForm} toggleLanguage={toggleLanguage} readOnly={!isAdmin} />
          {isAdmin && (
            <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
              <button type="button" style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={remove}>Delete assessment</button>
            </div>
          )}
        </form>
      )}

      {tab === "questions" && <CodingQuestionsPanel testId={test.id} questions={test.questions} onRefresh={load} />}
      {tab === "attempts" && <CodingAttemptsPanel testId={test.id} testTitle={test.title} maxAttempts={test.maxAttempts} />}
    </div>
  );
}

function ConfigFields({ form, setForm, toggleLanguage, readOnly }) {
  return (
    <>
      <label style={labelStyle}>Title</label>
      <input style={inputStyle} disabled={readOnly} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <label style={labelStyle}>Instructions</label>
      <textarea style={{ ...inputStyle, minHeight: 50 }} disabled={readOnly} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
        <div><label style={labelStyle}>Questions per attempt</label><input style={inputStyle} type="number" min="1" disabled={readOnly} value={form.questionCount} onChange={(e) => setForm({ ...form, questionCount: e.target.value })} /></div>
        <div><label style={labelStyle}>Time limit (min)</label><input style={inputStyle} type="number" min="1" disabled={readOnly} value={form.timeLimitMin} onChange={(e) => setForm({ ...form, timeLimitMin: e.target.value })} /></div>
        <div><label style={labelStyle}>Passing %</label><input style={inputStyle} type="number" min="0" max="100" disabled={readOnly} value={form.passingPercent} onChange={(e) => setForm({ ...form, passingPercent: e.target.value })} /></div>
        <div><label style={labelStyle}>Max attempts (blank = unlimited)</label><input style={inputStyle} type="number" min="1" disabled={readOnly} value={form.maxAttempts} onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })} /></div>
        <div><label style={labelStyle}>Cooldown between attempts (min)</label><input style={inputStyle} type="number" min="0" disabled={readOnly} value={form.cooldownMinutes} onChange={(e) => setForm({ ...form, cooldownMinutes: e.target.value })} /></div>
        <div><label style={labelStyle}>Max violations before auto-submit</label><input style={inputStyle} type="number" min="1" disabled={readOnly} value={form.maxViolations} onChange={(e) => setForm({ ...form, maxViolations: e.target.value })} /></div>
      </div>
      <label style={labelStyle}>Allowed languages</label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
        {["java", "python", "javascript", "c", "cpp"].map((lang) => (
          <label key={lang} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" disabled={readOnly} checked={form.allowedLanguages.includes(lang)} onChange={() => toggleLanguage(lang)} />
            {lang}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" disabled={readOnly} checked={!!form.randomizeQuestions} onChange={(e) => setForm({ ...form, randomizeQuestions: e.target.checked })} /> Randomize question selection
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" disabled={readOnly} checked={!!form.requireFullscreen} onChange={(e) => setForm({ ...form, requireFullscreen: e.target.checked })} /> Require fullscreen
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" disabled={readOnly} checked={!!form.requireWebcam} onChange={(e) => setForm({ ...form, requireWebcam: e.target.checked })} /> Require webcam (face detection)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" disabled={readOnly} checked={!!form.requireMicrophone} onChange={(e) => setForm({ ...form, requireMicrophone: e.target.checked })} /> Require microphone
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" disabled={readOnly} checked={!!form.allowResume} onChange={(e) => setForm({ ...form, allowResume: e.target.checked })} /> Allow resume after crash/refresh
        </label>
      </div>
    </>
  );
}

const EMPTY_CODING_Q = {
  title: "", description: "", difficulty: "EASY", starterCodeByLanguage: {}, timeLimitMs: 3000,
  testCases: [{ input: "", expected: "", isHidden: false, explanation: "" }], tags: "",
  estimatedTimeMin: null, realWorldScenario: "", constraints: "", inputFormat: "", outputFormat: "",
  notes: "", edgeCases: "", problemExplanation: "",
};

// Every language a Module Coding Test can allow (Test.allowedLanguages) — shown unconditionally
// here since this panel isn't scoped to one test's specific language selection. Leaving one blank
// isn't an error: the platform falls back to a generic-but-language-correct default template for
// any language with no admin-authored one, so students never see another language's code.
const CODING_LANGS = [
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
  { id: "javascript", label: "JavaScript" },
];

// Question pool CRUD (add/edit/delete/bulk-import) is ADMIN-only, matching the backend RBAC
// restriction — Staff see the pool read-only.
function CodingQuestionsPanel({ testId, questions, onRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_CODING_Q);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  async function bulkImport(e) {
    e.preventDefault();
    if (!bulkFile) return;
    setBulkImporting(true);
    setBulkResult(null);
    try {
      const formData = new FormData();
      formData.append("file", bulkFile);
      const { data } = await api.post(`/module-coding/admin/tests/${testId}/questions/bulk-import`, formData);
      setBulkResult(data);
      setBulkFile(null);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Bulk import failed");
    } finally {
      setBulkImporting(false);
    }
  }

  async function downloadBulkTemplate() {
    const res = await api.get(`/module-coding/admin/tests/${testId}/questions/bulk-template`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = "module-coding-question-template.xlsx";
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  function downloadBulkErrorReport() {
    const rows = (bulkResult.errors || []).map((e) => ["Failed", e.row, e.reason]);
    const header = ["Status", "Row", "Reason"];
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "module-coding-bulk-import-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const entries = Object.entries(form.starterCodeByLanguage).filter(([, v]) => v && v.trim());
      // The legacy single-language starterCode field is still populated (as whichever language
      // was authored first) purely for backward compatibility with any code path that hasn't
      // been updated to read starterCodeByLanguage yet — it's never the primary source anymore.
      const payload = {
        ...form,
        starterCode: entries[0]?.[1] || "",
        starterCodeByLanguage: entries.length > 0 ? Object.fromEntries(entries) : undefined,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      };
      await api.post(`/module-coding/admin/tests/${testId}/questions`, payload);
      setForm(EMPTY_CODING_Q);
      setAdding(false);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add question");
    } finally {
      setSaving(false);
    }
  }

  async function remove(q) {
    if (!confirm("Delete this question?")) return;
    await api.delete(`/module-coding/admin/questions/${q.id}`);
    onRefresh();
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 15 }}>Question pool</h3>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setBulkOpen((b) => !b)}>{bulkOpen ? "Cancel" : "⬆ Bulk upload"}</button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add question"}</button>
          </div>
        )}
      </div>

      {isAdmin && bulkOpen && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
            Import multiple coding questions at once from an .xlsx/.csv file — each row needs 2 visible sample
            test cases and at least 10 hidden test cases.{" "}
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={downloadBulkTemplate}>
              ⬇ Download template
            </button>
          </p>
          <form onSubmit={bulkImport} style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setBulkFile(e.target.files?.[0] || null)} />
            <button className="btn btn-primary" disabled={!bulkFile || bulkImporting}>{bulkImporting ? "Importing…" : "Import"}</button>
          </form>
          {bulkResult && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13 }}>
                <strong>{bulkResult.createdCount}</strong> question{bulkResult.createdCount === 1 ? "" : "s"} created
                out of {bulkResult.total}.{bulkResult.errorCount > 0 && ` ${bulkResult.errorCount} failed.`}
              </p>
              {bulkResult.errors?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={downloadBulkErrorReport}>
                    ⬇ Download error report
                  </button>
                  <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                    {bulkResult.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--rust)" }} className="mono">Row {e.row}: {e.reason}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {questions.map((q) => (
          <div key={q.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <div>
              <span className="badge">{q.difficulty}</span>
              <span style={{ marginLeft: 8, fontWeight: 600 }}>{q.title || "(untitled)"}</span>
              <div style={{ marginTop: 4, color: "var(--ink-dim)" }}>{q.description}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                {q.testCases.length} test case(s) — {q.testCases.filter((tc) => tc.isHidden).length} hidden
                {" — templates: "}
                {q.starterCodeByLanguage && Object.keys(q.starterCodeByLanguage).length > 0
                  ? Object.keys(q.starterCodeByLanguage).join(", ")
                  : "none (generic defaults used)"}
              </div>
            </div>
            {isAdmin && (
              <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => remove(q)}>Delete</button>
            )}
          </div>
        ))}
        {questions.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No questions yet — students can't start this assessment until at least one is added.</p>}
      </div>

      {adding && (
        <form onSubmit={create} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label style={labelStyle}>Description / prompt</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label style={labelStyle}>Difficulty</label>
          <select style={inputStyle} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
            <option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
          </select>
          <label style={labelStyle}>Tags (comma-separated, optional)</label>
          <input style={inputStyle} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Arrays, Recursion" />

          <ProblemStatementFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

          <label style={labelStyle}>Starter code per language (optional — languages left blank fall back to a generic default template instead of another language's code)</label>
          {CODING_LANGS.map((l) => (
            <div key={l.id} style={{ marginTop: 6 }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 2 }}>{l.label}</div>
              <textarea
                style={{ ...inputStyle, minHeight: 60, fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 0 }}
                value={form.starterCodeByLanguage[l.id] || ""}
                onChange={(e) => setForm({ ...form, starterCodeByLanguage: { ...form.starterCodeByLanguage, [l.id]: e.target.value } })}
              />
            </div>
          ))}
          <TestCasesEditor testCases={form.testCases} onChange={(tc) => setForm({ ...form, testCases: tc })} minVisible={2} minHidden={10} />
          <div style={{ marginTop: 10 }}>
            <QuestionPreviewToggle
              question={{
                ...form,
                tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                testCases: form.testCases.filter((tc) => !tc.isHidden),
              }}
            />
          </div>
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Adding…" : "Add question"}</button>
        </form>
      )}
    </div>
  );
}

const ATTEMPT_STATUS_COLORS = {
  "Not Started": { bg: "#F0EEE3", color: "var(--ink-dim)" },
  "In Progress": { bg: "#FCEFD9", color: "var(--amber-dark)" },
  "Completed": { bg: "#E7F3EB", color: "var(--mint)" },
  "Locked": { bg: "#F7E4E0", color: "var(--rust)" },
};

// Per-student aggregate attempt view — search by name/roll/email, Attempts Used/Remaining, Last
// Attempt, a derived Status badge, and a Reset action (Full or Custom-count) with an audit-logged
// reason. Reused for both the legacy module-direct test panel and chapter-scoped Level panel —
// both already fetch `test` with `title`/`maxAttempts` in scope.
function CodingAttemptsPanel({ testId, testTitle, maxAttempts }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [attempts, setAttempts] = useState(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetMode, setResetMode] = useState("full");
  const [customRemaining, setCustomRemaining] = useState(maxAttempts || 1);
  const [reason, setReason] = useState("");
  const [resetting, setResetting] = useState(false);

  function load() {
    api.get(`/module-coding/admin/tests/${testId}/attempts`).then((res) => setAttempts(res.data));
  }
  useEffect(load, [testId]);

  const students = useMemo(() => {
    if (!attempts) return [];
    const byStudent = new Map();
    for (const a of attempts) {
      if (!byStudent.has(a.student.id)) byStudent.set(a.student.id, { student: a.student, attempts: [] });
      byStudent.get(a.student.id).attempts.push(a);
    }
    return [...byStudent.values()].map(({ student, attempts: list }) => {
      const finalized = list.filter((a) => a.status !== "IN_PROGRESS");
      const inProgress = list.some((a) => a.status === "IN_PROGRESS");
      const passed = finalized.some((a) => a.passed);
      const attemptsUsed = finalized.length;
      const attemptsRemaining = maxAttempts != null ? Math.max(0, maxAttempts - attemptsUsed) : null;
      const lastAttempt = list.reduce((latest, a) => {
        const t = new Date(a.submittedAt || a.startedAt).getTime();
        return t > latest ? t : latest;
      }, 0);
      let status = "Not Started";
      if (passed) status = "Completed";
      else if (inProgress) status = "In Progress";
      else if (maxAttempts != null && attemptsUsed >= maxAttempts) status = "Locked";
      else if (attemptsUsed > 0) status = "In Progress"; // attempted, failed so far, attempts remain
      return {
        student, attempts: [...list].sort((a, b) => b.attemptNumber - a.attemptNumber),
        attemptsUsed, attemptsRemaining, lastAttempt, status,
      };
    }).sort((a, b) => b.lastAttempt - a.lastAttempt);
  }, [attempts, maxAttempts]);

  const filtered = students.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.student.name?.toLowerCase().includes(q) || s.student.email?.toLowerCase().includes(q) || s.student.rollNumber?.toLowerCase().includes(q);
  });

  function openReset(s) {
    setResetTarget(s);
    setResetMode("full");
    setCustomRemaining(maxAttempts || 1);
    setReason("");
  }

  async function doReset() {
    const ok = await confirmDialog({
      title: "Reset attempts?",
      message: "Are you sure you want to reset the coding assessment attempts for this student? This will restore all available attempts.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      await api.delete(`/module-coding/admin/tests/${testId}/students/${resetTarget.student.id}/attempts`, {
        data: { mode: resetMode, attemptsRemaining: resetMode === "custom" ? Number(customRemaining) : undefined, reason: reason || undefined },
      });
      toast.success("Attempts reset successfully.");
      setResetTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset attempts");
    } finally {
      setResetting(false);
    }
  }

  async function exportCsv() {
    const { data } = await api.get(`/module-coding/admin/tests/${testId}/export`, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "coding-assessment-attempts.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ fontSize: 15 }}>Student attempts</h3>
          {testTitle && <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>Assessment: {testTitle} · Max attempts: {maxAttempts ?? "Unlimited"}</div>}
        </div>
        {isAdmin && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={exportCsv}>⬇ Export CSV</button>
        )}
      </div>

      <input style={{ ...inputStyle, marginTop: 12 }} placeholder="Search by name, roll number, or email…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {filtered.map((s) => {
          const colors = ATTEMPT_STATUS_COLORS[s.status] || ATTEMPT_STATUS_COLORS["Not Started"];
          return (
            <div key={s.student.id} className="card" style={{ padding: 12, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === s.student.id ? null : s.student.id)}>
                  <div style={{ fontWeight: 600 }}>{s.student.name} <span className="mono" style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-dim)" }}>{s.student.rollNumber || s.student.email}</span></div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                    Used {s.attemptsUsed}{maxAttempts != null ? `/${maxAttempts}` : ""} · Remaining {s.attemptsRemaining ?? "Unlimited"} · Last attempt {s.lastAttempt ? new Date(s.lastAttempt).toLocaleString() : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="badge" style={{ background: colors.bg, color: colors.color }}>{s.status}</span>
                  <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => openReset(s)}>Reset attempts</button>
                </div>
              </div>
              {expanded === s.student.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", display: "grid", gap: 6 }}>
                  {s.attempts.map((a) => (
                    <div key={a.id} className="mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                      Attempt #{a.attemptNumber} — {a.status} — {a.score}%{a.passed ? " (Passed)" : ""} — {a.violationCount} violation(s)
                      {a.autoSubmitReason ? ` — auto-submitted: ${a.autoSubmitReason}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {attempts && filtered.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>{attempts.length === 0 ? "No attempts yet." : "No students match this search."}</p>
        )}
      </div>

      {resetTarget && (
        <div className="ca-modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Reset attempts for {resetTarget.student.name}</h3>
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="radio" checked={resetMode === "full"} onChange={() => setResetMode("full")} /> Full reset ({maxAttempts ?? "unlimited"} attempts)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="radio" checked={resetMode === "custom"} onChange={() => setResetMode("custom")} disabled={maxAttempts == null} /> Custom
              </label>
            </div>
            {resetMode === "custom" && (
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Attempts to restore</label>
                <input type="number" min="0" max={maxAttempts || undefined} style={inputStyle} value={customRemaining} onChange={(e) => setCustomRemaining(e.target.value)} />
              </div>
            )}
            <label style={labelStyle}>Reason (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={() => setResetTarget(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: "var(--rust)", color: "#fff" }} disabled={resetting} onClick={doReset}>{resetting ? "Resetting…" : "Reset attempts"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================== Chapters / Learning Topics / Levels ===========================
// A Chapter groups a Module's "Learn" content (topics — Lesson rows with chapterId set) with
// the Coding Assessment Level(s) (ModuleCodingTest rows with chapterId set) that gate progress
// past it. Every module predating this feature has one auto-created "General" chapter (see
// backend/scripts/backfillChapters.js), so this panel works identically for old and new content.

function ChapterListPanel({ moduleId, onSelect }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [chapters, setChapters] = useState(null);
  const [form, setForm] = useState({ title: "", description: "" });
  const [saving, setSaving] = useState(false);

  function load() {
    api.get(`/learning/modules/${moduleId}/chapters`).then((res) => setChapters(res.data));
  }
  useEffect(load, [moduleId]);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/learning/modules/${moduleId}/chapters`, { ...form, order: chapters?.length || 0 });
      setForm({ title: "", description: "" });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create chapter");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    if (!confirm(`Delete chapter "${c.title}" and all its topics/levels? This cannot be undone.`)) return;
    await api.delete(`/learning/chapters/${c.id}`);
    load();
  }

  async function reorder(c, delta) {
    await api.patch(`/learning/chapters/${c.id}`, { order: c.order + delta });
    load();
  }

  async function toggleActive(c) {
    await api.patch(`/learning/chapters/${c.id}`, { isActive: !c.isActive });
    load();
  }

  if (chapters === null) return <p className="mono" style={{ marginTop: 20 }}>Loading…</p>;

  return (
    <div style={{ marginTop: 20 }}>
      {isAdmin && (
        <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 200px" }}>
            <label style={labelStyle}>New chapter title</label>
            <input style={inputStyle} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div style={{ flex: "3 1 260px" }}>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add chapter"}</button>
        </form>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {chapters.sort((a, b) => a.order - b.order).map((c, i) => (
          <div key={c.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => onSelect(c)}>
              <div style={{ fontWeight: 600 }}>Chapter {i + 1}: {c.title}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {c._count.topics} topic{c._count.topics === 1 ? "" : "s"} · {c._count.levels} level{c._count.levels === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="badge" style={{ background: c.isActive ? "#E7F3EB" : "#F0EEE3", color: c.isActive ? "var(--mint)" : "var(--ink-dim)" }}>
                {c.isActive ? "Active" : "Inactive"}
              </span>
              <span className="badge" style={{ background: c.countsTowardCertificate ? "#E9EEFB" : "#F0EEE3", color: c.countsTowardCertificate ? "var(--ink)" : "var(--ink-dim)" }}>
                {c.countsTowardCertificate ? "Required" : "Optional"}
              </span>
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(c, -1)}>↑</button>}
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(c, 1)}>↓</button>}
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => toggleActive(c)}>{c.isActive ? "Deactivate" : "Activate"}</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onSelect(c)}>{isAdmin ? "Manage →" : "View →"}</button>
              {isAdmin && <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(c)}>Delete</button>}
            </div>
          </div>
        ))}
        {chapters.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No chapters yet — add one above.</p>}
      </div>
    </div>
  );
}

function ChapterDetailPanel({ chapter, onBack }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [tab, setTab] = useState("levels");
  const [form, setForm] = useState({
    title: chapter.title, description: chapter.description || "",
    isActive: chapter.isActive, countsTowardCertificate: chapter.countsTowardCertificate,
  });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/learning/chapters/${chapter.id}`, form);
      alert("Chapter saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save chapter");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onBack}>← Back to chapters</button>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className={tab === "settings" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("settings")}>Settings</button>
        <button className={tab === "learn" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("learn")}>Learn</button>
        <button className={tab === "levels" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("levels")}>Coding Assessment Levels</button>
      </div>

      {tab === "settings" && (
        <form onSubmit={save} className="card" style={{ padding: 20, marginTop: 16, maxWidth: 480 }}>
          {!isAdmin && (
            <span className="badge" style={{ background: "#F0EEE3", color: "var(--ink-dim)", fontSize: 11, marginBottom: 10, display: "inline-block" }}>Read-Only</span>
          )}
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} disabled={!isAdmin} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} disabled={!isAdmin} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" disabled={!isAdmin} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" disabled={!isAdmin} checked={form.countsTowardCertificate} onChange={(e) => setForm({ ...form, countsTowardCertificate: e.target.checked })} />
            Required for the course-wide Coding Assessment certificate
          </label>
          {isAdmin && <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Saving…" : "Save chapter"}</button>}
        </form>
      )}

      {tab === "learn" && <ChapterTopicsPanel chapterId={chapter.id} />}
      {tab === "levels" && <ChapterLevelsPanel chapterId={chapter.id} />}
    </div>
  );
}

function ChapterTopicsPanel({ chapterId }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [topics, setTopics] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [form, setForm] = useState({ title: "", estimatedMinutes: 10 });
  const [saving, setSaving] = useState(false);

  function load() {
    api.get(`/learning/chapters/${chapterId}/lessons`).then((res) => setTopics(res.data));
  }
  useEffect(load, [chapterId]);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/learning/chapters/${chapterId}/lessons`, { ...form, order: topics?.length || 0 });
      setForm({ title: "", estimatedMinutes: 10 });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create topic");
    } finally {
      setSaving(false);
    }
  }

  async function remove(t) {
    if (!confirm(`Delete topic "${t.title}"?`)) return;
    await api.delete(`/learning/lessons/${t.id}`);
    load();
  }

  async function reorder(t, delta) {
    await api.patch(`/learning/lessons/${t.id}`, { order: t.order + delta });
    load();
  }

  if (topics === null) return <p className="mono" style={{ marginTop: 16 }}>Loading…</p>;

  if (topicId) {
    return <TopicDetailPanel topicId={topicId} onBack={() => { setTopicId(null); load(); }} />;
  }

  return (
    <div style={{ marginTop: 16 }}>
      {isAdmin && (
        <form onSubmit={create} className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 200px" }}>
            <label style={labelStyle}>New topic title</label>
            <input style={inputStyle} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <label style={labelStyle}>Est. minutes</label>
            <input style={inputStyle} type="number" min="1" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add topic"}</button>
        </form>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {topics.sort((a, b) => a.order - b.order).map((t) => (
          <div key={t.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => setTopicId(t.id)}>{t.title}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(t, -1)}>↑</button>}
              {isAdmin && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => reorder(t, 1)}>↓</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setTopicId(t.id)}>{isAdmin ? "Edit →" : "View →"}</button>
              {isAdmin && <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={() => remove(t)}>Delete</button>}
            </div>
          </div>
        ))}
        {topics.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No topics yet — add one above.</p>}
      </div>
    </div>
  );
}

// Reuses PracticeQuestionsPanel as-is for this topic's Knowledge Check question bank — a
// "quiz" block in TopicBlockEditor below references specific question ids from here by id.
function TopicDetailPanel({ topicId, onBack }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [full, setFull] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get(`/learning/lessons/${topicId}`).then((res) => {
      setFull(res.data);
      const l = res.data.lesson;
      setForm({
        title: l.title, content: l.content || "", blocks: Array.isArray(l.blocks) ? l.blocks : [],
        videoUrl: l.videoUrl || "", pdfUrl: l.pdfUrl || "", estimatedMinutes: l.estimatedMinutes,
        isActive: l.isActive !== false,
      });
    });
  }
  useEffect(load, [topicId]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/learning/lessons/${topicId}`, form);
      load();
      alert("Topic saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save topic");
    } finally {
      setSaving(false);
    }
  }

  if (!full || !form) return <p className="mono" style={{ marginTop: 16 }}>Loading…</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onBack}>← Back to topics</button>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginTop: 12, alignItems: "start" }}>
        <form onSubmit={save} className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontSize: 15 }}>{isAdmin ? "Edit topic" : "Topic"}</h3>
            {!isAdmin && <span className="badge" style={{ background: "#F0EEE3", color: "var(--ink-dim)", fontSize: 11 }}>Read-Only</span>}
          </div>
          {/* fieldset's disabled attribute cascades to every nested input/textarea/button — including
              inside TopicBlockEditor/TableBlockEditor — without gating each field individually. */}
          <fieldset disabled={!isAdmin} style={{ border: "none", padding: 0, margin: 0 }}>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label style={labelStyle}>Video URL (optional)</label>
            <input style={inputStyle} value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} />
            <label style={labelStyle}>PDF URL (optional)</label>
            <input style={inputStyle} value={form.pdfUrl} onChange={(e) => setForm({ ...form, pdfUrl: e.target.value })} />
            <label style={labelStyle}>Estimated minutes</label>
            <input style={inputStyle} type="number" min="1" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>

            <div style={{ marginTop: 18, fontWeight: 700, fontSize: 14 }}>Learn content</div>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
              Build this topic as an ordered list of blocks. If left empty, the legacy HTML field below is used instead.
            </p>
            <TopicBlockEditor blocks={form.blocks} onChange={(blocks) => setForm({ ...form, blocks })} />

            <label style={labelStyle}>Legacy HTML content (used only when no blocks above)</label>
            <textarea style={{ ...inputStyle, minHeight: 140, fontFamily: "var(--font-mono)", fontSize: 12 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </fieldset>

          {isAdmin && <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>{saving ? "Saving…" : "Save topic"}</button>}
        </form>

        <PracticeQuestionsPanel lesson={{ id: topicId, questions: full.questions }} onRefresh={load} />
      </div>
    </div>
  );
}

const BLOCK_TYPES = [
  { type: "text", label: "Text (HTML)" },
  { type: "youtube", label: "YouTube video" },
  { type: "image", label: "Image (URL)" },
  { type: "table", label: "Table" },
  { type: "code", label: "Code snippet" },
  { type: "note", label: "Note / callout" },
  { type: "file", label: "File (URL)" },
  { type: "quiz", label: "Knowledge check (quiz)" },
];

function emptyBlock(type) {
  switch (type) {
    case "text": return { type, html: "" };
    case "youtube": return { type, url: "", caption: "" };
    case "image": return { type, url: "", caption: "" };
    case "table": return { type, headers: ["", ""], rows: [["", ""]] };
    case "code": return { type, language: "java", code: "" };
    case "note": return { type, html: "" };
    case "file": return { type, url: "", label: "" };
    case "quiz": return { type, practiceQuestionIds: [] };
    default: return { type };
  }
}

// Structured block-list editor for a Learning Topic's "Learn" content — add/reorder/remove
// typed blocks, each with a small type-specific form, instead of a full WYSIWYG canvas.
function TopicBlockEditor({ blocks, onChange }) {
  const [addType, setAddType] = useState("text");

  function addBlock() {
    onChange([...(blocks || []), emptyBlock(addType)]);
  }
  function updateBlock(i, patch) {
    const next = [...blocks];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeBlock(i) {
    onChange(blocks.filter((_, idx) => idx !== i));
  }
  function moveBlock(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select style={{ ...inputStyle, marginTop: 0, width: "auto" }} value={addType} onChange={(e) => setAddType(e.target.value)}>
          {BLOCK_TYPES.map((b) => <option key={b.type} value={b.type}>{b.label}</option>)}
        </select>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addBlock}>+ Add block</button>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {(blocks || []).map((b, i) => (
          <div key={i} className="card" style={{ padding: 12, background: "var(--card-bg, #F7F7F5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{b.type}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={() => moveBlock(i, -1)}>↑</button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={() => moveBlock(i, 1)}>↓</button>
                <button type="button" style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => removeBlock(i)}>Remove</button>
              </div>
            </div>

            {(b.type === "text" || b.type === "note") && (
              <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="HTML content" value={b.html} onChange={(e) => updateBlock(i, { html: e.target.value })} />
            )}
            {b.type === "youtube" && (
              <>
                <input style={inputStyle} placeholder="YouTube URL" value={b.url} onChange={(e) => updateBlock(i, { url: e.target.value })} />
                <input style={inputStyle} placeholder="Caption (optional)" value={b.caption || ""} onChange={(e) => updateBlock(i, { caption: e.target.value })} />
              </>
            )}
            {b.type === "image" && (
              <>
                <input style={inputStyle} placeholder="Image URL" value={b.url} onChange={(e) => updateBlock(i, { url: e.target.value })} />
                <input style={inputStyle} placeholder="Caption (optional)" value={b.caption || ""} onChange={(e) => updateBlock(i, { caption: e.target.value })} />
              </>
            )}
            {b.type === "file" && (
              <>
                <input style={inputStyle} placeholder="File URL" value={b.url} onChange={(e) => updateBlock(i, { url: e.target.value })} />
                <input style={inputStyle} placeholder="Link label" value={b.label || ""} onChange={(e) => updateBlock(i, { label: e.target.value })} />
              </>
            )}
            {b.type === "code" && (
              <>
                <input style={inputStyle} placeholder="Language (e.g. java)" value={b.language} onChange={(e) => updateBlock(i, { language: e.target.value })} />
                <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="Code" value={b.code} onChange={(e) => updateBlock(i, { code: e.target.value })} />
              </>
            )}
            {b.type === "table" && (
              <TableBlockEditor block={b} onChange={(patch) => updateBlock(i, patch)} />
            )}
            {b.type === "quiz" && (
              <input style={inputStyle} placeholder="Comma-separated Practice Question IDs (see the panel on the right)" value={(b.practiceQuestionIds || []).join(",")} onChange={(e) => updateBlock(i, { practiceQuestionIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableBlockEditor({ block, onChange }) {
  const headers = block.headers || [];
  const rows = block.rows || [];

  function setHeader(i, value) {
    const next = [...headers]; next[i] = value; onChange({ headers: next });
  }
  function addColumn() {
    onChange({ headers: [...headers, ""], rows: rows.map((r) => [...r, ""]) });
  }
  function setCell(r, c, value) {
    const next = rows.map((row) => [...row]); next[r][c] = value; onChange({ rows: next });
  }
  function addRow() {
    onChange({ rows: [...rows, headers.map(() => "")] });
  }
  function removeRow(r) {
    onChange({ rows: rows.filter((_, i) => i !== r) });
  }

  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {headers.map((h, i) => (
          <input key={i} style={{ ...inputStyle, marginTop: 0, width: 120 }} placeholder={`Header ${i + 1}`} value={h} onChange={(e) => setHeader(i, e.target.value)} />
        ))}
        <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={addColumn}>+ Column</button>
      </div>
      {rows.map((row, r) => (
        <div key={r} style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {row.map((cell, c) => (
            <input key={c} style={{ ...inputStyle, marginTop: 0, width: 120 }} value={cell} onChange={(e) => setCell(r, c, e.target.value)} />
          ))}
          <button type="button" style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => removeRow(r)}>Remove row</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, marginTop: 6 }} onClick={addRow}>+ Row</button>
    </div>
  );
}

function ChapterLevelsPanel({ chapterId }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [levels, setLevels] = useState(null);
  const [levelId, setLevelId] = useState(null);
  const [creating, setCreating] = useState(false);

  function load() {
    api.get(`/module-coding/admin/chapter/${chapterId}/levels`).then((res) => setLevels(res.data));
  }
  useEffect(load, [chapterId]);

  async function addLevel() {
    setCreating(true);
    try {
      await api.post(`/module-coding/admin/chapter/${chapterId}/levels`, { title: `Level ${(levels?.length || 0) + 1}`, order: levels?.length || 0 });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create level");
    } finally {
      setCreating(false);
    }
  }

  if (levels === null) return <p className="mono" style={{ marginTop: 16 }}>Loading…</p>;

  if (levelId) {
    return <LevelPanel levelId={levelId} onBack={() => { setLevelId(null); load(); }} />;
  }

  return (
    <div style={{ marginTop: 16 }}>
      {isAdmin && <button className="btn btn-primary" disabled={creating} onClick={addLevel}>{creating ? "Adding…" : "+ Add Level"}</button>}
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {levels.sort((a, b) => a.order - b.order).map((l, i) => (
          <div key={l.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ cursor: "pointer" }} onClick={() => setLevelId(l.id)}>
              <div style={{ fontWeight: 600 }}>Level {i + 1}: {l.title}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {l._count.questions} question{l._count.questions === 1 ? "" : "s"} · {l._count.attempts} attempt{l._count.attempts === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="badge" style={{ background: l.isActive ? "#E7F3EB" : "#F0EEE3", color: l.isActive ? "var(--mint)" : "var(--ink-dim)" }}>
                {l.isActive ? "Active" : "Inactive"}
              </span>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setLevelId(l.id)}>Manage →</button>
            </div>
          </div>
        ))}
        {levels.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No levels yet — add one to gate progress past this chapter.</p>}
      </div>
    </div>
  );
}

// Thin wrapper around the same config/questions/attempts UI CodingTestPanel uses for a legacy
// module-direct test, parameterized by an already-created Level's own id (fetched via the
// generic GET /admin/tests/:id route, since a chapter-scoped Level has no moduleId to key off).
function LevelPanel({ levelId, onBack }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [test, setTest] = useState(undefined);
  const [form, setForm] = useState(EMPTY_TEST_FORM);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("config");

  function load() {
    api.get(`/module-coding/admin/tests/${levelId}`).then((res) => {
      setTest(res.data);
      if (res.data) {
        setForm({
          title: res.data.title, instructions: res.data.instructions || "",
          questionCount: res.data.questionCount, randomizeQuestions: res.data.randomizeQuestions,
          passingPercent: res.data.passingPercent, timeLimitMin: res.data.timeLimitMin,
          maxAttempts: res.data.maxAttempts ?? "", cooldownMinutes: res.data.cooldownMinutes,
          maxViolations: res.data.maxViolations, requireFullscreen: res.data.requireFullscreen,
          requireWebcam: res.data.requireWebcam, requireMicrophone: res.data.requireMicrophone, allowResume: res.data.allowResume,
          allowedLanguages: res.data.allowedLanguages, isActive: res.data.isActive,
        });
      }
    });
  }
  useEffect(load, [levelId]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/module-coding/admin/tests/${levelId}`, form);
      load();
      alert("Saved.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this level and ALL student attempt history for it? This cannot be undone.")) return;
    await api.delete(`/module-coding/admin/tests/${levelId}`);
    onBack();
  }

  function toggleLanguage(lang) {
    setForm((f) => ({
      ...f,
      allowedLanguages: f.allowedLanguages.includes(lang) ? f.allowedLanguages.filter((l) => l !== lang) : [...f.allowedLanguages, lang],
    }));
  }

  if (!test) return <p className="mono" style={{ marginTop: 16 }}>Loading…</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onBack}>← Back to levels</button>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button className={tab === "config" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("config")}>Settings</button>
        <button className={tab === "questions" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("questions")}>Questions ({test.questions.length})</button>
        <button className={tab === "attempts" ? "btn btn-dark" : "btn btn-ghost"} onClick={() => setTab("attempts")}>Student Attempts</button>
        {!isAdmin && (
          <span className="badge" style={{ background: "#F0EEE3", color: "var(--ink-dim)", fontSize: 11 }}>Read-Only Access</span>
        )}
      </div>

      {tab === "config" && (
        <form onSubmit={save} className="card" style={{ padding: 20, marginTop: 16, maxWidth: 560 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" disabled={!isAdmin} checked={!!form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active (required to unlock the next module)
          </label>
          <ConfigFields form={form} setForm={setForm} toggleLanguage={toggleLanguage} readOnly={!isAdmin} />
          {isAdmin && (
            <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
              <button type="button" style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 13 }} onClick={remove}>Delete level</button>
            </div>
          )}
        </form>
      )}

      {tab === "questions" && <CodingQuestionsPanel testId={test.id} questions={test.questions} onRefresh={load} />}
      {tab === "attempts" && <CodingAttemptsPanel testId={test.id} testTitle={test.title} maxAttempts={test.maxAttempts} />}
    </div>
  );
}
