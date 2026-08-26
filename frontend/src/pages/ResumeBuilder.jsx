import { useEffect, useRef, useState } from "react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import useAiStatus from "../hooks/useAiStatus";
import Badge from "../components/Badge";

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 4 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" };
const SECTION_LABELS = { personal: "Personal Details", summary: "Professional Summary", education: "Education", skills: "Skills", projects: "Projects", experience: "Experience", certifications: "Certifications" };

// Five genuinely distinct layouts (see ResumePreview below + backend/src/utils/resumePdf.js) —
// not just a color swap. Ids/colors kept in sync with resumePdf.js's TEMPLATE_META.
const TEMPLATES = [
  { id: "modern", label: "Modern", accent: "#4F9D6E", desc: "Two-column, timeline experience" },
  { id: "professional", label: "Professional", accent: "#1C3D5A", desc: "ATS-friendly, single-column" },
  { id: "minimal", label: "Minimal", accent: "#1C1B18", desc: "Black & white, tight spacing" },
  { id: "executive", label: "Executive", accent: "#2B2118", desc: "Premium corporate style" },
  { id: "creative", label: "Creative", accent: "#9C4FD6", desc: "Visual header, skill tags" },
];

const EDUCATION_FIELDS = [
  { key: "degree", label: "Degree" }, { key: "specialization", label: "Specialization" },
  { key: "institution", label: "College / University" }, { key: "board", label: "Board (if applicable)" },
  { key: "startYear", label: "Start Year" }, { key: "endYear", label: "End Year" },
  { key: "score", label: "CGPA / Percentage" },
  { key: "status", label: "Current Status", type: "select", options: ["Pursuing", "Completed"] },
];
const SKILL_FIELDS = [
  { key: "category", label: "Category", type: "select", options: ["Programming Languages", "Frameworks", "Databases", "Cloud", "DevOps", "Tools", "Libraries", "Soft Skills", "Other"] },
  { key: "name", label: "Skill" },
  { key: "proficiency", label: "Proficiency", type: "select", options: ["Beginner", "Intermediate", "Advanced"] },
];
const PROJECT_FIELDS = [
  { key: "title", label: "Project Title" },
  { key: "description", label: "Description", type: "textarea", wide: true, improvable: "project" },
  { key: "technologies", label: "Technologies Used" }, { key: "role", label: "Role" }, { key: "duration", label: "Duration" },
  { key: "githubUrl", label: "GitHub Repository Link" }, { key: "liveUrl", label: "Live Demo Link (optional)" },
];
const EXPERIENCE_FIELDS = [
  { key: "company", label: "Company Name", type: "company" }, { key: "title", label: "Job Title" },
  { key: "employmentType", label: "Employment Type", type: "select", options: ["Internship", "Full-Time", "Freelance", "Research Project"] },
  { key: "startDate", label: "Start Date" }, { key: "endDate", label: "End Date" },
  { key: "responsibilities", label: "Responsibilities", type: "textarea", wide: true, improvable: "experience" },
  { key: "technologies", label: "Technologies Used" },
];
const CERT_FIELDS = [
  { key: "name", label: "Certification Name" }, { key: "org", label: "Issuing Organization" },
  { key: "issueDate", label: "Issue Date" }, { key: "expiryDate", label: "Expiry Date (optional)" },
  { key: "credentialId", label: "Credential ID" }, { key: "credentialUrl", label: "Credential URL" },
];
const ACHIEVEMENT_FIELDS = [
  { key: "category", label: "Category", type: "select", options: ["Award", "Hackathon", "Contest Ranking", "Scholarship", "Academic", "Open Source"] },
  { key: "text", label: "Description", type: "textarea", wide: true, improvable: "achievement" },
];
const LANGUAGE_FIELDS = [
  { key: "name", label: "Language" },
  { key: "proficiency", label: "Proficiency", type: "select", options: ["Beginner", "Intermediate", "Fluent", "Native"] },
];

