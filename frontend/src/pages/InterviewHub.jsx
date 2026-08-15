import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  MessagesSquare, Lightbulb, Code2, Building2, Compass, Briefcase, Calculator, Target, FileText, Award, GraduationCap,
} from "lucide-react";
import api from "../api";
import { useTheme } from "../context/ThemeContext";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import "./interviewPrep.css";

const CARDS = [
  { key: "HR", title: "HR Interview", icon: MessagesSquare, desc: "Practice common HR questions — type or speak your answer." },
  { key: "TECHNICAL", title: "Technical Interview", icon: Lightbulb, desc: "Subject-based Q&A across 11 core CS subjects." },
  { key: "CODING", title: "Coding Interview", icon: Code2, desc: "Solve real coding problems, graded by the judge." },
  { key: "SYSTEM_DESIGN", title: "System Design Interview", icon: Building2, desc: "Explain your approach to designing scalable systems." },
  { key: "BEHAVIORAL", title: "Behavioral Interview", icon: Compass, desc: "STAR-style questions about how you've handled real situations." },
  { key: "MANAGERIAL", title: "Managerial Interview", icon: Briefcase, desc: "Leadership, prioritization, and team-management scenarios." },
  { key: "APTITUDE", title: "Aptitude Interview", icon: Calculator, desc: "Timed quantitative, logical, verbal & DI questions." },
  { key: "COMPANY", title: "Company-Specific Interview", icon: Building2, desc: "Practice questions tagged to a specific company's hiring pattern, one round at a time." },
  { key: "COMPANY_ROUND", title: "Company Round", icon: Award, desc: "A full HR + Technical + Coding + Managerial round for one company, all in one session." },
  { key: "MOCK", title: "Mock Interview", icon: Target, desc: "A 30-minute mixed HR + Technical + Coding session." },
  { key: "RESUME_BASED", title: "Resume-based Interview", icon: FileText, desc: "Questions generated from your own resume." },
];

const SUBJECTS = ["C", "C++", "Java", "Python", "JavaScript", "SQL", "DBMS", "OS", "CN", "OOP", "DSA"];
const TOPICS = ["Arrays", "Strings", "Stack", "Queue", "Trees", "Graphs", "DP", "Linked List", "Recursion", "Sorting", "Searching", "Hashing", "Backtracking"];
const APTITUDE_CATS = [
  { id: "QUANTITATIVE", label: "Quantitative" }, { id: "LOGICAL", label: "Logical" },
  { id: "VERBAL", label: "Verbal" }, { id: "DATA_INTERPRETATION", label: "Data Interpretation" },
];
const LANGUAGES = ["java", "python", "javascript", "c", "cpp"];
const COMPANY_CATEGORIES = [
  { id: "HR", label: "HR" }, { id: "TECHNICAL", label: "Technical" }, { id: "CODING", label: "Coding" },
  { id: "SYSTEM_DESIGN", label: "System Design" }, { id: "BEHAVIORAL", label: "Behavioral" },
];
const DURATIONS = [15, 30, 45, 60];
const JOB_ROLES = ["Java Developer", "Full Stack Developer", "Backend Developer", "Software Engineer", "Data Analyst", "AI/ML Engineer"];

