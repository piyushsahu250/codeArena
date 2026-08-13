import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import { SkeletonGrid, SkeletonLine } from "../components/Skeleton";
import EditStudentProfileModal from "../components/EditStudentProfileModal";

const STATUS_LABEL = { IN_PROGRESS: "In Progress", SUBMITTED: "Completed", AUTO_SUBMITTED: "Auto-submitted" };
const STATUS_COLOR = { IN_PROGRESS: "var(--amber-dark)", SUBMITTED: "var(--mint)", AUTO_SUBMITTED: "var(--rust)" };
const VERIFICATION_LABEL = { PENDING: "Pending Verification", VERIFIED: "Verified", REJECTED: "Rejected" };
const VERIFICATION_COLOR = { PENDING: "var(--amber-dark)", VERIFIED: "var(--mint)", REJECTED: "var(--rust)" };

// Renders at /admin/students/:id, /staff/students/:id (basePath set, full management actions)
// and /dashboard/performance (no :id — self-view, read-only actions only).
export default function StudentPerformance({ basePath }) {
  const { id: paramId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const studentId = paramId || user.id;
  const isManager = !!basePath;
  const canEditProfile = isManager && user.role === "ADMIN";

  const [perf, setPerf] = useState(null);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [downloadingProfile, setDownloadingProfile] = useState(false);
  const [reattempting, setReattempting] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [sentCredential, setSentCredential] = useState(null); // { password, emailSent }
  const [copied, setCopied] = useState(false);

  const [placementProfile, setPlacementProfile] = useState(null); // { user, profile, ... } from GET /profile/:studentId
  const [placementOffers, setPlacementOffers] = useState(null); // { offers, summary } from GET /placement/offers/student/:studentId
  const [eligibilitySaving, setEligibilitySaving] = useState(false);
  const [verifyingOfferId, setVerifyingOfferId] = useState(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState({}); // offerId -> text

  const [docTypes, setDocTypes] = useState([]);
  const [documents, setDocuments] = useState(null); // from GET /documents/student/:studentId
  const [verifyingDocId, setVerifyingDocId] = useState(null);
  const [docReasonDraft, setDocReasonDraft] = useState({}); // documentId -> text
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [bulkVerifying, setBulkVerifying] = useState(false);

  function load() {
    api.get(`/users/${studentId}/performance`)
      .then((res) => setPerf(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load performance data"));
  }

  useEffect(load, [studentId]);

  // Placement data is manager-only (ADMIN/STAFF/CLERK viewing a specific student) — a student's
  // own self-view never sees eligibility flags, matching this platform's "internal tracking only,
  // never shown to the student" design for both eligibility evaluations.
  useEffect(() => {
    if (!isManager) return;
    api.get(`/profile/${studentId}`).then((res) => setPlacementProfile(res.data)).catch(() => setPlacementProfile(null));
    api.get(`/placement/offers/student/${studentId}`).then((res) => setPlacementOffers(res.data)).catch(() => setPlacementOffers(null));
    api.get("/documents/types").then((res) => setDocTypes(res.data)).catch(() => setDocTypes([]));
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, isManager]);

  function loadDocuments() {
    api.get(`/documents/student/${studentId}`).then((res) => setDocuments(res.data)).catch(() => setDocuments(null));
  }

  async function setDepartmentEligibility(status) {
    setEligibilitySaving(true);
    try {
      await api.patch(`/placement/students/${studentId}/department-eligibility`, { status });
      toast.success("Department eligibility updated.");
      const res = await api.get(`/profile/${studentId}`);
      setPlacementProfile(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update department eligibility");
    } finally {
      setEligibilitySaving(false);
    }
  }

  async function setClerkEligibility(status) {
    setEligibilitySaving(true);
    try {
      await api.patch(`/placement/students/${studentId}/clerk-eligibility`, { status });
      toast.success("Placement Cell eligibility updated.");
      const res = await api.get(`/profile/${studentId}`);
      setPlacementProfile(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update eligibility");
    } finally {
      setEligibilitySaving(false);
    }
  }

  async function verifyOffer(offerId, status) {
    setVerifyingOfferId(offerId);
    try {
      await api.patch(`/placement/offers/${offerId}/verify`, { status, rejectionReason: status === "REJECTED" ? (rejectReasonDraft[offerId] || "") : undefined });
      toast.success(status === "VERIFIED" ? "Offer verified." : "Offer rejected.");
      const res = await api.get(`/placement/offers/student/${studentId}`);
      setPlacementOffers(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update verification");
    } finally {
      setVerifyingOfferId(null);
    }
  }

  async function verifyDocument(docId, status) {
    const reason = (docReasonDraft[docId] || "").trim();
    if (status !== "VERIFIED" && !reason) {
      toast.error("A remark is required when rejecting or requesting re-upload");
      return;
    }
    setVerifyingDocId(docId);
    try {
      await api.patch(`/documents/${docId}/verify`, { status, reason: status !== "VERIFIED" ? reason : undefined });
      toast.success(status === "VERIFIED" ? "Document verified." : status === "REJECTED" ? "Document rejected." : "Re-upload requested.");
      loadDocuments();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update verification");
    } finally {
      setVerifyingDocId(null);
    }
  }

  function toggleDocSelected(docId) {
    setSelectedDocIds((prev) => (prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]));
  }

  async function bulkVerifyDocuments(status) {
    if (selectedDocIds.length === 0) return;
    let reason;
    if (status !== "VERIFIED") {
      reason = (docReasonDraft.bulk || "").trim();
      if (!reason) {
        toast.error("A remark is required when rejecting or requesting re-upload");
        return;
      }
    }
    setBulkVerifying(true);
    try {
      const { data } = await api.post("/documents/bulk-verify", { documentIds: selectedDocIds, status, reason });
      toast.success(`${data.verifiedCount} document${data.verifiedCount === 1 ? "" : "s"} updated${data.skipped ? `, ${data.skipped} skipped` : ""}.`);
      setSelectedDocIds([]);
      loadDocuments();
    } catch (err) {
      toast.error(err.response?.data?.error || "Bulk verification failed");
    } finally {
      setBulkVerifying(false);
    }
  }

  async function deleteDocumentAsManager(doc) {
    const ok = await confirmDialog({
      title: "Delete Document",
      message: `Delete "${docTypes.find((t) => t.value === doc.documentType)?.label || doc.documentType}"${doc.label ? ` — ${doc.label}` : ""}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setVerifyingDocId(doc.id);
    try {
      await api.delete(`/documents/${doc.id}/admin`);
      toast.success("Document deleted.");
      loadDocuments();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete document");
    } finally {
      setVerifyingDocId(null);
    }
  }

  async function downloadDocument(doc) {
    setVerifyingDocId(doc.id);
    try {
      const { data, headers } = await api.get(`/documents/${doc.id}/download`, { responseType: "blob" });
      const typeLabel = docTypes.find((t) => t.value === doc.documentType)?.label || doc.documentType;
      const cd = headers["content-disposition"] || "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${typeLabel}${doc.label ? `-${doc.label}` : ""}`;
      const url = URL.createObjectURL(new Blob([data], { type: headers["content-type"] || "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download document");
    } finally {
      setVerifyingDocId(null);
    }
  }

  async function downloadReport(format) {
    setDownloading(format);
    try {
      const { data } = await api.get(`/users/${studentId}/performance/report.${format}`, { responseType: "blob" });
      const blob = new Blob([data], {
        type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${perf.student.rollNumber || perf.student.id}-performance-report.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert(`Failed to download ${format.toUpperCase()} report`);
    } finally {
      setDownloading(null);
    }
  }

  async function downloadProfilePdf() {
    setDownloadingProfile(true);
    try {
      const { data } = await api.get(`/profile/${studentId}/report.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${perf.student.rollNumber || studentId}-profile.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download profile PDF");
    } finally {
      setDownloadingProfile(false);
    }
  }

  async function viewReport() {
    try {
      const { data } = await api.get(`/users/${studentId}/performance/report.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      window.open(url, "_blank");
    } catch {
      alert("Failed to open report");
    }
  }

  async function resetPassword() {
    const ok = await confirmDialog({
      title: "Reset Password",
      message: `Are you sure you want to reset ${student?.name || "this student"}'s password? A new, unique password will be generated and emailed to them. They will be required to set a new password during their next login.`,
      confirmLabel: "Reset Password",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    setCopied(false);
    try {
      const { data } = await api.post(`/users/${studentId}/reset-password`, { sendEmail: true });
      setSentCredential({ password: data.defaultPassword, emailSent: data.emailSent, emailError: data.emailError });
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset password");
    } finally {
      setResetting(false);
    }
  }

  function copySentCredential() {
    if (!sentCredential) return;
    const text = `Email: ${perf.student.email}\nPassword: ${sentCredential.password}\nLogin: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function grantReattempt(testId, testName) {
    if (!confirm(`Allow ${perf.student.name} to reattempt "${testName}"? This resets their previous attempt.`)) return;
    setReattempting(testId);
    try {
      await api.post(`/tests/${testId}/attempts/${studentId}/reattempt`);
      alert("Reattempt granted.");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to grant reattempt");
    } finally {
      setReattempting(null);
    }
  }

  if (error) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
          <p style={{ color: "var(--rust)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!perf) {
    return (
      <div>
        <Navbar />
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
          <SkeletonLine width="40%" height={28} />
          <div style={{ marginTop: 24 }}><SkeletonGrid count={4} minWidth={180} /></div>
        </div>
      </div>
    );
  }

  const { student, summary, testHistory, analytics } = perf;
  const codingVsMcqData = [
    { name: "Coding", percentage: analytics.codingVsMcq.coding.percentage, detail: `${analytics.codingVsMcq.coding.solved}/${analytics.codingVsMcq.coding.attempted}` },
    { name: "MCQ", percentage: analytics.codingVsMcq.mcq.percentage, detail: `${analytics.codingVsMcq.mcq.correct}/${analytics.codingVsMcq.mcq.attempted}` },
  ];

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1>{isManager ? student.name : "Your performance"}</h1>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isManager && <Link to={`${basePath}/students`} className="btn btn-ghost">← Back to search</Link>}
            <button className="btn btn-ghost" onClick={viewReport}>View Detailed Report</button>
            <button className="btn btn-ghost" onClick={() => downloadReport("pdf")} disabled={downloading === "pdf"}>
              {downloading === "pdf" ? "Preparing…" : "Download PDF"}
            </button>
            <button className="btn btn-ghost" onClick={() => downloadReport("xlsx")} disabled={downloading === "xlsx"}>
              {downloading === "xlsx" ? "Preparing…" : "Download Excel"}
            </button>
            {isManager && (
              <button className="btn btn-ghost" onClick={downloadProfilePdf} disabled={downloadingProfile}>
                {downloadingProfile ? "Preparing…" : "Download Profile PDF"}
              </button>
            )}
            {isManager && (
              <button className="btn btn-ghost" onClick={resetPassword} disabled={resetting} title="Generates a new unique password and emails it to the student">
                {resetting ? "Sending…" : "Send Credentials"}
              </button>
            )}
            {canEditProfile && (
              <button className="btn btn-primary" onClick={() => setShowEdit(true)}>Edit Profile</button>
            )}
          </div>
        </div>

        {!student.isActive && (
          <p className="mono" style={{ color: "var(--rust)", fontSize: 13, marginTop: 12, fontWeight: 700 }}>
            ⚠ This account is deactivated — the student cannot log in.
          </p>
        )}

        {sentCredential && (
          <div className="card" style={{ padding: 16, marginTop: 16, background: "var(--mint-bg, rgba(76,175,80,0.08))" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>New credentials generated for {student.name}</div>
            <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>
              {student.email} — password: <strong>{sentCredential.password}</strong>
            </div>
            {sentCredential.emailSent === true && (
              <p style={{ fontSize: 12, color: "var(--mint)", marginTop: 6, fontWeight: 600 }}>✓ Welcome email sent successfully.</p>
            )}
            {sentCredential.emailSent === false && (
              <div style={{ marginTop: 6 }}>
                <p style={{ fontSize: 12, color: "var(--rust)", fontWeight: 600 }}>✗ Email could not be delivered.</p>
                <p className="mono" style={{ fontSize: 11, color: "var(--rust)", marginTop: 2 }}>Reason: {sentCredential.emailError || "Unknown error"}</p>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={copySentCredential}>
                {copied ? "✓ Copied" : "Copy Login Credentials"}
              </button>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={resetPassword} disabled={resetting}>
                {resetting ? "Resending…" : "✉ Resend Welcome Email"}
              </button>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setSentCredential(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Student info */}
        <div className="card" style={{ padding: 20, marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <Field label="Roll Number" value={student.rollNumber} mono />
          <Field label="Registration Number" value={student.registrationNumber} mono />
          <Field label="Institute" value={student.institute?.name} />
          <Field label="Department" value={student.academicGroup?.department?.name || student.department} />
          <Field label="Course" value={student.program} />
          <Field label="Section" value={student.academicGroup?.section || student.section} />
          <Field label="Batch Year" value={student.academicGroup?.batch || student.batchYear} />
          <Field label="Official Email" value={student.email} mono />
          <Field label="Mobile" value={student.mobile} mono />
          <Field label="Status" value={student.isActive === false ? "Inactive" : "Active"} />
        </div>

        {/* Profile */}
        {isManager && placementProfile && (
          <div className="card" style={{ padding: 20, marginTop: 20 }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Profile</h3>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {placementProfile.user?.profilePhotoUrl ? (
                <img src={placementProfile.user.profilePhotoUrl} alt="Profile" style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 84, height: 84, borderRadius: "50%", background: "var(--surface-2, #eee)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: "var(--ink-dim)" }}>
                  No photo
                </div>
              )}
              <div style={{ flex: 1, minWidth: 260, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                <Field label="Gender" value={placementProfile.user?.gender} />
                <Field label="Personal Email" value={placementProfile.profile?.personalEmail} mono />
                <Field label="LinkedIn" value={placementProfile.linkedin} link />
                <Field label="Date of Birth" value={placementProfile.profile?.dob ? new Date(placementProfile.profile.dob).toLocaleDateString() : null} />
                <Field label="Address" value={placementProfile.profile?.address} />
                <Field label="State" value={placementProfile.profile?.state} />
                <Field label="District" value={placementProfile.profile?.district} />
                <Field label="Pincode" value={placementProfile.profile?.pincode} />
                <Field label="Father's Name" value={placementProfile.profile?.fatherName} />
                <Field label="Father's Contact" value={placementProfile.profile?.fatherContact} mono />
                <Field label="Mother's Name" value={placementProfile.profile?.motherName} />
                <Field label="Mother's Contact" value={placementProfile.profile?.motherContact} mono />
                <Field label="LeetCode" value={placementProfile.profile?.leetcodeHandle} />
                <Field label="HackerRank" value={placementProfile.profile?.hackerrankHandle} />
                <Field label="StopStalk" value={placementProfile.profile?.stopstalkHandle} />
                <Field label="AMCAT ID" value={placementProfile.profile?.amcatId} />
                <Field label="CoCubes ID" value={placementProfile.profile?.cocubesId} />
              </div>
            </div>

            {placementProfile.profile?.shortDescription && (
              <p style={{ fontSize: 13, marginTop: 14, color: "var(--ink-dim)" }}>{placementProfile.profile.shortDescription}</p>
            )}

            <h4 style={{ fontSize: 14, marginTop: 18, marginBottom: 8 }}>Career History &amp; Education</h4>
            {!placementProfile.education || placementProfile.education.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No education records added yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {placementProfile.education.map((e, i) => (
                  <div key={i} className="card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.degree}{e.specialization ? ` (${e.specialization})` : ""}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                      {e.institution || "—"} · {e.board || "—"} · {e.startYear || "—"}–{e.endYear || "—"} · Score: {e.score || "—"} · {e.status || "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Placement */}
        {isManager && (placementProfile || placementOffers) && (
          <div className="card" style={{ padding: 20, marginTop: 20 }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Placement</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <Field
                label="Registration Status"
                value={
                  placementProfile?.profile?.placementParticipation === "INTERESTED" ? "Registered"
                    : placementProfile?.profile?.placementParticipation === "NOT_INTERESTED" ? "Not Registered"
                    : "Not set yet"
                }
              />
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Department Eligibility</div>
                {(user.role === "STAFF" || user.role === "ADMIN") ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button className={placementProfile?.profile?.departmentEligibility === "ELIGIBLE" ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 11, padding: "3px 8px" }} disabled={eligibilitySaving} onClick={() => setDepartmentEligibility("ELIGIBLE")}>Eligible</button>
                    <button className={placementProfile?.profile?.departmentEligibility === "NOT_ELIGIBLE" ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 11, padding: "3px 8px" }} disabled={eligibilitySaving} onClick={() => setDepartmentEligibility("NOT_ELIGIBLE")}>Not Eligible</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, marginTop: 2 }}>{placementProfile?.profile?.departmentEligibility || "—"}</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Placement Cell Eligibility</div>
                {(user.role === "CLERK" || user.role === "ADMIN") ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button className={placementProfile?.profile?.clerkEligibility === "ELIGIBLE" ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 11, padding: "3px 8px" }} disabled={eligibilitySaving} onClick={() => setClerkEligibility("ELIGIBLE")}>Eligible</button>
                    <button className={placementProfile?.profile?.clerkEligibility === "NOT_ELIGIBLE" ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 11, padding: "3px 8px" }} disabled={eligibilitySaving} onClick={() => setClerkEligibility("NOT_ELIGIBLE")}>Not Eligible</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, marginTop: 2 }}>{placementProfile?.profile?.clerkEligibility || "—"}</div>
                )}
              </div>
            </div>

            <h4 style={{ fontSize: 14, marginTop: 18, marginBottom: 8 }}>Placement Offers</h4>
            {!placementOffers || placementOffers.offers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No offers submitted yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {placementOffers.offers.map((o) => (
                  <div key={o.id} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.companyName} — {o.offerType === "INTERNSHIP" ? "Internship" : "Placement"}</div>
                        <div className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                          {o.offeredPackage} {o.offerType === "INTERNSHIP" ? "/month" : "LPA"} · {o.source === "ON_CAMPUS" ? "On-Campus" : "Off-Campus"} · {o.offerStatus}
                          {o.joiningStatus && ` · ${o.joiningStatus}`}
                        </div>
                        <a href={o.proofLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--mint)" }}>View proof document →</a>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="badge" style={{ color: VERIFICATION_COLOR[o.verificationStatus], fontWeight: 700 }}>{VERIFICATION_LABEL[o.verificationStatus]}</span>
                        {o.verificationStatus === "PENDING" && (
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                            <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 8px" }} disabled={verifyingOfferId === o.id} onClick={() => verifyOffer(o.id, "VERIFIED")}>Verify</button>
                            <input
                              placeholder="Rejection reason (optional)"
                              style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line)", width: 180 }}
                              value={rejectReasonDraft[o.id] || ""}
                              onChange={(e) => setRejectReasonDraft({ ...rejectReasonDraft, [o.id]: e.target.value })}
                            />
                            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", color: "var(--rust)" }} disabled={verifyingOfferId === o.id} onClick={() => verifyOffer(o.id, "REJECTED")}>Reject</button>
                          </div>
                        )}
                        {o.verificationStatus === "REJECTED" && o.rejectionReason && (
                          <p style={{ fontSize: 11, color: "var(--rust)", marginTop: 4, maxWidth: 200 }}>{o.rejectionReason}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Documents */}
        {isManager && documents && documents.length > 0 && (
          <div className="card" style={{ padding: 20, marginTop: 20 }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Documents</h3>
            {selectedDocIds.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", marginBottom: 10, background: "var(--card-bg, #F7F5EF)", borderRadius: 8 }}>
                <span style={{ fontSize: 12 }}>{selectedDocIds.length} selected</span>
                <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 8px" }} disabled={bulkVerifying} onClick={() => bulkVerifyDocuments("VERIFIED")}>Verify Selected</button>
                <input
                  placeholder="Reason (for reject / re-upload)"
                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line)", width: 180 }}
                  value={docReasonDraft.bulk || ""}
                  onChange={(e) => setDocReasonDraft({ ...docReasonDraft, bulk: e.target.value })}
                />
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", color: "var(--rust)" }} disabled={bulkVerifying} onClick={() => bulkVerifyDocuments("REJECTED")}>Reject Selected</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} disabled={bulkVerifying} onClick={() => bulkVerifyDocuments("REUPLOAD_REQUIRED")}>Request Re-upload (Selected)</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSelectedDocIds([])}>Clear</button>
              </div>
            )}
            <div style={{ display: "grid", gap: 8 }}>
              {documents.map((d) => {
                const typeLabel = docTypes.find((t) => t.value === d.documentType)?.label || d.documentType;
                return (
                  <div key={d.id} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        {d.verificationStatus === "PENDING" && (
                          <input type="checkbox" checked={selectedDocIds.includes(d.id)} onChange={() => toggleDocSelected(d.id)} style={{ marginTop: 4 }} />
                        )}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{typeLabel}{d.label ? ` — ${d.label}` : ""}</div>
                          <a href={d.documentLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--mint)" }}>View document →</a>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="badge" style={{ color: VERIFICATION_COLOR[d.verificationStatus] || "var(--rust)", fontWeight: 700 }}>
                          {d.verificationStatus === "REUPLOAD_REQUIRED" ? "Re-upload Required" : VERIFICATION_LABEL[d.verificationStatus]}
                        </span>
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          {d.verificationStatus === "PENDING" && (
                            <span style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>Awaiting review</span>
                          )}
                          {d.verificationStatus !== "PENDING" && (
                            <span style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
                              Change status{d.verifiedByName ? ` (last set by ${d.verifiedByName})` : ""}
                            </span>
                          )}
                          {d.verificationStatus !== "VERIFIED" && (
                            <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 8px" }} disabled={verifyingDocId === d.id} onClick={() => verifyDocument(d.id, "VERIFIED")}>Verify</button>
                          )}
                          <input
                            placeholder="Reason (for reject / re-upload)"
                            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line)", width: 180 }}
                            value={docReasonDraft[d.id] || ""}
                            onChange={(e) => setDocReasonDraft({ ...docReasonDraft, [d.id]: e.target.value })}
                          />
                          <div style={{ display: "flex", gap: 4 }}>
                            {d.verificationStatus !== "REJECTED" && (
                              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", color: "var(--rust)" }} disabled={verifyingDocId === d.id} onClick={() => verifyDocument(d.id, "REJECTED")}>Reject</button>
                            )}
                            {d.verificationStatus !== "REUPLOAD_REQUIRED" && (
                              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} disabled={verifyingDocId === d.id} onClick={() => verifyDocument(d.id, "REUPLOAD_REQUIRED")}>Request Re-upload</button>
                            )}
                          </div>
                        </div>
                        {(d.verificationStatus === "REJECTED" || d.verificationStatus === "REUPLOAD_REQUIRED") && d.rejectionReason && (
                          <p style={{ fontSize: 11, color: "var(--rust)", marginTop: 4, maxWidth: 200 }}>{d.rejectionReason}</p>
                        )}
                        <div style={{ marginTop: 6, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {d.verificationStatus === "VERIFIED" && (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "3px 8px" }}
                              disabled={verifyingDocId === d.id}
                              onClick={() => downloadDocument(d)}
                            >
                              {verifyingDocId === d.id ? "…" : "Download"}
                            </button>
                          )}
                          {user.role === "ADMIN" && (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "3px 8px", color: "var(--rust)" }}
                              disabled={verifyingDocId === d.id}
                              onClick={() => deleteDocumentAsManager(d)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary stats */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Overall performance</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <StatCard label="Tests Assigned" value={summary.totalTestsAssigned} />
          <StatCard label="Tests Attempted" value={summary.totalTestsAttempted} />
          <StatCard label="Tests Completed" value={summary.totalTestsCompleted} accent="var(--mint)" />
          <StatCard label="Tests Pending" value={summary.totalTestsPending} accent="var(--amber-dark)" />
          <StatCard label="Average Score" value={`${summary.averageScorePercent}%`} />
          <StatCard label="Overall Percentage" value={`${summary.overallPercentage}%`} accent="var(--mint)" />
          <StatCard label="Highest Score" value={summary.highest ? `${summary.highest.percentage}%` : "—"} accent="var(--mint)" />
          <StatCard label="Lowest Score" value={summary.lowest ? `${summary.lowest.percentage}%` : "—"} accent="var(--rust)" />
          <StatCard label="Coding Solved" value={`${summary.totalCodingSolved}/${summary.totalCodingAttempted}`} />
          <StatCard label="MCQs Attempted" value={summary.totalMcqAttempted} />
          <StatCard label="MCQs Correct" value={summary.totalMcqCorrect} accent="var(--mint)" />
          <StatCard label="Time Spent" value={`${summary.totalTimeSpentMin} min`} />
        </div>
        <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 10 }}>
          Last test attempt: {summary.lastAttemptDate ? new Date(summary.lastAttemptDate).toLocaleString() : "—"}
        </p>

        {/* Test history */}
        <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Test history</h3>
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
                <th style={{ padding: "10px 12px" }}>Test Name</th>
                <th style={{ padding: "10px 12px" }}>Date</th>
                <th style={{ padding: "10px 12px" }}>Score</th>
                <th style={{ padding: "10px 12px" }}>Percentage</th>
                <th style={{ padding: "10px 12px" }}>Time Taken</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
                {isManager && <th style={{ padding: "10px 12px" }}></th>}
              </tr>
            </thead>
            <tbody>
              {testHistory.map((h) => (
                <tr key={h.testId} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <td style={{ padding: "10px 12px" }}>{h.testName}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{new Date(h.date).toLocaleDateString()}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{h.resultsPending ? "—" : `${h.score}/${h.maxScore}`}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{h.resultsPending ? "Pending" : `${h.percentage}%`}</td>
                  <td className="mono" style={{ padding: "10px 12px" }}>{h.timeTakenMin != null ? `${h.timeTakenMin} min` : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className="mono" style={{ fontWeight: 700, color: STATUS_COLOR[h.status] }}>{STATUS_LABEL[h.status] || h.status}</span>
                  </td>
                  {isManager && (
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {(user.role === "ADMIN" || user.role === "STAFF") && h.status !== "IN_PROGRESS" && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => grantReattempt(h.testId, h.testName)}
                          disabled={reattempting === h.testId}
                        >
                          {reattempting === h.testId ? "Granting…" : "Allow Reattempt"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {testHistory.length === 0 && (
                <tr>
                  <td colSpan={isManager ? 7 : 6} style={{ padding: 24, textAlign: "center", color: "var(--ink-dim)" }}>
                    No test attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Analytics */}
        {testHistory.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 12 }}>Performance analytics</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 20 }}>
              <ChartCard title="Score trend over time">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={analytics.scoreTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="testName" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="percentage" stroke="var(--mint)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Test-wise performance">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={analytics.scoreTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="testName" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Bar dataKey="percentage" fill="var(--amber)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {analytics.subjectWise.length > 0 && (
                <ChartCard title="Subject-wise performance">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={analytics.subjectWise}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                      <Tooltip formatter={(v) => `${v}%`} />
                      <Bar dataKey="percentage" fill="var(--mint)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}

              <ChartCard title="Coding vs MCQ performance">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={codingVsMcqData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(v, n, p) => [`${v}% (${p.payload.detail})`, "Accuracy"]} />
                    <Bar dataKey="percentage" fill="var(--amber-dark)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {analytics.monthly.length > 0 && (
                <ChartCard title="Monthly performance summary">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={analytics.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                      <Tooltip formatter={(v) => `${v}%`} />
                      <Legend />
                      <Bar dataKey="averagePercentage" name="Avg %" fill="var(--mint)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </div>
          </>
        )}
      </div>

      {showEdit && (
        <EditStudentProfileModal
          studentId={studentId}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            toast.success("Profile updated.");
            load();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value, mono, link }) {
  // A bare handle like "linkedin.com/in/xyz" (no scheme) is a valid href target for a browser,
  // but not a valid absolute URL for the anchor to resolve relative to the current page — prepend
  // https:// so it always opens the profile itself rather than a codearena-app.vercel.app/... 404.
  const href = link && value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, marginTop: 2, display: "block", overflowWrap: "anywhere" }}>{value}</a>
      ) : (
        <div className={mono ? "mono" : undefined} style={{ fontSize: 14, marginTop: 2, overflowWrap: "anywhere" }}>{value || "—"}</div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: accent || "var(--ink)" }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <h4 style={{ fontSize: 14, marginBottom: 12 }}>{title}</h4>
      {children}
    </div>
  );
}
