import { useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { useToast } from "../context/ToastContext";

// ADMIN/SUPER_ADMIN/INSTITUTE_ADMIN: send a System Announcement (platform-maturity spec item
// #14) -- creates an in-app notification for every matching user, optionally also an email.
// Institute-scoped admins only ever reach their own institute's users (enforced server-side,
// never by this form) regardless of what's picked here.
const AUDIENCE_OPTIONS = [
  { value: "ALL_STUDENTS", label: "All Students" },
  { value: "ALL_STAFF", label: "All Staff & Clerks" },
  { value: "EVERYONE", label: "Everyone (Students + Staff + Clerks)" },
];

export default function Announcements() {
  const toast = useToast();
  const [audience, setAudience] = useState("ALL_STUDENTS");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function send(e) {
    e.preventDefault();
    if (!message.trim()) return toast.error("Write a message first.");
    if (!window.confirm(`Send this announcement to ${AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label}? This can't be recalled once sent.`)) return;
    setSending(true);
    setLastResult(null);
    try {
      const { data } = await api.post("/admin/announcements", {
        audience, message: message.trim(), subject: subject.trim(), sendEmail,
      });
      setLastResult(data);
      toast.success(`Sent to ${data.recipientCount} recipient(s)${data.emailQueued ? " — emails queued in the background" : ""}.`);
      setMessage("");
      setSubject("");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to send announcement");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px 24px" }}>
        <h1>System Announcements</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 12 }}>
          Sends an in-app notification (and, optionally, an email) to everyone in the selected audience,
          scoped to your own institute unless you're a platform-level Super Admin. There's no recall once sent.
        </p>

        <form onSubmit={send} className="card" style={{ padding: 20, marginTop: 20, display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Audience</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
              {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="What do you want to tell them?"
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Also send as email (in addition to the in-app notification)
          </label>

          {sendEmail && (
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Email subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Announcement from CodeArena"
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            </label>
          )}

          <button type="submit" className="btn btn-primary" disabled={sending || !message.trim()} style={{ justifySelf: "start" }}>
            {sending ? "Sending…" : "Send Announcement"}
          </button>
        </form>

        {lastResult && (
          <div className="card" style={{ padding: 16, marginTop: 16, fontSize: 13 }}>
            Last send: {lastResult.recipientCount} recipient(s){lastResult.emailQueued ? " — email delivery is running in the background; check Email Logs for status." : "."}
          </div>
        )}
      </div>
    </div>
  );
}
