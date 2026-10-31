import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ChalkUnderline from "../../components/ChalkUnderline";
import { useToast } from "../../context/ToastContext";
import { Notice, Pager, errMsg, fmtDateTime, useDebounced, useLoader } from "./kit";
import "./testmgmt.css";

const BACK = "/staff/test-management?s=series";
const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (local) => (local ? new Date(local).toISOString() : null);

function Shell({ title, sub, children }) {
  return (
    <div>
      <Navbar />
      <div className="tm-page" style={{ maxWidth: 1000 }}>
        <p className="tm-meta"><Link to={BACK}>← Test Management</Link></p>
        <h1 style={{ margin: 0 }}>{title}</h1><ChalkUnderline />
        {sub && <p className="tm-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

// Create or edit a series: details, then an ordered list of existing tests. Saving checks the version so two people cannot overwrite each other silently.
export function SeriesEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ title: "", description: "", coverUrl: "", subject: "", difficulty: "", accessMode: "FLEXIBLE", unlockRule: "ATTEMPTED" });
  const [items, setItems] = useState([]);
  const [version, setVersion] = useState(undefined);
  const [lifecycle, setLifecycle] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const loaded = useLoader(async () => {
    if (isNew) return null;
    const { data } = await api.get(`/test-management/series/${id}`);
    setForm({ title: data.title, description: data.description || "", coverUrl: data.coverUrl || "", subject: data.subject || "", difficulty: data.difficulty || "", accessMode: data.accessMode, unlockRule: data.unlockRule });
    setItems(data.items.map((i) => ({ testId: i.testId, title: i.title, questions: i.questions, lifecycle: i.lifecycle })));
    setVersion(data.version); setLifecycle(data.lifecycle);
    return data;
  }, [id]);
  const picker = useLoader(() => api.get("/test-management/tests", { params: { view: "all", q: dq || undefined, pageSize: 10, sort: "title" } }).then((r) => r.data), [dq]);
  const chosen = new Set(items.map((i) => i.testId));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const move = (i, d) => setItems((list) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function save(e) {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      const body = { ...form, difficulty: form.difficulty || null, testIds: items.map((i) => i.testId), ...(version !== undefined ? { version } : {}) };
      const { data } = isNew ? await api.post("/test-management/series", body) : await api.put(`/test-management/series/${id}`, body);
      toast.success("Series saved.");
      if (isNew) navigate(`/staff/test-management/series/${data.id}`, { replace: true });
      else { setVersion(data.version); setLifecycle(data.lifecycle); }
    } catch (err) { setError(errMsg(err)); } finally { setSaving(false); }
  }

  return (
    <Shell title={isNew ? "New Test Series" : "Edit Test Series"} sub="A series puts tests you already have in order. It never changes a test's own schedule, eligibility or results.">
      {loaded.error && <Notice kind="bad">{loaded.error}</Notice>}
      {lifecycle?.archived && <Notice kind="warn">This series is archived. Restore it from the series list before editing.</Notice>}
      <form className="tm-card tm-form" onSubmit={save}>
        <label htmlFor="s-title">Title</label>
        <input id="s-title" type="text" required maxLength={140} value={form.title} onChange={set("title")} />
        <label htmlFor="s-desc">Description</label>
        <textarea id="s-desc" rows={3} maxLength={2000} value={form.description} onChange={set("description")} />
        <div className="tm-two">
          <div><label htmlFor="s-sub">Subject</label><input id="s-sub" type="text" value={form.subject} onChange={set("subject")} /></div>
          <div><label htmlFor="s-dif">Difficulty</label><select id="s-dif" value={form.difficulty} onChange={set("difficulty")}><option value="">Not set</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select></div>
          <div><label htmlFor="s-mode">Access</label><select id="s-mode" value={form.accessMode} onChange={set("accessMode")}><option value="FLEXIBLE">Flexible: any order</option><option value="SEQUENTIAL">Sequential: one after another</option></select></div>
          {form.accessMode === "SEQUENTIAL" && <div><label htmlFor="s-rule">A test unlocks the next when it is</label><select id="s-rule" value={form.unlockRule} onChange={set("unlockRule")}><option value="ATTEMPTED">Attempted (submitted)</option><option value="PASSED">Passed (meets passing marks)</option></select></div>}
        </div>
        <label htmlFor="s-cover">Cover image address (optional)</label>
        <input id="s-cover" type="url" placeholder="https://…" value={form.coverUrl} onChange={set("coverUrl")} />

        <h3 style={{ marginBottom: 4 }}>Tests in this series ({items.length})</h3>
        {items.length === 0 && <p className="tm-meta">No tests yet. Search below and add them in the order students should take them.</p>}
        {items.map((it, i) => (
          <div key={it.testId} className="tm-step">
            <span className="no">{i + 1}</span>
            <div><div className="tm-title">{it.title}</div><div className="tm-meta">{it.questions != null ? `${it.questions} questions` : ""}{it.lifecycle && !it.lifecycle.published ? " · unpublished" : ""}{it.lifecycle && !it.lifecycle.active ? " · inactive" : ""}</div></div>
            <div style={{ whiteSpace: "nowrap" }}>
              <button type="button" className="btn btn-ghost" aria-label={`Move ${it.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-ghost" aria-label={`Move ${it.title} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-ghost" onClick={() => setItems(items.filter((x) => x.testId !== it.testId))}>Remove</button>
            </div>
          </div>
        ))}

        <h3 style={{ marginBottom: 4 }}>Add tests</h3>
        <input type="search" placeholder="Search your tests" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests to add" />
        <div className="tm-table-wrap"><table className="tm-table"><tbody>
          {(picker.data?.rows || []).map((t) => (
            <tr key={t.id}><td><div className="tm-title">{t.title}</div><div className="tm-meta">{[t.subject, `${t.questions} questions`].filter(Boolean).join(" · ")}</div></td>
              <td style={{ textAlign: "right" }}><button type="button" className="btn btn-ghost" disabled={chosen.has(t.id)} onClick={() => setItems([...items, { testId: t.id, title: t.title, questions: t.questions, lifecycle: t.lifecycle }])}>{chosen.has(t.id) ? "Added" : "Add"}</button></td></tr>
          ))}
        </tbody></table></div>
        {picker.data?.rows.length === 0 && <p className="tm-meta">No matching tests.</p>}

        {error && <Notice kind="bad">{error}</Notice>}
        <div className="tm-tools" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" disabled={saving || lifecycle?.archived}>{saving ? "Saving…" : "Save series"}</button>
          {!isNew && <Link className="btn btn-ghost" to={`/staff/test-management/series/${id}/assign`}>Assign to groups</Link>}
          <Link className="btn btn-ghost" to={BACK}>Back</Link>
        </div>
        {!isNew && <p className="tm-meta">Publish or switch the series on from the Test Series list. Students only see a series that is published, active and assigned to them.</p>}
      </form>
    </Shell>
  );
}

// Assign: choose groups / pools, set the window (or No Expiry), review a confirmation that names every target and flags tests not yet open to them, then confirm.
export function SeriesAssign() {
  const { id } = useParams();
  const toast = useToast();
  const series = useLoader(() => api.get(`/test-management/series/${id}`).then((r) => r.data), [id]);
  const options = useLoader(() => api.get("/test-management/assignment-options").then((r) => r.data), []);
  const [gSel, setGSel] = useState(new Set());
  const [pSel, setPSel] = useState(new Set());
  const [dep, setDep] = useState("");
  const [win, setWin] = useState({ startAt: toLocalInput(new Date().toISOString()), endAt: "", noExpiry: false, completionDeadline: "", instructions: "" });
  const [preview, setPreview] = useState(null);
  const [alsoAssign, setAlsoAssign] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = (options.data?.groups || []).filter((g) => !dep || g.departmentId === dep);
  const deps = [...new Map((options.data?.groups || []).filter((g) => g.departmentId).map((g) => [g.departmentId, g.department])).entries()];
  const flip = (set, setter, v) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n); setPreview(null); };
  const body = () => ({ academicGroupIds: [...gSel], poolIds: [...pSel], startAt: toIso(win.startAt), endAt: win.noExpiry ? null : toIso(win.endAt), noExpiry: win.noExpiry, completionDeadline: toIso(win.completionDeadline), instructions: win.instructions });

  async function review() {
    setError(""); setBusy(true);
    try { const { data } = await api.post(`/test-management/series/${id}/assignments/preview`, body()); setPreview(data); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  async function confirm() {
    setError(""); setBusy(true);
    try { const { data } = await api.post(`/test-management/series/${id}/assignments`, { ...body(), confirm: true, alsoAssignTests: alsoAssign }); setResult(data); setPreview(null); setGSel(new Set()); setPSel(new Set()); series.reload(); toast.success("Series assigned."); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  const s = series.data;

  return (
    <Shell title={s ? `Assign: ${s.title}` : "Assign series"} sub="Choose who receives this series and when. Each assignment has its own window, so different groups can have different dates.">
      {series.error && <Notice kind="bad">{series.error}</Notice>}
      {s && !s.lifecycle.published && <Notice kind="warn">This series is still a draft. You can assign it now, but students see it only after you publish it.</Notice>}
      {result && (
        <Notice kind="ok" onClose={() => setResult(null)}>
          Assigned to {result.created.length} target{result.created.length === 1 ? "" : "s"}.
          {result.duplicates.length > 0 && <div>Already assigned, left unchanged: {result.duplicates.map((d) => d.label).join(", ")}.</div>}
          {result.testsAssigned.length > 0 && <div>Also made {result.testsAssigned.length} test(s) available to those groups.</div>}
          {result.stillMissing.length > 0 && <div>Not yet open to some students: {result.stillMissing.map((m) => `${m.target} (${m.tests.join(", ")})`).join("; ")}. Those tests show as unavailable until they are assigned.</div>}
        </Notice>
      )}
      <div className="tm-card tm-form">
        <h3 style={{ marginTop: 0 }}>1. Who</h3>
        {deps.length > 1 && <select value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Filter by department"><option value="">All departments</option>{deps.map(([k, name]) => <option key={k} value={k}>{name}</option>)}</select>}
        <div style={{ maxHeight: 240, overflow: "auto", marginTop: 8 }}>
          {groups.map((g) => <label key={g.id} style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={gSel.has(g.id)} onChange={() => flip(gSel, setGSel, g.id)} />{g.label} <span className="tm-meta">· {g.students} students</span></label>)}
          {options.data && groups.length === 0 && <p className="tm-meta">No academic groups found.</p>}
        </div>
        {options.data?.canAssignPools && (options.data.pools.length > 0) && <>
          <h4 style={{ marginBottom: 0 }}>Talent Pools</h4>
          {options.data.pools.map((p) => <label key={p.id} style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={pSel.has(p.id)} onChange={() => flip(pSel, setPSel, p.id)} />{p.name} <span className="tm-meta">· {p.students} students</span></label>)}
        </>}
        {options.data && !options.data.canAssignPools && <p className="tm-meta">Assigning to Talent Pools is done by an administrator.</p>}

        <h3>2. When</h3>
        <div className="tm-two">
          <div><label htmlFor="a-start">Opens</label><input id="a-start" type="datetime-local" value={win.startAt} onChange={(e) => { setWin({ ...win, startAt: e.target.value }); setPreview(null); }} /></div>
          <div><label htmlFor="a-end">Closes</label><input id="a-end" type="datetime-local" disabled={win.noExpiry} value={win.noExpiry ? "" : win.endAt} onChange={(e) => { setWin({ ...win, endAt: e.target.value }); setPreview(null); }} /></div>
          <div><label htmlFor="a-due">Complete the whole series by (optional)</label><input id="a-due" type="datetime-local" value={win.completionDeadline} onChange={(e) => { setWin({ ...win, completionDeadline: e.target.value }); setPreview(null); }} /></div>
        </div>
        <label style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={win.noExpiry} onChange={(e) => { setWin({ ...win, noExpiry: e.target.checked }); setPreview(null); }} /> No Expiry: the series never closes (no end date is stored)</label>
        <label htmlFor="a-ins">Instructions for students (optional)</label>
        <textarea id="a-ins" rows={2} maxLength={2000} value={win.instructions} onChange={(e) => setWin({ ...win, instructions: e.target.value })} />
        <p className="tm-meta">The window above controls access to the <em>series</em>. Each test inside still follows its own schedule.</p>
        {error && <Notice kind="bad">{error}</Notice>}
        <button className="btn btn-primary" disabled={busy || (gSel.size + pSel.size === 0)} onClick={review}>Review assignment</button>
      </div>

      {preview && (
        <div className="tm-card" style={{ marginTop: 14 }} role="region" aria-label="Confirm assignment">
          <h3 style={{ marginTop: 0 }}>3. Confirm</h3>
          <p>You are about to assign <strong>{preview.series.title}</strong> ({preview.series.tests} tests) to <strong>{preview.targets.length}</strong> target{preview.targets.length === 1 ? "" : "s"}, about <strong>{preview.totalStudents}</strong> students.</p>
          <p className="tm-meta">Opens {win.startAt ? fmtDateTime(toIso(win.startAt)) : "—"} · {win.noExpiry ? "No Expiry" : `closes ${fmtDateTime(toIso(win.endAt))}`}</p>
          <ul style={{ paddingLeft: 18 }}>
            {preview.targets.map((t) => (
              <li key={t.id}><strong>{t.label}</strong> <span className="tm-meta">({t.type === "TALENT_POOL" ? "Talent Pool" : "group"}, {t.students ?? "?"} students)</span>
                {t.existing && <div className="tm-meta">Already assigned: it will be left unchanged (edit it in Assignments).</div>}
                {!t.existing && t.missing.length > 0 && <div className="tm-meta" style={{ color: "var(--warning-text)" }}>Not yet open to them: {t.missing.map((m) => m.title + (m.canAutoAssign ? "" : " (cannot add automatically)")).join(", ")}</div>}
              </li>))}
          </ul>
          {preview.targets.some((t) => !t.existing && t.missing.some((m) => m.canAutoAssign)) && <label style={{ fontWeight: 400 }}><input type="checkbox" checked={alsoAssign} onChange={(e) => setAlsoAssign(e.target.checked)} style={{ marginRight: 8 }} />Also make those tests available to these groups (only tests you own that are already limited to certain groups)</label>}
          <p className="tm-meta">{preview.note}</p>
          <div className="tm-tools"><button className="btn btn-primary" disabled={busy || preview.targets.every((t) => t.existing)} onClick={confirm}>Confirm and assign</button><button className="btn btn-ghost" onClick={() => setPreview(null)}>Back</button></div>
        </div>
      )}
      {s && s.assignments.length > 0 && (
        <div className="tm-card" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Current assignments</h3>
          <table className="tm-table"><tbody>{s.assignments.map((a) => <tr key={a.id}><td>{a.label}</td><td className="tm-meta">{fmtDateTime(a.startAt)} → {a.noExpiry ? "No Expiry" : fmtDateTime(a.endAt)}</td></tr>)}</tbody></table>
          <Link className="btn btn-ghost" to="/staff/test-management?s=assignments">Manage assignments</Link>
        </div>
      )}
    </Shell>
  );
}

// Progress of a series for one group, one pool or everyone assigned, searchable by name / roll number / PRN, exportable. Results are shown per academic group, never merged.
export function SeriesReport() {
  const { id } = useParams();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const series = useLoader(() => api.get(`/test-management/series/${id}`).then((r) => r.data), [id]);
  const params = { q: dq || undefined, page, pageSize: 25, ...(target.startsWith("g:") ? { academicGroupId: target.slice(2) } : target.startsWith("p:") ? { poolId: target.slice(2) } : {}) };
  const rep = useLoader(() => api.get(`/test-management/series/${id}/report`, { params }).then((r) => r.data), [id, dq, page, target]);
  useEffect(() => { setPage(1); }, [dq, target]);
  async function exportCsv() {
    try {
      const { data } = await api.get(`/test-management/series/${id}/report.csv`, { params: { ...params, page: undefined, pageSize: undefined }, responseType: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(data); a.download = `series-${id}-progress.csv`; a.click(); URL.revokeObjectURL(a.href);
    } catch (err) { toast.error(errMsg(err, "Could not export.")); }
  }
  const d = rep.data;
  return (
    <Shell title={series.data ? `Progress: ${series.data.title}` : "Series progress"} sub="Marks are each student's own submitted attempt, unchanged. Groups are listed separately.">
      {rep.error && <Notice kind="bad">{rep.error}</Notice>}
      {d && (
        <>
          <div className="tm-stats">
            <div className="tm-stat"><div className="n">{d.summary.students}</div><div className="tm-meta">Students assigned</div></div>
            <div className="tm-stat"><div className="n">{d.summary.started}</div><div className="tm-meta">Started</div></div>
            <div className="tm-stat"><div className="n">{d.summary.completedAll}</div><div className="tm-meta">Completed all tests</div></div>
            <div className="tm-stat"><div className="n">{d.summary.completionRate}%</div><div className="tm-meta">Completion rate</div></div>
          </div>
          {d.byGroup.length > 0 && <div className="tm-card" style={{ marginBottom: 14 }}><h3 style={{ marginTop: 0 }}>By academic group</h3><table className="tm-table"><thead><tr><th>Department · batch · section</th><th>Students</th><th>Started</th><th>Completed all</th></tr></thead><tbody>{d.byGroup.map((g) => <tr key={g.academicGroupId}><td>{g.label}</td><td>{g.students}</td><td>{g.started}</td><td>{g.completedAll}</td></tr>)}</tbody></table></div>}
        </>
      )}
      <div className="tm-card">
        <div className="tm-tools">
          <input type="search" placeholder="Search name, roll number or PRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Group or pool"><option value="">Everyone assigned</option>{(series.data?.assignments || []).map((a) => <option key={a.id} value={(a.type === "TALENT_POOL" ? "p:" : "g:") + a.targetId}>{a.label}</option>)}</select>
          <button className="btn btn-ghost" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="tm-table-wrap"><table className="tm-table">
          <thead><tr><th>Student</th><th>Roll / PRN</th><th>Group</th>{d?.series.tests.map((t) => <th key={t.testId}>{t.position}. {t.title}</th>)}<th>Done</th></tr></thead>
          <tbody>{(d?.rows || []).map((r) => (
            <tr key={r.studentId}><td className="tm-title">{r.name}</td><td className="tm-meta">{[r.rollNumber, r.prn].filter(Boolean).join(" / ") || "—"}</td><td className="tm-meta">{r.group}</td>
              {r.tests.map((t) => <td key={t.testId}>{t.state === "COMPLETED" ? <>{t.score}{t.passed === false && <span className="tm-pill bad">Below pass</span>}{t.passed === true && <span className="tm-pill ok">Pass</span>}</> : t.state === "IN_PROGRESS" ? <span className="tm-pill warn">In progress</span> : <span className="tm-meta">Pending</span>}</td>)}
              <td>{r.completed}/{r.completed + r.pending} <span className="tm-meta">({r.percent}%)</span></td></tr>))}</tbody>
        </table></div>
        {d && d.rows.length === 0 && <div className="tm-empty">No students found. Assign this series to a group first.</div>}
        <Pager page={d?.page || 1} totalPages={d?.totalPages} total={d?.total} onPage={setPage} />
        {d && <p className="tm-meta">{d.note}</p>}
      </div>
    </Shell>
  );
}
