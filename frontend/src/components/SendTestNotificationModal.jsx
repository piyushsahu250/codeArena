import { useEffect, useState } from "react";
import { X } from "lucide-react";
import api from "../api";
import { useToast } from "../context/ToastContext";

// Manual "Send Notification" action — the ONLY thing that emails students about a test now.
// Nothing fires automatically from create/edit/save-draft/publish/assign anymore; this dialog is
// the deliberate, explicit alternative. In-App is checked by default, Email is NOT — matching the
// spec's "Email should be OFF by default" requirement exactly.
//
// idempotencyKey is generated exactly once per dialog open (useState's lazy initializer runs once
// per mount, not per render) and reused unchanged across a retry of the SAME click — a double-
// click before this button disables, or a dropped-response retry, resends the identical key and
// the backend's unique constraint on it treats that as "already sent," not a second send. A
// genuinely new dialog open later (e.g. after closing and reopening, or a page refresh) gets its
// own fresh key, which is a deliberate new action, not a duplicate.
export default function SendTestNotificationModal({ test, onClose }) {
  const toast = useToast();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [sendInApp, setSendInApp] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/tests/${test.id}/notification-recipients`)
      .then((res) => setPreview(res.data))
      .catch((err) => setPreviewError(err.response?.data?.error || "Failed to load recipients"));
  }, [test.id]);

  async function handleSend() {
    if (!sendInApp && !sendEmail) return toast.error("Select at least one notification type.");
    setSending(true);
    try {
      const { data } = await api.post(`/tests/${test.id}/notify`, { sendInApp, sendEmail, idempotencyKey });
      setResult(data);
      if (data.alreadySent) {
        toast.error("This notification was already sent — no duplicate was sent.");
      } else {
        toast.success(`Sent to ${data.recipientCount} student(s)${data.sendEmailQueued ? " — emails are being sent in the background" : ""}.`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to send notification");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflowY: "auto" }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: 24, position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-ghost" style={{ position: "absolute", top: 12, right: 12, padding: 6 }} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <h3>Send Notification</h3>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>
          Test: <strong>{test.title}</strong>
        </p>

        {previewError ? (
          <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{previewError}</p>
        ) : !preview ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 16 }}>Loading recipients…</p>
        ) : result ? (
          <div style={{ marginTop: 20, padding: 16, background: "var(--paper)", borderRadius: 8, fontSize: 13 }}>
            {result.alreadySent
              ? <>This notification was already sent to <strong>{result.recipientCount}</strong> student(s) at {new Date(result.sentAt).toLocaleString()} — sending again was blocked to avoid a duplicate.</>
              : <>Sent to <strong>{result.recipientCount}</strong> student(s).{result.sendEmailQueued ? " Emails are being delivered in the background — check the notification log for delivery status." : ""}</>}
          </div>
        ) : (
          <>
            <div style={{ marginTop: 16, padding: 16, background: "var(--paper)", borderRadius: 8, fontSize: 13, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--ink-dim)" }}>Recipients</span>
                <strong>{preview.recipientCount} student{preview.recipientCount === 1 ? "" : "s"}</strong>
              </div>
              {preview.breakdown.map((g) => (
                <div key={g.academicGroupId} className="mono" style={{ fontSize: 11.5, color: "var(--ink-dim)", display: "flex", justifyContent: "space-between" }}>
                  <span>{g.institute || "—"} · {g.branch || "—"} - {g.section || "—"}{g.batch ? ` (${g.batch})` : ""}</span>
                  <span>{g.count}</span>
                </div>
              ))}
              {preview.ungroupedCount > 0 && (
                <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-dim)", display: "flex", justifyContent: "space-between" }}>
                  <span>Other / unassigned group</span>
                  <span>{preview.ungroupedCount}</span>
                </div>
              )}
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={sendInApp} onChange={(e) => setSendInApp(e.target.checked)} />
                Send In-App Notification
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                Send Email
              </label>
            </div>

            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 14 }}>
              Send notification to {preview.recipientCount} student{preview.recipientCount === 1 ? "" : "s"}?
            </p>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending || preview.recipientCount === 0 || (!sendInApp && !sendEmail)}
              >
                {sending ? "Sending…" : "Send"}
              </button>
              <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
            </div>
            {preview.recipientCount === 0 && (
              <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 8 }}>No eligible students found for this test.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
