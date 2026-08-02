import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };
const DIFF_COLOR = { EASY: "var(--mint)", MEDIUM: "var(--amber-dark)", HARD: "var(--rust)" };

function toDateInputValue(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Mirrors backend/src/routes/challenges.js's isoWeekStart() so the week the admin sees selected
// in the UI is the same Monday the server will actually key the schedule row on.
function isoWeekStart(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const day = x.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

function QuestionPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get("/questions", { params: { q, questionType: "CODING", pageSize: 15 } })
        .then((res) => setResults(res.data.rows))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div style={{ position: "relative" }}>
      {value ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}>
          <span style={{ flex: 1 }}>{value.title || value.description.slice(0, 60)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: DIFF_COLOR[value.difficulty] }}>{value.difficulty}</span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => onChange(null)}>Change</button>
        </div>
      ) : (
        <>
          <input
            style={inputStyle}
            placeholder="Search coding questions by title/description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
          />
          {open && results.length > 0 && (
            <div className="card" style={{ position: "absolute", zIndex: 10, top: "100%", left: 0, right: 0, maxHeight: 260, overflowY: "auto", marginTop: 4 }}>
              {results.map((r) => (
                <div
                  key={r.id}
                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--line)", fontSize: 13 }}
                  onClick={() => { onChange(r); setOpen(false); setQ(""); }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{r.title || r.description.slice(0, 60)}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: DIFF_COLOR[r.difficulty] }}>{r.difficulty}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Institute/academic-group scope picker — blank institute = Global (every student sees it,
// unless a more specific challenge exists for them); institute picked + blank group = that whole
// institute; both picked = one section only. Mirrors the most-specific-wins resolution the
// backend applies when a student looks up "today's challenge" (see utils/challengeScoping.js).
function ScopePicker({ instituteId, academicGroupId, onChange }) {
  const [institutes, setInstitutes] = useState([]);
  const [groups, setGroups] = useState([]);

  useEffect(() => { api.get("/institutes").then((res) => setInstitutes(res.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!instituteId) { setGroups([]); return; }
    api.get("/academic-groups", { params: { instituteId } }).then((res) => setGroups(res.data)).catch(() => setGroups([]));
  }, [instituteId]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)" }}>Institute (blank = Global)</label>
        <select style={{ ...inputStyle, marginTop: 6 }} value={instituteId || ""} onChange={(e) => onChange({ instituteId: e.target.value || null, academicGroupId: null })}>
          <option value="">— Global (every institute) —</option>
          {institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)" }}>Academic Group (blank = whole institute)</label>
        <select style={{ ...inputStyle, marginTop: 6 }} value={academicGroupId || ""} disabled={!instituteId} onChange={(e) => onChange({ instituteId, academicGroupId: e.target.value || null })}>
          <option value="">— Whole institute —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.department?.name} · {g.batch} · {g.section}</option>)}
        </select>
      </div>
    </div>
  );
}

function ScheduleForm({ kind, onScheduled }) {
  const toast = useToast();
  const [when, setWhen] = useState(toDateInputValue(new Date()));
  const [question, setQuestion] = useState(null);
  const [scope, setScope] = useState({ instituteId: null, academicGroupId: null });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!question) return toast.error("Pick a coding question first.");
    setSaving(true);
    try {
      const body = {
        ...(kind === "daily" ? { date: when } : { weekStart: when }),
        questionId: question.id, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId,
      };
      await api.post(`/challenges/admin/${kind}`, body);
      toast.success(`${kind === "daily" ? "Daily" : "Weekly"} challenge scheduled.`);
      setQuestion(null);
      onScheduled();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)" }}>
          {kind === "daily" ? "Date" : "Any day in the target week"}
        </label>
        <input type="date" style={{ ...inputStyle, marginTop: 6 }} value={when} onChange={(e) => setWhen(e.target.value)} />
        {kind === "weekly" && (
          <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
            Scheduled for the week of {isoWeekStart(when).toDateString()} (Monday–Sunday).
          </p>
        )}
      </div>
      <ScopePicker instituteId={scope.instituteId} academicGroupId={scope.academicGroupId} onChange={setScope} />
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)" }}>Question</label>
        <div style={{ marginTop: 6 }}>
          <QuestionPicker value={question} onChange={setQuestion} />
        </div>
      </div>
      <button className="btn btn-primary" disabled={saving} onClick={submit} style={{ justifySelf: "start" }}>
        {saving ? "Scheduling…" : "Schedule"}
      </button>
    </div>
  );
}

