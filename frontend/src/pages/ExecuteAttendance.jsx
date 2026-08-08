import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import useIsMobile from "../hooks/useIsMobile";

const LECTURE_TYPE_LABELS = { REGULAR: "Regular Class", PRACTICE_TEST: "Practice Test", EXAM: "Exam" };

const STATUS_OPTIONS = [
  { value: "PRESENT", label: "P", color: "var(--mint)" },
  { value: "ABSENT", label: "A", color: "var(--rust)" },
  { value: "LATE", label: "L", color: "var(--amber)" },
  { value: "LEAVE", label: "Lv", color: "#64748b" },
];
const STATUS_LABELS = { PRESENT: "Present", ABSENT: "Absent", LATE: "Late", LEAVE: "Leave" };

const SORT_OPTIONS = [
  { value: "rollNumber", label: "Roll Number" },
  { value: "name", label: "Student Name" },
  { value: "registrationNumber", label: "Registration Number" },
];

// Numeric-aware ascending compare for Roll Number (mirrors backend's compareRollNumbers), plain
// locale compare for the other two sort keys — students missing the sort field sort last.
function compareBy(key) {
  return (a, b) => {
    const av = a[key], bv = b[key];
    if (key === "rollNumber") {
      const an = /^\d+$/.test(av || "") ? Number(av) : null;
      const bn = /^\d+$/.test(bv || "") ? Number(bv) : null;
      if (an !== null && bn !== null) return an - bn;
      if (an !== null) return -1;
      if (bn !== null) return 1;
    }
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return String(av).localeCompare(String(bv));
  };
}

