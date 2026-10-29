import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar";
import { examErrorMessage } from "../../utils/examProgress";
import "./exam.css";

const SECTION_META = [
  { key: "APTITUDE", label: "A · Aptitude" },
  { key: "TECHNICAL", label: "B · Technical" },
  { key: "CODING", label: "C · Coding" },
  { key: "AI_INTERVIEW", label: "D · AI Mock Interview" },
];
const APT_CATS = [["QUANTITATIVE", "Quantitative"], ["LOGICAL", "Logical"], ["VERBAL", "Verbal"], ["DATA_INTERPRETATION", "Data interpretation"]];
const LANGS = ["java", "python", "javascript", "c", "cpp"];

const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (local) => (local ? new Date(local).toISOString() : "");

function newBlueprint() {
  const start = new Date(Date.now() + 24 * 3600e3); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600e3);
  const sec = (key, order, maxMarks, questionCount, extra) => ({ key, order, maxMarks, questionCount, navigation: "FREE", answerEditing: "EDITABLE_UNTIL_SECTION_SUBMIT", requireAllAnswered: false, shuffleOptions: true, ...extra });
  return {
    title: "", mode: "PROCTORED", practiceEnabled: true, startAt: start.toISOString(), endAt: end.toISOString(), durationMin: 120, graceSec: 0, passingMarks: 40, timingPolicy: "OVERALL_ONLY", resultVisibility: "AFTER_PUBLISH",
    sections: [
      sec("APTITUDE", 1, 25, 10, { source: { distribution: [{ category: "QUANTITATIVE", count: 5 }, { category: "LOGICAL", count: 5 }] } }),
      sec("TECHNICAL", 2, 25, 10, { source: { subjects: [] } }),
      sec("CODING", 3, 30, 1, { source: { questionIds: [], allowedLanguages: ["java", "python", "cpp"] }, maxSubmissionsPerProblem: 5 }),
      sec("AI_INTERVIEW", 4, 20, 3, { interview: { category: "HR", difficulty: "MEDIUM", answerInput: "TYPED_OR_SPEECH", speechToText: true, cameraRequired: true, rubricVersion: "hr-v1", evaluationMode: "RULES" } }),
    ],
    proctoring: { cameraRequired: true, microphoneRequired: true, fullscreenRequired: true, autoSubmitOnExpiry: true, reviewRequired: true, maxWarnings: 3, networkGraceSec: 30, cameraLossPolicy: "WARN", evidenceRetentionDays: 30 },
  };
}

