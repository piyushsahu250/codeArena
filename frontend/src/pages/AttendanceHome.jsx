import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { formatAcademicGroupLabel } from "../utils/classLabel";
import { useAuth } from "../context/AuthContext";

// Landing page for Attendance — no more manual Department/Section/Class dropdowns. Every card is
// one assignment (my-assignments already enforces "staff only sees what they're assigned to"),
// either an ordinary division (academicGroup/class) or, since the Talent Pool multi-institute
// expansion, a Talent-Pool-institute pairing (talentPoolId set) — see resolveAssignmentAccess /
// rosterWhereForAssignment in backend/src/routes/attendance.js for how the latter reuses this
// exact same LecturePlan/execute/report machinery.
export default function AttendanceHome() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/attendance/my-assignments")
      .then((res) => setAssignments(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load your classes"));
  }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>Attendance</h1>
            <ChalkUnderline />
          </div>
          <Link to="/staff/attendance/reports" className="btn btn-ghost">View Reports</Link>
        </div>

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 16 }}>{error}</p>}

        {assignments === null && !error && <p style={{ marginTop: 24, color: "var(--ink-dim)", fontSize: 13 }}>Loading…</p>}

        {assignments !== null && assignments.length === 0 && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            You haven't been assigned to any classes for attendance yet. Ask an admin to assign you a division.
          </div>
        )}

        {assignments && assignments.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginTop: 24 }}>
            {assignments.map((a) => (
              <div key={a.id} className="card" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
                {a.talentPoolId ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>Talent Pool: {a.talentPool?.name}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8, display: "grid", gap: 3 }}>
                      <div>Institute: {a.attendanceInstitute?.name}</div>
                      <div>Faculty: {a.staff.name}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{formatAcademicGroupLabel(a.academicGroup, a.class)}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 8, display: "grid", gap: 3 }}>
                      {a.subject && <div>Subject: {a.subject}</div>}
                      <div>Batch: {a.academicGroup?.batch || a.class?.batchYear || "—"}</div>
                      <div>Semester: {a.semester}</div>
                      <div>Section: {a.academicGroup?.section || a.class?.division?.name || "—"}</div>
                      <div>Faculty: {a.staff.name}</div>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/staff/attendance/${a.id}?tab=plans&addPlan=1`)}>Add Plan</button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate(`/staff/attendance/${a.id}?tab=mark`)}>Mark Attendance</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {user?.role === "STAFF" && user?.instituteId && <TalentPoolAttendanceClaims user={user} assignments={assignments} />}
      </div>
    </div>
  );
}

// Self-service: lists Talent Pools that include this staff member's own institute and have at
// least one attendance-mandatory exclusive test, with a one-click "Claim" that self-assigns
// attendance ownership for their institute — "without requiring Admin intervention," per the spec.
// Already-claimed pools are skipped (they already show as a normal assignment card above).
function TalentPoolAttendanceClaims({ user, assignments }) {
  const [pools, setPools] = useState(null);
  const [claiming, setClaiming] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/talent-pools").then(async (res) => {
      const withMandatoryTests = await Promise.all(
        res.data.map(async (p) => {
          try {
            const { data: tests } = await api.get(`/talent-pools/${p.id}/tests`);
            const hasMandatory = tests.some((t) => t.test.attendanceMandatory);
            return hasMandatory ? p : null;
          } catch {
            return null;
          }
        })
      );
      setPools(withMandatoryTests.filter(Boolean));
    }).catch(() => setPools([]));
  }, []);

  const claimedPoolIds = new Set((assignments || []).filter((a) => a.talentPoolId).map((a) => a.talentPoolId));
  const claimable = (pools || []).filter((p) => !claimedPoolIds.has(p.id));

  async function claim(poolId) {
    setClaiming(poolId);
    setError("");
    try {
      await api.post(`/talent-pools/${poolId}/attendance-owners`, { instituteId: user.instituteId, staffId: user.id });
      window.location.reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to claim attendance ownership");
      setClaiming("");
    }
  }

  if (pools === null || claimable.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 16 }}>Talent Pool Attendance</h2>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
        These Talent Pools include your institute and have attendance-mandatory exclusive tests. Claim ownership to
        plan and mark attendance for your institute's members.
      </p>
      {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
        {claimable.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
            <button className="btn btn-primary" style={{ marginTop: 10, width: "100%" }} disabled={claiming === p.id} onClick={() => claim(p.id)}>
              {claiming === p.id ? "Claiming…" : "Claim / Manage"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
