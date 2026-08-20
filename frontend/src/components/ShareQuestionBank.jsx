import { useEffect, useState } from "react";
import api from "../api";

const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 };

// Grant/revoke panel for a Question Bank (folder) — visible only to the folder's own creator or
// an Admin (the backend enforces this too; the UI just doesn't bother rendering an action a 403
// would immediately reject). Mirrors the platform's existing Subject-authoring-access pattern
// (QuestionBank.jsx's "Who can author under Subject X") but for explicit folder sharing.
export default function ShareQuestionBank({ folderId }) {
  const [expanded, setExpanded] = useState(false);
  const [shares, setShares] = useState(null);
  const [staffDirectory, setStaffDirectory] = useState(null);
  const [grantStaffId, setGrantStaffId] = useState("");
  const [granting, setGranting] = useState(false);

  function load() {
    setShares(null);
    api.get(`/questions/folders/${folderId}/shares`).then((res) => setShares(res.data)).catch(() => setShares([]));
    if (!staffDirectory) {
      api.get("/tests/staff-directory").then((res) => setStaffDirectory(res.data)).catch(() => setStaffDirectory([]));
    }
  }

  useEffect(() => {
    if (expanded) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, folderId]);

  async function grant() {
    if (!grantStaffId) return;
    setGranting(true);
    try {
      await api.post(`/questions/folders/${folderId}/shares`, { staffIds: [grantStaffId] });
      setGrantStaffId("");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to share");
    } finally {
      setGranting(false);
    }
  }

  async function revoke(staffId) {
    try {
      await api.delete(`/questions/folders/${folderId}/shares/${staffId}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to revoke access");
    }
  }

  if (!expanded) {
    return (
      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={() => setExpanded(true)}>
        Share this Question Bank
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Who else can manage this Question Bank?</div>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
        Private by default — only you can see or edit these questions. Staff granted here get full view/edit access to
        everything in this bank, but can't re-share it to anyone else.
      </p>
      {shares === null ? (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <select style={{ ...selectStyle, minWidth: 200 }} value={grantStaffId} onChange={(e) => setGrantStaffId(e.target.value)}>
              <option value="">Select staff to grant…</option>
              {(staffDirectory || [])
                .filter((s) => !shares.some((sh) => sh.staffId === s.id))
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!grantStaffId || granting} onClick={grant}>
              {granting ? "Sharing…" : "Share"}
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            {shares.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>Not shared with anyone yet.</p>}
            {shares.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                <span>{s.staff.name}</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)" }} onClick={() => revoke(s.staffId)}>Revoke</button>
              </div>
            ))}
          </div>
        </>
      )}
      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 10 }} onClick={() => setExpanded(false)}>Close</button>
    </div>
  );
}
