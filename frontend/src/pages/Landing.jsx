import { Link } from "react-router-dom";
import {
  ArrowRight, CheckCircle2,
  GraduationCap, Users, Building2, Briefcase,
  ShieldCheck, Trophy,
} from "lucide-react";
import MarketingNav from "../components/MarketingNav";
import MarketingFooter from "../components/MarketingFooter";
import useSeoHead from "../hooks/useSeoHead";
import useCountUp from "../hooks/useCountUp";
import useOnScreen from "../hooks/useOnScreen";
import "./landing.css";

// Public marketing homepage — shown at "/" to anyone not signed in (see App.jsx's Home()).
// Every claim on this page is grounded in a feature that actually exists in this codebase
// (routes, models, judge languages) rather than invented adoption numbers or a role that isn't
// real here — this platform has exactly three roles (Student/Staff/Admin, see schema.prisma).
// There's no self-serve signup (Register.jsx redirects to "contact your admin") and no lead-
// capture backend yet, so every CTA points at the real /login route rather than a fake demo
// form or an invented contact address.
export default function Landing() {
  useSeoHead({
    title: "AI-Powered Coding & Assessment Platform",
    description:
      "CodeArena is an AI-powered coding, assessment, learning and employability platform for students and educational institutions — proctored exams, a real compiler, an LMS, and AI mock interviews in one workspace.",
    path: "/",
  });
  return (
    <div className="ca-landing">
      <MarketingNav />
      <Hero />
      <AudienceSection />
      <StatsBand />
      <FeatureSections />
      <ClosingCta />
      <MarketingFooter />
    </div>
  );
}

function Reveal({ children, as: Tag = "div", style, className = "" }) {
  const [ref, visible] = useOnScreen();
  return (
    <Tag ref={ref} className={`ca-reveal ${visible ? "in" : ""} ${className}`} style={style}>
      {children}
    </Tag>
  );
}