// 4-way segmented control (Present/Absent/Late/Leave) — default PRESENT for every student, staff
// only needs to tap the students who weren't simply present.
function StatusButtons({ status, onChange, compact }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {STATUS_OPTIONS.map((opt) => {
        const active = status === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={STATUS_LABELS[opt.value]}
            style={{
              width: compact ? 30 : 34, height: compact ? 30 : 34, borderRadius: 8, border: active ? "none" : "1px solid var(--line)",
              background: active ? opt.color : "transparent", color: active ? "#fff" : "var(--ink-dim)",
              fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ExecuteAttendance() {
  const { assignmentId, planId } = useParams();
  const isMobile = useIsMobile();

  const [plan, setPlan] = useState(null);
  const [roster, setRoster] = useState([]);
  const [eligibleTests, setEligibleTests] = useState([]);
  const [statuses, setStatuses] = useState({}); // studentId -> "PRESENT" | "ABSENT" | "LATE" | "LEAVE"
  const [testId, setTestId] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rollNumber");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [auditNote, setAuditNote] = useState("");

  useEffect(() => {
    setLoading(true);
    api.get(`/attendance/assignments/${assignmentId}/plans/${planId}/execute`)
      .then((res) => {
        const { plan, roster, eligibleTests } = res.data;
        setPlan(plan);
        setRoster(roster);
        setEligibleTests(eligibleTests);
        const next = {};
        roster.forEach((s) => (next[s.id] = "PRESENT"));
        // A Talent-Pool auto-generated plan already carries its own testId (see schema.prisma) —
        // pre-select it even before a session exists, so the fixed-test label below always has a
        // value to show and `save()` never needs the (never-rendered) dropdown for these plans.
        if (plan.testId) setTestId(plan.testId);
        if (plan.session) {
          plan.session.records.forEach((r) => (next[r.studentId] = r.status));
          setTestId(plan.session.testId || plan.testId || "");
          const who = plan.session.updatedBy?.name || plan.session.markedBy?.name;
          const when = plan.session.updatedBy ? plan.session.updatedAt : plan.session.markedAt;
          if (who) setAuditNote(`Last updated by ${who} at ${new Date(when).toLocaleString()}`);
        }
        setStatuses(next);
      })
      .catch((err) => setError(err.response?.data?.error || "Failed to load this lecture"))
      .finally(() => setLoading(false));
  }, [assignmentId, planId]);

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q ? roster : roster.filter((s) =>
      s.name.toLowerCase().includes(q) || (s.rollNumber || "").toLowerCase().includes(q) || (s.registrationNumber || "").toLowerCase().includes(q)
    );
    return sortBy === "rollNumber" ? filtered : [...filtered].sort(compareBy(sortBy));
  }, [roster, search, sortBy]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
    roster.forEach((s) => { c[statuses[s.id] || "PRESENT"]++; });
    return c;
  }, [roster, statuses]);

  const missingPrnCount = useMemo(() => roster.filter((s) => !s.registrationNumber).length, [roster]);

  const requiresTest = plan && plan.lectureType !== "REGULAR";
  const canSave = !requiresTest || !!testId;

  function setStatus(studentId, status) {
    setStatuses((prev) => ({ ...prev, [studentId]: status }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const records = roster.map((s) => ({ studentId: s.id, status: statuses[s.id] || "PRESENT" }));
      await api.post(`/attendance/assignments/${assignmentId}/plans/${planId}/attendance`, {
        testId: requiresTest ? testId : undefined,
        records,
      });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <Navbar />
        <div style={{ padding: 48 }} className="mono">Loading…</div>
      </div>
    );
  }

  if (error && !plan) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px 24px" }}>
          <p style={{ color: "var(--rust)" }}>{error}</p>
          <Link to={`/staff/attendance/${assignmentId}`} className="btn btn-ghost" style={{ marginTop: 16 }}>Back</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>
        <Link to={`/staff/attendance/${assignmentId}`} className="btn btn-ghost" style={{ fontSize: 12 }}>← Back</Link>
        <div style={{ marginTop: 12 }}>
          <h1 style={{ fontSize: 20 }}>{plan.topic}</h1>
          <ChalkUnderline />
          <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8 }}>
            {plan.subject} · Lecture {plan.lectureNumber} · {plan.scheduleDate.slice(0, 10)} · {plan.slotLabel} ({plan.startTime}–{plan.endTime}) · {LECTURE_TYPE_LABELS[plan.lectureType] || plan.lectureType}
          </p>
          {auditNote && <p style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>{auditNote}</p>}
        </div>

        {/* A Talent-Pool auto-generated plan already knows exactly which Test it represents (see
            schema.prisma's LecturePlan.testId) — nothing to pick, so show it as a fixed label
            instead of the manual-workflow's dropdown. */}
        {requiresTest && plan.testId && (
          <div className="card" style={{ padding: 16, marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Assessment</div>
            <div style={{ fontSize: 13 }}>{plan.test?.title || "This assessment"}</div>
          </div>
        )}

        {requiresTest && !plan.testId && (
          <div className="card" style={{ padding: 16, marginTop: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Select Test</label>
            <select
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
            >
              <option value="">Select test…</option>
              {eligibleTests.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            {eligibleTests.length === 0 && (
              <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6 }}>
                No currently-active, attendance-mandatory tests are available for this class right now.
              </p>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: isMobile ? 8 : 16, marginTop: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
            <span>Total: <strong>{roster.length}</strong></span>
            <span style={{ color: "var(--mint)" }}>Present: <strong>{counts.PRESENT}</strong></span>
            <span style={{ color: "var(--rust)" }}>Absent: <strong>{counts.ABSENT}</strong></span>
            <span style={{ color: "var(--amber)" }}>Late: <strong>{counts.LATE}</strong></span>
            <span style={{ color: "#64748b" }}>Leave: <strong>{counts.LEAVE}</strong></span>
          </div>
          <input
            style={{ flex: 1, minWidth: 160, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
            placeholder="Search by name, roll number, or registration number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            title="Sort by"
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
          </select>
        </div>

        {missingPrnCount > 0 && (
          <div className="card" style={{ padding: "10px 14px", marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, borderColor: "var(--amber)" }}>
            <span style={{ fontSize: 12.5 }}>
              <strong>{missingPrnCount}</strong> student{missingPrnCount === 1 ? "" : "s"} in this division {missingPrnCount === 1 ? "is" : "are"} missing a Registration Number (PRN). Edit their profile in Student Management to set it.
            </span>
          </div>
        )}

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 12 }}>{error}</p>}
        {saved && <p style={{ color: "var(--mint)", fontSize: 13, marginTop: 12 }}>Attendance saved.</p>}

        <div style={{ display: "grid", gap: 6, marginTop: 16 }}>
          {filteredRoster.map((s) => {
            const status = statuses[s.id] || "PRESENT";
            return (
              <div
                key={s.id}
                className="card"
                style={{ padding: "10px 14px", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: isMobile ? 8 : 0 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {s.profilePhotoUrl ? (
                    <img src={s.profilePhotoUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface-2, #eee)", flexShrink: 0 }} />
                  )}
                  <div>
                    <div>
                      <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginRight: 10 }}>{s.rollNumber || "—"}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                      <span className="mono">{s.registrationNumber || "PRN not set"}</span>
                      {(s.academicGroup?.department?.name || s.department) && <span> · {s.academicGroup?.department?.name || s.department}</span>}
                      {s.academicGroup?.section && <span> · Sec {s.academicGroup.section}</span>}
                    </div>
                  </div>
                </div>
                <StatusButtons status={status} onChange={(v) => setStatus(s.id, v)} compact={isMobile} />
              </div>
            );
          })}
          {filteredRoster.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-dim)", textAlign: "center", padding: 24 }}>No students match "{search}".</p>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--bg, #fff)", borderTop: "1px solid var(--line)", padding: "12px 24px", display: "flex", justifyContent: "center" }}>
        <button className="btn btn-primary" style={{ padding: "10px 32px" }} onClick={save} disabled={saving || !canSave || roster.length === 0}>
          {saving ? "Saving…" : "Save Attendance"}
        </button>
      </div>

    </div>
  );
}
