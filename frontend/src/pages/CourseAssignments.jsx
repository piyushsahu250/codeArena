import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import AcademicGroupPicker from "../components/AcademicGroupPicker";
import { useToast } from "../context/ToastContext";

const cardStyle = { padding: 20 };

// Admin-only: assign Published courses to Institutes (broad grant) and/or specific Academic
// Groups (fine-grained grant) — mirrors the exact Test<->AcademicGroup assignment pattern this
// platform already uses, applied to Course visibility instead. One Course -> many Institutes,
// or many Courses -> many Institutes/groups at once (bulk assign).
export default function CourseAssignments() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const preselectCourseId = searchParams.get("courseId");

  const [courses, setCourses] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [academicGroups, setAcademicGroups] = useState([]);
  const [courseIds, setCourseIds] = useState(preselectCourseId ? [preselectCourseId] : []);
  const [instituteIds, setInstituteIds] = useState([]);
  const [academicGroupIds, setAcademicGroupIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(null); // { institutes, academicGroups } for the single selected course
  const [loadingCurrent, setLoadingCurrent] = useState(false);

  useEffect(() => {
    api.get("/learning/courses").then((res) => setCourses(res.data));
    api.get("/institutes").then((res) => setInstitutes(res.data));
    api.get("/academic-groups").then((res) => setAcademicGroups(res.data));
  }, []);

  function loadCurrent(courseId) {
    setLoadingCurrent(true);
    api.get(`/learning/courses/${courseId}/assignments`).then((res) => setCurrent(res.data)).finally(() => setLoadingCurrent(false));
  }
  useEffect(() => {
    if (courseIds.length === 1) loadCurrent(courseIds[0]);
    else setCurrent(null);
  }, [courseIds]);

  const publishedCourses = courses.filter((c) => c.status === "PUBLISHED");

  function toggleCourse(id) {
    setCourseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function assign() {
    if (courseIds.length === 0 || (instituteIds.length === 0 && academicGroupIds.length === 0)) {
      toast.error("Select at least one course and one institute or academic group.");
      return;
    }
    setSaving(true);
    try {
      if (courseIds.length === 1) {
        await api.post(`/learning/courses/${courseIds[0]}/assignments`, { instituteIds, academicGroupIds });
      } else {
        await api.post("/learning/courses/assignments/bulk", { courseIds, instituteIds, academicGroupIds });
      }
      toast.success("Course(s) assigned successfully.");
      if (courseIds.length === 1) loadCurrent(courseIds[0]);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to assign course(s)");
    } finally {
      setSaving(false);
    }
  }

  async function unassign() {
    if (courseIds.length !== 1 || (instituteIds.length === 0 && academicGroupIds.length === 0)) {
      toast.error("Select exactly one course and at least one institute or academic group to unassign.");
      return;
    }
    setSaving(true);
    try {
      await api.delete(`/learning/courses/${courseIds[0]}/assignments`, { data: { instituteIds, academicGroupIds } });
      toast.success("Unassigned successfully.");
      loadCurrent(courseIds[0]);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to unassign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Course Assignments</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12, fontSize: 14 }}>
          Only Published courses can be assigned. A course with no assignment at all is invisible to students —
          assign it to an Institute (visible to everyone there) or specific Academic Groups (visible only to that batch/department/section).
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 24, marginTop: 24, alignItems: "start" }}>
          <div className="card" style={cardStyle}>
            <h3 style={{ fontSize: 15 }}>Courses</h3>
            <div style={{ display: "grid", gap: 6, marginTop: 10, maxHeight: 360, overflowY: "auto" }}>
              {publishedCourses.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 4px" }}>
                  <input type="checkbox" checked={courseIds.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                  {c.name}
                </label>
              ))}
              {publishedCourses.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No Published courses yet.</p>}
            </div>
          </div>

          <div className="card" style={cardStyle}>
            <h3 style={{ fontSize: 15 }}>Institutes (broad grant)</h3>
            <div style={{ display: "grid", gap: 6, marginTop: 10, maxHeight: 140, overflowY: "auto" }}>
              {institutes.map((i) => (
                <label key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox" checked={instituteIds.includes(i.id)}
                    onChange={() => setInstituteIds((prev) => (prev.includes(i.id) ? prev.filter((x) => x !== i.id) : [...prev, i.id]))}
                  />
                  {i.name}
                </label>
              ))}
            </div>

            <h3 style={{ fontSize: 15, marginTop: 20 }}>Academic groups (fine-grained grant)</h3>
            <div style={{ marginTop: 10 }}>
              <AcademicGroupPicker multi groups={academicGroups} value={academicGroupIds} onChange={setAcademicGroupIds} />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving} onClick={assign}>{saving ? "Saving…" : "Assign selected"}</button>
              <button className="btn btn-ghost" disabled={saving} onClick={unassign}>Unassign selected</button>
            </div>
          </div>
        </div>

        {courseIds.length === 1 && (
          <div className="card" style={{ ...cardStyle, marginTop: 20 }}>
            <h3 style={{ fontSize: 15 }}>Currently assigned to</h3>
            {loadingCurrent ? (
              <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>Loading…</p>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(current?.institutes || []).map((i) => <span key={i.id} className="badge" style={{ background: "#E7F3EB", color: "var(--mint)" }}>{i.name}</span>)}
                {(current?.academicGroups || []).map((g) => (
                  <span key={g.id} className="badge" style={{ background: "#EAF1FB", color: "var(--ink)" }}>
                    {g.institute?.name} · {g.department?.name} · {g.section} ({g.batch})
                  </span>
                ))}
                {current && (current.institutes || []).length === 0 && (current.academicGroups || []).length === 0 && (
                  <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>Not assigned anywhere — invisible to students.</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