function ScheduleList({ rows, kind, isAdmin, onDeleted }) {
  const toast = useToast();
  const confirmDialog = useConfirm();

  async function remove(row) {
    const ok = await confirmDialog({
      title: "Remove this scheduled challenge?",
      message: `This unschedules "${row.question.title || row.question.description.slice(0, 60)}" — any student submissions for it stay on record.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/challenges/admin/${kind}/${row.id}`);
      toast.success("Removed.");
      onDeleted();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to remove");
    }
  }

  if (!rows) return <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>;
  if (rows.length === 0) return <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Nothing scheduled yet.</p>;

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
            <th style={{ padding: "10px 12px" }}>{kind === "daily" ? "Date" : "Week of"}</th>
            <th style={{ padding: "10px 12px" }}>Scope</th>
            <th style={{ padding: "10px 12px" }}>Question</th>
            <th style={{ padding: "10px 12px" }}>Difficulty</th>
            <th style={{ padding: "10px 12px" }}>Submissions</th>
            {isAdmin && <th style={{ padding: "10px 12px" }}></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <td className="mono" style={{ padding: "10px 12px" }}>{toDateInputValue(kind === "daily" ? r.date : r.weekStart)}</td>
              <td style={{ padding: "10px 12px", fontSize: 12 }}>
                {r.academicGroup ? `${r.academicGroup.department?.name} · ${r.academicGroup.batch} · ${r.academicGroup.section}` : r.institute ? r.institute.name : <span style={{ opacity: 0.6 }}>Global</span>}
              </td>
              <td style={{ padding: "10px 12px" }}>{r.question.title || r.question.description.slice(0, 60)}</td>
              <td style={{ padding: "10px 12px", color: DIFF_COLOR[r.question.difficulty], fontWeight: 700 }}>{r.question.difficulty}</td>
              <td style={{ padding: "10px 12px" }}>{r._count.submissions}</td>
              {isAdmin && (
                <td style={{ padding: "10px 12px" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} onClick={() => remove(r)}>Remove</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChallengeAdmin() {
  const { user } = useAuth();
  const isAdmin = user.role === "ADMIN";
  const [tab, setTab] = useState("daily");
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);

  function loadDaily() { api.get("/challenges/admin/daily").then((res) => setDaily(res.data)); }
  function loadWeekly() { api.get("/challenges/admin/weekly").then((res) => setWeekly(res.data)); }

  useEffect(() => { loadDaily(); loadWeekly(); }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Coding Challenges</h1>
            <ChalkUnderline />
          </div>
          <Link to={isAdmin ? "/admin" : "/staff"} className="btn btn-ghost">← Back</Link>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 12 }}>
          Schedule a coding question from the question bank onto a specific day or week. Students solve it from
          their Daily/Weekly Challenge page and earn XP + streak credit the same way Practice Coding does.
          {!isAdmin && " Only Admins can schedule or remove challenges — you have view access."}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className={`btn ${tab === "daily" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("daily")}>Daily Challenge</button>
          <button className={`btn ${tab === "weekly" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("weekly")}>Weekly Challenge</button>
        </div>

        {tab === "daily" ? (
          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            {isAdmin && <ScheduleForm kind="daily" onScheduled={loadDaily} />}
            <ScheduleList rows={daily} kind="daily" isAdmin={isAdmin} onDeleted={loadDaily} />
          </div>
        ) : (
          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            {isAdmin && <ScheduleForm kind="weekly" onScheduled={loadWeekly} />}
            <ScheduleList rows={weekly} kind="weekly" isAdmin={isAdmin} onDeleted={loadWeekly} />
          </div>
        )}
      </div>
    </div>
  );
}
