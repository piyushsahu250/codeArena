import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CompleteProfileModal from "../components/CompleteProfileModal";
import FileUpload from "../components/FileUpload";
import { compressImageToDataUrl } from "../utils/imageCompression";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFeatures } from "../context/FeatureContext";

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 6 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginTop: 10, display: "block" };
const linkButtonStyle = { background: "none", border: "none", padding: 0, font: "inherit", color: "var(--amber-dark)", textDecoration: "underline", cursor: "pointer" };

// Shared by every save handler on this page so "no response at all" (offline/DNS/CORS — axios
// never got a response object) reads as a connectivity problem instead of the misleading default
// fallback text, which otherwise told a student with no internet to go "check the fields below."
// A real field-validation 400 or a server 5xx already carries a specific `error` string from the
// backend and is shown as-is; only the true no-response case falls back to this generic wording.
function saveErrorMessage(err, fallback) {
  if (err.response?.data?.error) return err.response.data.error;
  if (!err.response) return "Network error — check your connection and try again.";
  return fallback;
}

const TABS = [
  { key: "personal", label: "Personal Academic & Info" },
  { key: "skills", label: "Skills & Capabilities" },
  { key: "lms", label: "CodeArena LMS Info" },
  { key: "placement", label: "Placement Registration" },
  { key: "salary", label: "Salary & Performance Info" },
  { key: "documents", label: "Documents" },
  { key: "jobs", label: "Job Preference" },
];

const DECLINE_REASONS = [
  { value: "HIGHER_STUDIES", label: "Higher Studies" },
  { value: "GOVT_EXAM", label: "Government Exam Preparation" },
  { value: "ENTREPRENEURSHIP", label: "Entrepreneurship / Startup" },
  { value: "FAMILY_BUSINESS", label: "Family Business" },
  { value: "EMPLOYED", label: "Already Employed" },
  { value: "NOT_INTERESTED", label: "Not Interested" },
  { value: "OTHER", label: "Other" },
];

const EMPTY_PERSONAL = {
  firstName: "", lastName: "", mobile: "", gender: "", profilePhotoUrl: "", rollNumber: "",
  personalEmail: "", dob: "", address: "", state: "", district: "", pincode: "",
  fatherName: "", fatherContact: "", motherName: "", motherContact: "", shortDescription: "",
};

const EMPTY_OFFER = {
  companyId: null, companyName: "", offerType: "PLACEMENT", source: "ON_CAMPUS",
  offeredPackage: "", offerStatus: "HOLDING", joiningStatus: "", proofLink: "",
};

// Same field shape as ResumeBuilder.jsx's EDUCATION_FIELDS — this writes to the same
// Resume.education array (via PATCH /resume/me), so an entry added here shows up in Resume
// Builder unchanged, and vice versa. There is only ever one Education list per student.
const EDUCATION_FIELDS = [
  { key: "degree", label: "Degree" }, { key: "specialization", label: "Specialization" },
  { key: "institution", label: "College / University" }, { key: "board", label: "Board (if applicable)" },
  { key: "startYear", label: "Start Year" }, { key: "endYear", label: "End Year" },
  { key: "score", label: "CGPA / Percentage" },
  { key: "status", label: "Current Status", type: "select", options: ["Pursuing", "Completed"] },
];
const EMPTY_EDUCATION = {};

const VERIFICATION_LABEL = { PENDING: "Pending Verification", VERIFIED: "Verified", REJECTED: "Rejected" };
const VERIFICATION_COLOR = { PENDING: "var(--amber-dark)", VERIFIED: "var(--mint)", REJECTED: "var(--rust)" };

const DOC_VERIFICATION_LABEL = { PENDING: "Pending Verification", VERIFIED: "Verified", REJECTED: "Rejected", REUPLOAD_REQUIRED: "Re-upload Required" };
const DOC_VERIFICATION_COLOR = { PENDING: "var(--amber-dark)", VERIFIED: "var(--mint)", REJECTED: "var(--rust)", REUPLOAD_REQUIRED: "var(--rust)" };
const LABEL_REQUIRED_DOC_TYPES = ["MARKSHEET", "OTHER"];
const EMPTY_DOCUMENT = { documentType: "", label: "", documentLink: "" };