export default function ResumeBuilder() {
  const aiAvailable = useAiStatus();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [ats, setAts] = useState(null);
  const [scoreDelta, setScoreDelta] = useState(null);
  const [checkingAts, setCheckingAts] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [zoom, setZoom] = useState(85);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [lowConfidenceFields, setLowConfidenceFields] = useState([]);
  const [confidenceScores, setConfidenceScores] = useState({});
  const [undoUploadVersionId, setUndoUploadVersionId] = useState(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [rawText, setRawText] = useState(null);
  const [showComparison, setShowComparison] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [pendingAts, setPendingAts] = useState(null);
  const [reviewChecks, setReviewChecks] = useState({});
  const [aiReview, setAiReview] = useState(null);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiReviewError, setAiReviewError] = useState("");
  const [companies, setCompanies] = useState([]);
  const fileInputRef = useRef(null);

  async function getAiReview() {
    setAiReviewing(true);
    setAiReviewError("");
    try {
      const { data: review } = await api.post("/resume/me/ai-review");
      setAiReview(review);
    } catch (err) {
      setAiReviewError(err.response?.data?.error || "AI review failed");
    } finally {
      setAiReviewing(false);
    }
  }

  function load() {
    api.get("/resume/me").then((res) => setData(res.data)).catch(() => setError("Failed to load resume"));
  }
  useEffect(load, []);
  useEffect(() => { api.get("/companies").then((res) => setCompanies(res.data)).catch(() => setCompanies([])); }, []);

  async function save(patch) {
    const { data: res } = await api.patch("/resume/me", patch);
    setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
    setAts(res.atsScore);
    setScoreDelta(res.scoreDelta);
    // Once the student has touched a section themselves, the parser's original confidence
    // score no longer applies to it — clear that section's "please review" flag.
    const touchedConfidenceKeys = new Set(
      Object.keys(patch).map((k) => (["fullName", "email", "mobile", "linkedin", "github", "portfolio", "address"].includes(k) ? "personal" : k))
    );
    setLowConfidenceFields((prev) => prev.filter((f) => !touchedConfidenceKeys.has(f)));
  }

  async function runAutofill() {
    setAutofilling(true);
    try {
      const { data: res } = await api.post("/resume/me/autofill");
      setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
      alert(res.filledFields.length ? `Auto-filled: ${res.filledFields.join(", ")}` : "Nothing new to auto-fill — your resume already has this data.");
    } catch (err) {
      alert(err.response?.data?.error || "Auto-fill failed");
    } finally {
      setAutofilling(false);
    }
  }

  async function checkAts() {
    setCheckingAts(true);
    try {
      const { data: res } = await api.get("/resume/me/ats-score");
      setAts(res);
      setReviewPending(false);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to compute ATS score");
    } finally {
      setCheckingAts(false);
    }
  }

  function confirmReview() {
    setAts(pendingAts);
    setPendingAts(null);
    setReviewPending(false);
  }

  function toggleReviewCheck(section) {
    setReviewChecks((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const { data: blob } = await api.get("/resume/me/pdf", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.resume.fullName || "resume"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download PDF");
    } finally {
      setDownloading(false);
    }
  }

  async function downloadDocx() {
    setDownloadingDocx(true);
    try {
      const { data: blob } = await api.get("/resume/me/docx", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.resume.fullName || "resume"}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download DOCX");
    } finally {
      setDownloadingDocx(false);
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("File is too large. Maximum size is 10 MB.");
      e.target.value = "";
      return;
    }
    const ext = file.name.toLowerCase().split(".").pop();
    if (!["pdf", "docx"].includes(ext)) {
      alert("Please upload a .pdf or .docx file.");
      e.target.value = "";
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setUploadProgress(0);
    try {
      const { data: res } = await api.post("/resume/me/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => setUploadProgress(evt.total ? Math.round((evt.loaded / evt.total) * 100) : null),
      });
      setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
      setScoreDelta(null);
      setLowConfidenceFields(res.lowConfidenceFields || []);
      setConfidenceScores(res.confidence || {});
      setUndoUploadVersionId(res.previousVersionId || null);
      setRawText(res.rawText || null);
      // Manual review gate: the ATS score is already computed server-side, but it's held back
      // from display until the student confirms the extracted data looks right — per spec,
      // scoring shouldn't happen (visibly) before review.
      setPendingAts(res.atsScore);
      setAts(null);
      setReviewPending(true);
      setReviewChecks({});
    } catch (err) {
      alert(err.response?.data?.error || "Failed to upload and parse this resume");
    } finally {
      setUploadProgress(null);
      e.target.value = "";
    }
  }

  async function undoUpload() {
    if (!undoUploadVersionId) return;
    try {
      const { data: res } = await api.post(`/resume/me/versions/${undoUploadVersionId}/restore`);
      setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
      setAts(res.atsScore);
      setScoreDelta(null);
      setLowConfidenceFields([]);
      setConfidenceScores({});
      setUndoUploadVersionId(null);
      setRawText(null);
      setShowComparison(false);
      setReviewPending(false);
      setPendingAts(null);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to undo the upload");
    }
  }

  async function clearAll() {
    if (!confirm("Clear ALL resume data? Your current state is saved to Version History first, so this can be undone.")) return;
    setClearingAll(true);
    try {
      const { data: res } = await api.post("/resume/me/clear-all");
      setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
      setAts(res.atsScore);
      setScoreDelta(null);
      setLowConfidenceFields([]);
      setConfidenceScores({});
      setUndoUploadVersionId(null);
      setRawText(null);
      setShowComparison(false);
      setReviewPending(false);
      setPendingAts(null);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to clear resume data");
    } finally {
      setClearingAll(false);
    }
  }

  async function clearSection(section) {
    if (!confirm(`Clear this section? Your current state is saved to Version History first, so this can be undone.`)) return;
    try {
      const { data: res } = await api.post("/resume/me/clear-section", { section });
      setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
      setAts(res.atsScore);
      setLowConfidenceFields((prev) => prev.filter((f) => f !== section));
    } catch (err) {
      alert(err.response?.data?.error || "Failed to clear this section");
    }
  }

  if (error) return <div><Navbar /><div style={{ maxWidth: 1200, margin: "0 auto", padding: 48 }}><p style={{ color: "var(--rust)" }}>{error}</p></div></div>;
  if (!data) return <div><Navbar /><div style={{ maxWidth: 1200, margin: "0 auto", padding: 48 }} className="mono">Loading…</div></div>;

  const { resume, completion, feedback } = data;
  // Old ids from before the 5-template rewrite (still possibly stored on existing resumes) map
  // onto their closest replacement so the picker highlights the right one, matching the same
  // LEGACY_TEMPLATE_MAP the backend uses in resumePdf.js.
  const LEGACY_TEMPLATE_MAP = { classic: "professional", "software-engineer": "modern", fresher: "minimal", experienced: "executive" };
  const resolvedTemplateId = LEGACY_TEMPLATE_MAP[resume.template] || resume.template;
  const template = TEMPLATES.find((t) => t.id === resolvedTemplateId) || TEMPLATES[0];

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/branding/logo.png" alt="CodeArena" style={{ height: 28, width: "auto" }} />
              <h1 style={{ margin: 0 }}>Resume Builder</h1>
            </div>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx" style={{ display: "none" }} onChange={handleFileSelected} />
            <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={uploadProgress !== null}>
              {uploadProgress !== null ? `Uploading… ${uploadProgress}%` : "Upload Existing Resume"}
            </button>
            <button className="btn btn-ghost" onClick={runAutofill} disabled={autofilling}>{autofilling ? "Filling…" : "Auto-fill from Platform"}</button>
            <button className="btn btn-ghost" onClick={() => window.print()}>Print</button>
            <button className="btn btn-ghost" onClick={downloadDocx} disabled={downloadingDocx}>{downloadingDocx ? "Preparing…" : "Download DOCX"}</button>
            <button className="btn btn-primary" onClick={downloadPdf} disabled={downloading}>{downloading ? "Preparing…" : "Download PDF"}</button>
            <button className="btn btn-ghost" style={{ color: "var(--rust)", borderColor: "var(--rust)" }} onClick={clearAll} disabled={clearingAll}>
              {clearingAll ? "Clearing…" : "Clear All Resume Data"}
            </button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
          Supported upload formats: .pdf, .docx (max 10 MB). Uploading replaces the fields below with what's extracted — review and edit afterward.
        </p>

        {Object.keys(confidenceScores).length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 16, background: lowConfidenceFields.length ? "var(--warning-bg)" : undefined, borderLeft: lowConfidenceFields.length ? "4px solid var(--amber-dark)" : undefined }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {lowConfidenceFields.length > 0
                ? "Some information could not be extracted with high confidence. Please review the highlighted sections below."
                : "✓ Resume parsed with high confidence across all sections."}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
              {Object.entries(confidenceScores).filter(([, v]) => v !== null).map(([key, pct]) => (
                <span key={key} className="mono" style={{ fontSize: 12, color: pct < 70 ? "var(--rust)" : "var(--mint)" }}>
                  {SECTION_LABELS[key] || key} {pct}%
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {undoUploadVersionId && (
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={undoUpload}>
                  ↩ Undo this upload (restore what was here before)
                </button>
              )}
              {rawText && (
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowComparison((v) => !v)}>
                  {showComparison ? "Hide" : "View"} Original vs Parsed
                </button>
              )}
            </div>
          </div>
        )}

        {showComparison && rawText && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Original Resume vs Parsed Data</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)", marginBottom: 4 }}>ORIGINAL (extracted text)</div>
                <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto", background: "var(--paper)", padding: 10, borderRadius: 6, margin: 0, fontFamily: "var(--font-mono)" }}>{rawText}</pre>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)", marginBottom: 4 }}>PARSED (what was extracted into fields)</div>
                <div style={{ fontSize: 12, maxHeight: 400, overflowY: "auto", background: "var(--paper)", padding: 10, borderRadius: 6 }}>
                  <div><strong>Name:</strong> {resume.fullName || "—"}</div>
                  <div><strong>Email:</strong> {resume.email || "—"}</div>
                  <div><strong>Mobile:</strong> {resume.mobile || "—"}</div>
                  <div><strong>Summary:</strong> {resume.summary || "—"}</div>
                  <div style={{ marginTop: 6 }}><strong>Education:</strong> {(resume.education || []).length} record(s)</div>
                  <div><strong>Skills:</strong> {(resume.skills || []).length} extracted</div>
                  <div><strong>Projects:</strong> {(resume.projects || []).length} record(s)</div>
                  <div><strong>Experience:</strong> {(resume.experience || []).length} record(s)</div>
                  <div><strong>Certifications:</strong> {(resume.certifications || []).length} record(s)</div>
                  <div><strong>Achievements:</strong> {(resume.achievements || []).length} record(s)</div>
                  <div><strong>Languages:</strong> {(resume.languages || []).length} record(s)</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {reviewPending && (
          <div className="card" style={{ padding: 16, marginTop: 16, borderLeft: "4px solid var(--amber-dark)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Review Extracted Data</div>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              Check each section below (edit any that need fixing), then confirm to calculate your ATS score.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
              {Object.keys(SECTION_LABELS).map((key) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!reviewChecks[key]} onChange={() => toggleReviewCheck(key)} />
                  {SECTION_LABELS[key]}
                </label>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12, fontSize: 12 }}
              onClick={confirmReview}
              disabled={Object.keys(SECTION_LABELS).some((k) => !reviewChecks[k])}
            >
              ✓ Confirm &amp; Calculate ATS Score
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 12, marginLeft: 8, fontSize: 12 }} onClick={confirmReview}>
              Skip review — show score now
            </button>
          </div>
        )}

        {/* Completion */}
        <div className="card" style={{ padding: 16, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Resume Completion</span>
            <span className="mono" style={{ fontWeight: 700, color: "var(--mint)" }}>{completion.percent}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${completion.percent}%`, background: "var(--mint)" }} />
          </div>
          {completion.missingSections.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Missing: {completion.missingSections.join(", ")}</div>
          )}
        </div>

        {feedback.length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 16, background: "var(--warning-bg)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Feedback from your institute</div>
            {feedback.map((f) => (
              <div key={f.id} style={{ fontSize: 13, marginTop: 6 }}>
                <strong>{f.authorName}:</strong> {f.message}
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: 8 }}>{new Date(f.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 24, marginTop: 24, alignItems: "start" }} className="resume-builder-layout">
          {/* Left: editor */}
          <div style={{ display: "grid", gap: 16 }}>
            {/* Template picker */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Template</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => save({ template: t.id })}
                    className={resolvedTemplateId === t.id ? "btn btn-dark" : "btn btn-ghost"}
                    style={{ fontSize: 12, borderLeft: `4px solid ${t.accent}` }}
                    title={t.desc}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ATS score */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>ATS Score Checker</div>
                {!reviewPending && (
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={checkAts} disabled={checkingAts}>{checkingAts ? "Checking…" : ats ? "Regenerate" : "Check ATS Score"}</button>
                )}
              </div>
              {reviewPending && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Complete the "Review Extracted Data" step above to see your ATS score.</p>
              )}
              {ats && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: ats.score >= 75 ? "var(--mint)" : ats.score >= 60 ? "var(--amber-dark)" : "var(--rust)" }}>{ats.score}/100</span>
                    <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>{ats.status}</span>
                  </div>

                  {scoreDelta && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: scoreDelta.overall >= 0 ? "var(--success-bg)" : "var(--danger-bg)" }}>
                      <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: scoreDelta.overall >= 0 ? "var(--mint)" : "var(--rust)" }}>
                        {scoreDelta.previous} → {scoreDelta.current} ({scoreDelta.overall >= 0 ? "+" : ""}{scoreDelta.overall})
                      </div>
                      {scoreDelta.byCategory.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>What changed</div>
                          {scoreDelta.byCategory.map((c, i) => (
                            <div key={i} style={{ fontSize: 11, color: c.delta >= 0 ? "var(--mint)" : "var(--rust)" }}>
                              {c.label} {c.delta >= 0 ? "+" : ""}{c.delta}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Section breakdown</div>
                    {ats.breakdown.map((b) => (
                      <div key={b.key} style={{ marginBottom: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                          <span>{b.label}</span>
                          <span className="mono">{b.score}/{b.max}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: "var(--line)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(b.score / b.max) * 100}%`, background: b.score === b.max ? "var(--mint)" : "var(--amber-dark)" }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {ats.actionVerbUsage && (
                    <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-dim)" }}>
                      {ats.actionVerbUsage.strongCount} strong action verb{ats.actionVerbUsage.strongCount === 1 ? "" : "s"} found
                      {ats.actionVerbUsage.weakCount > 0 && `, ${ats.actionVerbUsage.weakCount} weak phrase${ats.actionVerbUsage.weakCount === 1 ? "" : "s"} to replace`}.
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Suggestions</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {ats.suggestions.map((s, i) => (
                        <div key={i} style={{ fontSize: 12 }}>
                          <div style={{ color: "var(--rust)" }}>❌ {s.issue}</div>
                          <div style={{ color: "var(--ink-dim)", marginTop: 1 }}>→ {s.recommendation}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* AI Review — a real Gemini call reviewing the whole resume at once; augments the ATS
                score above rather than replacing it. The per-field "Improve with AI" buttons
                elsewhere on this page also call Gemini now (falling back to a deterministic
                rule-based rewrite only when the server has no GEMINI_API_KEY configured). */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>AI Resume Review</div>
                {aiAvailable === false ? (
                  <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>Coming soon</span>
                ) : (
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={getAiReview} disabled={aiReviewing || reviewPending || aiAvailable !== true}>
                    {aiReviewing ? "Reviewing…" : aiReview ? "Regenerate" : "Get AI Review"}
                  </button>
                )}
              </div>
              {aiAvailable === false && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>AI-powered review isn't available on this server yet.</p>
              )}
              {reviewPending && (
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>Complete the "Review Extracted Data" step above first.</p>
              )}
              {aiReviewError && <p style={{ color: "var(--rust)", fontSize: 12, marginTop: 8 }}>{aiReviewError}</p>}
              {aiReview && (
                <div style={{ marginTop: 12, fontSize: 13 }}>
                  <p>{aiReview.overallFeedback}</p>
                  {aiReview.strengths?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Strengths</div>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {aiReview.strengths.map((s, i) => <li key={i} style={{ fontSize: 12, color: "var(--mint)" }}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {aiReview.improvements?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Suggested improvements</div>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {aiReview.improvements.map((s, i) => <li key={i} style={{ fontSize: 12, color: "var(--ink-dim)" }}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <TargetRoleCard resume={resume} onRoleChange={(targetRole) => setData((d) => ({ ...d, resume: { ...d.resume, targetRole } }))} />

            <VersionHistoryCard onRestore={(res) => {
              setData((d) => ({ ...d, resume: res.resume, completion: res.completion }));
              setAts(res.atsScore);
              setScoreDelta(null);
              setReviewPending(false);
              setPendingAts(null);
              setShowComparison(false);
            }} />

            {/* Personal details */}
            <PersonalDetailsForm resume={resume} onSave={save}
              lowConfidence={lowConfidenceFields.includes("personal") || lowConfidenceFields.includes("summary")}
              confidence={confidenceScores.personal} />

            <ArraySectionEditor title="Education" items={resume.education || []} fields={EDUCATION_FIELDS}
              onChange={(items) => save({ education: items })}
              onClear={() => clearSection("education")}
              lowConfidence={lowConfidenceFields.includes("education")}
              confidence={confidenceScores.education}
              renderSummary={(e) => `${e.degree || "—"}${e.specialization ? ` (${e.specialization})` : ""} — ${e.institution || "—"}`} />

            <ArraySectionEditor title="Skills" items={resume.skills || []} fields={SKILL_FIELDS}
              onChange={(items) => save({ skills: items })}
              onClear={() => clearSection("skills")}
              lowConfidence={lowConfidenceFields.includes("skills")}
              confidence={confidenceScores.skills}
              groupBy={(s) => s.category || "Other"}
              renderSummary={(s) => `${s.name || "—"} — ${s.category || "Other"} (${s.proficiency || "—"})`} />

            <ArraySectionEditor title="Projects" items={resume.projects || []} fields={PROJECT_FIELDS}
              onChange={(items) => save({ projects: items })}
              onClear={() => clearSection("projects")}
              lowConfidence={lowConfidenceFields.includes("projects")}
              confidence={confidenceScores.projects}
              allowSplitMerge
              renderSummary={(p) => `${p.title || "—"}${p.role ? ` — ${p.role}` : ""}`} />

            <ArraySectionEditor title="Experience" items={resume.experience || []} fields={EXPERIENCE_FIELDS}
              onChange={(items) => save({ experience: items })}
              onClear={() => clearSection("experience")}
              lowConfidence={lowConfidenceFields.includes("experience")}
              confidence={confidenceScores.experience}
              allowSplitMerge
              companies={companies}
              renderSummary={(e) => `${e.title || "—"} at ${e.company || "—"} (${e.employmentType || "—"})`} />

            <ArraySectionEditor title="Certifications" items={resume.certifications || []} fields={CERT_FIELDS}
              onChange={(items) => save({ certifications: items })}
              onClear={() => clearSection("certifications")}
              lowConfidence={lowConfidenceFields.includes("certifications")}
              confidence={confidenceScores.certifications}
              allowSplitMerge
              renderSummary={(c) => `${c.name || "—"} — ${c.org || "—"}`} />

            <ArraySectionEditor title="Achievements" items={resume.achievements || []} fields={ACHIEVEMENT_FIELDS}
              onChange={(items) => save({ achievements: items })}
              onClear={() => clearSection("achievements")}
              renderSummary={(a) => `[${a.category || "—"}] ${a.text || "—"}`} />

            <ArraySectionEditor title="Languages" items={resume.languages || []} fields={LANGUAGE_FIELDS}
              onChange={(items) => save({ languages: items })}
              onClear={() => clearSection("languages")}
              renderSummary={(l) => `${l.name || "—"} — ${l.proficiency || "—"}`} />
          </div>

          {/* Right: live preview */}
          <div style={{ position: "sticky", top: 20 }}>
            <div className="card" style={{ padding: 12, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Live Preview</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setZoom((z) => Math.max(50, z - 10))}>-</button>
                <span className="mono" style={{ fontSize: 11 }}>{zoom}%</span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setZoom((z) => Math.min(150, z + 10))}>+</button>
              </div>
            </div>
            <div style={{ overflow: "auto", maxHeight: "80vh", border: "1px solid var(--line)", borderRadius: 8, background: "#ddd", padding: 16 }}>
              <div id="resume-print-area" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center", transition: "transform 0.15s" }}>
                <ResumePreview resume={resume} accent={template.accent} templateId={resolvedTemplateId} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #resume-print-area, #resume-print-area * { visibility: visible; }
          #resume-print-area { position: absolute; top: 0; left: 0; transform: none !important; }
        }
        @media (max-width: 900px) {
          .resume-builder-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function ConfidenceBadge({ confidence, lowConfidence }) {
  if (confidence == null) return lowConfidence ? <Badge tone="warning" style={{ fontSize: 11 }}>Please review</Badge> : null;
  return (
    <Badge tone={confidence < 70 ? "warning" : "success"} style={{ fontSize: 11 }} mono>
      {confidence}% confidence
    </Badge>
  );
}

// Full Name/Photo/Email/Mobile/Address are independently editable here — Resume Builder keeps
// its own copy of these, separate from Profile's institutional record, so a student's resume
// contact details don't have to match their Profile exactly.
function PersonalDetailsForm({ resume, onSave, lowConfidence, confidence }) {
  const [form, setForm] = useState({
    fullName: resume.fullName || "", email: resume.email || "", mobile: resume.mobile || "",
    photoUrl: resume.photoUrl || "", address: resume.address || "",
    linkedin: resume.linkedin || "", github: resume.github || "", portfolio: resume.portfolio || "",
    summary: resume.summary || "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, border: lowConfidence ? "2px solid var(--amber-dark)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Personal Details</div>
        <ConfidenceBadge confidence={confidence} lowConfidence={lowConfidence} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <Field label="Full Name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
        <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Field label="Mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
        <Field label="Profile Picture URL" value={form.photoUrl} onChange={(v) => setForm({ ...form, photoUrl: v })} />
      </div>
      {form.photoUrl && <img src={form.photoUrl} alt="Preview" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", marginTop: 10 }} />}
      <div style={{ marginTop: 10 }}>
        <label style={labelStyle}>Address</label>
        <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
        <Field label="LinkedIn Profile" value={form.linkedin} onChange={(v) => setForm({ ...form, linkedin: v })} />
        <Field label="GitHub Profile" value={form.github} onChange={(v) => setForm({ ...form, github: v })} />
        <Field label="Portfolio Website (optional)" value={form.portfolio} onChange={(v) => setForm({ ...form, portfolio: v })} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={labelStyle}>Career Objective / Professional Summary</label>
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        <ImproveButton text={form.summary} section="summary" onApply={(improved) => setForm((f) => ({ ...f, summary: improved }))} />
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12, fontSize: 12 }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Personal Details"}</button>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ArraySectionEditor({ title, items, fields, onChange, renderSummary, onClear, lowConfidence, confidence, allowSplitMerge, groupBy, companies }) {
  const [editingIndex, setEditingIndex] = useState(null); // -1 = adding, N = editing index N, null = closed
  const [draft, setDraft] = useState({});

  function startAdd() {
    const empty = {};
    fields.forEach((f) => { empty[f.key] = f.type === "select" ? f.options[0] : ""; });
    setDraft(empty);
    setEditingIndex(-1);
  }
  function startEdit(i) {
    setDraft({ ...items[i] });
    setEditingIndex(i);
  }
  function cancel() { setEditingIndex(null); setDraft({}); }
  function saveItem() {
    const next = editingIndex === -1 ? [...items, draft] : items.map((it, i) => (i === editingIndex ? draft : it));
    onChange(next);
    cancel();
  }
  function remove(i) {
    if (!confirm("Delete this entry?")) return;
    onChange(items.filter((_, idx) => idx !== i));
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  // Duplicates the entry in place — the parser sometimes merges two real entries (e.g. two
  // projects) into one; this gives the student a copy of each half to manually pull apart,
  // rather than needing to delete-and-retype from scratch.
  function splitItem(i) {
    const next = [...items];
    next.splice(i, 0, { ...items[i] });
    onChange(next);
  }
  // Folds entry i into the one above it — for wherever an entry got split that shouldn't have
  // been. Text fields (textarea) are concatenated; everything else keeps the earlier entry's
  // value unless it was empty.
  function mergeUp(i) {
    if (i === 0) return;
    if (!confirm("Merge this entry into the one above it?")) return;
    const prev = items[i - 1];
    const cur = items[i];
    const merged = { ...prev };
    for (const f of fields) {
      const key = f.key;
      if (!merged[key] && cur[key]) merged[key] = cur[key];
      else if (merged[key] && cur[key] && merged[key] !== cur[key] && f.type === "textarea") {
        merged[key] = `${merged[key]} ${cur[key]}`.trim();
      }
    }
    const next = items.filter((_, idx) => idx !== i);
    next[i - 1] = merged;
    onChange(next);
  }

  function renderRow(item, i) {
    return editingIndex === i ? (
      <ItemForm key={i} fields={fields} draft={draft} setDraft={setDraft} onSave={saveItem} onCancel={cancel} companies={companies} />
    ) : (
      <div key={i} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 13, flex: 1 }}>{renderSummary(item)}</div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 6px" }} onClick={() => move(i, -1)}>↑</button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 6px" }} onClick={() => move(i, 1)}>↓</button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => startEdit(i)}>Edit</button>
          {allowSplitMerge && (
            <>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => splitItem(i)} title="Duplicate this entry so you can split merged content across the two copies">Split</button>
              {i > 0 && <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => mergeUp(i)} title="Merge this entry into the one above it">Merge ↑</button>}
            </>
          )}
          <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 11 }} onClick={() => remove(i)}>Delete</button>
        </div>
      </div>
    );
  }

  const grouped = groupBy
    ? items.reduce((acc, item, i) => {
        const key = groupBy(item);
        (acc[key] = acc[key] || []).push(i);
        return acc;
      }, {})
    : null;

  return (
    <div className="card" style={{ padding: 16, border: lowConfidence ? "2px solid var(--amber-dark)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <ConfidenceBadge confidence={confidence} lowConfidence={lowConfidence} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {editingIndex === null && items.length > 0 && onClear && (
            <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12 }} onClick={() => { if (confirm(`Clear all ${title}?`)) onClear(); }}>
              Clear section
            </button>
          )}
          {editingIndex === null && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={startAdd}>+ Add</button>}
        </div>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {grouped
          ? Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, indices]) => (
              <div key={cat}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)", marginTop: 6, marginBottom: 4 }}>{cat} ({indices.length})</div>
                <div style={{ display: "grid", gap: 8 }}>{indices.map((i) => renderRow(items[i], i))}</div>
              </div>
            ))
          : items.map((item, i) => renderRow(item, i))}
        {editingIndex === -1 && <ItemForm fields={fields} draft={draft} setDraft={setDraft} onSave={saveItem} onCancel={cancel} companies={companies} />}
        {items.length === 0 && editingIndex === null && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>None added yet.</p>}
      </div>
    </div>
  );
}

