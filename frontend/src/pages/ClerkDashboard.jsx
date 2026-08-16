import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building, Search, Users, GraduationCap, FileDown, FileText, UserCheck, Clock, Target } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid } from "../components/Skeleton";

const PIE_COLORS = ["#4F9D6E", "#C7852A", "#B0473F", "#5B7DB1"];

export default function ClerkDashboard() {
  const { user } = useAuth();
  const [companyCount, setCompanyCount] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [offerStats, setOfferStats] = useState(null);
  const [department, setDepartment] = useState(null);
  const [documentStats, setDocumentStats] = useState(null);
  const [profileStats, setProfileStats] = useState(null);
  const [batchFilter, setBatchFilter] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [readiness, setReadiness] = useState(null);

  useEffect(() => {
    api.get("/companies").then((res) => setCompanyCount(res.data.length)).catch(() => setCompanyCount(null));
  }, []);

  useEffect(() => {
    api.get("/placement/analytics/registration", { params: { batch: batchFilter || undefined } })
      .then((res) => setRegistration(res.data))
      .catch(() => setRegistration({ total: 0, registered: 0, notRegistered: 0, percentRegistered: 0, declineBreakdown: [] }));
    api.get("/placement/analytics/department", { params: { batch: batchFilter || undefined } })
      .then((res) => setDepartment(res.data)).catch(() => setDepartment([]));
  }, [batchFilter]);

  useEffect(() => {
    api.get("/placement/analytics/offers", { params: { verifiedOnly: verifiedOnly || undefined } })
      .then((res) => setOfferStats(res.data))
      .catch(() => setOfferStats({
        totalStudents: 0, placed: 0, unplaced: 0, activeOffers: 0, multipleOffers: 0,
        totalOffers: 0, averageOffersPerStudent: 0, onCampus: 0, offCampus: 0, highestPackage: 0, averagePackage: 0,
      }));
  }, [verifiedOnly]);

  useEffect(() => {
    api.get("/placement/analytics/documents").then((res) => setDocumentStats(res.data)).catch(() => setDocumentStats(null));
  }, []);

  // Reduced-detail readiness view — readiness-level flags only, no BTL/topic breakdowns
  // (spec requires the Placement Cell not see raw academic assessment data).
  useEffect(() => {
    api.get("/readiness/placement/overview")
      .then((res) => setReadiness(res.data))
      .catch(() => setReadiness(null));
  }, []);

  // Reuses the same institute-scoped completion-stats route Student Management/Institute admin
  // already call — Clerk was already permitted here (see institutes.js), just never fetched it.
  useEffect(() => {
    if (!user?.instituteId) return;
    api.get(`/institutes/${user.instituteId}/profile-completion-stats`)
      .then((res) => setProfileStats(res.data))
      .catch(() => setProfileStats(null));
  }, [user?.instituteId]);

  async function downloadPdfReport() {
    setDownloadingPdf(true);
    try {
      const { data } = await api.get("/placement/analytics/report.pdf", { params: { batch: batchFilter || undefined }, responseType: "blob" });
      const blob = new Blob([data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `placement-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const offerSourceData = offerStats ? [
    { name: "On-Campus", value: offerStats.onCampus },
    { name: "Off-Campus", value: offerStats.offCampus },
  ].filter((d) => d.value > 0) : [];

  return (
    <div>
      <Navbar />
      <div className="page-container" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>Placement Cell — {user?.name}</h1>
            <ChalkUnderline />
            <p style={{ color: "var(--ink-dim)", marginTop: 8 }}>Institute-scoped placement operations, registration, and offer analytics.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to="/clerk/students" className="btn btn-primary"><Search size={15} /> Student Search</Link>
            <Link to="/clerk/companies" className="btn btn-ghost"><Building size={15} /> Company Master</Link>
            <button className="btn btn-ghost" disabled={downloadingPdf} onClick={downloadPdfReport}><FileDown size={15} /> {downloadingPdf ? "Downloading…" : "Download PDF Report"}</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 24 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Batch (optional)</label>
            <input
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
              placeholder="e.g. 2022-2026"
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
            />
          </div>
        </div>

        {/* Registration Overview */}
        <h3 style={{ fontSize: 16, marginTop: 24, marginBottom: 10 }}>Placement Registration Overview</h3>
        {registration === null ? (
          <SkeletonGrid count={5} minWidth={160} />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <StatCard icon={Users} label="Total Students" value={registration.total} />
              <StatCard icon={GraduationCap} label="Registered" value={registration.registered} />
              <StatCard icon={GraduationCap} label="Not Registered" value={registration.notRegistered} />
              <StatCard icon={Building} label="Companies" value={companyCount ?? "—"} />
              <StatCard icon={Users} label="% Registered" value={`${registration.percentRegistered}%`} />
              {profileStats && (
                <StatCard icon={UserCheck} label="Profiles Verified" value={profileStats.completed} />
              )}
              {profileStats && (
                <StatCard icon={Clock} label="Profiles Pending Verification" value={profileStats.incomplete} />
              )}
              {documentStats && (
                <Link to="/clerk/students" style={{ textDecoration: "none", color: "inherit" }}>
                  <StatCard icon={FileText} label="Documents Pending Verification" value={documentStats.pending} />
                </Link>
              )}
              {documentStats && (
                <StatCard icon={FileText} label="Documents Verified" value={documentStats.verified} />
              )}
            </div>
            {registration.declineBreakdown.length > 0 && (
              <div className="card" style={{ padding: 16, marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Not-Registered — by reason</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {registration.declineBreakdown.map((r) => (
                    <div key={r.reason} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>{r.label}</span>
                      <span className="mono">{r.count} ({r.percent}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Offer Analytics */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 28, marginBottom: 10 }}>
          <h3 style={{ fontSize: 16 }}>Placement Offer Analytics</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
            Verified offers only
          </label>
        </div>
        {offerStats === null ? (
          <SkeletonGrid count={8} minWidth={150} />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <StatCard icon={Users} label="Placed" value={offerStats.placed} />
              <StatCard icon={Users} label="Unplaced" value={offerStats.unplaced} />
              <StatCard icon={Users} label="Active Offers" value={offerStats.activeOffers} />
              <StatCard icon={Users} label="Multiple Offers" value={offerStats.multipleOffers} />
              <StatCard icon={Users} label="Total Offers" value={offerStats.totalOffers} />
              <StatCard icon={Users} label="Avg Offers / Student" value={offerStats.averageOffersPerStudent} />
              <StatCard icon={Building} label="Highest Package (LPA)" value={offerStats.highestPackage} />
              <StatCard icon={Building} label="Average Package (LPA)" value={offerStats.averagePackage} />
              <StatCard icon={Clock} label="Offer Letters Pending Verification" value={offerStats.pendingVerification} />
            </div>

            {offerSourceData.length > 0 && (
              <div className="card" style={{ padding: 16, marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>On-Campus vs Off-Campus Offers</div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={offerSourceData} dataKey="value" nameKey="name" outerRadius={80} label>
                      {offerSourceData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {/* Technical Readiness Overview */}
        <h3 style={{ fontSize: 16, marginTop: 28, marginBottom: 10 }}>Technical Readiness Overview</h3>
        {readiness === null ? (
          <SkeletonGrid count={5} minWidth={160} />
        ) : readiness.totalAssessments === 0 ? (
          <div className="card" style={{ padding: 16, color: "var(--ink-dim)", fontSize: 13 }}>
            No readiness assessments recorded yet for this institute.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <StatCard icon={Target} label="Assessments Completed" value={readiness.totalAssessments} />
              <StatCard icon={Users} label="Students Assessed" value={readiness.studentsAssessed} />
              <StatCard icon={Target} label="Average Readiness" value={`${readiness.averageReadiness}%`} />
              <StatCard icon={UserCheck} label="Ready for Placement" value={readiness.readyStudents.length} />
              <StatCard icon={Clock} label="Needs Preparation" value={readiness.needsPreparationStudents.length} />
            </div>

            {readiness.readyStudents.length > 0 && (
              <div className="card" style={{ overflowX: "auto", marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, padding: "12px 12px 0" }}>Students Ready for Technical Assessments</div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                      <th style={{ padding: "10px 12px" }}>Name</th>
                      <th style={{ padding: "10px 12px" }}>Reg. No. (PRN)</th>
                      <th style={{ padding: "10px 12px" }}>Subject</th>
                      <th style={{ padding: "10px 12px" }}>Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readiness.readyStudents.slice(0, 20).map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                        <td style={{ padding: "10px 12px" }}>{s.name}</td>
                        <td className="mono" style={{ padding: "10px 12px" }}>{s.registrationNumber || "—"}</td>
                        <td style={{ padding: "10px 12px" }}>{s.subject}</td>
                        <td className="mono" style={{ padding: "10px 12px" }}>{s.overallScore}% — {s.readinessLevel.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {readiness.needsPreparationStudents.length > 0 && (
              <div className="card" style={{ overflowX: "auto", marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, padding: "12px 12px 0" }}>Students Needing Preparation</div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                      <th style={{ padding: "10px 12px" }}>Name</th>
                      <th style={{ padding: "10px 12px" }}>Reg. No. (PRN)</th>
                      <th style={{ padding: "10px 12px" }}>Subject</th>
                      <th style={{ padding: "10px 12px" }}>Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readiness.needsPreparationStudents.slice(0, 20).map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                        <td style={{ padding: "10px 12px" }}>{s.name}</td>
                        <td className="mono" style={{ padding: "10px 12px" }}>{s.registrationNumber || "—"}</td>
                        <td style={{ padding: "10px 12px" }}>{s.subject}</td>
                        <td className="mono" style={{ padding: "10px 12px" }}>{s.overallScore}% — {s.readinessLevel.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Department-wise */}
        <h3 style={{ fontSize: 16, marginTop: 28, marginBottom: 10 }}>Department-wise Placement Status</h3>
        {department && department.length > 0 && (
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={department}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="department" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="registered" name="Registered" fill="#4F9D6E" />
                <Bar dataKey="notRegistered" name="Not Registered" fill="#B0473F" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Department</th>
                <th style={{ padding: "10px 12px" }}>Total</th>
                <th style={{ padding: "10px 12px" }}>Registered</th>
                <th style={{ padding: "10px 12px" }}>Not Registered</th>
                <th style={{ padding: "10px 12px" }}>Dept Eligible</th>
                <th style={{ padding: "10px 12px" }}>Dept Ineligible</th>
                <th style={{ padding: "10px 12px" }}>Cell Eligible</th>
                <th style={{ padding: "10px 12px" }}>Cell Ineligible</th>
              </tr>
            </thead>
            <tbody>
              {(department || []).map((d) => (
                <tr key={d.departmentId} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td style={{ padding: "10px 12px" }}>{d.department}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.total}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.registered}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.notRegistered}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.deptEligible}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.deptIneligible}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.clerkEligible}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{d.clerkIneligible}</td>
                </tr>
              ))}
              {(!department || department.length === 0) && (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>No students yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {profileStats && profileStats.recentlyUpdated.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, marginTop: 28, marginBottom: 10 }}>Recently Updated Student Profiles</h3>
            <div className="card" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                    <th style={{ padding: "10px 12px" }}>Roll Number</th>
                    <th style={{ padding: "10px 12px" }}>Name</th>
                    <th style={{ padding: "10px 12px" }}>Department</th>
                    <th style={{ padding: "10px 12px" }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {profileStats.recentlyUpdated.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                      <td className="mono" style={{ padding: "10px 12px" }}>{p.rollNumber || "—"}</td>
                      <td style={{ padding: "10px 12px" }}><Link to={`/clerk/students/${p.id}`}>{p.name}</Link></td>
                      <td style={{ padding: "10px 12px" }}>{p.department || "—"}</td>
                      <td className="mono" style={{ padding: "10px 12px" }}>{new Date(p.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="card" style={{ padding: 16, marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Need a filtered list?</div>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            Use <Link to="/clerk/students">Student Search</Link>'s Batch, Placement Registration, and Offer Verification filters
            to find students pending registration or pending offer verification, and export the results to Excel.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <Icon size={20} />
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
