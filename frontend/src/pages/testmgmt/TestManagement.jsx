import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FolderPlus, Plus, Star } from "lucide-react";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ChalkUnderline from "../../components/ChalkUnderline";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import { LifecyclePills, Menu, Notice, Pager, errMsg, fmtDate, fmtDateTime, useDebounced, useLoader } from "./kit";
import "./testmgmt.css";

const VIEWS = [["all", "All Tests"], ["active", "Active"], ["inactive", "Inactive"], ["published", "Published"], ["unpublished", "Unpublished"], ["starred", "Starred"], ["hidden", "Hidden"], ["archived", "Archived"]];
const HIGH_IMPACT = { archive: "Archive", deactivate: "Switch off", unpublish: "Unpublish", publish: "Publish" };

// The one place staff and administrators manage tests: views (all / active / inactive / published / unpublished / starred / hidden / archived), their own folders, Test Series, assignments and
// results. Lists are paged and filtered on the server. Starring, hiding and filing are the person's own marks; none of them changes what a student sees or any result.
export default function TestManagement() {
  const [params, setParams] = useSearchParams();
  const section = params.get("s") || "overview";
  const view = params.get("view") || "all";
  const folder = params.get("folder") || "";
  const go = (next) => setParams({ s: next.s ?? section, ...(next.view ? { view: next.view } : {}), ...(next.folder ? { folder: next.folder } : {}) });
  const overview = useLoader(() => api.get("/test-management/overview").then((r) => r.data), []);
  const folders = useLoader(() => api.get("/test-management/folders").then((r) => r.data), []);
  const refreshAll = () => { overview.reload(); folders.reload(); };
  const counts = overview.data?.tests || {};
  const navBtn = (label, on, onClick, count) => <button key={label} className={on ? "on" : ""} onClick={onClick} aria-current={on ? "page" : undefined}><span>{label}</span>{count != null && <span className="tm-count">{count}</span>}</button>;

  return (
    <div>
      <Navbar />
      <div className="tm-page">
        <div className="tm-head">
          <div><h1>Test Management</h1><ChalkUnderline /><p className="tm-sub">Organise your tests into folders, switch them on or off, archive them, and group them into Test Series.</p></div>
          <div className="tm-tools" style={{ margin: 0 }}>
            <Link className="btn btn-primary" to="/staff/tests/new"><Plus size={14} aria-hidden="true" /> New test</Link>
            <Link className="btn btn-ghost" to="/staff/test-management/series/new">New series</Link>
            <Link className="btn btn-ghost" to="/staff/tests/classic">Classic view</Link>
          </div>
        </div>
        <div className="tm-shell">
          <nav className="tm-nav" aria-label="Test Management">
            {navBtn("Overview", section === "overview", () => go({ s: "overview" }))}
            <h4>Tests</h4>
            {VIEWS.map(([k, label]) => navBtn(label, section === "tests" && view === k && !folder, () => go({ s: "tests", view: k }), counts[k]))}
            <h4>My folders</h4>
            {navBtn("No folder", section === "tests" && folder === "none", () => go({ s: "tests", view: "all", folder: "none" }), folders.data?.withoutFolder)}
            {(folders.data?.folders || []).map((f) => navBtn(f.name, section === "tests" && folder === f.id, () => go({ s: "tests", view: "all", folder: f.id }), f.tests))}
            {navBtn("Manage folders…", section === "folders", () => go({ s: "folders" }))}
            <h4>Series and results</h4>
            {navBtn("Test Series", section === "series", () => go({ s: "series" }), overview.data?.series?.total)}
            {navBtn("Assignments", section === "assignments", () => go({ s: "assignments" }))}
            {navBtn("Results & Analytics", section === "results", () => go({ s: "results" }))}
          </nav>
          <main>
            {overview.error && <Notice kind="bad">{overview.error}</Notice>}
            {section === "overview" && <Overview data={overview.data} go={go} />}
            {section === "tests" && <TestsPanel key={`${view}|${folder}`} view={view} folder={folder} folders={folders.data?.folders || []} onChanged={refreshAll} />}
            {section === "folders" && <FoldersPanel data={folders.data} onChanged={refreshAll} go={go} />}
            {section === "series" && <SeriesPanel onChanged={refreshAll} />}
            {section === "assignments" && <AssignmentsPanel />}
            {section === "results" && <ResultsPanel />}
          </main>
        </div>
      </div>
    </div>
  );
}