function ItemForm({ fields, draft, setDraft, onSave, onCancel, companies }) {
  return (
    <div className="card" style={{ padding: 12, background: "var(--paper)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {fields.map((f) => (
          <div key={f.key} style={{ gridColumn: f.wide ? "1 / -1" : undefined }}>
            <label style={labelStyle}>{f.label}</label>
            {f.type === "textarea" ? (
              <>
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                {f.improvable && (
                  <ImproveButton text={draft[f.key]} section={f.improvable} onApply={(improved) => setDraft({ ...draft, [f.key]: improved })} />
                )}
              </>
            ) : f.type === "select" ? (
              <select style={inputStyle} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "company" ? (
              <CompanyField field={f} draft={draft} setDraft={setDraft} companies={companies || []} />
            ) : (
              <input style={inputStyle} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={onSave}>Save</button>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Searchable Company Master dropdown + "Other" free-text fallback — draft[field.key] always holds
// the display name (shown in previews/PDF unchanged); draft.companyId is set only when a real
// Company Master entry is picked, and cleared back to null for "Other" so the resume doesn't carry
// a stale link to a company the student didn't actually select.
function CompanyField({ field, draft, setDraft, companies }) {
  const matched = draft.companyId && companies.some((c) => c.id === draft.companyId);
  return (
    <>
      <select
        style={inputStyle}
        value={matched ? draft.companyId : "OTHER"}
        onChange={(e) => {
          if (e.target.value === "OTHER") {
            setDraft({ ...draft, companyId: null });
          } else {
            const c = companies.find((c) => c.id === e.target.value);
            setDraft({ ...draft, companyId: c.id, [field.key]: c.name });
          }
        }}
      >
        <option value="OTHER">Other (type company name below)</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!matched && (
        <input
          style={{ ...inputStyle, marginTop: 6 }}
          placeholder="Enter company name"
          value={draft[field.key] || ""}
          onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value, companyId: null })}
        />
      )}
    </>
  );
}

// Mirrors backend/src/utils/resumePdf.js's 5 renderers so what's shown here roughly matches
// what gets downloaded — a student picking "Modern" should see the two-column/timeline layout
// change right away, not just discover it after downloading a PDF.
function ResumePreview({ resume, accent, templateId }) {
  const education = resume.education || [], skills = resume.skills || [], projects = resume.projects || [];
  const experience = resume.experience || [], certifications = resume.certifications || [], achievements = resume.achievements || [], languages = resume.languages || [];
  const skillsByCategory = {};
  for (const s of skills) (skillsByCategory[s.category || "Other"] = skillsByCategory[s.category || "Other"] || []).push(s);
  const contactLine = [resume.email, resume.mobile, resume.address].filter(Boolean).join("   |   ");
  const linksLine = [resume.linkedin, resume.github, resume.portfolio].filter(Boolean).join("   |   ");

  const shared = { resume, accent, education, skills, projects, experience, certifications, achievements, languages, skillsByCategory, contactLine, linksLine };
  if (templateId === "minimal") return <MinimalPreview {...shared} />;
  if (templateId === "modern") return <ModernPreview {...shared} />;
  if (templateId === "executive") return <ExecutivePreview {...shared} />;
  if (templateId === "creative") return <CreativePreview {...shared} />;
  return <ProfessionalPreview {...shared} />;
}

function ProfessionalPreview({ resume, accent, education, skills, projects, experience, certifications, achievements, languages, skillsByCategory, contactLine, linksLine }) {
  return (
    <div style={{ width: 700, minHeight: 900, background: "#fff", padding: 40, fontFamily: "var(--font-body)", color: "#1C1B18", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", color: accent, margin: 0, fontSize: 28 }}>{resume.fullName || "Your Name"}</h1>
      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{contactLine}</div>
      <div style={{ fontSize: 12, color: "#555" }}>{linksLine}</div>
      <div style={{ height: 2, background: accent, marginTop: 10, marginBottom: 14 }} />

      {resume.summary && <PreviewSection title="Professional Summary" accent={accent}><p style={{ fontSize: 13, margin: 0 }}>{resume.summary}</p></PreviewSection>}

      {experience.length > 0 && (
        <PreviewSection title="Experience" accent={accent}>
          {experience.map((e, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{e.title}{e.company ? ` — ${e.company}` : ""}</div>
              <div style={{ fontSize: 11, color: "#666" }}>{[e.employmentType, [e.startDate, e.endDate].filter(Boolean).join(" – ")].filter(Boolean).join(" · ")}</div>
              {e.responsibilities && <div style={{ fontSize: 12 }}>{e.responsibilities}</div>}
            </div>
          ))}
        </PreviewSection>
      )}

      {education.length > 0 && (
        <PreviewSection title="Education" accent={accent}>
          {education.map((e, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{e.degree}{e.specialization ? ` in ${e.specialization}` : ""}</div>
              <div style={{ fontSize: 12 }}>{e.institution}{e.board ? ` (${e.board})` : ""}</div>
              <div style={{ fontSize: 11, color: "#666" }}>{e.startYear} – {e.endYear || e.status}{e.score ? ` · ${e.score}` : ""}</div>
            </div>
          ))}
        </PreviewSection>
      )}

      {projects.length > 0 && (
        <PreviewSection title="Projects" accent={accent}>
          {projects.map((p, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{p.title}</div>
              <div style={{ fontSize: 11, color: "#666" }}>{[p.role, p.duration].filter(Boolean).join(" · ")}</div>
              {p.description && <div style={{ fontSize: 12 }}>{p.description}</div>}
              {p.technologies && <div style={{ fontSize: 11, color: "#666" }}>Tech: {p.technologies}</div>}
            </div>
          ))}
        </PreviewSection>
      )}

      {skills.length > 0 && (
        <PreviewSection title="Skills" accent={accent}>
          {Object.entries(skillsByCategory).map(([cat, list]) => (
            <div key={cat} style={{ fontSize: 12, marginBottom: 3 }}><strong>{cat}:</strong> {list.map((s) => s.proficiency ? `${s.name} (${s.proficiency})` : s.name).join(", ")}</div>
          ))}
        </PreviewSection>
      )}

      {certifications.length > 0 && (
        <PreviewSection title="Certifications" accent={accent}>
          {certifications.map((c, i) => <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>{c.name} — {c.org} <span style={{ color: "#666" }}>({c.issueDate})</span></div>)}
        </PreviewSection>
      )}

      {achievements.length > 0 && (
        <PreviewSection title="Achievements" accent={accent}>
          {achievements.map((a, i) => <div key={i} style={{ fontSize: 12, marginBottom: 3 }}>• {a.text}</div>)}
        </PreviewSection>
      )}

      {languages.length > 0 && (
        <PreviewSection title="Languages" accent={accent}>
          <div style={{ fontSize: 12 }}>{languages.map((l) => `${l.name} (${l.proficiency})`).join(", ")}</div>
        </PreviewSection>
      )}
    </div>
  );
}

// Black & white, tight spacing, no color anywhere — mirrors renderMinimal in resumePdf.js.
function MinimalPreview({ resume, education, skills, projects, experience, certifications, achievements, languages, skillsByCategory, contactLine, linksLine }) {
  const h = { fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 };
  const sec = { marginBottom: 10 };
  return (
    <div style={{ width: 700, minHeight: 900, background: "#fff", padding: 44, fontFamily: "var(--font-body)", color: "#000", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{resume.fullName || "Your Name"}</h1>
      <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{contactLine}</div>
      <div style={{ fontSize: 11, color: "#444" }}>{linksLine}</div>
      <div style={{ height: 14 }} />

      {resume.summary && <div style={sec}><div style={h}>SUMMARY</div><p style={{ fontSize: 12, margin: 0 }}>{resume.summary}</p></div>}

      {experience.length > 0 && (
        <div style={sec}><div style={h}>EXPERIENCE</div>
          {experience.map((e, i) => (
            <div key={i} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{e.title}{e.company ? ` — ${e.company}` : ""}</div>
              <div style={{ fontSize: 10.5, color: "#555" }}>{[e.employmentType, [e.startDate, e.endDate].filter(Boolean).join(" – ")].filter(Boolean).join(" · ")}</div>
              {e.responsibilities && <div style={{ fontSize: 11.5 }}>{e.responsibilities}</div>}
            </div>
          ))}
        </div>
      )}

      {education.length > 0 && (
        <div style={sec}><div style={h}>EDUCATION</div>
          {education.map((e, i) => (
            <div key={i} style={{ fontSize: 11.5, marginBottom: 3 }}>
              <strong>{e.degree}{e.specialization ? ` in ${e.specialization}` : ""}</strong> — {e.institution} ({e.startYear}–{e.endYear || e.status})
            </div>
          ))}
        </div>
      )}

      {skills.length > 0 && <div style={sec}><div style={h}>SKILLS</div><div style={{ fontSize: 11.5 }}>{Object.values(skillsByCategory).flat().map((s) => s.proficiency ? `${s.name} (${s.proficiency})` : s.name).join(", ")}</div></div>}

      {projects.length > 0 && (
        <div style={sec}><div style={h}>PROJECTS</div>
          {projects.map((p, i) => <div key={i} style={{ fontSize: 11.5, marginBottom: 3 }}><strong>{p.title}</strong>{p.description ? ` — ${p.description}` : ""}</div>)}
        </div>
      )}

      {certifications.length > 0 && <div style={sec}><div style={h}>CERTIFICATIONS</div><div style={{ fontSize: 11.5 }}>{certifications.map((c) => `${c.name}${c.org ? ` (${c.org})` : ""}`).join("; ")}</div></div>}
      {achievements.length > 0 && <div style={sec}><div style={h}>ACHIEVEMENTS</div>{achievements.map((a, i) => <div key={i} style={{ fontSize: 11.5 }}>— {a.text}</div>)}</div>}
      {languages.length > 0 && <div style={sec}><div style={h}>LANGUAGES</div><div style={{ fontSize: 11.5 }}>{languages.map((l) => `${l.name} (${l.proficiency})`).join(", ")}</div></div>}
    </div>
  );
}

// Two-column with a tinted sidebar + timeline-style experience — mirrors renderModern.
function ModernPreview({ resume, accent, education, skills, projects, experience, certifications, achievements, languages, skillsByCategory, contactLine, linksLine }) {
  return (
    <div style={{ width: 700, minHeight: 900, background: "#fff", display: "flex", fontFamily: "var(--font-body)", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>
      <div style={{ width: 210, background: "#F0EEE3", padding: "30px 20px", flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 6, letterSpacing: "0.04em" }}>CONTACT</div>
        <div style={{ fontSize: 10.5, color: "#333", marginBottom: 2 }}>{resume.email}</div>
        <div style={{ fontSize: 10.5, color: "#333", marginBottom: 2 }}>{resume.mobile}</div>
        <div style={{ fontSize: 10.5, color: "#333", marginBottom: 10 }}>{resume.address}</div>
        {skills.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 6, letterSpacing: "0.04em" }}>SKILLS</div>
            {Object.entries(skillsByCategory).map(([cat, list]) => (
              <div key={cat} style={{ fontSize: 10, marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: "#1C1B18" }}>{cat}</div>
                <div style={{ color: "#444" }}>{list.map((s) => s.name).join(", ")}</div>
              </div>
            ))}
          </>
        )}
        {education.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, margin: "10px 0 6px", letterSpacing: "0.04em" }}>EDUCATION</div>
            {education.map((e, i) => (
              <div key={i} style={{ fontSize: 10, marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>{e.degree}</div>
                <div style={{ color: "#444" }}>{e.institution}</div>
                <div style={{ color: "#666" }}>{e.startYear}–{e.endYear || e.status}</div>
              </div>
            ))}
          </>
        )}
        {languages.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, margin: "10px 0 6px", letterSpacing: "0.04em" }}>LANGUAGES</div>
            <div style={{ fontSize: 10, color: "#444" }}>{languages.map((l) => l.name).join(", ")}</div>
          </>
        )}
      </div>
      <div style={{ flex: 1, padding: "34px 28px", color: "#1C1B18" }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>{resume.fullName || "Your Name"}</h1>
        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{linksLine}</div>
        <div style={{ height: 2, background: accent, marginTop: 10, marginBottom: 16, width: "100%" }} />

        {resume.summary && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: "0.03em", marginBottom: 6 }}>SUMMARY</div>
            <p style={{ fontSize: 11.5, margin: 0 }}>{resume.summary}</p>
          </div>
        )}

        {experience.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: "0.03em", marginBottom: 8 }}>EXPERIENCE</div>
            {experience.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 8, paddingTop: 4, flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent }} />
                  {i < experience.length - 1 && <div style={{ width: 1, background: "#ddd", height: 34, marginLeft: 3.5 }} />}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{e.title}{e.company ? ` — ${e.company}` : ""}</div>
                  <div style={{ fontSize: 10.5, color: "#777" }}>{[e.startDate, e.endDate].filter(Boolean).join(" – ")}</div>
                  {e.responsibilities && <div style={{ fontSize: 11 }}>{e.responsibilities}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {projects.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: "0.03em", marginBottom: 8 }}>PROJECTS</div>
            {projects.map((p, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{p.title}</div>
                {p.description && <div style={{ fontSize: 11 }}>{p.description}</div>}
              </div>
            ))}
          </div>
        )}

        {certifications.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: "0.03em", marginBottom: 6 }}>CERTIFICATIONS</div>
            <div style={{ fontSize: 11 }}>{certifications.map((c) => c.name).join(", ")}</div>
          </div>
        )}

        {achievements.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: "0.03em", marginBottom: 6 }}>ACHIEVEMENTS</div>
            {achievements.map((a, i) => <div key={i} style={{ fontSize: 11 }}>•  {a.text}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

// Centered serif header, generous spacing, formal — mirrors renderExecutive.
function ExecutivePreview({ resume, accent, education, skills, projects, experience, certifications, achievements, contactLine, linksLine, skillsByCategory }) {
  const h = { fontSize: 13, fontWeight: 700, color: accent, letterSpacing: "0.08em", textAlign: "center", marginBottom: 10 };
  return (
    <div style={{ width: 700, minHeight: 900, background: "#fff", padding: "48px 60px", fontFamily: "Georgia, 'Times New Roman', serif", color: "#1C1B18", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>
      <h1 style={{ margin: 0, fontSize: 26, textAlign: "center", letterSpacing: "0.05em", color: accent }}>{(resume.fullName || "Your Name").toUpperCase()}</h1>
      <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginTop: 8 }}>{contactLine}</div>
      <div style={{ fontSize: 11, color: "#555", textAlign: "center" }}>{linksLine}</div>
      <div style={{ borderTop: `1px solid ${accent}`, marginTop: 14, marginBottom: 4 }} />
      <div style={{ borderTop: `0.5px solid ${accent}`, marginBottom: 20 }} />

      {resume.summary && <div style={{ marginBottom: 20 }}><div style={h}>EXECUTIVE SUMMARY</div><p style={{ fontSize: 12, margin: 0, textAlign: "center" }}>{resume.summary}</p></div>}

      {experience.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={h}>PROFESSIONAL EXPERIENCE</div>
          {experience.map((e, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{e.title}{e.company ? ` — ${e.company}` : ""}</div>
              <div style={{ fontSize: 10.5, fontStyle: "italic", color: "#666" }}>{[e.employmentType, [e.startDate, e.endDate].filter(Boolean).join(" – ")].filter(Boolean).join("   ·   ")}</div>
              {e.responsibilities && <div style={{ fontSize: 11.5, marginTop: 3 }}>{e.responsibilities}</div>}
            </div>
          ))}
        </div>
      )}

      {education.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={h}>EDUCATION</div>
          {education.map((e, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{e.degree}{e.specialization ? ` in ${e.specialization}` : ""}</div>
              <div style={{ fontSize: 11.5 }}>{e.institution}</div>
              <div style={{ fontSize: 10.5, color: "#666" }}>{e.startYear} – {e.endYear || e.status}</div>
            </div>
          ))}
        </div>
      )}

      {skills.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={h}>CORE COMPETENCIES</div>
          {Object.entries(skillsByCategory).map(([cat, list]) => (
            <div key={cat} style={{ fontSize: 11.5, marginBottom: 3 }}><strong>{cat}:</strong> {list.map((s) => s.name).join(", ")}</div>
          ))}
        </div>
      )}

      {certifications.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={h}>CERTIFICATIONS</div>
          {certifications.map((c, i) => <div key={i} style={{ fontSize: 11.5, marginBottom: 3 }}>{c.name}{c.org ? ` — ${c.org}` : ""}</div>)}
        </div>
      )}

      {projects.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={h}>SELECTED PROJECTS</div>
          {projects.map((p, i) => <div key={i} style={{ fontSize: 11.5, marginBottom: 3 }}><strong>{p.title}</strong>{p.description ? ` — ${p.description}` : ""}</div>)}
        </div>
      )}

      {achievements.length > 0 && (
        <div>
          <div style={h}>ACHIEVEMENTS</div>
          {achievements.map((a, i) => <div key={i} style={{ fontSize: 11.5, textAlign: "center" }}>{a.text}</div>)}
        </div>
      )}
    </div>
  );
}

