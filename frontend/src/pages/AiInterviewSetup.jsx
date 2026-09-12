import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headphones } from "lucide-react";
import api from "../api";
import Card from "../components/Card";
import Button from "../components/Button";
import "./aiInterview.css";

// Configuration screen for the AI Voice Interview module (backend: POST /api/ai-interviews —
// see backend/src/routes/aiInterview.js for the exact validation this mirrors). Deliberately a
// separate module/route tree from the older InterviewHub.jsx ("Mock Interview") — different
// backend tables, different engine (AIInterviewEngine's adaptive, evidence-based evaluation vs.
// the older question-bank-driven one), different feature key (ai_voice_interview vs
// ai_mock_interview). Not a redesign of that page — a new one for a genuinely different feature.
const INTERVIEW_TYPES = [
  { value: "TECHNICAL", label: "Technical" },
  { value: "HR", label: "HR" },
  { value: "BEHAVIORAL", label: "Behavioral" },
  { value: "CODING", label: "Coding" },
  { value: "SYSTEM_DESIGN", label: "System Design" },
  { value: "PROJECT", label: "Project Discussion" },
  { value: "MIXED", label: "Mixed" },
  { value: "COMPANY_SPECIFIC", label: "Company-Style" },
  { value: "PLACEMENT", label: "Placement" },
  { value: "AI_MOCK", label: "AI Mock" },
];
const EXPERIENCE_LEVELS = ["FRESHER", "INTERN", "ENTRY_LEVEL", "JUNIOR", "MID_LEVEL", "SENIOR", "EXPERIENCED", "LEAD", "MANAGER"];
const DURATIONS = [10, 15, 20, 30, 45, 60];
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
];
const COMMON_SKILLS = ["Java", "Python", "JavaScript", "SQL", "Data Structures", "System Design", "Spring Boot", "React", "OOP", "DBMS", "Operating Systems", "Communication"];

export default function AiInterviewSetup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    role: "", experienceLevel: "FRESHER", interviewType: "TECHNICAL",
    targetSkills: [], durationMin: 20, language: "en", jobDescription: "",
  });
  const [skillInput, setSkillInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  function addSkill(skill) {
    const s = skill.trim();
    if (!s || form.targetSkills.includes(s)) return;
    setForm((f) => ({ ...f, targetSkills: [...f.targetSkills, s] }));
    setSkillInput("");
  }
  function removeSkill(skill) {
    setForm((f) => ({ ...f, targetSkills: f.targetSkills.filter((s) => s !== skill) }));
  }

  async function handleStart() {
    setError(null);
    if (!form.role.trim()) return setError("Job role is required.");
    if (form.targetSkills.length === 0) return setError("Add at least one skill to be assessed.");

    setStarting(true);
    try {
      const { data } = await api.post("/ai-interviews", {
        role: form.role.trim(),
        experienceLevel: form.experienceLevel,
        interviewType: form.interviewType,
        targetSkills: form.targetSkills,
        durationMin: form.durationMin,
        language: form.language,
        jobDescription: form.jobDescription.trim() || undefined,
      });
      navigate(`/ai-interview/session/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create the interview. Please try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="ai-int-page">
      <div className="ai-int-setup-wrap">
        <div className="ai-int-setup-header">
          <Headphones size={26} />
          <div>
            <h1>AI Voice Interview</h1>
            <p>A real-time, spoken technical interview. The next question always depends on how you answered the last one.</p>
          </div>
        </div>

        <Card padding={24} className="ai-int-setup-card">
          <FormRow label="Job role">
            <input
              className="ai-int-input"
              placeholder="e.g. Java Backend Developer"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
          </FormRow>

          <FormRow label="Experience level">
            <select
              className="ai-int-input"
              value={form.experienceLevel}
              onChange={(e) => setForm((f) => ({ ...f, experienceLevel: e.target.value }))}
            >
              {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
            </select>
          </FormRow>

          <FormRow label="Interview type">
            <select
              className="ai-int-input"
              value={form.interviewType}
              onChange={(e) => setForm((f) => ({ ...f, interviewType: e.target.value }))}
            >
              {INTERVIEW_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </FormRow>

          <FormRow label="Skills to be assessed">
            <div className="ai-int-skill-input-row">
              <input
                className="ai-int-input"
                placeholder="Type a skill and press Enter"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(skillInput); } }}
              />
              <Button variant="ghost" onClick={() => addSkill(skillInput)}>Add</Button>
            </div>
            <div className="ai-int-skill-suggestions">
              {COMMON_SKILLS.filter((s) => !form.targetSkills.includes(s)).slice(0, 8).map((s) => (
                <button key={s} type="button" className="ai-int-skill-chip suggestion" onClick={() => addSkill(s)}>+ {s}</button>
              ))}
            </div>
            {form.targetSkills.length > 0 && (
              <div className="ai-int-skill-chips">
                {form.targetSkills.map((s) => (
                  <span key={s} className="ai-int-skill-chip">
                    {s}
                    <button type="button" aria-label={`Remove ${s}`} onClick={() => removeSkill(s)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </FormRow>

          <div className="ai-int-form-grid-2">
            <FormRow label="Duration">
              <select
                className="ai-int-input"
                value={form.durationMin}
                onChange={(e) => setForm((f) => ({ ...f, durationMin: Number(e.target.value) }))}
              >
                {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
              </select>
            </FormRow>
            <FormRow label="Language">
              <select
                className="ai-int-input"
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
              >
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </FormRow>
          </div>

          <FormRow label="Job description (optional)">
            <textarea
              className="ai-int-input ai-int-textarea"
              placeholder="Paste a job description to help the AI focus on relevant competencies."
              value={form.jobDescription}
              onChange={(e) => setForm((f) => ({ ...f, jobDescription: e.target.value }))}
              maxLength={4000}
              rows={4}
            />
          </FormRow>

          {error && <p className="ai-int-error">{error}</p>}

          <Button variant="primary" loading={starting} onClick={handleStart} style={{ width: "100%", marginTop: 8, justifyContent: "center" }}>
            {starting ? "Creating interview…" : "Continue to system check"}
          </Button>
        </Card>
      </div>
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div className="ai-int-form-row">
      <label>{label}</label>
      {children}
    </div>
  );
}