function Overview({ data, go }) {
  if (!data) return <p className="mono">Loading…</p>;
  const t = data.tests;
  const stats = [["All tests", t.all, "all"], ["Active", t.active, "active"], ["Inactive", t.inactive, "inactive"], ["Published", t.published, "published"], ["Unpublished", t.unpublished, "unpublished"], ["Starred", t.starred, "starred"], ["Archived", t.archived, "archived"]];
  return (
    <>
      <div className="tm-stats">
        {stats.map(([label, n, v]) => <button key={v} className="tm-stat" onClick={() => go({ s: "tests", view: v })}><div className="n">{n}</div><div className="tm-meta">{label}</div></button>)}
        <button className="tm-stat" onClick={() => go({ s: "series" })}><div className="n">{data.series.total}</div><div className="tm-meta">Test series ({data.series.published} published, {data.series.draft} draft)</div></button>
        <button className="tm-stat" onClick={() => go({ s: "folders" })}><div className="n">{data.folders}</div><div className="tm-meta">My folders</div></button>
      </div>
      <div className="tm-card">
        <h3 style={{ marginTop: 0 }}>How this works</h3>
        <ul className="tm-meta" style={{ lineHeight: 1.7, paddingLeft: 18 }}>
          <li><strong>Published</strong> means students may see the test. <strong>Active</strong> means it takes new attempts. A published test can be switched off without being unpublished.</li>
          <li><strong>Folders, stars and hiding</strong> are yours alone. They never change what students see, who a test is assigned to, or any result.</li>
          <li><strong>Archiving</strong> takes a test off the working lists and off student lists. Its results stay available, and you can restore it any time.</li>
          <li>A <strong>Test Series</strong> groups existing tests in an order. It never opens a test by itself: each test keeps its own schedule and assignment.</li>
        </ul>
      </div>
    </>
  );
}