export default function StudentProfile() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const { isFeatureEnabled } = useFeatures();
  const resumeBuilderEnabled = isFeatureEnabled("resume_builder");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("personal");
  const [form, setForm] = useState(EMPTY_PERSONAL);
  const [skillsForm, setSkillsForm] = useState({ leetcodeHandle: "", hackerrankHandle: "", stopstalkHandle: "", amcatId: "", cocubesId: "" });
  const [placementForm, setPlacementForm] = useState({ placementParticipation: "", placementDeclineReason: "", placementDeclineOther: "" });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [lmsData, setLmsData] = useState(null);
  const [showModal, setShowModal] = useState(() => user?.role === "STUDENT" && user?.requireProfileCompletion && !user?.profileComplete);

  const [companies, setCompanies] = useState([]);
  const [offers, setOffers] = useState(null);
  const [offerSummary, setOfferSummary] = useState(null);
  const [offerForm, setOfferForm] = useState(EMPTY_OFFER);
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerSaving, setOfferSaving] = useState(false);
  const [offerError, setOfferError] = useState("");

  const [docTypes, setDocTypes] = useState([]);
  const [documents, setDocuments] = useState(null);
  const [documentForm, setDocumentForm] = useState(EMPTY_DOCUMENT);
  const [editingDocId, setEditingDocId] = useState(null);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentError, setDocumentError] = useState("");

  const [education, setEducation] = useState(null);
  const [educationDraft, setEducationDraft] = useState(EMPTY_EDUCATION);
  const [editingEducationIndex, setEditingEducationIndex] = useState(null); // -1 = adding, N = editing, null = closed
  const [educationSaving, setEducationSaving] = useState(false);

  // Unsaved-changes tracking for the three editable-form tabs (Personal, Skills, Placement) — the
  // baseline snapshot is refreshed every time load() runs (initial mount + after every successful
  // save), so `dirty` only ever reflects edits made since the last save.
  const baselineRef = useRef(null);
  const [dirty, setDirty] = useState(false);

  function load() {
    api.get("/resume/me").then((res) => setEducation(res.data.resume?.education || [])).catch(() => setEducation([]));
    api.get("/profile/me").then((res) => {
      setData(res.data);
      const { user: u, profile: p } = res.data;
      const [first, ...rest] = (u.name || "").split(" ");
      const nextForm = {
        firstName: first || "", lastName: rest.join(" ") || "",
        mobile: u.mobile || "", gender: u.gender || "", profilePhotoUrl: u.profilePhotoUrl || "",
        rollNumber: u.rollNumber || "",
        personalEmail: p?.personalEmail || "", dob: p?.dob ? p.dob.slice(0, 10) : "",
        address: p?.address || "", state: p?.state || "", district: p?.district || "", pincode: p?.pincode || "",
        fatherName: p?.fatherName || "", fatherContact: p?.fatherContact || "",
        motherName: p?.motherName || "", motherContact: p?.motherContact || "",
        shortDescription: p?.shortDescription || "",
      };
      const nextSkillsForm = {
        leetcodeHandle: p?.leetcodeHandle || "", hackerrankHandle: p?.hackerrankHandle || "",
        stopstalkHandle: p?.stopstalkHandle || "", amcatId: p?.amcatId || "", cocubesId: p?.cocubesId || "",
      };
      const nextPlacementForm = {
        placementParticipation: p?.placementParticipation || "",
        placementDeclineReason: p?.placementDeclineReason || "", placementDeclineOther: p?.placementDeclineOther || "",
      };
      setForm(nextForm);
      setSkillsForm(nextSkillsForm);
      setPlacementForm(nextPlacementForm);
      baselineRef.current = JSON.stringify({ form: nextForm, skillsForm: nextSkillsForm, placementForm: nextPlacementForm });
      setDirty(false);
    });
  }
  useEffect(load, []);

  useEffect(() => {
    if (baselineRef.current === null) return;
    setDirty(JSON.stringify({ form, skillsForm, placementForm }) !== baselineRef.current);
  }, [form, skillsForm, placementForm]);

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function confirmDiscardIfDirty(e) {
    if (dirty && !window.confirm("You have unsaved profile changes that will be lost. Leave this page anyway?")) {
      e.preventDefault();
    }
  }

  // CodeArena LMS Info is read-only and system-generated — reuses the existing Dashboard
  // aggregation route rather than duplicating coding-solved/streak computation here. Deliberately
  // does not fabricate a single "Employability Index Score": no such formula exists anywhere in
  // this platform, so the real component metrics are shown as-is instead.
  useEffect(() => {
    if (tab !== "lms" || lmsData) return;
    api.get("/dashboard/student").then((res) => setLmsData(res.data)).catch(() => setLmsData({}));
  }, [tab, lmsData]);

  // Live progress bar, computed from the same checklist the backend enforces — recalculated on
  // every keystroke for immediate feedback; the backend recomputes authoritatively on save.
  function livePercent() {
    const checks = [
      !!form.firstName.trim() && !!form.lastName.trim(),
      !!form.mobile.trim(), !!form.gender, !!form.profilePhotoUrl.trim(),
      !!form.personalEmail.trim(), !!form.dob,
      !!form.address.trim(), !!form.state.trim(), !!form.district.trim(), !!form.pincode.trim(),
      !!form.fatherName.trim(), !!form.fatherContact.trim(), !!form.motherName.trim(), !!form.motherContact.trim(),
      form.shortDescription.trim().length >= 10,
      (data?.educationCount || 0) > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }

  async function savePersonal(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await api.patch("/profile/me", form);
      toast.success("Personal Academic & Info saved.");
      updateUser({ profileComplete: res.data.completion.unlocked, name: res.data.user.name, mobile: res.data.user.mobile, gender: res.data.user.gender, profilePhotoUrl: res.data.user.profilePhotoUrl });
      load();
    } catch (err) {
      const msg = saveErrorMessage(err, "Failed to save. Please check the fields below.");
      setErrors({ personal: msg });
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function saveSkills(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/profile/me", skillsForm);
      toast.success("Skills & Capabilities saved.");
      load();
    } catch (err) {
      toast.error(saveErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  async function savePlacement(e) {
    e.preventDefault();
    if (placementForm.placementParticipation === "NOT_INTERESTED" && !placementForm.placementDeclineReason) {
      toast.error("Select a reason for not participating");
      return;
    }
    setSaving(true);
    try {
      await api.patch("/profile/me", placementForm);
      toast.success("Placement registration saved.");
      load();
    } catch (err) {
      toast.error(saveErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  // Placement Offers — lazy-loaded on first visit to the "salary" tab, same pattern as lmsData.
  useEffect(() => {
    if (tab !== "salary" || offers) return;
    api.get("/companies").then((res) => setCompanies(res.data)).catch(() => setCompanies([]));
    loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function loadOffers() {
    Promise.all([api.get("/placement/offers/me"), api.get("/placement/offers/summary/me")])
      .then(([offersRes, summaryRes]) => {
        setOffers(offersRes.data);
        setOfferSummary(summaryRes.data);
      })
      .catch(() => { setOffers([]); setOfferSummary(null); });
  }

  function startAddOffer() {
    setEditingOfferId(null);
    setOfferForm(EMPTY_OFFER);
    setOfferError("");
    setShowOfferForm(true);
  }

  function startEditOffer(o) {
    setEditingOfferId(o.id);
    setOfferForm({
      companyId: o.companyId, companyName: o.companyName, offerType: o.offerType, source: o.source,
      offeredPackage: String(o.offeredPackage), offerStatus: o.offerStatus, joiningStatus: o.joiningStatus || "", proofLink: o.proofLink,
    });
    setOfferError("");
    setShowOfferForm(true);
  }

  async function saveOffer(e) {
    e.preventDefault();
    if (!offerForm.companyName.trim()) { setOfferError("Company name is required."); return; }
    if (!offerForm.proofLink.trim()) { setOfferError("A document proof link is required to save this offer."); return; }
    setOfferSaving(true);
    setOfferError("");
    try {
      const payload = { ...offerForm, joiningStatus: offerForm.joiningStatus || null };
      if (editingOfferId) await api.patch(`/placement/offers/${editingOfferId}`, payload);
      else await api.post("/placement/offers", payload);
      toast.success(editingOfferId ? "Offer updated — pending re-verification." : "Offer added.");
      setShowOfferForm(false);
      loadOffers();
    } catch (err) {
      setOfferError(err.response?.data?.error || "Failed to save offer");
    } finally {
      setOfferSaving(false);
    }
  }

  async function deleteOffer(id) {
    if (!confirm("Delete this offer?")) return;
    try {
      await api.delete(`/placement/offers/${id}`);
      loadOffers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete offer");
    }
  }

  // Documents — lazy-loaded on first visit to the "documents" tab, same pattern as offers.
  useEffect(() => {
    if (tab !== "documents" || documents) return;
    api.get("/documents/types").then((res) => setDocTypes(res.data)).catch(() => setDocTypes([]));
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function loadDocuments() {
    api.get("/documents/me").then((res) => setDocuments(res.data)).catch(() => setDocuments([]));
  }

  function startAddDocument() {
    setEditingDocId(null);
    setDocumentForm(EMPTY_DOCUMENT);
    setDocumentError("");
    setShowDocumentForm(true);
  }

  function startEditDocument(d) {
    setEditingDocId(d.id);
    setDocumentForm({ documentType: d.documentType, label: d.label || "", documentLink: d.documentLink });
    setDocumentError("");
    setShowDocumentForm(true);
  }

  async function saveDocument(e) {
    e.preventDefault();
    if (!documentForm.documentType) { setDocumentError("Select a document type."); return; }
    if (LABEL_REQUIRED_DOC_TYPES.includes(documentForm.documentType) && !documentForm.label.trim()) {
      setDocumentError("A label is required for this document type (e.g. 'Semester 5 Mark Sheet').");
      return;
    }
    if (!documentForm.documentLink.trim()) { setDocumentError("A document link is required."); return; }
    setDocumentSaving(true);
    setDocumentError("");
    try {
      if (editingDocId) await api.patch(`/documents/${editingDocId}`, documentForm);
      else await api.post("/documents", documentForm);
      toast.success(editingDocId ? "Document updated — pending re-verification." : "Document added.");
      setShowDocumentForm(false);
      loadDocuments();
    } catch (err) {
      setDocumentError(err.response?.data?.error || "Failed to save document");
    } finally {
      setDocumentSaving(false);
    }
  }

  async function deleteDocument(id) {
    if (!confirm("Delete this document?")) return;
    try {
      await api.delete(`/documents/${id}`);
      loadDocuments();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete document");
    }
  }

  function startAddEducation() {
    setEditingEducationIndex(-1);
    setEducationDraft(EMPTY_EDUCATION);
  }
  function startEditEducation(i) {
    setEditingEducationIndex(i);
    setEducationDraft({ ...education[i] });
  }
  function cancelEducation() {
    setEditingEducationIndex(null);
    setEducationDraft(EMPTY_EDUCATION);
  }

  async function saveEducation() {
    if (!educationDraft.degree?.trim() || !educationDraft.institution?.trim()) {
      toast.error("Degree and College/University are required.");
      return;
    }
    const next = editingEducationIndex === -1
      ? [...education, educationDraft]
      : education.map((it, i) => (i === editingEducationIndex ? educationDraft : it));
    setEducationSaving(true);
    try {
      await api.patch("/resume/me", { education: next });
      setEducation(next);
      cancelEducation();
      toast.success("Education record saved.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save education record");
    } finally {
      setEducationSaving(false);
    }
  }

  async function deleteEducation(i) {
    if (!confirm("Delete this education record?")) return;
    const next = education.filter((_, idx) => idx !== i);
    try {
      await api.patch("/resume/me", { education: next });
      setEducation(next);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to delete education record");
    }
  }

  const gated = user?.role === "STUDENT" && user?.requireProfileCompletion && !user?.profileComplete;
  const percent = data?.completion?.percent ?? livePercent();

  return (
    <div>
      {showModal && <CompleteProfileModal onDismiss={() => setShowModal(false)} />}
      <Navbar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Student Profile</h1>
        <ChalkUnderline />

        {gated && (
          <div className="card" style={{ padding: 16, marginTop: 16, background: "var(--warning-bg)", border: "1px solid var(--amber)" }}>
            <strong>Complete your Personal Academic &amp; Info to continue.</strong>
            <p style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              Every other section of CodeArena unlocks once this reaches 80% completion. Fill in the fields below,
              including at least one education record under "Career History &amp; Education" and at least one
              uploaded document under the <button type="button" onClick={() => setTab("documents")} style={{ ...linkButtonStyle }}>Documents</button> tab
              — feel free to finish the rest afterward.
            </p>
          </div>
        )}

        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 }}>
            <span>Personal Academic &amp; Info completion</span>
            <span>{percent}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${percent}%`, background: percent === 100 ? "var(--mint)" : "var(--amber)", transition: "width 0.3s" }} />
          </div>
          {data?.completion && !data.completion.complete && (() => {
            // Every check is tagged with the actual page it's filled in on (see
            // studentProfileCompletion.js) — DOCUMENTS lives on this page's own "Documents" tab,
            // not the currently-open "personal" tab, so lumping it into one "missing on this page"
            // line was actively misleading: a student staring at the Personal Info form would see
            // a field name they can't find anywhere on screen. PROFILE and RESUME checks (the
            // latter is "education," which this personal tab also edits inline further down) stay
            // together since both are genuinely visible without switching tabs.
            const missingHere = data.completion.missingFields.filter((f) => f.section !== "DOCUMENTS");
            const missingDocs = data.completion.missingFields.filter((f) => f.section === "DOCUMENTS");
            return (
              <div style={{ marginTop: 8 }}>
                {missingHere.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "4px 0" }}>
                    Missing on this page: {missingHere.map((f) => f.label).join(", ")}
                  </p>
                )}
                {missingDocs.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "4px 0" }}>
                    Missing on the <button type="button" onClick={() => setTab("documents")} style={linkButtonStyle}>Documents</button> tab: {missingDocs.map((f) => f.label).join(", ")}
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        {dirty && (
          <p style={{ fontSize: 12, color: "var(--amber-dark)", marginTop: 12, marginBottom: -4 }}>
            You have unsaved changes — remember to save before leaving this page.
          </p>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "btn btn-dark" : "btn btn-ghost"} style={{ fontSize: 12.5 }} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "personal" && (
          <form onSubmit={savePersonal} className="card" style={{ padding: 20, marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Demographic Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>First Name</label><input style={inputStyle} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
              <div><label style={labelStyle}>Last Name</label><input style={inputStyle} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Email</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Personal Email</label><input style={inputStyle} type="email" value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} /></div>
              <div><label style={labelStyle}>College Email</label><input style={{ ...inputStyle, background: "var(--line)" }} value={data?.user?.email || ""} disabled /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Academic Identifiers</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Institute / College Name</label><input style={{ ...inputStyle, background: "var(--line)" }} value={data?.user?.institute?.name || ""} disabled /></div>
              <div><label style={labelStyle}>Registration Number (PRN)</label><input style={{ ...inputStyle, background: "var(--line)" }} value={data?.user?.registrationNumber || ""} disabled /></div>
              <div><label style={labelStyle}>Roll Number</label><input style={inputStyle} maxLength={3} value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value.slice(0, 3) })} placeholder="Max 3 characters" /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Phone</div>
            <label style={labelStyle}>Mobile Number</label>
            <input style={inputStyle} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+91XXXXXXXXXX" />

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Address</div>
            <label style={labelStyle}>Address</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>State</label><input style={inputStyle} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
              <div><label style={labelStyle}>District</label><input style={inputStyle} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></div>
              <div><label style={labelStyle}>Pincode</label><input style={inputStyle} value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Personal Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Gender</label>
                <select style={inputStyle} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="">Select…</option>
                  <option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>
                </select>
              </div>
              <div><label style={labelStyle}>Date of Birth</label><input style={inputStyle} type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} max={new Date().toISOString().slice(0, 10)} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Parents' Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Father's Name *</label><input style={inputStyle} value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} /></div>
              <div><label style={labelStyle}>Father's Contact Number *</label><input style={inputStyle} value={form.fatherContact} onChange={(e) => setForm({ ...form, fatherContact: e.target.value })} /></div>
              <div><label style={labelStyle}>Mother's Name *</label><input style={inputStyle} value={form.motherName} onChange={(e) => setForm({ ...form, motherName: e.target.value })} /></div>
              <div><label style={labelStyle}>Mother's Contact Number *</label><input style={inputStyle} value={form.motherContact} onChange={(e) => setForm({ ...form, motherContact: e.target.value })} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>About</div>
            <label style={labelStyle}>Short Description *</label>
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} placeholder="A couple of sentences about yourself" />

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Profile Picture</div>
            <div style={{ marginTop: 6, maxWidth: 260 }}>
              <FileUpload
                accept="image/png,image/jpeg,image/webp"
                maxSizeMB={8}
                imagePreview
                existingPreviewUrl={form.profilePhotoUrl || null}
                label="Upload a photo"
                onFileSelected={async (file) => {
                  if (!file) { setForm({ ...form, profilePhotoUrl: "" }); return; }
                  try {
                    const dataUrl = await compressImageToDataUrl(file);
                    setForm({ ...form, profilePhotoUrl: dataUrl });
                  } catch {
                    toast.error("Could not process that image. Please try a different file.");
                  }
                }}
              />
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>LinkedIn</div>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              {data?.linkedin ? (
                <a href={data.linkedin} target="_blank" rel="noopener noreferrer">{data.linkedin}</a>
              ) : (
                <span style={{ color: "var(--ink-dim)" }}>Not added yet.</span>
              )}
              {resumeBuilderEnabled && (
                <>
                  {" — "}
                  <Link to="/resume" onClick={confirmDiscardIfDirty}>Add or edit in Resume Builder</Link>
                </>
              )}
            </p>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Career History &amp; Education</div>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4, marginBottom: 10 }}>
              At least one education record (SSLC, HSC, Diploma, Degree, etc.) is required — this is part of your
              institutional academic record.
              {resumeBuilderEnabled && <> It also appears automatically in your <Link to="/resume" onClick={confirmDiscardIfDirty}>Resume Builder</Link>.</>}
            </p>

            <div style={{ display: "grid", gap: 8 }}>
              {education === null ? (
                <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
              ) : (
                education.map((e, i) =>
                  editingEducationIndex === i ? (
                    <EducationForm key={i} draft={educationDraft} setDraft={setEducationDraft} onSave={saveEducation} onCancel={cancelEducation} saving={educationSaving} />
                  ) : (
                    <div key={i} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{e.degree || "Untitled"}</strong>{e.specialization ? ` — ${e.specialization}` : ""}
                        <div style={{ color: "var(--ink-dim)", fontSize: 12, marginTop: 2 }}>
                          {[e.institution, e.board, [e.startYear, e.endYear].filter(Boolean).join("–"), e.score, e.status].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => startEditEducation(i)}>Edit</button>
                        <button type="button" style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 11 }} onClick={() => deleteEducation(i)}>Delete</button>
                      </div>
                    </div>
                  )
                )
              )}
              {editingEducationIndex === -1 && (
                <EducationForm draft={educationDraft} setDraft={setEducationDraft} onSave={saveEducation} onCancel={cancelEducation} saving={educationSaving} />
              )}
              {education?.length === 0 && editingEducationIndex === null && <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No education records added yet.</p>}
              {editingEducationIndex === null && (
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, justifySelf: "start" }} onClick={startAddEducation}>+ Add Education Record</button>
              )}
            </div>

            {errors.personal && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 10 }}>{errors.personal}</p>}
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={saving}>{saving ? "Saving…" : "Save Personal Academic & Info"}</button>
          </form>
        )}

        {tab === "skills" && (
          <form onSubmit={saveSkills} className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
              Hackathons, certifications, online courses, internships, GitHub, key skills, technology stack, and languages
              {resumeBuilderEnabled
                ? <> are managed in your <Link to="/resume" onClick={confirmDiscardIfDirty}>Resume Builder</Link> — reused here rather than duplicated.</>
                : " are managed elsewhere."} Add your
              competitive-programming and assessment handles below.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <div><label style={labelStyle}>LeetCode</label><input style={inputStyle} value={skillsForm.leetcodeHandle} onChange={(e) => setSkillsForm({ ...skillsForm, leetcodeHandle: e.target.value })} /></div>
              <div><label style={labelStyle}>HackerRank</label><input style={inputStyle} value={skillsForm.hackerrankHandle} onChange={(e) => setSkillsForm({ ...skillsForm, hackerrankHandle: e.target.value })} /></div>
              <div><label style={labelStyle}>StopStalk</label><input style={inputStyle} value={skillsForm.stopstalkHandle} onChange={(e) => setSkillsForm({ ...skillsForm, stopstalkHandle: e.target.value })} /></div>
              <div><label style={labelStyle}>AMCAT ID</label><input style={inputStyle} value={skillsForm.amcatId} onChange={(e) => setSkillsForm({ ...skillsForm, amcatId: e.target.value })} /></div>
              <div><label style={labelStyle}>CoCubes ID</label><input style={inputStyle} value={skillsForm.cocubesId} onChange={(e) => setSkillsForm({ ...skillsForm, cocubesId: e.target.value })} /></div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </form>
        )}

        {tab === "lms" && (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>System-generated — read only.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <StatTile label="Coding Questions Solved" value={lmsData?.cards?.codingSolved ?? "—"} />
              <StatTile label="Aptitude (MCQ) Correct" value={lmsData?.cards?.mcqCorrect ?? "—"} />
              <StatTile label="Current Streak" value={lmsData?.cards?.codingStreak != null ? `${lmsData.cards.codingStreak} days` : "—"} />
              <StatTile label="Time Spent (min)" value={lmsData?.performanceSummary?.totalTimeSpentMin ?? "—"} />
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>
              Full course-wise statistics are on the <Link to="/dashboard">Dashboard</Link>.
            </p>
          </div>
        )}

        {tab === "placement" && (
          <form onSubmit={savePlacement} className="card" style={{ padding: 20, marginTop: 16 }}>
            <label style={labelStyle}>Would you like to participate in Training &amp; Placement activities?</label>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="radio" name="participation" checked={placementForm.placementParticipation === "INTERESTED"} onChange={() => setPlacementForm({ ...placementForm, placementParticipation: "INTERESTED" })} />
                Yes, I want to participate.
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="radio" name="participation" checked={placementForm.placementParticipation === "NOT_INTERESTED"} onChange={() => setPlacementForm({ ...placementForm, placementParticipation: "NOT_INTERESTED" })} />
                No, I do not wish to participate.
              </label>
            </div>

            {placementForm.placementParticipation === "NOT_INTERESTED" && (
              <>
                <label style={labelStyle}>Reason</label>
                <select style={inputStyle} value={placementForm.placementDeclineReason} onChange={(e) => setPlacementForm({ ...placementForm, placementDeclineReason: e.target.value })}>
                  <option value="">Select a reason…</option>
                  {DECLINE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {placementForm.placementDeclineReason === "OTHER" && (
                  <>
                    <label style={labelStyle}>Please describe</label>
                    <textarea style={{ ...inputStyle, minHeight: 60 }} value={placementForm.placementDeclineOther} onChange={(e) => setPlacementForm({ ...placementForm, placementDeclineOther: e.target.value })} />
                  </>
                )}
              </>
            )}
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 10 }}>Visible to Staff, Clerk, and Admin. You can update this at any time.</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving || !placementForm.placementParticipation}>{saving ? "Saving…" : "Save"}</button>
          </form>
        )}

        {tab === "salary" && (
          <div style={{ marginTop: 16 }}>
            {offerSummary && (
              <div className="card" style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <StatTile label="Total Offers" value={offerSummary.totalOffers} />
                <StatTile label="Internship Offers" value={offerSummary.internshipOffers} />
                <StatTile label="Placement Offers" value={offerSummary.placementOffers} />
                <StatTile label="Accepted" value={offerSummary.acceptedOffers} />
                <StatTile label="Holding" value={offerSummary.holdingOffers} />
                <StatTile label="Highest Offer" value={offerSummary.highestOffer ? `${offerSummary.highestOffer.offeredPackage} — ${offerSummary.highestOffer.companyName}` : "—"} />
                <StatTile label="Current Status" value={offerSummary.currentlyWorking ? `Working at ${offerSummary.currentEmployer}` : "Not currently working"} />
              </div>
            )}

            <div className="card" style={{ padding: 20, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Placement Offers</div>
                {!showOfferForm && <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={startAddOffer}>+ Add Offer</button>}
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                A document proof link (offer letter PDF, Google Drive, OneDrive, Dropbox, etc.) is required for every offer.
                Staff, Clerk, and Admin verify offers against this link — editing a verified offer resets it to Pending.
              </p>

              {showOfferForm && (
                <form onSubmit={saveOffer} className="card" style={{ padding: 16, marginTop: 12, background: "#FBFAF6" }}>
                  <OfferCompanyField form={offerForm} setForm={setOfferForm} companies={companies} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>Offer Type</label>
                      <select style={inputStyle} value={offerForm.offerType} onChange={(e) => setOfferForm({ ...offerForm, offerType: e.target.value })}>
                        <option value="PLACEMENT">Placement</option>
                        <option value="INTERNSHIP">Internship</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Source</label>
                      <select style={inputStyle} value={offerForm.source} onChange={(e) => setOfferForm({ ...offerForm, source: e.target.value })}>
                        <option value="ON_CAMPUS">On-Campus</option>
                        <option value="OFF_CAMPUS">Off-Campus</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{offerForm.offerType === "INTERNSHIP" ? "Stipend (per month)" : "Offered Package (LPA)"}</label>
                      <input style={inputStyle} type="number" step="0.01" min="0" required value={offerForm.offeredPackage} onChange={(e) => setOfferForm({ ...offerForm, offeredPackage: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelStyle}>Offer Status</label>
                      <select style={inputStyle} value={offerForm.offerStatus} onChange={(e) => setOfferForm({ ...offerForm, offerStatus: e.target.value })}>
                        <option value="HOLDING">Holding</option>
                        <option value="ACCEPTED">Accepted</option>
                        <option value="REJECTED">Rejected</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Joining Status (optional)</label>
                      <select style={inputStyle} value={offerForm.joiningStatus} onChange={(e) => setOfferForm({ ...offerForm, joiningStatus: e.target.value })}>
                        <option value="">Not set</option>
                        <option value="Joined">Joined</option>
                        <option value="Not Yet Joined">Not Yet Joined</option>
                        <option value="Deferred">Deferred</option>
                      </select>
                    </div>
                  </div>
                  <label style={labelStyle}>Document Proof Link *</label>
                  <input style={inputStyle} required type="url" placeholder="https://drive.google.com/… or offer letter PDF link" value={offerForm.proofLink} onChange={(e) => setOfferForm({ ...offerForm, proofLink: e.target.value })} />
                  {offerError && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{offerError}</p>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={offerSaving}>{offerSaving ? "Saving…" : "Save Offer"}</button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowOfferForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {offers === null ? (
                  <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
                ) : offers.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No offers added yet.</p>
                ) : (
                  offers.map((o) => (
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
                          {o.verificationStatus === "REJECTED" && o.rejectionReason && (
                            <p style={{ fontSize: 11, color: "var(--rust)", marginTop: 4, maxWidth: 220 }}>{o.rejectionReason}</p>
                          )}
                          <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => startEditOffer(o)}>Edit</button>
                            <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 11 }} onClick={() => deleteOffer(o.id)}>Delete</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "documents" && (
          <div style={{ marginTop: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Documents</div>
                {!showDocumentForm && <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={startAddDocument}>+ Add Document</button>}
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                Add a shareable link (Google Drive, OneDrive, Dropbox, or PDF link) for each supporting document.
                Staff, Clerk, and Admin verify documents against this link — editing a verified document resets it to Pending.
              </p>

              {showDocumentForm && (
                <form onSubmit={saveDocument} className="card" style={{ padding: 16, marginTop: 12, background: "#FBFAF6" }}>
                  <label style={labelStyle}>Document Type *</label>
                  <select style={inputStyle} required value={documentForm.documentType} onChange={(e) => setDocumentForm({ ...documentForm, documentType: e.target.value })}>
                    <option value="">Select…</option>
                    {docTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>

                  {LABEL_REQUIRED_DOC_TYPES.includes(documentForm.documentType) && (
                    <>
                      <label style={labelStyle}>Label *</label>
                      <input style={inputStyle} required placeholder="e.g. Semester 5 Mark Sheet" value={documentForm.label} onChange={(e) => setDocumentForm({ ...documentForm, label: e.target.value })} />
                    </>
                  )}

                  <label style={labelStyle}>Document Link *</label>
                  <input style={inputStyle} required type="url" placeholder="https://drive.google.com/… or document PDF link" value={documentForm.documentLink} onChange={(e) => setDocumentForm({ ...documentForm, documentLink: e.target.value })} />

                  {documentError && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{documentError}</p>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={documentSaving}>{documentSaving ? "Saving…" : "Save Document"}</button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowDocumentForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {documents === null ? (
                  <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
                ) : documents.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>No documents added yet.</p>
                ) : (
                  documents.map((d) => {
                    const typeLabel = docTypes.find((t) => t.value === d.documentType)?.label || d.documentType;
                    return (
                      <div key={d.id} className="card" style={{ padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{typeLabel}{d.label ? ` — ${d.label}` : ""}</div>
                            <a href={d.documentLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--mint)" }}>View document →</a>
                            <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                              Uploaded {new Date(d.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span className="badge" style={{ color: DOC_VERIFICATION_COLOR[d.verificationStatus], fontWeight: 700 }}>{DOC_VERIFICATION_LABEL[d.verificationStatus]}</span>
                            {d.verifiedByName && d.verifiedAt && (
                              <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                                By {d.verifiedByName} on {new Date(d.verifiedAt).toLocaleDateString()}
                              </div>
                            )}
                            {(d.verificationStatus === "REJECTED" || d.verificationStatus === "REUPLOAD_REQUIRED") && d.rejectionReason && (
                              <p style={{ fontSize: 11, color: "var(--rust)", marginTop: 4, maxWidth: 220 }}>{d.rejectionReason}</p>
                            )}
                            {d.verificationStatus !== "VERIFIED" && (
                              <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => startEditDocument(d)}>Edit</button>
                                <button style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 11 }} onClick={() => deleteDocument(d.id)}>Delete</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "jobs" && (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Job preference (salary range, locations, joining availability, and more) is coming soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Same select-or-"Other" pattern as ResumeBuilder.jsx's CompanyField, sourced from the same
// GET /companies Company Master list — companyName always holds a value (mirrored from the
// selected Company or typed free-text), companyId only when a real Company Master row was picked.
function OfferCompanyField({ form, setForm, companies }) {
  const matched = form.companyId && companies.some((c) => c.id === form.companyId);
  return (
    <div>
      <label style={labelStyle}>Company Name *</label>
      <select
        style={inputStyle}
        value={matched ? form.companyId : "OTHER"}
        onChange={(e) => {
          if (e.target.value === "OTHER") setForm({ ...form, companyId: null });
          else {
            const c = companies.find((c) => c.id === e.target.value);
            setForm({ ...form, companyId: c.id, companyName: c.name });
          }
        }}
      >
        <option value="OTHER">Other (type company name below)</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!matched && (
        <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Enter company name" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value, companyId: null })} />
      )}
    </div>
  );
}

// Minimal add/edit form for one Education entry — mirrors EDUCATION_FIELDS' shape exactly so the
// data stays interchangeable with ResumeBuilder.jsx's own (separate, more elaborate) Education
// editor. No AI-improve/confidence/split-merge here — none of that applies to a straightforward
// institutional academic record.
function EducationForm({ draft, setDraft, onSave, onCancel, saving }) {
  return (
    <div className="card" style={{ padding: 12, background: "#FBFAF6" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {EDUCATION_FIELDS.map((f) => (
          <div key={f.key}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" }}>{f.label}</label>
            {f.type === "select" ? (
              <select style={inputStyle} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input style={inputStyle} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