function Hero() {
  return (
    <header className="ca-hero">
      <div className="ca-hero-grid">
        <div>
          <span className="ca-eyebrow">Students · Faculty · Institutes</span>
          <h1>
            One workspace to <em>learn</em>, <em>practice</em>, get <em>assessed</em> — and get placed.
          </h1>
          <p className="ca-hero-sub">
            CodeArena brings coding practice, proctored assessments, a learning management system,
            attendance, and placement preparation into a single platform your institute already
            controls — no separate logins for every tool.
          </p>
          <div className="ca-hero-ctas">
            <Link to="/login" className="btn btn-primary">
              Sign in to your workspace <ArrowRight size={16} />
            </Link>
            <a href="#practice" className="btn-outline-light">
              See what's inside
            </a>
          </div>
          <div className="ca-hero-audience-row">
            {["For Students", "For Faculty", "For Institutes & Universities", "For Recruiters"].map((t) => (
              <span key={t} className="ca-hero-audience-chip">{t}</span>
            ))}
          </div>
        </div>

        <div className="ca-hero-mockup">
          <div className="ca-hero-mockup-base">
            <div className="ca-hero-mockup-base-inner">
              <div className="ca-hero-mockup-dots"><span /><span /><span /></div>
              <div className="ca-hero-mockup-code">
                <div><span className="kw">function</span> <span className="fn">twoSum</span>(nums, target) {"{"}</div>
                <div>&nbsp;&nbsp;<span className="kw">const</span> seen = <span className="kw">new</span> Map();</div>
                <div>&nbsp;&nbsp;<span className="kw">for</span> (<span className="kw">let</span> i = 0; i &lt; nums.length; i++) {"{"}</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="kw">if</span> (seen.has(target - nums[i]))</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="kw">return</span> [seen.get(target - nums[i]), i];</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;seen.set(nums[i], i);</div>
                <div>&nbsp;&nbsp;{"}"}</div>
                <div>{"}"}</div>
              </div>
            </div>
          </div>
          <div className="ca-hero-float-card f1">
            <CheckCircle2 size={18} color="var(--mint)" />
            <div>
              <div className="ca-hero-float-card-label">Hidden test cases</div>
              <div className="ca-hero-float-card-value">8 / 8 passed</div>
            </div>
          </div>
          <div className="ca-hero-float-card f2">
            <Trophy size={18} color="var(--amber-dark)" />
            <div>
              <div className="ca-hero-float-card-label">Class leaderboard</div>
              <div className="ca-hero-float-card-value">Rank #3</div>
            </div>
          </div>
          <div className="ca-hero-float-card f3">
            <ShieldCheck size={18} color="var(--mint)" />
            <div>
              <div className="ca-hero-float-card-label">Proctoring</div>
              <div className="ca-hero-float-card-value">No violations</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

const AUDIENCES = [
  {
    icon: GraduationCap,
    color: "var(--amber)",
    title: "Students",
    items: [
      "Practice coding with instant, hidden-test-case grading",
      "Structured learning paths with module-end coding tests",
      "AI-evaluated mock interviews across 7 tracks",
      "A resume builder with real ATS scoring",
    ],
  },
  {
    icon: Users,
    color: "var(--mint)",
    title: "Faculty",
    items: [
      "Author question banks and build tests in minutes",
      "Run proctored assessments with live violation logs",
      "Mark attendance and manage lecture plans per section",
      "Track every student's performance in one dashboard",
    ],
  },
  {
    icon: Building2,
    color: "var(--rust)",
    title: "Institutes & Universities",
    items: [
      "Bulk-onboard an entire batch from a single spreadsheet",
      "Institute → Batch → Department → Section, auto-derived",
      "Full audit log of every account and password action",
      "Exportable attendance, results, and performance reports",
    ],
  },
  {
    icon: Briefcase,
    color: "var(--amber-dark)",
    title: "Recruiters",
    items: [
      "Company-tagged coding rounds mapped to real interview formats",
      "Publicly verifiable certificates via a scannable QR code",
      "Consistent, proctored skill benchmarks across candidates",
    ],
  },
];

function AudienceSection() {
  return (
    <section className="ca-section" id="audiences">
      <Reveal className="ca-section-head">
        <span className="ca-eyebrow">Built for the whole ecosystem</span>
        <h2>Not just a coding site — the whole academic workflow.</h2>
        <p>
          Every role gets its own view of the same underlying data, so a student's practice
          history, a faculty member's attendance record, and an institute's placement report all
          stay in sync automatically.
        </p>
      </Reveal>
      <div className="ca-grid-4">
        {AUDIENCES.map((a, i) => (
          <Reveal key={a.title} style={{ transitionDelay: `${i * 70}ms` }}>
            <div className="card ca-audience-card">
              <div className="ca-icon-badge" style={{ background: `${a.color}1f` }}>
                <a.icon size={22} color={a.color} />
              </div>
              <h3>{a.title}</h3>
              <ul>
                {a.items.map((it) => (
                  <li key={it}><CheckCircle2 size={15} />{it}</li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// Honest, verifiable capability counts (grounded in judge.js / schema.prisma / route inventory)
// rather than invented adoption numbers — see the header comment for why.
const STATS = [
  { value: 5, suffix: "", label: "Compiler languages, plus SQL" },
  { value: 5, suffix: "", label: "Question types (coding, MCQ, SQL & more)" },
  { value: 7, suffix: "", label: "AI-evaluated interview tracks" },
  { value: 6, suffix: "", label: "Live proctoring signals monitored" },
  { value: 100, suffix: "%", label: "Auto-graded, zero manual re-checking" },
];

function StatCard({ stat }) {
  const [ref, value] = useCountUp(stat.value);
  return (
    <div ref={ref}>
      <div className="ca-stat-value">{value}{stat.suffix}</div>
      <div className="ca-stat-label">{stat.label}</div>
    </div>
  );
}

function StatsBand() {
  return (
    <div className="ca-stats-band">
      <div className="ca-stats-grid">
        {STATS.map((s) => <StatCard key={s.label} stat={s} />)}
      </div>
    </div>
  );
}

function FeatureSections() {
  return (
    <section className="ca-section" style={{ paddingTop: 24 }}>
      <FeatureRow
        id="practice"
        eyebrow="Practice & Compiler"
        title="A real compiler, not a code snippet box."
        description="Students write and run code against Java, Python, C, C++, and JavaScript — with SQL questions judged against an isolated database per attempt. Every submission is graded against hidden test cases, not just the ones the student can see."
        bullets={[
          "Run vs. Submit split — see visible cases instantly, hidden cases only on submit",
          "Per-language starter code and syntax highlighting",
          "Daily and weekly coding challenges with streak tracking",
          "Editorial explanations and progressive hints after a wrong attempt",
        ]}
        visual={<PracticeVisual />}
        href="/coding-platform"
      />
      <FeatureRow
        id="assessments"
        eyebrow="Proctored Assessments"
        title="Exams that hold up to scrutiny."
        description="Formal tests run inside a locked-down, fullscreen session with tab-switch and copy-paste detection, optional face-presence checks, and a full violation log faculty can review after the fact."
        bullets={[
          "Randomized question order and shuffled MCQ options per student",
          "Auto-graded coding, MCQ, true/false, multi-select, and SQL questions",
          "Live violation feed during the attempt, not just a final report",
          "Detailed per-question breakdown once results are published",
        ]}
        visual={<AssessmentVisual />}
        href="/online-assessment"
        reverse
      />
      <FeatureRow
        id="learning"
        eyebrow="Learning Management"
        title="Courses that gate on understanding, not just clicks."
        description="Structured courses break down into modules and lessons, each ending in a coding test a student has to pass before the next module unlocks — so 'completed' actually means something."
        bullets={[
          "Module-end coding assessments with the same judge as formal exams",
          "Course-completion certificates with QR-verifiable authenticity",
          "Practice-streak and XP-based gamification to keep momentum",
          "Progress visible to both the student and their faculty",
        ]}
        visual={<LearningVisual />}
        href="/lms"
      />
      <FeatureRow
        id="placement"
        eyebrow="Placement Preparation"
        title="Interview practice that actually evaluates you."
        description="Seven interview tracks — HR, Technical, Coding, Aptitude, System Design, Behavioral, and Managerial — each scored by heuristic and AI-assisted evaluation, plus a resume builder with real ATS scoring, not a cosmetic checklist."
        bullets={[
          "Company-round simulations tagged to real recruiter formats",
          "Resume upload, parsing, and AI-assisted rewrite suggestions",
          "Weak-topic detection that recommends what to practice next",
          "A certificate and detailed report at the end of every session",
        ]}
        visual={<PlacementVisual />}
        href="/ai-mock-interview"
        reverse
      />
      <FeatureRow
        id="institutes"
        eyebrow="For Institutes & Universities"
        title="The academic structure, derived automatically."
        description="Institute, Batch, Department, and Section are derived the moment a student is registered — through bulk upload or manual account creation — instead of requiring an admin to hand-build a class list first."
        bullets={[
          "Bulk-onboard an entire batch from a single spreadsheet",
          "Attendance, staff assignments, and reports scoped per section",
          "Full audit log of every account, password, and access change",
          "One-click exports for results, attendance, and certificates",
        ]}
        visual={<InstitutesVisual />}
        href="/for-institutions"
      />
    </section>
  );
}

function FeatureRow({ id, eyebrow, title, description, bullets, visual, reverse, href }) {
  return (
    <div id={id} className={`ca-feature-row ${reverse ? "reverse" : ""}`}>
      <Reveal className="ca-feature-copy">
        <span className="ca-eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
        <ul className="ca-feature-bullets">
          {bullets.map((b) => (
            <li key={b}><CheckCircle2 size={17} />{b}</li>
          ))}
        </ul>
        {href && (
          <Link to={href} className="ca-feature-learn-more">
            Learn more <ArrowRight size={14} />
          </Link>
        )}
      </Reveal>
      <Reveal className="ca-feature-visual-wrap">
        {visual}
      </Reveal>
    </div>
  );
}

function PracticeVisual() {
  return (
    <div className="ca-feature-visual">
      <div className="ca-panel-row">
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>SOLUTION.JS</span>
        <div className="ca-panel-lang-pills">
          <span>Java</span><span>Python</span><span>C++</span>
        </div>
      </div>
      <div className="ca-code-block">
        <div><span className="kw">def</span> is_palindrome(s):</div>
        <div>&nbsp;&nbsp;s = [c.lower() <span className="kw">for</span> c <span className="kw">in</span> s <span className="kw">if</span> c.isalnum()]</div>
        <div>&nbsp;&nbsp;<span className="kw">return</span> s == s[::-1]</div>
      </div>
      <div className="ca-testcase-row"><span>Test case 1 — visible</span><span className="ca-testcase-pass">Passed</span></div>
      <div className="ca-testcase-row"><span>Test case 2 — hidden</span><span className="ca-testcase-pass">Passed</span></div>
      <div className="ca-testcase-row"><span>Test case 3 — hidden</span><span className="ca-testcase-pass">Passed</span></div>
    </div>
  );
}

function AssessmentVisual() {
  return (
    <div className="ca-feature-visual">
      <div className="ca-panel-row">
        <span style={{ fontWeight: 700, fontSize: 14 }}>Data Structures — Mid Term</span>
        <span className="badge" style={{ background: "rgba(79,157,110,0.15)", color: "var(--mint)" }}>Live</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>Proctoring signals — this attempt</div>
      {[
        ["Fullscreen enforced", true],
        ["Tab-switch detection", true],
        ["Copy / paste blocked", true],
        ["Face presence check", true],
      ].map(([label, ok]) => (
        <div key={label} className="ca-testcase-row">
          <span>{label}</span>
          <span className="ca-testcase-pass">{ok ? "0 violations" : "—"}</span>
        </div>
      ))}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
          <span>Question 6 of 20</span><span className="mono">18:42 remaining</span>
        </div>
        <div className="ca-mini-bar-track"><div className="ca-mini-bar-fill" style={{ width: "30%" }} /></div>
      </div>
    </div>
  );
}

function LearningVisual() {
  return (
    <div className="ca-feature-visual">
      <div className="ca-panel-row">
        <span style={{ fontWeight: 700, fontSize: 14 }}>Java Fundamentals</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>Module 4 / 16</span>
      </div>
      {[
        { name: "Module 1 — Basics", pct: 100, locked: false },
        { name: "Module 2 — Control Flow", pct: 100, locked: false },
        { name: "Module 3 — Methods", pct: 100, locked: false },
        { name: "Module 4 — Arrays (coding test to unlock Module 5)", pct: 60, locked: true },
      ].map((m) => (
        <div key={m.name} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{m.name}</span><span className="mono">{m.pct}%</span>
          </div>
          <div className="ca-mini-bar-track">
            <div className="ca-mini-bar-fill" style={{ width: `${m.pct}%`, background: m.locked ? "var(--amber)" : "var(--mint)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlacementVisual() {
  return (
    <div className="ca-feature-visual">
      <div className="ca-panel-row">
        <span style={{ fontWeight: 700, fontSize: 14 }}>Interview Prep tracks</span>
      </div>
      <div className="ca-track-pill-row">
        {["HR", "Technical", "Coding", "Aptitude", "System Design", "Behavioral", "Managerial"].map((t) => (
          <span key={t} className="ca-track-pill">{t}</span>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>Latest session — Company Round</div>
        <div className="ca-testcase-row"><span>Overall score</span><span className="ca-testcase-pass">82%</span></div>
        <div className="ca-testcase-row"><span>Weak topic flagged</span><span>Time complexity analysis</span></div>
        <div className="ca-testcase-row"><span>Recommended next</span><span>DSA — Sorting practice set</span></div>
      </div>
    </div>
  );
}

function InstitutesVisual() {
  return (
    <div className="ca-feature-visual ca-erp-tree">
      <div className="lvl1">Your Institute</div>
      <div className="lvl2">Batch 2024–26</div>
      <div className="lvl3">Computer Science · Section A · 62 students</div>
      <div className="lvl3">Computer Science · Section B · 58 students</div>
      <div className="lvl2">Batch 2025–27</div>
      <div className="lvl3">Information Technology · Section A · 54 students</div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <div className="ca-testcase-row"><span>Bulk upload</span><span className="ca-testcase-pass">174 accounts created</span></div>
        <div className="ca-testcase-row"><span>Audit log entries this week</span><span>612</span></div>
      </div>
    </div>
  );
}

function ClosingCta() {
  return (
    <div className="ca-cta-band">
      <div className="ca-section" style={{ padding: "80px 32px" }}>
        <span className="ca-eyebrow">Get started</span>
        <h2>Bring practice, assessments, and placement prep onto one platform.</h2>
        <p>
          Accounts on CodeArena are provisioned by your institute administrator — there's no
          self-serve signup. If your institute already uses CodeArena, sign in below.
        </p>
        <div className="ca-cta-band-actions">
          <Link to="/login" className="btn btn-primary">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

