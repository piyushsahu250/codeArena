import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CompleteProfileModal from "../components/CompleteProfileModal";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 6 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--ink-dim)", marginTop: 10, display: "block" };

const TABS = [
  { key: "personal", label: "Personal Academic & Info" },
  { key: "skills", label: "Skills & Capabilities" },
  { key: "lms", label: "Talentely LMS Info" },
  { key: "placement", label: "Placement Registration" },
  { key: "salary", label: "Salary & Performance Info" },
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
  firstName: "", lastName: "", mobile: "", gender: "", profilePhotoUrl: "",
  personalEmail: "", dob: "", address: "", state: "", district: "", pincode: "",
  fatherName: "", fatherContact: "", motherName: "", motherContact: "", shortDescription: "",
};

export default function StudentProfile() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("personal");
  const [form, setForm] = useState(EMPTY_PERSONAL);
  const [skillsForm, setSkillsForm] = useState({ leetcodeHandle: "", hackerrankHandle: "", stopstalkHandle: "", amcatId: "", cocubesId: "" });
  const [placementForm, setPlacementForm] = useState({ placementParticipation: "", placementDeclineReason: "", placementDeclineOther: "" });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [lmsData, setLmsData] = useState(null);
  const [showModal, setShowModal] = useState(() => user?.role === "STUDENT" && user?.requireProfileCompletion && !user?.profileComplete);

  function load() {
    api.get("/profile/me").then((res) => {
      setData(res.data);
      const { user: u, profile: p } = res.data;
      const [first, ...rest] = (u.name || "").split(" ");
      setForm({
        firstName: first || "", lastName: rest.join(" ") || "",
        mobile: u.mobile || "", gender: u.gender || "", profilePhotoUrl: u.profilePhotoUrl || "",
        personalEmail: p?.personalEmail || "", dob: p?.dob ? p.dob.slice(0, 10) : "",
        address: p?.address || "", state: p?.state || "", district: p?.district || "", pincode: p?.pincode || "",
        fatherName: p?.fatherName || "", fatherContact: p?.fatherContact || "",
        motherName: p?.motherName || "", motherContact: p?.motherContact || "",
        shortDescription: p?.shortDescription || "",
      });
      setSkillsForm({
        leetcodeHandle: p?.leetcodeHandle || "", hackerrankHandle: p?.hackerrankHandle || "",
        stopstalkHandle: p?.stopstalkHandle || "", amcatId: p?.amcatId || "", cocubesId: p?.cocubesId || "",
      });
      setPlacementForm({
        placementParticipation: p?.placementParticipation || "",
        placementDeclineReason: p?.placementDeclineReason || "", placementDeclineOther: p?.placementDeclineOther || "",
      });
    });
  }
  useEffect(load, []);

  // Talentely LMS Info is read-only and system-generated — reuses the existing Dashboard
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
      (data?.educationCount || 0) > 0, !!data?.hasResume,
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
      updateUser({ profileComplete: res.data.completion.complete, name: res.data.user.name, mobile: res.data.user.mobile, gender: res.data.user.gender, profilePhotoUrl: res.data.user.profilePhotoUrl });
      load();
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to save. Please check the fields below.";
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
      toast.error(err.response?.data?.error || "Failed to save");
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
      toast.error(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
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
          <div className="card" style={{ padding: 16, marginTop: 16, background: "#FCEFD9", border: "1px solid var(--amber)" }}>
            <strong>Complete your Personal Academic &amp; Info to continue.</strong>
            <p style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              Every other section of CodeArena is locked until this section is 100% complete. Fill in the fields below,
              upload your profile picture and resume, and add at least one education record.
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
          {data?.completion && !data.completion.complete && (
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
              Missing: {data.completion.missingFields.map((f) => f.label).join(", ")}
            </p>
          )}
        </div>

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
              <div><label style={labelStyle}>First Name</label><input style={inputStyle} required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
              <div><label style={labelStyle}>Last Name</label><input style={inputStyle} required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Email</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Personal Email</label><input style={inputStyle} type="email" required value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} /></div>
              <div><label style={labelStyle}>College Email</label><input style={{ ...inputStyle, background: "var(--line)" }} value={data?.user?.email || ""} disabled /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Phone</div>
            <label style={labelStyle}>Mobile Number</label>
            <input style={inputStyle} required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+91XXXXXXXXXX" />

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Address</div>
            <label style={labelStyle}>Address</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>State</label><input style={inputStyle} required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
              <div><label style={labelStyle}>District</label><input style={inputStyle} required value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></div>
              <div><label style={labelStyle}>Pincode</label><input style={inputStyle} required value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Personal Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Gender</label>
                <select style={inputStyle} required value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="">Select…</option>
                  <option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>
                </select>
              </div>
              <div><label style={labelStyle}>Date of Birth</label><input style={inputStyle} type="date" required value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} max={new Date().toISOString().slice(0, 10)} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Parents' Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Father's Name</label><input style={inputStyle} required value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} /></div>
              <div><label style={labelStyle}>Father's Contact Number</label><input style={inputStyle} required value={form.fatherContact} onChange={(e) => setForm({ ...form, fatherContact: e.target.value })} /></div>
              <div><label style={labelStyle}>Mother's Name</label><input style={inputStyle} required value={form.motherName} onChange={(e) => setForm({ ...form, motherName: e.target.value })} /></div>
              <div><label style={labelStyle}>Mother's Contact Number</label><input style={inputStyle} required value={form.motherContact} onChange={(e) => setForm({ ...form, motherContact: e.target.value })} /></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>About</div>
            <label style={labelStyle}>Short Description</label>
            <textarea style={{ ...inputStyle, minHeight: 70 }} required minLength={10} value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} placeholder="A couple of sentences about yourself" />

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Profile Picture</div>
            <label style={labelStyle}>Profile Picture URL</label>
            <input style={inputStyle} required value={form.profilePhotoUrl} onChange={(e) => setForm({ ...form, profilePhotoUrl: e.target.value })} placeholder="https://…" />
            {form.profilePhotoUrl && <img src={form.profilePhotoUrl} alt="Profile preview" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", marginTop: 8 }} />}

            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 18 }}>Career History & Education, and Resume</div>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>
              At least one education record (SSLC, HSC, Diploma, Degree, etc.) and a resume are required.
              {" "}Manage both in the <Link to="/resume">Resume Builder</Link> — you currently have{" "}
              <strong>{data?.educationCount ?? 0}</strong> education record{data?.educationCount === 1 ? "" : "s"}
              {" "}and {data?.hasResume ? "a resume on file" : "no resume yet"}.
            </p>

            {errors.personal && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 10 }}>{errors.personal}</p>}
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={saving}>{saving ? "Saving…" : "Save Personal Academic & Info"}</button>
          </form>
        )}

        {tab === "skills" && (
          <form onSubmit={saveSkills} className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
              Hackathons, certifications, online courses, internships, GitHub, key skills, technology stack, and languages
              are managed in your <Link to="/resume">Resume Builder</Link> — reused here rather than duplicated. Add your
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
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Placement history and work experience tracking are coming soon.</p>
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

function StatTile({ label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