export default function InterviewHub() {
  const navigate = useNavigate();
  const location = useLocation();
  const [summary, setSummary] = useState(null);
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [setupCard, setSetupCard] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [config, setConfig] = useState({
    subject: "Java", topic: "Arrays", difficulty: "EASY", language: "java",
    aptitudeCategory: "QUANTITATIVE", negativeMarking: false,
    durationMin: 30, jobRole: "", experienceLevel: "Fresher",
    company: "", companyCategory: "HR",
  });

  useEffect(() => {
    api.get("/interview/summary").then((res) => setSummary(res.data));
    api.get("/interview/companies").then((res) => setCompanies(res.data));
  }, []);

  // Arriving from the Company Browse page's "Start Company Round" button pre-fills and jumps
  // straight to that card's setup form instead of making the student re-pick the company.
  useEffect(() => {
    if (location.state?.prefillCompany) {
      setConfig((c) => ({ ...c, company: location.state.prefillCompany }));
      setSetupCard("COMPANY_ROUND");
    }
  }, [location.state]);

  async function start(category, extraConfig) {
    setStarting(true);
    setStartError(null);
    try {
      const body = category === "MOCK"
        ? { isMock: true, config: { jobRole: config.jobRole || undefined, experienceLevel: config.experienceLevel } }
        : category === "RESUME_BASED"
          ? { isResumeBased: true, config: {} }
          : category === "COMPANY_ROUND"
            ? { isCompanyRound: true, config: { company: config.company, difficulty: config.difficulty, ...commonConfig() } }
            : { category, config: extraConfig || {} };
      const { data } = await api.post("/interview/sessions", body);
      if (data.resumed) {
        // The server silently reused an existing in-progress session of this shape instead of
        // creating a new one (see interview.js's resume-matching) — surface that plainly rather
        // than letting the student think they're starting fresh, per a brief pause before
        // navigating into InterviewSession.jsx's own richer "Resume Interview" screen.
        setResuming(true);
        setTimeout(() => navigate(`/interview/session/${data.session.id}`), 700);
        return;
      }
      navigate(`/interview/session/${data.session.id}`);
    } catch (err) {
      const serverMessage = err.response?.data?.error;
      // The backend returns this exact family of messages only for the "zero questions
      // available" business-rule case (see pickQuestions()/POST /sessions in interview.js) —
      // never a generic failure, so it's safe to key the fallback UI off it.
      const isNoQuestions = typeof serverMessage === "string" && serverMessage.startsWith("No interview questions available")
        || typeof serverMessage === "string" && serverMessage.startsWith("No questions available");
      if (category === "COMPANY_ROUND" && isNoQuestions) {
        setStartError({
          message: "We couldn't generate the company-specific interview right now. Please try again or start a general technical interview.",
          retry: () => start("COMPANY_ROUND"),
          showGeneralFallback: true,
        });
      } else {
        setStartError({ message: serverMessage || "Could not start interview. Please try again.", retry: () => start(category, extraConfig) });
      }
    } finally {
      setStarting(false);
    }
  }

  const CONFIGURABLE = ["TECHNICAL", "CODING", "APTITUDE", "SYSTEM_DESIGN", "BEHAVIORAL", "MANAGERIAL", "COMPANY", "COMPANY_ROUND"];

  function handleCardClick(key) {
    setStartError(null);
    if (CONFIGURABLE.includes(key)) {
      setSetupCard(setupCard === key ? null : key);
    } else {
      start(key);
    }
  }

  function commonConfig() {
    return { durationMin: config.durationMin, jobRole: config.jobRole || undefined, experienceLevel: config.experienceLevel };
  }

  return (
    <div className={`interview-prep ${dark ? "dark" : ""}`}>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>AI Mock Interview</h1>
            <ChalkUnderline />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link to="/interview/companies" className="btn btn-ghost">Browse Companies</Link>
            <Link to="/interview/history" className="btn btn-ghost">History</Link>
            <Link to="/interview/leaderboard" className="btn btn-ghost">Leaderboard</Link>
            <Link to="/interview/progress" className="btn btn-ghost">Progress</Link>
            <Link to="/interview/certificate" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><GraduationCap size={14} /> Certificate</Link>
          </div>
        </div>

        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 24 }}>
            <StatTile label="Interviews Attempted" value={summary.totalAttempted} />
            <StatTile label="Average Score" value={`${summary.averageScore}%`} />
            <StatTile label="Strong Areas" value={summary.strongAreas.length ? summary.strongAreas.join(", ") : "—"} small />
            <StatTile label="Weak Areas" value={summary.weakAreas.length ? summary.weakAreas.join(", ") : "—"} small />
          </div>
        )}
        {summary?.improvementSuggestions?.length > 0 && (
          <div className="ip-glass" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Improvement Suggestions</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {summary.improvementSuggestions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {resuming && (
          <div className="ip-glass" style={{ padding: 16, marginTop: 16, border: "1px solid var(--ip-accent)" }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>Resuming your previous in-progress interview…</p>
          </div>
        )}

        {startError && (
          <div className="ip-glass" style={{ padding: 16, marginTop: 16, border: "1px solid var(--rust)" }}>
            <p style={{ margin: 0, color: "var(--rust)", fontWeight: 600, fontSize: 14 }}>{startError.message}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" disabled={starting} onClick={startError.retry}>Try Again</button>
              {startError.showGeneralFallback && (
                <button
                  className="btn btn-primary"
                  disabled={starting}
                  onClick={() => start("TECHNICAL", { subject: config.subject, difficulty: config.difficulty, ...commonConfig() })}
                >
                  Start General Technical Interview
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setStartError(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 28 }}>
          {CARDS.map((c) => (
            <div key={c.key} className="ip-glass ip-card" onClick={() => handleCardClick(c.key)}>
              <c.icon size={28} />
              <h3 style={{ fontSize: 17, marginTop: 8 }}>{c.title}</h3>
              <p style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{c.desc}</p>

              {setupCard === c.key && (
                <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {c.key === "TECHNICAL" && (
                    <>
                      <select className="ip-select" value={config.subject} onChange={(e) => setConfig({ ...config, subject: e.target.value })}>
                        {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select className="ip-select" value={config.difficulty} onChange={(e) => setConfig({ ...config, difficulty: e.target.value })}>
                        <option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
                      </select>
                    </>
                  )}
                  {c.key === "CODING" && (
                    <>
                      <select className="ip-select" value={config.topic} onChange={(e) => setConfig({ ...config, topic: e.target.value })}>
                        {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select className="ip-select" value={config.language} onChange={(e) => setConfig({ ...config, language: e.target.value })}>
                        {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <select className="ip-select" value={config.difficulty} onChange={(e) => setConfig({ ...config, difficulty: e.target.value })}>
                        <option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
                      </select>
                    </>
                  )}
                  {c.key === "APTITUDE" && (
                    <>
                      <select className="ip-select" value={config.aptitudeCategory} onChange={(e) => setConfig({ ...config, aptitudeCategory: e.target.value })}>
                        {APTITUDE_CATS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                      </select>
                      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" checked={config.negativeMarking} onChange={(e) => setConfig({ ...config, negativeMarking: e.target.checked })} />
                        Enable negative marking
                      </label>
                    </>
                  )}
                  {c.key === "COMPANY" && (
                    <>
                      <select className="ip-select" value={config.company} onChange={(e) => setConfig({ ...config, company: e.target.value })}>
                        <option value="">Select a company…</option>
                        {companies.map((co) => <option key={co.company} value={co.company}>{co.company} ({co.questionCount})</option>)}
                      </select>
                      <select className="ip-select" value={config.companyCategory} onChange={(e) => setConfig({ ...config, companyCategory: e.target.value })}>
                        {COMPANY_CATEGORIES.map((cc) => <option key={cc.id} value={cc.id}>{cc.label}</option>)}
                      </select>
                      {config.companyCategory === "CODING" && (
                        <select className="ip-select" value={config.language} onChange={(e) => setConfig({ ...config, language: e.target.value })}>
                          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      )}
                    </>
                  )}
                  {c.key === "COMPANY_ROUND" && (
                    <>
                      <select className="ip-select" value={config.company} onChange={(e) => setConfig({ ...config, company: e.target.value })}>
                        <option value="">Select a company…</option>
                        {companies.map((co) => <option key={co.company} value={co.company}>{co.company} ({co.questionCount})</option>)}
                      </select>
                      <select className="ip-select" value={config.difficulty} onChange={(e) => setConfig({ ...config, difficulty: e.target.value })}>
                        <option value="EASY">Beginner</option><option value="MEDIUM">Intermediate</option><option value="HARD">Advanced</option>
                      </select>
                      <p style={{ fontSize: 11, opacity: 0.7, margin: 0 }}>HR + Technical + Coding + Managerial, ~45 minutes.</p>
                    </>
                  )}

                  {/* Shared config: job role, experience level, duration — spec's "Interview Configuration" */}
                  <select className="ip-select" value={config.jobRole} onChange={(e) => setConfig({ ...config, jobRole: e.target.value })}>
                    <option value="">Any job role</option>
                    {JOB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select className="ip-select" value={config.experienceLevel} onChange={(e) => setConfig({ ...config, experienceLevel: e.target.value })}>
                    <option value="Fresher">Fresher</option>
                    <option value="Experienced">Experienced</option>
                  </select>
                  <select className="ip-select" value={config.durationMin} onChange={(e) => setConfig({ ...config, durationMin: Number(e.target.value) })}>
                    {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
                  </select>

                  <button
                    className="btn btn-primary"
                    disabled={starting || ((c.key === "COMPANY" || c.key === "COMPANY_ROUND") && !config.company)}
                    onClick={() => {
                      if (c.key === "TECHNICAL") start("TECHNICAL", { subject: config.subject, difficulty: config.difficulty, ...commonConfig() });
                      else if (c.key === "CODING") start("CODING", { subject: config.topic, difficulty: config.difficulty, language: config.language, ...commonConfig() });
                      else if (c.key === "APTITUDE") start("APTITUDE", { aptitudeCategory: config.aptitudeCategory, negativeMarking: config.negativeMarking, durationMin: config.durationMin || 10 });
                      else if (c.key === "SYSTEM_DESIGN" || c.key === "BEHAVIORAL" || c.key === "MANAGERIAL") start(c.key, commonConfig());
                      else if (c.key === "COMPANY") start(config.companyCategory, { company: config.company, language: config.language, ...commonConfig() });
                      else if (c.key === "COMPANY_ROUND") start("COMPANY_ROUND");
                    }}
                  >
                    {starting ? "Starting…" : "Start"}
                  </button>
                </div>
              )}

              {setupCard !== c.key && (c.key === "HR" || c.key === "MOCK" || c.key === "RESUME_BASED") && (
                <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={starting} onClick={(e) => { e.stopPropagation(); start(c.key); }}>
                  {starting ? "Starting…" : "Start"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, small }) {
  return (
    <div className="ip-glass" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: small ? 13 : 20, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{label}</div>
    </div>
  );
}