// Creating and editing a section-wise examination. The page only edits the configuration; every rule (enough valid questions, marks that add up, locked fields once students have
// started) is checked by the server, and its messages are shown beside the fields they belong to.
export default function ExamEditor() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [bp, setBp] = useState(newBlueprint);
  const [description, setDescription] = useState("");
  const [groupIds, setGroupIds] = useState([]);
  const [groups, setGroups] = useState([]);
  const [src, setSrc] = useState({ subjects: [], aptitudeCounts: [], codingQuestions: [] });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [version, setVersion] = useState(0);
  const [check, setCheck] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!examId);

  useEffect(() => { api.get("/academic-groups").then((r) => setGroups(Array.isArray(r.data) ? r.data : r.data?.groups || [])).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => api.get("/exams/admin/sources", { params: search ? { search } : {} }).then((r) => setSrc(r.data)).catch(() => {}), search ? 300 : 0); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    if (!examId) return;
    api.get(`/exams/admin/exams/${examId}`).then((r) => {
      const e = r.data.exam;
      setBp({ ...newBlueprint(), ...e.blueprint }); setDescription(e.description || ""); setGroupIds(e.academicGroupIds || []); setStatus(e.status); setVersion(e.version); setCheck(r.data.validation); setLoaded(true);
    }).catch((e) => setMsg({ ok: false, text: examErrorMessage(e, "Could not load the examination.") }));
  }, [examId]);

  const sectionOf = (k) => bp.sections.find((s) => s.key === k);
  const setSection = (k, patch) => setBp((b) => ({ ...b, sections: b.sections.map((s) => (s.key === k ? { ...s, ...patch } : s)) }));
  const setSource = (k, patch) => setSection(k, { source: { ...sectionOf(k).source, ...patch } });
  const setInterview = (patch) => setSection("AI_INTERVIEW", { interview: { ...sectionOf("AI_INTERVIEW").interview, ...patch } });
  const set = (patch) => setBp((b) => ({ ...b, ...patch }));
  const setProc = (patch) => setBp((b) => ({ ...b, proctoring: { ...b.proctoring, ...patch } }));
  const errorsFor = (prefix) => (check?.errors || []).filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`) || e.path.startsWith(`${prefix}[`));
  const totalMarks = useMemo(() => Math.round(bp.sections.reduce((a, s) => a + (Number(s.maxMarks) || 0), 0) * 100) / 100, [bp.sections]);

  // The counts follow from what was chosen, so they can never disagree with it.
  function payload() {
    const sections = bp.sections.map((s) => {
      const out = { ...s, maxMarks: Number(s.maxMarks), durationMin: s.durationMin ? Number(s.durationMin) : undefined };
      if (s.key === "APTITUDE") out.questionCount = (s.source.distribution || []).reduce((a, x) => a + (Number(x.count) || 0), 0);
      if (s.key === "TECHNICAL") out.questionCount = (s.source.subjects || []).reduce((a, x) => a + (Number(x.count) || 0), 0);
      if (s.key === "CODING") out.questionCount = (s.source.questionIds || []).length;
      if (s.key === "AI_INTERVIEW") out.questionCount = Number(s.questionCount);
      return out;
    });
    return { ...bp, sections, totalMarks, durationMin: Number(bp.durationMin), graceSec: Number(bp.graceSec) || 0, passingMarks: bp.passingMarks === "" || bp.passingMarks == null ? undefined : Number(bp.passingMarks) };
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      let r;
      if (examId) r = await api.put(`/exams/admin/exams/${examId}`, { blueprint: payload(), description, academicGroupIds: groupIds });
      else r = await api.post("/exams/admin/exams", { blueprint: payload(), description, academicGroupIds: groupIds });
      setCheck(r.data.validation);
      setMsg({ ok: true, text: r.data.validation.valid ? "Saved. The configuration is valid." : `Saved as a draft. ${r.data.validation.errors.length} thing(s) to fix before it can be published.` });
      if (!examId) navigate(`/exam-admin/${r.data.exam.id}/edit`, { replace: true });
      else if (r.data.changedSincePublished?.length) setMsg({ ok: true, text: `Saved. These settings changed since the published version and apply to a new publish only: ${r.data.changedSincePublished.join(", ")}.` });
    } catch (e) { setMsg({ ok: false, text: examErrorMessage(e) + (e.response?.data?.details ? ` ${JSON.stringify(e.response.data.details)}` : "") }); } finally { setBusy(false); }
  }
  async function validate() {
    if (!examId) return save();
    setBusy(true); setMsg(null);
    try { const { data } = await api.post(`/exams/admin/exams/${examId}/validate`, {}); setCheck(data); } catch (e) { setMsg({ ok: false, text: examErrorMessage(e) }); } finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setMsg(null);
    try {
      await api.put(`/exams/admin/exams/${examId}`, { blueprint: payload(), description, academicGroupIds: groupIds });
      const { data } = await api.post(`/exams/admin/exams/${examId}/publish`, {});
      setStatus("PUBLISHED"); setVersion(data.version?.version ?? version + 1);
      setMsg({ ok: true, text: `Published${data.invalidQuestionsExcluded ? `. ${data.invalidQuestionsExcluded} question(s) without a valid answer key are excluded from papers` : ""}.` });
    } catch (e) {
      const d = e.response?.data;
      setMsg({ ok: false, text: examErrorMessage(e) });
      if (d?.errors || d?.shortages) setCheck((c) => ({ ...(c || {}), valid: false, errors: d.errors || c?.errors || [], shortages: d.shortages }));
    } finally { setBusy(false); }
  }

  if (!loaded) return <div><Navbar /><div className="ex-page"><p className="mono">Loading…</p></div></div>;
  const apt = sectionOf("APTITUDE"), tech = sectionOf("TECHNICAL"), cod = sectionOf("CODING"), iv = sectionOf("AI_INTERVIEW");
  const Err = ({ prefix }) => errorsFor(prefix).map((e, i) => <div key={i} className="ex-notice bad" role="alert">{e.message}</div>);

  return (
    <div>
      <Navbar />
      <div className="ex-page">
        <div className="ex-head">
          <div><h1>{examId ? "Edit section exam" : "New section exam"}</h1><p className="ex-sub">Aptitude, Technical, Coding and AI Mock Interview in one attempt. {examId && <span className="ex-chip">{status}{version ? ` · v${version}` : ""}</span>}</p></div>
          <Link to="/exam-admin" className="btn btn-ghost">← All section exams</Link>
        </div>

        <div className="ex-card ex-form">
          <h3>General</h3>
          <label htmlFor="ex-title">Title</label><input id="ex-title" type="text" value={bp.title} onChange={(e) => set({ title: e.target.value })} /><Err prefix="title" />
          <label htmlFor="ex-desc">Description (shown to students)</label><textarea id="ex-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="ex-two">
            <div><label>Mode</label><select value={bp.mode} onChange={(e) => set({ mode: e.target.value })}><option value="PROCTORED">Official (proctored, one attempt)</option><option value="PRACTICE">Practice only</option></select></div>
            <div><label>Practice attempts</label><select value={bp.practiceEnabled ? "1" : "0"} onChange={(e) => set({ practiceEnabled: e.target.value === "1" })}><option value="1">Allowed (unofficial)</option><option value="0">Not allowed</option></select></div>
            <div><label>Opens</label><input type="datetime-local" value={toLocal(bp.startAt)} onChange={(e) => set({ startAt: toIso(e.target.value) })} /></div>
            <div><label>Closes</label><input type="datetime-local" value={toLocal(bp.endAt)} onChange={(e) => set({ endAt: toIso(e.target.value) })} /></div>
            <div><label>Duration (minutes)</label><input type="number" min="1" value={bp.durationMin} onChange={(e) => set({ durationMin: e.target.value })} /></div>
            <div><label>Grace after time (seconds)</label><input type="number" min="0" value={bp.graceSec} onChange={(e) => set({ graceSec: e.target.value })} /></div>
            <div><label>Passing marks (of {totalMarks})</label><input type="number" min="0" step="0.5" value={bp.passingMarks ?? ""} onChange={(e) => set({ passingMarks: e.target.value })} /></div>
            <div><label>Timers</label><select value={bp.timingPolicy} onChange={(e) => set({ timingPolicy: e.target.value })}><option value="OVERALL_ONLY">Overall timer only</option><option value="OVERALL_AND_SECTION">Overall and per-section timers</option></select></div>
            <div><label>Results</label><select value={bp.resultVisibility} onChange={(e) => set({ resultVisibility: e.target.value })}><option value="AFTER_PUBLISH">Shown after I publish</option><option value="IMMEDIATE">Shown as soon as final</option></select></div>
          </div>
          <Err prefix="startAt" /><Err prefix="endAt" /><Err prefix="durationMin" /><Err prefix="passingMarks" /><Err prefix="passingPercent" /><Err prefix="totalMarks" /><Err prefix="timingPolicy" />
          <label>Who can take it (leave empty for every student of the institute)</label>
          <select multiple size={Math.min(6, Math.max(3, groups.length))} value={groupIds} onChange={(e) => setGroupIds([...e.target.selectedOptions].map((o) => o.value))}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name || [g.department?.name, g.batch, g.section].filter(Boolean).join(" · ")}</option>)}
          </select>
        </div>

        {SECTION_META.map(({ key, label }) => {
          const s = sectionOf(key);
          return (
            <div key={key} className="ex-card ex-form">
              <h3>{label}</h3>
              <div className="ex-two">
                <div><label>Marks</label><input type="number" min="0" step="0.5" value={s.maxMarks} onChange={(e) => setSection(key, { maxMarks: e.target.value })} /></div>
                {bp.timingPolicy === "OVERALL_AND_SECTION" && <div><label>Section minutes</label><input type="number" min="1" value={s.durationMin ?? ""} onChange={(e) => setSection(key, { durationMin: e.target.value })} /></div>}
                <div><label>Navigation</label><select value={s.navigation} onChange={(e) => setSection(key, { navigation: e.target.value })}><option value="FREE">Move freely</option><option value="FORWARD_ONLY">Forward only</option></select></div>
                <div><label>Changing answers</label><select value={s.answerEditing} onChange={(e) => setSection(key, { answerEditing: e.target.value })}><option value="EDITABLE_UNTIL_SECTION_SUBMIT">Until the section is submitted</option><option value="LOCKED_AFTER_NEXT">Locked after Next</option><option value="LOCKED_AFTER_SAVE">Locked once saved</option></select></div>
                <div><label>Every question required</label><select value={s.requireAllAnswered ? "1" : "0"} onChange={(e) => setSection(key, { requireAllAnswered: e.target.value === "1" })}><option value="0">No, skipping is allowed</option><option value="1">Yes</option></select></div>
              </div>
              <label>Instructions shown before the section (optional)</label>
              <textarea rows={2} value={s.instructions || ""} onChange={(e) => setSection(key, { instructions: e.target.value })} />
              <Err prefix={`sections[${bp.sections.indexOf(s)}]`} />

              {key === "APTITUDE" && (
                <>
                  <label>Questions per topic</label>
                  <div className="ex-two">{APT_CATS.map(([c, name]) => {
                    const row = (apt.source.distribution || []).find((x) => x.category === c);
                    const avail = src.aptitudeCounts.find((x) => x.category === c)?.count;
                    return <div key={c}><span className="ex-sub">{name} ({avail ?? 0} in bank)</span><input type="number" min="0" value={row?.count ?? 0} onChange={(e) => { const n = Number(e.target.value) || 0; const rest = (apt.source.distribution || []).filter((x) => x.category !== c); setSource("APTITUDE", { distribution: n > 0 ? [...rest, { category: c, count: n }] : rest }); }} /></div>;
                  })}</div>
                </>
              )}
              {key === "TECHNICAL" && (
                <>
                  <label>Subjects and how many questions from each</label>
                  {(tech.source.subjects || []).map((row, i) => (
                    <div key={i} className="ex-row" style={{ marginBottom: 6 }}>
                      <select value={row.subjectId} onChange={(e) => setSource("TECHNICAL", { subjects: tech.source.subjects.map((x, j) => (j === i ? { ...x, subjectId: e.target.value } : x)) })}><option value="">Choose a subject…</option>{src.subjects.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}</select>
                      <input type="number" min="1" style={{ maxWidth: 90 }} value={row.count} onChange={(e) => setSource("TECHNICAL", { subjects: tech.source.subjects.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) || 0 } : x)) })} />
                      <button type="button" className="btn btn-ghost" onClick={() => setSource("TECHNICAL", { subjects: tech.source.subjects.filter((_, j) => j !== i) })}>Remove</button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-ghost" onClick={() => setSource("TECHNICAL", { subjects: [...(tech.source.subjects || []), { subjectId: "", count: 5 }] })}>+ Add subject</button>
                </>
              )}
              {key === "CODING" && (
                <>
                  <label>Coding problems ({(cod.source.questionIds || []).length} chosen)</label>
                  <input type="text" placeholder="Search published coding problems…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <div style={{ maxHeight: 220, overflow: "auto", marginTop: 6 }}>
                    {src.codingQuestions.map((q) => {
                      const on = (cod.source.questionIds || []).includes(q.id);
                      return <label key={q.id} style={{ fontWeight: 400, display: "flex", gap: 8 }}><input type="checkbox" checked={on} onChange={() => setSource("CODING", { questionIds: on ? cod.source.questionIds.filter((x) => x !== q.id) : [...(cod.source.questionIds || []), q.id] })} />#{q.questionNumber} {q.title} <span className="ex-chip">{q.difficulty}</span></label>;
                    })}
                  </div>
                  <label>Languages allowed</label>
                  <div className="ex-row">{LANGS.map((l) => <label key={l} style={{ fontWeight: 400 }}><input type="checkbox" checked={(cod.source.allowedLanguages || []).includes(l)} onChange={(e) => setSource("CODING", { allowedLanguages: e.target.checked ? [...(cod.source.allowedLanguages || []), l] : (cod.source.allowedLanguages || []).filter((x) => x !== l) })} /> {l}</label>)}</div>
                  <label>Submissions allowed per problem (empty for no limit)</label>
                  <input type="number" min="1" value={cod.maxSubmissionsPerProblem ?? ""} onChange={(e) => setSection("CODING", { maxSubmissionsPerProblem: e.target.value ? Number(e.target.value) : undefined })} />
                </>
              )}
              {key === "AI_INTERVIEW" && (
                <>
                  <div className="ex-two">
                    <div><label>Questions</label><input type="number" min="1" value={iv.questionCount} onChange={(e) => setSection("AI_INTERVIEW", { questionCount: e.target.value })} /></div>
                    <div><label>Category</label><select value={iv.interview.category} onChange={(e) => setInterview({ category: e.target.value })}>{["HR", "TECHNICAL", "BEHAVIORAL", "SITUATIONAL", "PROJECT", "ROLE_SPECIFIC"].map((c) => <option key={c}>{c}</option>)}</select></div>
                    <div><label>Difficulty</label><select value={iv.interview.difficulty} onChange={(e) => setInterview({ difficulty: e.target.value })}>{["EASY", "MEDIUM", "HARD"].map((c) => <option key={c}>{c}</option>)}</select></div>
                    <div><label>Answer input</label><select value={iv.interview.answerInput} onChange={(e) => setInterview({ answerInput: e.target.value })}><option value="TYPED">Typed</option><option value="SPEECH">Spoken (text is transcribed)</option><option value="TYPED_OR_SPEECH">Typed or spoken</option></select></div>
                    <div><label>Evaluation</label><select value={iv.interview.evaluationMode} onChange={(e) => setInterview({ evaluationMode: e.target.value })}><option value="RULES">Fixed rubric (no AI needed)</option><option value="AI">AI, falling back to pending if unavailable</option></select></div>
                    <div><label>Rubric version</label><input type="text" value={iv.interview.rubricVersion} onChange={(e) => setInterview({ rubricVersion: e.target.value })} /></div>
                  </div>
                  <div className="ex-row" style={{ marginTop: 8 }}>
                    <label style={{ fontWeight: 400 }}><input type="checkbox" checked={!!iv.interview.speechToText} onChange={(e) => setInterview({ speechToText: e.target.checked })} /> Speech-to-text available</label>
                    <label style={{ fontWeight: 400 }}><input type="checkbox" checked={!!iv.interview.cameraRequired} onChange={(e) => setInterview({ cameraRequired: e.target.checked })} /> Camera required</label>
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="ex-card ex-form">
          <h3>Proctoring (official attempts)</h3>
          <div className="ex-row">
            {[["cameraRequired", "Camera"], ["microphoneRequired", "Microphone"], ["fullscreenRequired", "Fullscreen"], ["autoSubmitOnExpiry", "Submit saved answers when time ends"], ["reviewRequired", "A person reviews flagged events before results are final"]].map(([k, l]) => <label key={k} style={{ fontWeight: 400 }}><input type="checkbox" checked={!!bp.proctoring[k]} onChange={(e) => setProc({ [k]: e.target.checked })} /> {l}</label>)}
          </div>
          <div className="ex-two">
            <div><label>Warnings before review flag</label><input type="number" min="1" value={bp.proctoring.maxWarnings} onChange={(e) => setProc({ maxWarnings: Number(e.target.value) })} /></div>
            <div><label>Network grace (seconds)</label><input type="number" min="0" value={bp.proctoring.networkGraceSec} onChange={(e) => setProc({ networkGraceSec: Number(e.target.value) })} /></div>
            <div><label>If the camera is lost</label><select value={bp.proctoring.cameraLossPolicy} onChange={(e) => setProc({ cameraLossPolicy: e.target.value })}><option value="WARN">Warn</option><option value="STRIKE">Count as a warning</option><option value="BLOCK_UNTIL_RESTORED">Block until restored</option></select></div>
          </div>
          <p className="ex-sub">Events are recorded for review. They never fail or end an attempt on their own.</p>
          <Err prefix="proctoring" />
        </div>

        {check && (
          <div className="ex-card">
            <h3>Checks</h3>
            {check.valid ? <div className="ex-notice ok">The configuration is valid.</div> : <div className="ex-notice bad">{check.errors?.length || 0} problem(s) to fix.</div>}
            {(check.errors || []).length > 0 && <ul className="ex-list">{check.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>}
            {(check.warnings || []).length > 0 && <ul className="ex-list">{check.warnings.map((e, i) => <li key={i} className="ex-muted">{e.message}</li>)}</ul>}
            {(check.shortages || []).length > 0 && (
              <div className="ex-notice warn"><strong>Not enough valid questions yet:</strong><ul className="ex-list">{check.shortages.map((s, i) => <li key={i}>{s.message || `${s.section}: need ${s.needed}, have ${s.available}${s.label ? ` (${s.label})` : ""}`}</li>)}</ul>Add questions to the bank, then check again. Nothing is invented to fill the gap.</div>
            )}
            {check.invalidQuestionsExcluded > 0 && <p className="ex-sub">{check.invalidQuestionsExcluded} question(s) have no valid answer key and are never used.</p>}
          </div>
        )}
        {msg && <div className={`ex-notice ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
        <div className="ex-row" style={{ position: "sticky", bottom: 0, background: "var(--bg, #fff)", padding: "10px 0" }}>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Working…" : "Save"}</button>
          {examId && <button className="btn btn-ghost" disabled={busy} onClick={validate}>Check availability</button>}
          {examId && <button className="btn btn-ghost" disabled={busy} onClick={publish}>{status === "PUBLISHED" ? "Publish changes" : "Publish"}</button>}
          {examId && <Link className="btn btn-ghost" to={`/exam-admin/${examId}/results`}>Results</Link>}
        </div>
      </div>
    </div>
  );
}