// Colored header band + skill "tag" pills — mirrors renderCreative.
function CreativePreview({ resume, accent, education, skills, projects, experience, certifications, achievements, contactLine, linksLine, skillsByCategory }) {
  const initials = (resume.fullName || "Y N").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{ width: 700, minHeight: 900, background: "#fff", fontFamily: "var(--font-body)", color: "#1C1B18", boxShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>
      <div style={{ background: accent, padding: "26px 40px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#fff", color: accent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, flexShrink: 0 }}>{initials}</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: "#fff" }}>{resume.fullName || "Your Name"}</h1>
          <div style={{ fontSize: 11, color: "#fff", opacity: 0.9, marginTop: 4 }}>{contactLine}</div>
          <div style={{ fontSize: 11, color: "#fff", opacity: 0.9 }}>{linksLine}</div>
        </div>
      </div>
      <div style={{ padding: "24px 40px" }}>
        {resume.summary && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 4, height: 14, background: accent }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>ABOUT ME</div>
            </div>
            <p style={{ fontSize: 11.5, margin: 0 }}>{resume.summary}</p>
          </div>
        )}

        {skills.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 4, height: 14, background: accent }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>SKILLS</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.values(skillsByCategory).flat().map((s, i) => (
                <span key={i} style={{ background: "#F4E9FB", color: accent, borderRadius: 999, padding: "3px 10px", fontSize: 10.5 }}>{s.name}</span>
              ))}
            </div>
          </div>
        )}

        {experience.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 4, height: 14, background: accent }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>EXPERIENCE</div>
            </div>
            {experience.map((e, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{e.title}{e.company ? ` — ${e.company}` : ""}</div>
                <div style={{ fontSize: 10.5, color: accent }}>{[e.startDate, e.endDate].filter(Boolean).join(" – ")}</div>
                {e.responsibilities && <div style={{ fontSize: 11 }}>{e.responsibilities}</div>}
              </div>
            ))}
          </div>
        )}

        {projects.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 4, height: 14, background: accent }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>PROJECTS</div>
            </div>
            {projects.map((p, i) => <div key={i} style={{ fontSize: 11, marginBottom: 4 }}><strong>{p.title}</strong>{p.description ? ` — ${p.description}` : ""}</div>)}
          </div>
        )}

        {education.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 4, height: 14, background: accent }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>EDUCATION</div>
            </div>
            {education.map((e, i) => <div key={i} style={{ fontSize: 11, marginBottom: 3 }}><strong>{e.degree}</strong> — {e.institution}</div>)}
          </div>
        )}

        {achievements.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 4, height: 14, background: accent }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>ACHIEVEMENTS</div>
            </div>
            {achievements.map((a, i) => <div key={i} style={{ fontSize: 11 }}>•  {a.text}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewSection({ title, accent, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid #ccc", paddingBottom: 3, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

// Calls a real Claude rewrite when the server has AI configured; the backend transparently falls
// back to a deterministic rule-based rewrite (weak-verb replacement, grammar cleanup,
// quantify-impact prompts) otherwise, so this button keeps working either way. `suggestion.source`
// ("ai" | "rule-based") tells us which one actually produced the result, shown as a small note
// rather than always implying a real AI rewrite happened.
function ImproveButton({ text, section, onApply }) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  async function run() {
    if (!text || !text.trim()) return alert("Add some text first.");
    setLoading(true);
    setSuggestion(null);
    try {
      const { data } = await api.post("/resume/me/improve", { text, section });
      setSuggestion(data);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to generate improvement");
    } finally {
      setLoading(false);
    }
  }

  function accept() {
    onApply(suggestion.improved);
    setSuggestion(null);
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={run} disabled={loading}>
        {loading ? "Improving…" : "✨ Improve with AI"}
      </button>
      {suggestion && (
        <div className="card" style={{ padding: 10, marginTop: 6, background: "var(--paper)", fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Suggested rewrite</div>
          <div style={{ marginBottom: 6, whiteSpace: "pre-wrap" }}>{suggestion.improved}</div>
          <ul style={{ paddingLeft: 16, margin: "0 0 8px", color: "var(--ink-dim)" }}>
            {suggestion.changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          {suggestion.source === "rule-based" && (
            <div style={{ fontSize: 10, color: "var(--ink-dim)", marginBottom: 8 }}>
              AI rewriting isn't configured on this server right now — this is a rule-based suggestion instead.
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={accept}>Accept</button>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setSuggestion(null)}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Job-Specific Optimization: pick a target role, see keyword/skill gaps against a fixed
// per-role dictionary (not a real embedding-similarity model — same rule-based approach as the
// rest of the ATS engine).
function TargetRoleCard({ resume, onRoleChange }) {
  const [roles, setRoles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/resume/job-roles").then((res) => setRoles(res.data)); }, []);

  useEffect(() => {
    if (!resume.targetRole) { setAnalysis(null); return; }
    setLoading(true);
    api.get("/resume/me/role-analysis").then((res) => setAnalysis(res.data)).catch(() => setAnalysis(null)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume.targetRole]);

  async function selectRole(role) {
    setLoading(true);
    try {
      const { data } = await api.patch("/resume/me/target-role", { role: role || null });
      onRoleChange(data.resume.targetRole);
      setAnalysis(data.roleAnalysis);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to set target role");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Job-Specific Optimization</div>
      <select style={inputStyle} value={resume.targetRole || ""} onChange={(e) => selectRole(e.target.value)}>
        <option value="">Select a target role…</option>
        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {loading && <p className="mono" style={{ fontSize: 11, marginTop: 8 }}>Loading…</p>}
      {analysis && !loading && (
        <div style={{ marginTop: 10 }}>
          <div className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{analysis.matchPercent}% keyword match for {analysis.role}</div>
          {analysis.missingKeywords.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>Missing keywords</div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{analysis.missingKeywords.join(", ")}</div>
            </div>
          )}
          {analysis.recommendedSkills.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>Recommended skills to add</div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{analysis.recommendedSkills.join(", ")}</div>
            </div>
          )}
          {analysis.summaryTip && <p style={{ fontSize: 12, marginTop: 6 }}>{analysis.summaryTip}</p>}
          {analysis.relevantProjects.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>Most relevant projects</div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{analysis.relevantProjects.join(", ")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Version history — auto-saved on every resume save (capped at the 20 most recent server-side).
// "Compare" fetches two full snapshots client-side and diffs just the ATS score; the snapshots
// themselves are visible via Restore if a student wants to inspect one in full.
function VersionHistoryCard({ onRestore }) {
  const [versions, setVersions] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [notice, setNotice] = useState("");

  function load() { api.get("/resume/me/versions").then((res) => setVersions(res.data)); }
  useEffect(load, []);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice((m) => (m === msg ? "" : m)), 4000);
  }

  async function restore(id) {
    if (!confirm("Restore this version? Your current state is saved first, so this can be undone.")) return;
    try {
      const { data } = await api.post(`/resume/me/versions/${id}/restore`);
      onRestore(data);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to restore this version");
    }
  }

  async function downloadVersion(id) {
    setBusyId(id);
    try {
      const { data } = await api.get(`/resume/me/versions/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = "resume-version.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download this version");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteVersion(id) {
    if (!confirm("Delete this saved version? This action cannot be undone.")) return;
    setBusyId(id);
    try {
      await api.delete(`/resume/me/versions/${id}`);
      setCompareIds((prev) => prev.filter((x) => x !== id));
      setCompareResult(null);
      load();
      flash("Resume version deleted successfully.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete this version");
    } finally {
      setBusyId(null);
    }
  }

  async function clearAll() {
    if (!confirm("Are you sure you want to permanently delete all saved resume versions? This action cannot be undone.")) return;
    setClearingAll(true);
    try {
      await api.delete("/resume/me/versions");
      setCompareIds([]);
      setCompareResult(null);
      load();
      flash("All resume versions cleared successfully.");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to clear version history");
    } finally {
      setClearingAll(false);
    }
  }

  function toggleCompare(id) {
    setCompareResult(null);
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]));
  }

  async function runCompare() {
    if (compareIds.length !== 2) return;
    const [a, b] = await Promise.all(compareIds.map((id) => api.get(`/resume/me/versions/${id}`)));
    const [older, newer] = [a.data, b.data].sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    setCompareResult({ older, newer });
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Version History</div>
        <div style={{ display: "flex", gap: 6 }}>
          {compareIds.length === 2 && <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={runCompare}>Compare selected</button>}
          {versions.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 11, color: "var(--rust)", borderColor: "var(--rust)" }} onClick={clearAll} disabled={clearingAll}>
              {clearingAll ? "Clearing…" : "Clear All Versions"}
            </button>
          )}
        </div>
      </div>
      {notice && <p style={{ fontSize: 11, color: "var(--mint)", marginTop: 6, fontWeight: 600 }}>✓ {notice}</p>}
      <div style={{ display: "grid", gap: 6, marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
        {versions.map((v) => (
          <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, gap: 6, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={compareIds.includes(v.id)} onChange={() => toggleCompare(v.id)} />
              <span className="mono">{new Date(v.createdAt).toLocaleString()}</span> — {v.atsScore}/100
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => restore(v.id)} disabled={busyId === v.id}>Restore</button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => downloadVersion(v.id)} disabled={busyId === v.id}>Download</button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "var(--rust)" }} onClick={() => deleteVersion(v.id)} disabled={busyId === v.id}>Delete</button>
            </div>
          </div>
        ))}
        {versions.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>No saved versions yet — one is captured automatically each time you save.</p>}
      </div>
      {compareResult && (
        <div style={{ marginTop: 10, fontSize: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div>Older ({new Date(compareResult.older.createdAt).toLocaleString()}): <strong>{compareResult.older.atsScore}/100</strong></div>
          <div>Newer ({new Date(compareResult.newer.createdAt).toLocaleString()}): <strong>{compareResult.newer.atsScore}/100</strong></div>
          <div style={{ marginTop: 4, fontWeight: 700, color: compareResult.newer.atsScore >= compareResult.older.atsScore ? "var(--mint)" : "var(--rust)" }}>
            {compareResult.newer.atsScore - compareResult.older.atsScore >= 0 ? "+" : ""}{compareResult.newer.atsScore - compareResult.older.atsScore} point difference
          </div>
        </div>
      )}
    </div>
  );
}
