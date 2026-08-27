import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import EditStudentProfileModal from "../components/EditStudentProfileModal";

// Read-only conflict dashboard — GET /users/roll-number-conflicts (backend/src/routes/users.js).
// Deliberately does not resolve anything itself: per this feature's own explicit "do not
// auto-rename" requirement, resolving a conflict means an authorized admin picks a real new Roll
// Number for one of the affected students, which reuses the exact same edit flow (and the exact
// same PATCH /users/:id validation/collision-check) every other student edit already goes through
// — see EditStudentProfileModal below, opened directly from a conflict row rather than duplicated.
export default function RollNumberConflicts() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [editingStudentId, setEditingStudentId] = useState(null);

  function load() {
    api.get("/users/roll-number-conflicts", { params: { page, pageSize: 10 } })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load conflicts"));
  }
  useEffect(load, [page]);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Roll Number Conflicts</h1>
        <ChalkUnderline />
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 12 }}>
          Students who currently share the same Roll Number within the same Institute + Batch + Branch + Section.
          Nothing here is changed automatically — review each conflict and pick the correct Roll Number for the
          affected student(s) yourself, the same way you'd edit any other student profile.
        </p>

        {error && <p style={{ color: "var(--rust)", marginTop: 16 }}>{error}</p>}

        {!data ? (
          <p className="mono" style={{ color: "var(--ink-dim)", marginTop: 24 }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 16, marginTop: 20, marginBottom: 20 }}>
              <div className="card" style={{ padding: "12px 20px" }}>
                <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase" }}>Total Conflicts</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{data.total}</div>
              </div>
            </div>

            {data.total === 0 ? (
              <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--mint)" }}>
                ✓ No Roll Number conflicts found. Every Roll Number is unique within its Institute + Batch + Branch + Section.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {data.conflicts.map((c) => (
                  <div key={`${c.academicGroupId}:${c.rollNumber}`} className="card" style={{ padding: 18, borderLeft: "3px solid var(--rust)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
                      <AlertTriangle size={15} color="var(--rust)" />
                      Roll Number {c.rollNumber}
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                      {c.institute?.name || "(unknown institute)"} · Batch {c.batch} · {c.branch} · Section {c.section}
                    </div>
                    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                      {c.students.map((s) => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}>
                          <div>
                            <strong>{s.name}</strong>
                            <span className="mono" style={{ color: "var(--ink-dim)", marginLeft: 8 }}>PRN: {s.registrationNumber || "(none)"}</span>
                            {!s.isActive && <span className="badge" style={{ marginLeft: 8 }}>Inactive</span>}
                            <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                              {s.email} · Created {new Date(s.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditingStudentId(s.id)}>
                            Edit Profile
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", marginTop: 24 }}>
                <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Page {page} of {data.totalPages} ({data.total} conflict{data.total === 1 ? "" : "s"})</span>
                <button className="btn btn-ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {editingStudentId && (
        <EditStudentProfileModal
          studentId={editingStudentId}
          onClose={() => setEditingStudentId(null)}
          onSaved={() => { setEditingStudentId(null); load(); }}
        />
      )}
    </div>
  );
}