// ---- the list of tests --------------------------------------------------------------------------------------------------------------------------------------------
function TestsPanel({ view, folder, folders, onChanged }) {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("updated");
  const [windowF, setWindowF] = useState("");
  const [groupId, setGroupId] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [report, setReport] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [byGroup, setByGroup] = useState(null);
  const dq = useDebounced(q);
  const options = useLoader(() => api.get("/test-management/assignment-options").then((r) => r.data), []);
  const params = useMemo(() => ({ view, q: dq || undefined, sort, window: windowF || undefined, academicGroupId: groupId || undefined, folderId: folder || undefined, page, pageSize: 25 }), [view, dq, sort, windowF, groupId, folder, page]);
  const list = useLoader(() => api.get("/test-management/tests", { params }).then((r) => r.data), [JSON.stringify(params)]);
  useEffect(() => { setPage(1); }, [dq, sort, windowF, groupId]);
  useEffect(() => { setSelected(new Set()); }, [list.data]);
  const rows = list.data?.rows || [];
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function run(action, ids, extra = {}) {
    setReport(null);
    let confirm = false;
    if (HIGH_IMPACT[action]) {
      confirm = await confirmDialog({ title: `${HIGH_IMPACT[action]} ${ids.length} test${ids.length === 1 ? "" : "s"}?`, message: action === "archive" ? "Archived tests leave your working lists and the students' lists. Results and history stay available and you can restore them." : action === "deactivate" ? "Students will not be able to start new attempts. Attempts already running and all results are kept." : action === "publish" ? "Students assigned to these tests will be able to see them." : "Students will no longer see these tests. Attempts already made and results are kept.", confirmLabel: HIGH_IMPACT[action], danger: action !== "publish" });
      if (!confirm) return;
    }
    try {
      const { data } = await api.post("/test-management/tests/bulk", { action, testIds: ids, confirm: confirm || undefined, ...extra });
      setReport(data);
      if (data.failed === 0) toast.success(`${data.succeeded} test${data.succeeded === 1 ? "" : "s"} updated.`);
      list.reload(); onChanged();
    } catch (err) { setReport({ error: errMsg(err) }); }
  }
  const one = (action, id, extra) => run(action, [id], extra);
  const selIds = [...selected];

  async function duplicate(id) {
    try { const { data } = await api.post(`/tests/${id}/duplicate`, {}); toast.success("Copy created as an unpublished draft."); list.reload(); onChanged(); if (data?.id) navigate(`/staff/tests/${data.id}/edit`); }
    catch (err) { toast.error(errMsg(err)); }
  }

  const dep = useMemo(() => [...new Map((options.data?.groups || []).map((g) => [g.departmentId, g.department])).entries()], [options.data]);
  const title = folder === "none" ? "Tests without a folder" : folder ? folders.find((f) => f.id === folder)?.name || "Folder" : VIEWS.find(([k]) => k === view)?.[1];

  return (
    <div className="tm-card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="tm-tools">
        <input type="search" placeholder="Search title, code or subject" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="updated">Recently changed</option><option value="created">Newest</option><option value="title">Title A–Z</option><option value="start">Start date</option><option value="end">End date</option></select>
        <select value={windowF} onChange={(e) => setWindowF(e.target.value)} aria-label="Window"><option value="">Any window</option><option value="OPEN">Open now</option><option value="UPCOMING">Upcoming</option><option value="CLOSED">Closed</option></select>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Academic group"><option value="">Every group</option>{dep.length > 0 && (options.data?.groups || []).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
      </div>
      {list.error && <Notice kind="bad">{list.error}</Notice>}
      {report && !report.error && <Notice kind={report.failed ? "warn" : "ok"} onClose={() => setReport(null)}>
        {report.succeeded} of {report.requested} done{report.failed ? `, ${report.failed} could not be changed:` : "."}
        {report.failed > 0 && <ul className="tm-meta" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{report.results.filter((r) => !r.ok).map((r) => <li key={r.id}><strong>{r.title || r.id}</strong>: {r.message}</li>)}</ul>}
      </Notice>}
      {report?.error && <Notice kind="bad" onClose={() => setReport(null)}>{report.error}</Notice>}
      <div className="tm-table-wrap">
        <table className="tm-table">
          <thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="Select all on this page" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th><th style={{ width: 34 }} aria-label="Starred" /><th>Test</th><th>Status</th><th>Assigned to</th><th>Window</th><th>Qs / attempts</th><th>Folder</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={selected.has(t.id) ? "sel" : ""}>
                <td><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td><button className={`tm-star ${t.starred ? "on" : ""}`} aria-label={t.starred ? "Remove star" : "Star"} aria-pressed={t.starred} onClick={() => one(t.starred ? "unstar" : "star", t.id)}>{t.starred ? "★" : "☆"}</button></td>
                <td><div className="tm-title">{t.title}</div><div className="tm-meta">{[t.code, t.subject, t.unit].filter(Boolean).join(" · ") || "—"}{!t.ownedByMe && t.owner ? ` · by ${t.owner}` : ""}{t.inSeries ? ` · in ${t.inSeries} series` : ""}</div></td>
                <td><LifecyclePills life={t.lifecycle} />{t.hidden && <span className="tm-pill off">Hidden</span>}</td>
                <td className="tm-meta">{t.assignedTo.groups + t.assignedTo.pools === 0 ? "Whole institute" : <>{t.assignedTo.labels.slice(0, 2).map((l) => <div key={l}>{l}</div>)}{t.assignedTo.groups + t.assignedTo.pools > 2 && <div>+ {t.assignedTo.groups + t.assignedTo.pools - Math.min(2, t.assignedTo.labels.length)} more</div>}</>}</td>
                <td className="tm-meta">{fmtDateTime(t.startTime)}<br />to {fmtDateTime(t.endTime)}</td>
                <td className="tm-meta">{t.questions} / {t.attempts}</td>
                <td className="tm-meta">{t.folderName || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Menu>
                    {t.canManage && <Link to={`/staff/tests/${t.id}/edit`} role="menuitem">Edit</Link>}
                    <Link to={`/staff/tests/${t.id}/preview`} role="menuitem">Preview</Link>
                    <Link to={`/staff/tests/${t.id}/results`} role="menuitem">Results</Link>
                    <button role="menuitem" onClick={() => setByGroup(t)}>Results by group</button>
                    {t.canManage && <button role="menuitem" onClick={() => duplicate(t.id)}>Duplicate</button>}
                    <hr />
                    <button role="menuitem" onClick={() => { setSelected(new Set([t.id])); setMoveOpen(true); }}>Move to folder…</button>
                    <button role="menuitem" onClick={() => one(t.hidden ? "unhide" : "hide", t.id)}>{t.hidden ? "Show again" : "Hide from my view"}</button>
                    {t.canManage && <>
                      <hr />
                      <button role="menuitem" onClick={() => one(t.lifecycle.published ? "unpublish" : "publish", t.id)}>{t.lifecycle.published ? "Unpublish" : "Publish"}</button>
                      <button role="menuitem" onClick={() => one(t.lifecycle.active ? "deactivate" : "activate", t.id)}>{t.lifecycle.active ? "Switch off (inactive)" : "Switch on (active)"}</button>
                      <button role="menuitem" onClick={() => one(t.lifecycle.archived ? "restore" : "archive", t.id)}>{t.lifecycle.archived ? "Restore from archive" : "Archive"}</button>
                    </>}
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.loading && !list.data && <p className="mono tm-empty">Loading…</p>}
      {!list.loading && rows.length === 0 && !list.error && <div className="tm-empty">{q || windowF || groupId ? "No tests match these filters." : view === "starred" ? "You have not starred any tests yet." : view === "hidden" ? "You have not hidden any tests." : view === "archived" ? "Nothing is archived." : "No tests here yet."}</div>}
      <Pager page={list.data?.page || 1} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage} />
      {selIds.length > 0 && (
        <div className="tm-bulk" role="region" aria-label="Bulk actions">
          <strong>{selIds.length} selected</strong>
          <button className="btn btn-ghost" onClick={() => setMoveOpen(true)}>Move to folder</button>
          <button className="btn btn-ghost" onClick={() => run(view === "archived" ? "restore" : "archive", selIds)}>{view === "archived" ? "Restore" : "Archive"}</button>
          <button className="btn btn-ghost" onClick={() => run(view === "inactive" ? "activate" : "deactivate", selIds)}>{view === "inactive" ? "Switch on" : "Switch off"}</button>
          <button className="btn btn-ghost" onClick={() => run(view === "unpublished" ? "publish" : "unpublish", selIds)}>{view === "unpublished" ? "Publish" : "Unpublish"}</button>
          <button className="btn btn-ghost" onClick={() => run(view === "starred" ? "unstar" : "star", selIds)}><Star size={13} aria-hidden="true" /> {view === "starred" ? "Unstar" : "Star"}</button>
          <button className="btn btn-ghost" onClick={() => run(view === "hidden" ? "unhide" : "hide", selIds)}>{view === "hidden" ? "Show again" : "Hide"}</button>
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {moveOpen && <MoveModal folders={folders} count={selIds.length} onClose={() => setMoveOpen(false)} onMove={async (folderId) => { setMoveOpen(false); await run("move", selIds, { folderId }); }} />}
      {byGroup && <ByGroupModal test={byGroup} onClose={() => setByGroup(null)} />}
    </div>
  );
}

function MoveModal({ folders, count, onClose, onMove }) {
  const [target, setTarget] = useState("");
  return (
    <div className="tm-modal-back" role="dialog" aria-modal="true" aria-label="Move to folder">
      <div className="tm-modal">
        <h3>Move {count} test{count === 1 ? "" : "s"} to a folder</h3>
        <p className="tm-meta">Moving only changes where the test appears for you. Assignments and results are not touched.</p>
        <select style={{ width: "100%", padding: 8 }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Folder">
          <option value="">No folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}{f.isArchive ? " (archive: also archives the test)" : ""}</option>)}
        </select>
        <div className="tm-tools" style={{ justifyContent: "flex-end", marginTop: 16 }}><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onMove(target || null)}>Move</button></div>
      </div>
    </div>
  );
}

