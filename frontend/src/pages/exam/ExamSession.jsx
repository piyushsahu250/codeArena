import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../../api";
import Navbar from "../../components/Navbar";
import ReadinessChecklist from "../../components/ReadinessChecklist";
import ExamMcqQuestion from "../../components/exam/ExamMcqQuestion";
import ExamCodingProblem from "../../components/exam/ExamCodingProblem";
import ExamInterviewQuestion from "../../components/exam/ExamInterviewQuestion";
import { useProctoring } from "../../hooks/useProctoring";
import { useAnswerDictation } from "../../hooks/useAnswerDictation";
import { useExamNavigationGuard } from "../../hooks/useExamNavigationGuard";
import { useExamSession, rememberExamSession, recallExamSession } from "../../hooks/useExamSession";
import { getFullscreenElement } from "../../utils/fullscreenCompat";
import { mergeTranscript, SPEECH_LANG } from "../../utils/browserSpeech";
import { createExamAnswerSaver } from "../../utils/examAnswerSaver";
import { clockOffset, secondsUntil, formatClock, timerTone } from "../../utils/examClock";
import { countAnswered, reviewSummary, sectionState, nextOpenable, allSectionsDone, examErrorMessage } from "../../utils/examProgress";
import "./exam.css";

const LABEL = { TAB_SWITCH: "You left the examination tab", FULLSCREEN_EXIT: "You left fullscreen", COPY_ATTEMPT: "Copying is not allowed", PASTE_ATTEMPT: "Pasting is not allowed", NAVIGATION_ATTEMPT: "Leaving the page is not allowed" };
const FINISHED = ["SUBMITTED", "EXPIRED", "EVALUATING", "COMPLETED", "INVALIDATED"];

