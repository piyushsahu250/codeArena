import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, Copy, BarChart3, X } from "lucide-react";
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

function ScheduleForm({ kind, onScheduled, initialQuestionId }) {
  const toast = useToast();
  const [when, setWhen] = useState(toDateInputValue(new Date()));
  const [question, setQuestion] = useState(null);
  const [scope, setScope] = useState({ instituteId: null, academicGroupId: null });
  const [saving, setSaving] = useState(false);

  // Coming back from "+ Create New Question" (see that link below) — the question the admin just
  // made is pre-selected here automatically instead of making them switch back and search for it
  // by name. initialQuestionId is captured once by the parent and never changes, so this only
  // ever fetches once per mount, not on every render.
  useEffect(() => {
    if (!initialQuestionId) return;
    api.get(`/questions/${initialQuestionId}`).then((res) => setQuestion(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestionId]);

  async function submit() {
    if (!question) return toast.error("Pick a coding question first.");
    setSaving(true);
    try {
      const body = {
        ...(kind === "daily" ? { date: when } : { weekStart: when }),
        questionId: question.id, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId,
      };
      const res = await api.post(`/challenges/admin/${kind}`, body);
      toast.success(`${kind === "daily" ? "Daily" : "Weekly"} challenge scheduled.`);
      // Non-blocking quality-check warnings (e.g. no hidden test cases, no starter code) — the
      // schedule still went through, this is just a heads-up for the admin to improve the question.
      if (res.data.warnings?.length > 0) {
        toast.info(`Quality check: ${res.data.warnings.join(" ")}`, 7000);
      }
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
        {/* Root cause of "no proper option to upload/add questions": this picker could only search
            questions that already existed in the bank -- there was no path to create one from here
            at all. Reuses the existing Question Bank pages directly (create form + bulk import
            live there already) rather than building a second, duplicate question-authoring UI
            inside Challenge Admin. "+ Create New Question" round-trips in the same tab and comes
            straight back here with the new question already selected (see the initialQuestionId
            effect above + CreateQuestion.jsx's returnToChallenge handling) -- no new tab, no
            manually re-searching for what you just made. Bulk Upload creates many questions at
            once with no single one to pre-select, so it stays a plain new-tab link to the
            Question Bank, same as before. */}
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
          Don't see the question you need?{" "}
          <Link to={`/staff/questions/new?returnToChallenge=${kind}`}>+ Create New Question</Link>
          {" · "}
          <Link to="/staff/questions" target="_blank" rel="noopener noreferrer">Bulk Upload Questions</Link>
          {" (opens in a new tab)"}
        </p>
      </div>
      <button className="btn btn-primary" disabled={saving} onClick={submit} style={{ justifySelf: "start" }}>
        {saving ? "Scheduling…" : "Schedule"}
      </button>
    </div>
  );
}

// Read-only "what the student will see" view — hits the same GET .../preview route that reuses
// this file's own sanitizeQuestion() server-side, so hidden test cases are guaranteed stripped,
// not re-implemented client-side.
function PreviewModal({ kind, id, onClose }) {
  const [question, setQuestion] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/challenges/admin/${kind}/${id}/preview`)
      .then((res) => setQuestion(res.data.question))
      .catch((err) => setError(err.response?.data?.error || "Failed to load preview"));
  }, [kind, id]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflowY: "auto" }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 720, width: "100%", padding: 24, position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-ghost" style={{ position: "absolute", top: 12, right: 12, padding: 6 }} onClick={onClose} aria-label="Close preview">
          <X size={16} />
        </button>
        <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 12 }}>PREVIEW — exactly what a student sees (hidden test cases stripped)</p>
        {error ? (
          <p style={{ color: "var(--rust)" }}>{error}</p>
        ) : !question ? (
          <p style={{ color: "var(--ink-dim)" }}>Loading…</p>
        ) : (
          <>
            <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {question.title}
              <span style={{ fontSize: 11, fontWeight: 700, color: DIFF_COLOR[question.difficulty] }}>{question.difficulty}</span>
            </h3>
            <p style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 14 }}>{question.description}</p>
            {question.testCases.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 13 }}>Visible Test Cases</h4>
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {question.testCases.map((tc, i) => (
                    <div key={i} className="mono" style={{ fontSize: 12, padding: 10, background: "var(--surface-2, #f5f5f5)", borderRadius: 6 }}>
                      <div>Input: {tc.input}</div>
                      <div>Expected: {tc.expected}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Lazy-loaded inline analytics row — never queried until the admin actually expands it, and the
// route itself is wrapped in a short-TTL cached() server-side, so re-opening it repeatedly is cheap.
function AnalyticsRow({ kind, id, colSpan }) {
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    api.get(`/challenges/admin/${kind}/${id}/analytics`).then((res) => setAnalytics(res.data)).catch(() => setAnalytics({}));
  }, [kind, id]);

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "10px 12px", background: "var(--surface-2, #f9f9f9)" }}>
        {!analytics ? (
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Loading analytics…</span>
        ) : (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12 }}>
            <span><strong>{analytics.attempts ?? 0}</strong> attempts</span>
            <span><strong>{analytics.uniqueStudents ?? 0}</strong> unique students</span>
            <span><strong>{analytics.passRate ?? 0}%</strong> pass rate</span>
            <span><strong>{analytics.avgScore ?? 0}%</strong> avg score</span>
            <span><strong>{analytics.avgTimeMs != null ? `${(analytics.avgTimeMs / 1000).toFixed(1)}s` : "—"}</strong> avg time</span>
          </div>
        )}
      </td>
    </tr>
  );
}

function ScheduleList({ rows, kind, isAdmin, onDeleted, onChanged }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [previewRow, setPreviewRow] = useState(null);
  const [analyticsOpenId, setAnalyticsOpenId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  // Double-click / duplicate-request protection — mirrors the togglingId/duplicatingId pattern
  // already used for the two sibling actions below; Remove previously had no such guard.
  const [removingId, setRemovingId] = useState(null);

  async function remove(row) {
    const ok = await confirmDialog({
      title: `Remove this ${kind === "weekly" ? "weekly" : "daily"} challenge?`,
      message: `This will remove "${row.question.title || row.question.description.slice(0, 60)}" from the active ${kind === "weekly" ? "weekly" : "daily"} challenge schedule. Existing student submissions/results will not be deleted — if students have already submitted, the challenge is deactivated instead of deleted.`,
      confirmLabel: "Remove Challenge",
      danger: true,
    });
    if (!ok) return;
    setRemovingId(row.id);
    try {
      await api.delete(`/challenges/admin/${kind}/${row.id}`);
      toast.success(`${kind === "weekly" ? "Weekly" : "Daily"} Challenge removed successfully.`);
      onDeleted();
    } catch (err) {
      const msg = err.response?.data?.error || "Unable to remove the challenge. Please try again.";
      console.error("Failed to remove scheduled challenge:", err);
      if (err.response?.status === 409) toast.info(msg, 6000);
      else toast.error(msg);
      // Still refetch even on failure — this is a server truth refetch (not an optimistic local
      // removal), so it can never make a failed delete appear to have succeeded; it just re-syncs
      // in case e.g. the 409 archive-instead-of-delete branch DID change isActive server-side.
      onDeleted();
    } finally {
      setRemovingId(null);
    }
  }

  async function toggle(row) {
    setTogglingId(row.id);
    try {
      await api.patch(`/challenges/admin/${kind}/${row.id}/toggle`);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to toggle");
    } finally {
      setTogglingId(null);
    }
  }

  async function duplicate(row) {
    setDuplicatingId(row.id);
    try {
      await api.post(`/challenges/admin/${kind}/${row.id}/duplicate`);
      toast.success("Question duplicated into the question bank. Schedule the copy separately when ready.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to duplicate");
    } finally {
      setDuplicatingId(null);
    }
  }

  if (!rows) return <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>;
  if (rows.length === 0) return <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>Nothing matches — try clearing filters.</p>;

  const colSpan = isAdmin ? 7 : 6;

  return (
    <>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
              <th style={{ padding: "10px 12px" }}>{kind === "daily" ? "Date" : "Week of"}</th>
              <th style={{ padding: "10px 12px" }}>Scope</th>
              <th style={{ padding: "10px 12px" }}>Question</th>
              <th style={{ padding: "10px 12px" }}>Difficulty</th>
              <th style={{ padding: "10px 12px" }}>Submissions</th>
              <th style={{ padding: "10px 12px" }}>Active</th>
              {isAdmin && <th style={{ padding: "10px 12px" }}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td className="mono" style={{ padding: "10px 12px" }}>{toDateInputValue(kind === "daily" ? r.date : r.weekStart)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12 }}>
                    {r.academicGroup ? `${r.academicGroup.department?.name} · ${r.academicGroup.batch} · ${r.academicGroup.section}` : r.institute ? r.institute.name : <span style={{ opacity: 0.6 }}>Global</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>{r.question.title || r.question.description.slice(0, 60)}</td>
                  <td style={{ padding: "10px 12px", color: DIFF_COLOR[r.question.difficulty], fontWeight: 700 }}>{r.question.difficulty}</td>
                  <td style={{ padding: "10px 12px" }}>{r._count.submissions}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <button
                      className="btn btn-ghost"
                      disabled={!isAdmin || togglingId === r.id}
                      onClick={() => toggle(r)}
                      style={{ fontSize: 12, padding: "3px 10px", color: r.isActive ? "var(--mint)" : "var(--ink-dim)", fontWeight: 600 }}
                      title={isAdmin ? "Click to toggle" : undefined}
                    >
                      {r.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  {isAdmin && (
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost" style={{ padding: 6 }} title="Preview" onClick={() => setPreviewRow(r)}><Eye size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: 6 }} title="Analytics" onClick={() => setAnalyticsOpenId(analyticsOpenId === r.id ? null : r.id)}><BarChart3 size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: 6 }} disabled={duplicatingId === r.id} title="Duplicate question" onClick={() => duplicate(r)}><Copy size={14} /></button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--rust)" }} disabled={removingId === r.id} onClick={() => remove(r)}>
                        {removingId === r.id ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  )}
                </tr>
                {analyticsOpenId === r.id && <AnalyticsRow kind={kind} id={r.id} colSpan={colSpan} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {previewRow && <PreviewModal kind={kind} id={previewRow.id} onClose={() => setPreviewRow(null)} />}
    </>
  );
}

// Owns its own filter/page/rows state — mounted fresh per tab (daily vs weekly), so switching
// tabs naturally resets filters instead of needing separate state trees threaded from the parent.
function ChallengeSchedule({ kind, isAdmin, initialQuestionId }) {
  const [q, setQ] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: null, total: 0, totalPages: 1 });

  function load() {
    const params = { page, pageSize: 20 };
    if (q.trim()) params.q = q.trim();
    if (difficulty) params.difficulty = difficulty;
    if (status) params.status = status;
    api.get(`/challenges/admin/${kind}`, { params }).then((res) => setData(res.data)).catch(() => {});
  }

  useEffect(() => { load(); }, [page, q, difficulty, status]);
  useEffect(() => { setPage(1); }, [q, difficulty, status]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {isAdmin && <ScheduleForm kind={kind} onScheduled={load} initialQuestionId={initialQuestionId} />}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Search question title/description…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ minWidth: 130 }} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">All difficulties</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
        <select className="input" style={{ minWidth: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="VERIFIED">Verified</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      <ScheduleList rows={data.rows} kind={kind} isAdmin={isAdmin} onDeleted={load} onChanged={load} />

      {data.totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center" }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Page {page} of {data.totalPages} ({data.total} scheduled)</span>
          <button className="btn btn-ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

export default function ChallengeAdmin() {
  const { user } = useAuth();
  // Root cause of "Remove Weekly Challenge doesn't work": this previously matched only the
  // literal legacy "ADMIN" role, hiding the entire admin toolbar (Remove/Toggle/Duplicate/
  // Schedule) from every real SUPER_ADMIN and INSTITUTE_ADMIN account — even though the backend's
  // own requireRole lists in routes/challenges.js already permit all three roles on every admin
  // route, including DELETE /admin/weekly/:id. Same role-list-omission bug class already found
  // and fixed in tests.js, ResultManagement.jsx, and TalentPools.jsx this session.
  const isAdmin = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"].includes(user.role);
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link from CreateQuestion.jsx's "+ Create New Question" round trip (?tab=daily|weekly&
  // selectQuestionId=<id>) — captured once into plain state, not re-read from the live
  // searchParams, so it survives the query string being cleared right below and lands the admin
  // on the right tab with the question they just made already selected, no manual re-search.
  const [tab, setTab] = useState(() => (searchParams.get("tab") === "weekly" ? "weekly" : "daily"));
  const [initialQuestionId] = useState(() => searchParams.get("selectQuestionId") || null);
  useEffect(() => {
    if (searchParams.get("tab") || searchParams.get("selectQuestionId")) {
      setSearchParams((prev) => { prev.delete("tab"); prev.delete("selectQuestionId"); return prev; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
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
          {!isAdmin && " Only Admins can schedule, toggle, remove, or duplicate challenges — you have view access."}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className={`btn ${tab === "daily" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("daily")}>Daily Challenge</button>
          <button className={`btn ${tab === "weekly" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("weekly")}>Weekly Challenge</button>
        </div>

        <div style={{ marginTop: 16 }}>
          {tab === "daily"
            ? <ChallengeSchedule kind="daily" isAdmin={isAdmin} initialQuestionId={initialQuestionId} />
            : <ChallengeSchedule kind="weekly" isAdmin={isAdmin} initialQuestionId={initialQuestionId} />}
        </div>
      </div>
    </div>
  );
}