function ByGroupModal({ test, onClose }) {
  const data = useLoader(() => api.get(`/test-management/tests/${test.id}/results-by-group`).then((r) => r.data), [test.id]);
  return (
    <div className="tm-modal-back" role="dialog" aria-modal="true" aria-label="Results by group">
      <div className="tm-modal" style={{ width: "min(860px,100%)" }}>
        <h3>{test.title}: results by academic group</h3>
        {data.error && <Notice kind="bad">{data.error}</Notice>}
        {data.data && (
          <>
            <div className="tm-table-wrap"><table className="tm-table"><thead><tr><th>Department · batch · section</th><th>Students</th><th>Attempted</th><th>Average score</th><th>Best</th><th>Pass rate</th></tr></thead>
              <tbody>{data.data.groups.map((g) => <tr key={g.id || "none"}><td>{g.label}</td><td>{g.students ?? "—"}</td><td>{g.attempted}</td><td>{g.averageScore ?? "—"}</td><td>{g.bestScore ?? "—"}</td><td>{g.passRate != null ? `${g.passRate}%` : "—"}</td></tr>)}</tbody></table></div>
            {data.data.groups.length === 0 && <div className="tm-empty">Nobody has attempted this test yet.</div>}
            <p className="tm-meta">{data.data.note}</p>
          </>
        )}
        {data.loading && !data.data && <p className="mono">Loading…</p>}
        <div className="tm-tools" style={{ justifyContent: "flex-end" }}><Link className="btn btn-ghost" to={`/staff/tests/${test.id}/results`}>Student-wise results</Link><button className="btn btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ---- folders -------------------------------------------------------------------------------------------------------------------------------------------------------
function FoldersPanel({ data, onChanged, go }) {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", academicYear: "", department: "", subject: "", isArchive: false });
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [scope, setScope] = useState("mine");
  const shown = useLoader(() => api.get("/test-management/folders", { params: { q: q || undefined, scope: scope === "institute" ? "institute" : undefined } }).then((r) => r.data), [q, scope, data]);
  async function create(e) {
    e.preventDefault();
    try { await api.post("/test-management/folders", form); setForm({ name: "", academicYear: "", department: "", subject: "", isArchive: false }); toast.success("Folder created."); onChanged(); }
    catch (err) { toast.error(errMsg(err)); }
  }
  async function rename(f) {
    if (!renaming?.name.trim()) return;
    try { await api.patch(`/test-management/folders/${f.id}`, { name: renaming.name }); setRenaming(null); onChanged(); } catch (err) { toast.error(errMsg(err)); }
  }
  async function remove(f) {
    const ok = await confirmDialog({ title: `Delete the folder "${f.name}"?`, message: `The ${f.tests + f.archivedTests} test(s) in it are NOT deleted. They go back to "No folder" and stay in All Tests.`, confirmLabel: "Delete folder", danger: true });
    if (!ok) return;
    try { await api.delete(`/test-management/folders/${f.id}`); toast.success("Folder deleted. Its tests are untouched."); onChanged(); } catch (err) { toast.error(errMsg(err)); }
  }
  return (
    <div className="tm-card">
      <h2 style={{ marginTop: 0 }}>My folders</h2>
      <form className="tm-form" onSubmit={create}>
        <div className="tm-two">
          <div><label htmlFor="f-name">New folder</label><input id="f-name" type="text" required maxLength={60} placeholder="e.g. CSE Internal Assessments" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label htmlFor="f-year">Academic year (optional)</label><input id="f-year" type="text" value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} /></div>
          <div><label htmlFor="f-dep">Department (optional)</label><input id="f-dep" type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div><label htmlFor="f-sub">Subject (optional)</label><input id="f-sub" type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
        </div>
        <label style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: "auto" }} checked={form.isArchive} onChange={(e) => setForm({ ...form, isArchive: e.target.checked })} /> This is an archive folder: tests filed into it are also archived</label>
        <button className="btn btn-primary" style={{ marginTop: 10 }}><FolderPlus size={14} aria-hidden="true" /> Create folder</button>
        <p className="tm-meta">Folders are yours. Department and subject labels only help you search; they never grant or limit access to anything.</p>
      </form>
      <div className="tm-tools" style={{ marginTop: 16 }}>
        <input type="search" placeholder="Search folders" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search folders" />
        {scope !== undefined && <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Whose folders"><option value="mine">My folders</option><option value="institute">Whole institute (administrators)</option></select>}
      </div>
      {shown.error && <Notice kind="bad">{shown.error}</Notice>}
      <table className="tm-table"><thead><tr><th>Folder</th><th>Labels</th><th>Tests</th><th>Archived</th><th>Owner</th><th /></tr></thead>
        <tbody>
          {(shown.data?.folders || []).map((f) => (
            <tr key={f.id}>
              <td>{renaming?.id === f.id ? <input type="text" value={renaming.name} onChange={(e) => setRenaming({ id: f.id, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && rename(f)} autoFocus aria-label="Folder name" /> : <button className="btn btn-ghost" style={{ padding: "2px 6px" }} onClick={() => f.mine && go({ s: "tests", view: "all", folder: f.id })}>{f.name}</button>}{f.isArchive && <span className="tm-pill off">Archive</span>}</td>
              <td className="tm-meta">{[f.academicYear, f.department, f.subject].filter(Boolean).join(" · ") || "—"}</td>
              <td>{f.tests}</td><td>{f.archivedTests}</td><td className="tm-meta">{f.mine ? "You" : f.owner}</td>
              <td style={{ whiteSpace: "nowrap" }}>{f.mine && (renaming?.id === f.id ? <><button className="btn btn-primary" onClick={() => rename(f)}>Save</button> <button className="btn btn-ghost" onClick={() => setRenaming(null)}>Cancel</button></> : <><button className="btn btn-ghost" onClick={() => setRenaming({ id: f.id, name: f.name })}>Rename</button> <button className="btn btn-ghost" onClick={() => remove(f)}>Delete</button></>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.data && shown.data.folders.length === 0 && <div className="tm-empty">No folders yet. Create one above, then move tests into it from the list.</div>}
    </div>
  );
}

// ---- series --------------------------------------------------------------------------------------------------------------------------------------------------------
function SeriesPanel({ onChanged }) {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useLoader(() => api.get("/test-management/series", { params: { status, q: dq || undefined, page } }).then((r) => r.data), [status, dq, page]);
  async function act(s, action, ask) {
    if (ask && !(await confirmDialog({ title: ask.title, message: ask.message, confirmLabel: ask.label, danger: ask.danger }))) return;
    try { await api.post(`/test-management/series/${s.id}/action/${action}`); list.reload(); onChanged(); } catch (err) { toast.error(errMsg(err)); }
  }
  return (
    <div className="tm-card">
      <div className="tm-head" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>Test Series</h2><Link className="btn btn-primary" to="/staff/test-management/series/new"><Plus size={14} aria-hidden="true" /> New series</Link></div>
      <div className="tm-tools">
        <input type="search" placeholder="Search series" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search series" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="all">All (not archived)</option><option value="draft">Drafts</option><option value="published">Published</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select>
      </div>
      {list.error && <Notice kind="bad">{list.error}</Notice>}
      <div className="tm-series-grid">
        {(list.data?.rows || []).map((s) => (
          <div key={s.id} className="tm-card tm-series">
            <div className="tm-title">{s.title}</div>
            <div className="tm-meta">{[s.subject, s.difficulty].filter(Boolean).join(" · ")}{s.owner ? ` · by ${s.owner}` : ""}</div>
            <div><span className={`tm-pill ${s.lifecycle.published ? "ok" : "warn"}`}>{s.lifecycle.published ? "Published" : "Draft"}</span><span className={`tm-pill ${s.lifecycle.active ? "ok" : "bad"}`}>{s.lifecycle.active ? "Active" : "Inactive"}</span>{s.lifecycle.archived && <span className="tm-pill off">Archived</span>}<span className="tm-pill off">{s.accessMode === "SEQUENTIAL" ? "Sequential" : "Flexible"}</span></div>
            <div className="tm-meta">{s.tests} tests · {s.assignments} assignment{s.assignments === 1 ? "" : "s"} · updated {fmtDate(s.updatedAt)}</div>
            <div className="tm-tools" style={{ margin: 0 }}>
              <Link className="btn btn-ghost" to={`/staff/test-management/series/${s.id}`}>Edit</Link>
              <Link className="btn btn-ghost" to={`/staff/test-management/series/${s.id}/assign`}>Assign</Link>
              <Link className="btn btn-ghost" to={`/staff/test-management/series/${s.id}/report`}>Progress</Link>
              <Menu label="More">
                {s.lifecycle.published ? <button role="menuitem" onClick={() => act(s, "unpublish", { title: "Unpublish this series?", message: "Students will no longer see it. Their attempts and results are kept.", label: "Unpublish" })}>Unpublish</button> : <button role="menuitem" onClick={() => act(s, "publish")}>Publish</button>}
                <button role="menuitem" onClick={() => act(s, s.lifecycle.active ? "deactivate" : "activate")}>{s.lifecycle.active ? "Switch off" : "Switch on"}</button>
                <button role="menuitem" onClick={() => act(s, s.lifecycle.archived ? "restore" : "archive", s.lifecycle.archived ? null : { title: "Archive this series?", message: "It leaves the working lists and the students' lists. Nothing is deleted.", label: "Archive", danger: true })}>{s.lifecycle.archived ? "Restore" : "Archive"}</button>
              </Menu>
            </div>
          </div>
        ))}
      </div>
      {!list.loading && list.data?.rows.length === 0 && <div className="tm-empty">No series yet. A series puts existing tests in an order and gives them to a group together.</div>}
      <Pager page={list.data?.page || 1} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage} />
    </div>
  );
}

function AssignmentsPanel() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [page, setPage] = useState(1);
  const list = useLoader(() => api.get("/test-management/assignments", { params: { page } }).then((r) => r.data), [page]);
  const reasons = { NOT_STARTED: "Not started", EXPIRED: "Expired", INACTIVE: "Series off", UNPUBLISHED: "Draft", ARCHIVED: "Archived", ASSIGNMENT_INACTIVE: "Switched off" };
  async function toggle(a) {
    try { await api.patch(`/test-management/series/${a.seriesId}/assignments/${a.id}`, { isActive: !a.isActive }); list.reload(); } catch (err) { toast.error(errMsg(err)); }
  }
  async function remove(a) {
    if (!(await confirmDialog({ title: "Remove this assignment?", message: `${a.target} will no longer receive "${a.series}". Attempts and results already made are kept.`, confirmLabel: "Remove", danger: true }))) return;
    try { await api.delete(`/test-management/series/${a.seriesId}/assignments/${a.id}`); list.reload(); } catch (err) { toast.error(errMsg(err)); }
  }
  return (
    <div className="tm-card">
      <h2 style={{ marginTop: 0 }}>Assignments</h2>
      <p className="tm-meta">Each row is one series given to one academic group or Talent Pool, with its own window. The same series can have different windows for different groups.</p>
      {list.error && <Notice kind="bad">{list.error}</Notice>}
      <div className="tm-table-wrap"><table className="tm-table"><thead><tr><th>Series</th><th>Assigned to</th><th>Students</th><th>Opens</th><th>Closes</th><th>Status</th><th /></tr></thead>
        <tbody>{(list.data?.rows || []).map((a) => (
          <tr key={a.id}>
            <td><Link to={`/staff/test-management/series/${a.seriesId}`}>{a.series}</Link></td>
            <td>{a.target} <span className="tm-meta">({a.type === "TALENT_POOL" ? "Talent Pool" : "Academic group"})</span></td>
            <td>{a.students ?? "—"}</td><td className="tm-meta">{fmtDateTime(a.startAt)}</td>
            <td className="tm-meta">{a.noExpiry ? <strong>No Expiry</strong> : fmtDateTime(a.endAt)}{a.completionDeadline ? <><br />complete by {fmtDateTime(a.completionDeadline)}</> : null}</td>
            <td><span className={`tm-pill ${a.availability.available ? "ok" : "warn"}`}>{a.availability.available ? "Open" : reasons[a.availability.reason] || a.availability.reason}</span></td>
            <td style={{ whiteSpace: "nowrap" }}><button className="btn btn-ghost" onClick={() => toggle(a)}>{a.isActive ? "Switch off" : "Switch on"}</button> <button className="btn btn-ghost" onClick={() => remove(a)}>Remove</button></td>
          </tr>))}</tbody></table></div>
      {!list.loading && list.data?.rows.length === 0 && <div className="tm-empty">No series has been assigned yet. Open a series and choose Assign.</div>}
      <Pager page={list.data?.page || 1} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage} />
    </div>
  );
}

function ResultsPanel() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const tests = useLoader(() => api.get("/test-management/tests", { params: { view: "all", hasAttempts: "1", q: dq || undefined, page, pageSize: 15, sort: "end" } }).then((r) => r.data), [dq, page]);
  const archived = useLoader(() => api.get("/test-management/tests", { params: { view: "archived", hasAttempts: "1", pageSize: 10 } }).then((r) => r.data), []);
  const series = useLoader(() => api.get("/test-management/series", { params: { status: "published", pageSize: 20 } }).then((r) => r.data), []);
  const [byGroup, setByGroup] = useState(null);
  const Row = ({ t }) => <tr><td><div className="tm-title">{t.title}</div><div className="tm-meta">{[t.subject, t.unit].filter(Boolean).join(" · ")}</div></td><td><LifecyclePills life={t.lifecycle} /></td><td>{t.attempts}</td><td style={{ whiteSpace: "nowrap" }}><Link className="btn btn-ghost" to={`/staff/tests/${t.id}/results`}>Student-wise</Link> <button className="btn btn-ghost" onClick={() => setByGroup(t)}>By group</button></td></tr>;
  return (
    <>
      <div className="tm-card">
        <h2 style={{ marginTop: 0 }}>Results & Analytics: tests</h2>
        <p className="tm-meta">Results stay exactly as recorded when a test is switched off, moved, archived or added to a series. Group results are shown one academic group at a time, never merged.</p>
        <div className="tm-tools"><input type="search" placeholder="Search tests with attempts" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" /></div>
        {tests.error && <Notice kind="bad">{tests.error}</Notice>}
        <div className="tm-table-wrap"><table className="tm-table"><thead><tr><th>Test</th><th>Status</th><th>Attempts</th><th /></tr></thead><tbody>{(tests.data?.rows || []).map((t) => <Row key={t.id} t={t} />)}</tbody></table></div>
        {!tests.loading && tests.data?.rows.length === 0 && <div className="tm-empty">No test has been attempted yet.</div>}
        <Pager page={tests.data?.page || 1} totalPages={tests.data?.totalPages} total={tests.data?.total} onPage={setPage} />
      </div>
      {archived.data?.rows.length > 0 && <div className="tm-card" style={{ marginTop: 14 }}><h3 style={{ marginTop: 0 }}>Archived tests with results</h3><div className="tm-table-wrap"><table className="tm-table"><tbody>{archived.data.rows.map((t) => <Row key={t.id} t={t} />)}</tbody></table></div></div>}
      <div className="tm-card" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Test Series progress</h3>
        <table className="tm-table"><tbody>{(series.data?.rows || []).map((s) => <tr key={s.id}><td className="tm-title">{s.title}</td><td className="tm-meta">{s.tests} tests · {s.assignments} assignments</td><td><Link className="btn btn-ghost" to={`/staff/test-management/series/${s.id}/report`}>Progress & export</Link></td></tr>)}</tbody></table>
        {series.data?.rows.length === 0 && <div className="tm-empty">No published series yet.</div>}
      </div>
      {byGroup && <ByGroupModal test={byGroup} onClose={() => setByGroup(null)} />}
    </>
  );
}