// The examination page. The server owns the clock, the section order, the answers' versions and every decision about what is allowed; this page shows them, saves what the student does
// and reports what the browser sees. Nothing here can extend a timer, reopen a section or choose a score.
export default function ExamSession() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { replaced, setSession } = useExamSession();

  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | readiness | gate | active | finished
  const [drafts, setDrafts] = useState({});
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [saveState, setSaveState] = useState("idle");
  const [dialog, setDialog] = useState(null); // { type: "complete" | "submit" }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [warning, setWarning] = useState(null);
  const [ready, setReady] = useState(false);
  const draftsRef = useRef({});
  const viewRef = useRef(null);
  const refreshingRef = useRef(false);
  const finishedRef = useRef(false);

  const proctored = view?.attempt?.mode === "PROCTORED";
  const policy = view?.policy?.proctoring || null;
  const current = view?.current || null;
  const openSection = view?.sections?.find((s) => s.status === "IN_PROGRESS") || null;
  const proctoredActive = proctored && phase === "active";

  // ---- answer saver -----------------------------------------------------------------------------------------------------------------------------------------------------------
  const saver = useMemo(() => createExamAnswerSaver({
    put: (itemRef, body) => api.put(`/exams/attempts/${attemptId}/answers/${itemRef}`, body).then((r) => r.data),
    onStatus: () => {},
  }), [attemptId]);
  useEffect(() => {
    const t = setInterval(() => setSaveState(saver.summary()), 400);
    const online = () => saver.retryNow();
    window.addEventListener("online", online);
    return () => { clearInterval(t); window.removeEventListener("online", online); saver.dispose(); };
  }, [saver]);

  const applyView = useCallback((data) => {
    viewRef.current = data;
    setView(data);
    setOffset(clockOffset(data.timing?.serverNow));
    if (data.current) {
      const next = {};
      for (const a of data.current.answers || []) { next[a.itemRef] = a.payload; saver.setVersion(a.itemRef, a.version); }
      draftsRef.current = next;
      setDrafts(next);
    } else { draftsRef.current = {}; setDrafts({}); }
    return data;
  }, [saver]);

  // ---- load -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    let live = true;
    const sid = recallExamSession(attemptId);
    if (sid) setSession(sid);
    api.get(`/exams/attempts/${attemptId}`).then((r) => {
      if (!live) return;
      const data = applyView(r.data);
      const st = data.attempt.status;
      if (FINISHED.includes(st)) { finishedRef.current = true; setPhase("finished"); }
      else if (st === "READINESS_CHECK") setPhase("readiness");
      else if (data.attempt.mode === "PROCTORED") setPhase("gate"); // a reload or a new tab: the student resumes with a click, which also gives the browser the gesture fullscreen needs
      else setPhase("active");
    }).catch((e) => { if (live) setError(examErrorMessage(e, "Could not load the examination.")); });
    return () => { live = false; };
  }, [attemptId, applyView, setSession]);

  // ---- clock ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const overallLeft = secondsUntil(view?.timing?.overallDeadline, offset, now);
  const sectionLeft = secondsUntil(view?.timing?.sectionDeadline, offset, now);
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return null;
    refreshingRef.current = true;
    try {
      const { data } = await api.get(`/exams/attempts/${attemptId}`);
      applyView(data);
      if (FINISHED.includes(data.attempt.status)) { finishedRef.current = true; setPhase("finished"); }
      return data;
    } catch { return null; } finally { refreshingRef.current = false; }
  }, [attemptId, applyView]);
  // When a deadline reaches zero the server closes the section or the attempt on its next request; ask for it, then keep asking gently until the state has moved on.
  const timeIsUp = phase === "active" && (overallLeft === 0 || (!!openSection && sectionLeft === 0));
  useEffect(() => {
    if (!timeIsUp) return undefined;
    const first = setTimeout(async () => {
      const d = await refresh();
      if (d && d.attempt.status === "IN_PROGRESS") setNotice("Time for the section ended. The answers saved so far were submitted.");
    }, 1200);
    const again = setInterval(refresh, 3000);
    return () => { clearTimeout(first); clearInterval(again); };
  }, [timeIsUp, refresh]);

  // ---- proctoring -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const onViolation = useCallback(async (type) => {
    if (finishedRef.current || !viewRef.current) return;
    try {
      const { data } = await api.post(`/exams/attempts/${attemptId}/events`, { type, sectionKey: viewRef.current.current?.key, clientAt: new Date().toISOString() });
      if (data.penalized || data.severity === "SUSPICIOUS") {
        const msg = `${LABEL[type] || "A security event"} was recorded for review${data.maxWarnings ? ` (${data.warningCount}/${data.maxWarnings} warnings)` : ""}. Your examination continues; a reviewer decides whether it counts.`;
        setWarning(msg);
        setTimeout(() => setWarning((m) => (m === msg ? null : m)), 7000);
      }
    } catch { /* an event that cannot be sent is not a reason to disturb the student */ }
  }, [attemptId]);
  const proctor = useProctoring({ active: proctoredActive, requireFullscreen: !!policy?.fullscreen, requireWebcam: !!policy?.camera, requireMicrophone: !!policy?.microphone, onViolation });
  useExamNavigationGuard({ enabled: proctoredActive, onAttempt: () => onViolation("NAVIGATION_ATTEMPT") });

  useEffect(() => {
    if (phase !== "active") return undefined;
    const handler = (e) => { if (saver.summary() === "idle" || saver.summary() === "saved") return undefined; e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase, saver]);

  // ---- dictation (AI interview) -----------------------------------------------------------------------------------------------------------------------------------------------
  const dictation = useAnswerDictation({
    lang: SPEECH_LANG,
    onCommit: (itemRef, text) => {
      if (!itemRef || !text) return;
      const prev = draftsRef.current[itemRef] || {};
      const payload = { text: mergeTranscript(prev.text || "", text), input: "SPEECH" };
      setDraft(itemRef, payload);
    },
  });
  useEffect(() => { if (phase !== "active") dictation.cancel(); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (dictation.questionId && dictation.recording && dictation.questionId !== current?.items?.[index]?.id) dictation.stop(); }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- answers ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  function setDraft(itemRef, payload) {
    draftsRef.current = { ...draftsRef.current, [itemRef]: payload };
    setDrafts(draftsRef.current);
    saver.save(itemRef, payload);
  }
  async function flushAll() {
    const items = viewRef.current?.current?.items || [];
    const results = await Promise.all(items.map((i) => saver.flush(i.id)));
    return results.every(Boolean);
  }

  // ---- actions ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  async function begin() {
    setBusy(true); setError(null);
    try {
      if (proctored && policy?.fullscreen) await proctor.requestFullscreen();
      const fsOk = !(proctored && policy?.fullscreen) || !!getFullscreenElement();
      const readiness = proctored
        ? { camera: !policy.camera || !!proctor.mediaGranted, microphone: !policy.microphone || !!proctor.mediaGranted, fullscreen: fsOk, browser: true, connectivity: navigator.onLine !== false }
        : { browser: true, connectivity: true };
      const { data } = await api.post(`/exams/attempts/${attemptId}/begin`, { readiness });
      if (data.sessionId) { rememberExamSession(attemptId, data.sessionId); setSession(data.sessionId); }
      applyView(data);
      setIndex(0);
      setPhase("active");
    } catch (e) { setError(examErrorMessage(e)); } finally { setBusy(false); }
  }

  async function resume() {
    setBusy(true); setError(null);
    try {
      if (policy?.camera || policy?.microphone) { try { await proctor.requestMedia(); } catch { /* the in-session banners report a camera problem */ } }
      if (policy?.fullscreen) await proctor.requestFullscreen();
      const { data } = await api.post(`/exams/attempts/${attemptId}/claim`, {});
      if (data.sessionId) { rememberExamSession(attemptId, data.sessionId); setSession(data.sessionId); }
      applyView(data);
      setPhase("active");
    } catch (e) { setError(examErrorMessage(e)); } finally { setBusy(false); }
  }

  async function openNext(key) {
    setBusy(true); setNotice(null);
    try {
      const { data } = await api.post(`/exams/attempts/${attemptId}/sections/${key}/open`, {});
      applyView(data); setIndex(0);
    } catch (e) { setNotice(examErrorMessage(e)); await refresh(); } finally { setBusy(false); }
  }

  async function completeSection() {
    if (!current) return;
    setBusy(true); setNotice(null);
    try {
      const saved = await flushAll();
      if (!saved) { setNotice("Some answers have not been saved yet. Check your connection; they will be sent again automatically. Try submitting the section once they show as saved."); setDialog(null); return; }
      const answered = countAnswered(current.key, current.items, draftsRef.current);
      const { data } = await api.post(`/exams/attempts/${attemptId}/sections/${current.key}/complete`, { expectedAnswered: answered });
      setDialog(null); applyView(data); setIndex(0);
      if (dictation.recording) dictation.cancel();
    } catch (e) { setNotice(examErrorMessage(e)); setDialog(null); await refresh(); } finally { setBusy(false); }
  }

  async function submitExam() {
    setBusy(true); setNotice(null);
    try {
      await api.post(`/exams/attempts/${attemptId}/submit`, {});
      finishedRef.current = true;
      if (proctored) { try { proctor.stopMedia(); await proctor.releaseFullscreen(); } catch { /* best effort */ } }
      setDialog(null);
      await refresh();
      setPhase("finished");
    } catch (e) { setNotice(examErrorMessage(e)); setDialog(null); } finally { setBusy(false); }
  }

  // Next / previous. In a section with "locked after next" editing the answer being left is finalised first; with forward-only navigation there is no way back.
  async function goTo(i) {
    if (!current || i === index || i < 0 || i >= current.items.length) return;
    const sec = openSection;
    if (sec?.navigation === "FORWARD_ONLY" && i < index) return;
    if (dictation.recording) { await dictation.stop(); await new Promise((r) => setTimeout(r, 0)); }
    const leaving = current.items[index];
    if (leaving && sec?.answerEditing === "LOCKED_AFTER_NEXT" && i > index && draftsRef.current[leaving.id]) {
      const ok = await saver.finalize(leaving.id, draftsRef.current[leaving.id]);
      if (!ok) { setNotice("That answer could not be locked yet. Wait until it shows as saved, then try again."); return; }
    }
    setIndex(i);
  }

  // ---- screens ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const shell = (children) => <div><Navbar locked={proctoredActive} /><div className="ex-page">{children}</div></div>;

  if (replaced) return shell(<div className="ex-card"><h2>Examination open elsewhere</h2><p>This examination was opened in another tab, window or device, which now holds your session. Close this one, or continue here instead. Your saved answers are safe.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Continue in this tab</button></div>);
  if (error && phase === "loading") return shell(<div><p style={{ color: "var(--rust)" }}>{error}</p><Link to="/exams" className="btn btn-ghost">← Examinations</Link></div>);
  if (!view || phase === "loading") return shell(<p className="mono">Loading…</p>);

  const a = view.attempt;

  if (phase === "finished") {
    const res = view.result;
    return shell(
      <div className="ex-card">
        <h2>{a.status === "INVALIDATED" ? "This attempt was withdrawn" : "Examination submitted"}</h2>
        <p className="ex-sub">{a.title}</p>
        {a.status === "EXPIRED" && <div className="ex-notice warn">Time ended. The answers saved before the deadline were submitted automatically.</div>}
        {res ? <p>Your result is available.</p> : <p>{view.resultNotice || "Your answers have been received."}</p>}
        <div className="ex-row" style={{ marginTop: 12 }}>
          <Link className="btn btn-primary" to={`/exams/attempt/${attemptId}/report`}>{res ? "View result" : "View status"}</Link>
          <Link className="btn btn-ghost" to="/exams">All examinations</Link>
        </div>
      </div>
    );
  }

  if (phase === "readiness") {
    const needsChecks = proctored && (policy.camera || policy.microphone || policy.fullscreen);
    return shell(
      <div>
        <div className="ex-head"><div><h1>{a.title}</h1><p className="ex-sub">{a.official ? "Official examination" : "Practice attempt (unofficial, repeatable)"} · {view.policy.durationMin} minutes · {view.policy.totalMarks} marks</p></div></div>
        <div className="ex-card">
          <h3>Sections</h3>
          <ol className="ex-list">
            {view.sections.map((s) => <li key={s.key}><strong>{s.label}</strong>: {s.questionCount} {s.key === "CODING" ? "problem(s)" : "question(s)"}, {s.maxMarks} marks{s.durationMin ? `, ${s.durationMin} minutes` : ""}. {s.navigation === "FORWARD_ONLY" ? "Forward only: you cannot go back to an earlier question." : "You may move between questions."}{s.requireAllAnswered ? " Every question must be answered." : ""}</li>)}
          </ol>
          <ul className="ex-list" style={{ marginTop: 10 }}>
            <li>Sections open one after another, in order. A submitted section cannot be reopened.</li>
            <li>The timer runs on the server. Refreshing, closing the tab or losing the connection does not pause or reset it.</li>
            <li>Your answers are saved as you work. Wait for the status to read "All answers saved" before submitting a section.</li>
            {proctored && <li>This is proctored. Stay in fullscreen on this page. Events such as leaving the tab are recorded for review; they do not end your examination by themselves.</li>}
            {a.official && <li>This is your single official attempt. It cannot be restarted.</li>}
          </ul>
        </div>
        {needsChecks && (
          <div className="ex-card">
            <ReadinessChecklist proctor={proctor} requireWebcam={!!policy.camera} requireMicrophone={!!policy.microphone} requireFullscreen={!!policy.fullscreen} onReadyChange={setReady} />
          </div>
        )}
        {error && <div className="ex-notice bad" role="alert">{error}</div>}
        <button className="btn btn-primary" style={{ width: "100%", padding: "12px 24px", opacity: !needsChecks || ready ? 1 : 0.4 }} disabled={busy || (needsChecks && !ready)} onClick={begin}>{busy ? "Starting…" : proctored ? "Begin examination (fullscreen)" : "Begin practice"}</button>
        <p className="ex-sub" style={{ marginTop: 8 }}><Link to="/exams">← Back without starting</Link></p>
      </div>
    );
  }

  if (phase === "gate") {
    return shell(
      <div className="ex-card" style={{ maxWidth: 560, margin: "40px auto" }}>
        <h2>Continue your examination</h2>
        <p>Your examination is in progress and the timer kept running on the server. Resume to carry on where you left off. Camera, microphone and fullscreen are needed again.</p>
        {overallLeft !== null && <p><strong>Time left: {formatClock(overallLeft)}</strong></p>}
        {error && <div className="ex-notice bad" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={resume}>{busy ? "Resuming…" : "Resume examination"}</button>
      </div>
    );
  }

  // ---- active -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const item = current?.items?.[index] || null;
  const nextSection = nextOpenable(view.sections);
  const done = allSectionsDone(view.sections);
  const tone = timerTone(sectionLeft ?? overallLeft, null);
  const saveLabel = { idle: "", saved: "All answers saved", saving: "Saving…", retrying: "Reconnecting — your answers are kept and will be sent", failed: "Not saved — check your connection" }[saveState] || "";
  const review = current ? reviewSummary(current.key, current.items, drafts) : null;
  const locked = false;

  return (
    <div>
      <Navbar locked={proctoredActive} />
      <div className="ex-bar" role="status">
        <span className="ex-title">{a.title}{!a.official && " · Practice"}</span>
        {openSection && sectionLeft !== null && <span className={`ex-timer ${tone}`} aria-label="Section time left">Section {formatClock(sectionLeft)}</span>}
        <span className={`ex-timer ${timerTone(overallLeft, view.policy.durationMin * 60)}`} aria-label="Exam time left">Total {formatClock(overallLeft)}</span>
        <span className={`ex-save ${saveState}`} aria-live="polite">{saveLabel}</span>
        {proctored && policy?.camera && <video ref={proctor.videoRef} muted autoPlay playsInline style={{ width: 72, height: 54, borderRadius: 8, objectFit: "cover" }} aria-label="Your camera" />}
        {!proctored && <Link className="btn btn-ghost" to="/exams">Leave (resume later)</Link>}
      </div>
      <div className="ex-page wide">
        <div className="ex-steps" aria-label="Sections">
          {view.sections.map((s, i) => {
            const st = sectionState(s);
            return <div key={s.key} className={`ex-step ${st}`} aria-current={st === "open" ? "step" : undefined}><b>{"ABCD"[i]}</b>{s.label}{st === "done" && " ✓"}{st === "open" && ` · ${s.answered}/${s.questionCount}`}</div>;
          })}
        </div>

        {warning && <div className="ex-notice warn" role="alert">{warning}</div>}
        {notice && <div className="ex-notice warn" role="alert">{notice}</div>}
        {proctoredActive && policy?.fullscreen && !proctor.fullscreenOk && (
          <div className="ex-notice bad" role="alert">You are not in fullscreen. <button className="btn btn-ghost" onClick={() => proctor.requestFullscreen()}>Return to fullscreen</button></div>
        )}
        {(saveState === "failed" || saveState === "retrying") && <div className="ex-notice bad" role="alert">Your latest answers could not reach the server yet. They are kept on this page and sent again automatically. Do not close the page. <button className="btn btn-ghost" onClick={() => saver.retryNow()}>Try now</button></div>}

        {current && item ? (
          <div className="ex-layout">
            <div>
              {current.key === "CODING"
                ? <ExamCodingProblem key={item.id} attemptId={attemptId} item={item} number={index + 1} total={current.items.length} payload={drafts[item.id]} evaluation={current.answers.find((x) => x.itemRef === item.id)?.evaluation} allowedLanguages={item.languages} maxSubmissions={openSection?.maxSubmissionsPerProblem} onChange={(p) => setDraft(item.id, p)} disabled={locked} flushAnswer={(id) => saver.flush(id)} />
                : current.key === "AI_INTERVIEW"
                  ? <ExamInterviewQuestion key={item.id} item={item} number={index + 1} total={current.items.length} payload={drafts[item.id]} onChange={(p) => setDraft(item.id, p)} disabled={locked} speechAllowed={!!openSection?.interview?.speechToText && openSection?.interview?.answerInput !== "TYPED"} dictation={dictation} />
                  : <ExamMcqQuestion key={item.id} item={item} number={index + 1} total={current.items.length} payload={drafts[item.id]} onChange={(p) => setDraft(item.id, p)} disabled={locked} />}
              <div className="ex-foot">
                <button className="btn btn-ghost" disabled={index === 0 || openSection?.navigation === "FORWARD_ONLY"} onClick={() => goTo(index - 1)}>← Previous</button>
                {index < current.items.length - 1
                  ? <button className="btn btn-primary" onClick={() => goTo(index + 1)}>Next →</button>
                  : <button className="btn btn-primary" onClick={() => setDialog({ type: "complete" })}>Review and submit this section</button>}
              </div>
            </div>
            <aside aria-label="Question palette">
              <div className="ex-card">
                <strong>{openSection?.label}</strong>
                <p className="ex-sub">{review.answered} of {review.total} answered</p>
                <div className="ex-palette">
                  {current.items.map((it, i) => (
                    <button key={it.id} type="button" className={`ex-pal ${countAnswered(current.key, [it], drafts) ? "answered" : ""} ${i === index ? "current" : ""}`} disabled={openSection?.navigation === "FORWARD_ONLY" && i < index} onClick={() => goTo(i)} aria-label={`Question ${i + 1}${countAnswered(current.key, [it], drafts) ? ", answered" : ", not answered"}`}>{i + 1}</button>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setDialog({ type: "complete" })}>Submit section</button>
              </div>
            </aside>
          </div>
        ) : done ? (
          <div className="ex-card">
            <h2>All sections are complete</h2>
            <p>Submit the examination to finish. After this you cannot change anything.</p>
            <button className="btn btn-primary" onClick={() => setDialog({ type: "submit" })}>Submit examination</button>
          </div>
        ) : nextSection ? (
          <div className="ex-card">
            <h2>{view.sections.some((s) => s.status === "COMPLETED") ? "Section complete" : "Ready to begin"}</h2>
            <p>Next: <strong>{nextSection.label}</strong> — {nextSection.questionCount} {nextSection.key === "CODING" ? "problem(s)" : "question(s)"}, {nextSection.maxMarks} marks{nextSection.durationMin ? `, ${nextSection.durationMin} minutes (its own timer starts when you open it)` : ""}.</p>
            {nextSection.instructions && <p className="ex-sub" style={{ whiteSpace: "pre-wrap" }}>{nextSection.instructions}</p>}
            {nextSection.key === "AI_INTERVIEW" && <p className="ex-sub">Answer each question in your own words. You may type, or speak and let the browser transcribe, then edit the text.</p>}
            <button className="btn btn-primary" disabled={busy} onClick={() => openNext(nextSection.key)}>{busy ? "Opening…" : `Open ${nextSection.label}`}</button>
          </div>
        ) : <div className="ex-card ex-muted">Updating…</div>}
      </div>

      {dialog?.type === "complete" && review && (
        <div className="ex-modal-back" role="dialog" aria-modal="true" aria-label="Submit section">
          <div className="ex-modal">
            <h3>Submit {openSection?.label}?</h3>
            <p>{review.answered} of {review.total} answered.{review.unanswered.length > 0 && <> Unanswered: {review.unanswered.join(", ")}.</>}</p>
            {openSection?.requireAllAnswered && review.unanswered.length > 0 && <div className="ex-notice bad">Every question in this section must be answered before you can submit it.</div>}
            <p className="ex-sub">After you submit, this section is closed and cannot be reopened.</p>
            <div className="ex-row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setDialog(null)} disabled={busy}>Keep working</button>
              <button className="btn btn-primary" onClick={completeSection} disabled={busy || (openSection?.requireAllAnswered && review.unanswered.length > 0)}>{busy ? "Submitting…" : "Submit section"}</button>
            </div>
          </div>
        </div>
      )}
      {dialog?.type === "submit" && (
        <div className="ex-modal-back" role="dialog" aria-modal="true" aria-label="Submit examination">
          <div className="ex-modal">
            <h3>Submit the examination?</h3>
            <p className="ex-sub">All four sections are complete. After this you cannot change anything.</p>
            <div className="ex-row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setDialog(null)} disabled={busy}>Not yet</button>
              <button className="btn btn-primary" onClick={submitExam} disabled={busy}>{busy ? "Submitting…" : "Submit examination"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
