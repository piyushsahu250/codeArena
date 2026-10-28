import { useEffect, useMemo, useState } from "react";
import api from "../api";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";

// "Edit live duration": change how long a formal test lasts while students are taking it. The server holds all the rules (modules/tests/tests.duration.*): a student's deadline is their own start
// plus the duration, so each running attempt gets a new deadline measured from ITS OWN start, answers are never touched, and a reduction needs confirmation. This dialog shows the exact effect first
// (GET /tests/:id/duration-impact?durationMin=) and applies it with the version it was shown and a request id generated once per opening, so a double click or a retry cannot apply it twice.
const time = (ms) => (ms ? new Date(ms).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

export default function LiveDurationModal({ test, onClose, onChanged }) {
  const toast = useToast();
  const [requestId] = useState(() => crypto.randomUUID());
  const [info, setInfo] = useState(null); // the current state (no requested duration)
  const [minutes, setMinutes] = useState("");
  const [impact, setImpact] = useState(null); // the preview for `minutes`
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [confirmReduction, setConfirmReduction] = useState(false);
  const [confirmExpiry, setConfirmExpiry] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/tests/${test.id}/duration-impact`)
      .then((res) => { setInfo(res.data); setMinutes(String(res.data.currentDurationMin)); })
      .catch((err) => setError(err.response?.data?.error || "Could not load the exam details"));
  }, [test.id]);

  const valid = /^\d{1,3}$/.test(minutes) && Number(minutes) >= 1 && Number(minutes) <= 720;
  useEffect(() => {
    setImpact(null); setConfirmReduction(false); setConfirmExpiry(false);
    if (!info || !valid || Number(minutes) === info.currentDurationMin) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      api.get(`/tests/${test.id}/duration-impact`, { params: { durationMin: minutes } })
        .then((res) => { if (!cancelled) { setImpact(res.data); setError(""); } })
        .catch((err) => { if (!cancelled) setError(err.response?.data?.error || "Could not calculate the effect"); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [minutes, info, valid, test.id]);

  const needs = impact?.confirmationsNeeded || { reduction: false, expiry: false };
  const plan = impact?.plan;
  const canApply = useMemo(() => !!impact && valid && !applying && !result && (!needs.reduction || confirmReduction) && (!needs.expiry || confirmExpiry), [impact, valid, applying, result, needs.reduction, needs.expiry, confirmReduction, confirmExpiry]);

  async function apply() {
    setApplying(true); setError("");
    try {
      const { data } = await api.patch(`/tests/${test.id}/duration`, { durationMin: Number(minutes), expectedVersion: info.test.version, requestId, reason: reason.trim() || undefined, confirmReduction, confirmExpiry });
      setResult(data);
      toast.success(data.repeated ? "This change was already applied." : "Duration updated.");
      onChanged?.();
    } catch (err) {
      const body = err.response?.data;
      if (err.response?.status === 409 && body?.needsConfirmation) setImpact((prev) => (prev ? { ...prev, plan: body.plan, confirmationsNeeded: { reduction: body.needsConfirmation === "REDUCTION" || prev.confirmationsNeeded?.reduction, expiry: body.needsConfirmation === "EXPIRY" || prev.confirmationsNeeded?.expiry } } : prev));
      setError(body?.error || "The duration was not changed. Check the connection and try again: the same request is safe to repeat.");
    } finally {
      setApplying(false);
    }
  }

  const row = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "3px 0" };
  const footer = result
    ? <button className="btn btn-primary" onClick={onClose}>Close</button>
    : (<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={apply} disabled={!canApply}>{applying ? "Applying…" : "Apply Duration Change"}</button></>);

  return (
    <Modal open onClose={onClose} title="Edit live duration" width={520} footer={footer}>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 6 }}>{test.title} <span className="mono" style={{ fontSize: 11 }}>({test.id.slice(0, 8)})</span></p>

      {!info && !error && <p role="status" style={{ fontSize: 13 }}>Loading…</p>}
      {info && (
        <div style={{ marginTop: 10 }}>
          <div style={row}><span>Original duration</span><b>{info.originalDurationMin} min</b></div>
          <div style={row}><span>Current duration</span><b>{info.currentDurationMin} min</b></div>
          <div style={row}><span>Students who have started</span><b>{info.attempts.started}</b></div>
          <div style={row}><span>Active attempts now</span><b>{info.attempts.active}</b></div>
          <div style={row}><span>Completed attempts</span><b>{info.attempts.completed}</b></div>

          <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 600 }} htmlFor="live-duration-min">New duration (minutes)</label>
          <input id="live-duration-min" className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} disabled={!!result} style={{ width: 120 }} />
          {!valid && minutes !== "" && <p role="alert" style={{ fontSize: 12, color: "var(--rust)", marginTop: 4 }}>Enter a whole number of minutes from 1 to 720.</p>}

          {plan && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 8 }} aria-live="polite">
              <div style={row}><span>Eligible running attempts</span><b>{plan.eligible}</b></div>
              <div style={row}><span>Deadlines that move {impact.requestedDurationMin > info.currentDurationMin ? "later" : "earlier"}</span><b>{impact.requestedDurationMin > info.currentDurationMin ? plan.movedLater : plan.movedEarlier}</b></div>
              {plan.eligible > 0 && <div style={row}><span>New deadlines (each from the student's own start)</span><b>{time(plan.earliestNewDeadline && Date.parse(plan.earliestNewDeadline))} to {time(plan.latestNewDeadline && Date.parse(plan.latestNewDeadline))}</b></div>}
              {plan.afterWindowClose > 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "6px 0 0" }}>{plan.afterWindowClose} deadline(s) fall after the scheduled closing time ({time(Date.parse(info.test.endTime))}). The closing time is not changed here: it only decides who can start.</p>}
              <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "6px 0 0" }}>Nothing restarts and no answer is touched. Open student pages update on their next sync (about 20 seconds).</p>
            </div>
          )}

          {needs.reduction && (
            <div style={{ marginTop: 12, padding: 12, background: "var(--amber)", color: "var(--amber-ink)", borderRadius: 8, fontSize: 13 }}>
              <b>This shortens the time of {plan.movedEarlier} running attempt(s).</b>
              {plan.wouldExpireSoon > 0 && <div style={{ marginTop: 4 }}>{plan.wouldExpireSoon} would be at or past the new deadline or within five minutes of it ({plan.wouldExpireNow} already past it). The server closes an attempt past its deadline on its next sweep and keeps and grades what was saved.</div>}
              <label style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-start", cursor: "pointer" }}><input type="checkbox" checked={confirmReduction} onChange={(e) => setConfirmReduction(e.target.checked)} /> <span>I understand and want to shorten the time of running attempts.</span></label>
              {needs.expiry && <label style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "flex-start", cursor: "pointer" }}><input type="checkbox" checked={confirmExpiry} onChange={(e) => setConfirmExpiry(e.target.checked)} /> <span>I understand that {plan.wouldExpireSoon} student(s) will be closed immediately or within five minutes.</span></label>}
            </div>
          )}

          <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 600 }} htmlFor="live-duration-reason">Reason (optional, kept in the record)</label>
          <input id="live-duration-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!!result} style={{ width: "100%" }} />
        </div>
      )}

      {error && <p role="alert" style={{ fontSize: 13, color: "var(--rust)", marginTop: 10 }}>{error}</p>}

      {result && (
        <div role="status" style={{ marginTop: 14, padding: 12, border: "1px solid var(--mint)", borderRadius: 8, fontSize: 13 }}>
          <b>Duration updated successfully.</b>
          <div style={row}><span>Previous duration</span><b>{result.previousDurationMin} min</b></div>
          <div style={row}><span>New duration</span><b>{result.newDurationMin} min</b></div>
          <div style={row}><span>Eligible attempts</span><b>{result.eligibleAttempts}</b></div>
          <div style={row}><span>Updated attempts</span><b>{result.updatedAttempts}</b></div>
          <div style={row}><span>Failed attempts</span><b>{result.failedAttempts}</b></div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "6px 0 0" }}>{result.howApplied}</p>
        </div>
      )}
    </Modal>
  );
}
