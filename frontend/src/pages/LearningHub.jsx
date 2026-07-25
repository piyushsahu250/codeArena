import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Coffee, Binary, Cpu, Terminal, Network, Database, Globe, GitBranch, Wifi, Target, Layers, Wrench, BookOpen, Code2,
} from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";

// Per-course banner: a colored gradient (built from the platform's own token palette, not any
// external brand's colors) + a lucide icon, matched against the course's name/slug. No image
// field exists on Course (and this platform has no object storage — see Lesson.videoUrl/pdfUrl
// comments), so this is a purely CSS/icon-driven "thumbnail" rather than an uploaded image.
const COURSE_VISUALS = [
  { match: /java(?!script)/i, icon: Coffee, gradient: "linear-gradient(135deg, #C7852A, #E8A33D)" },
  { match: /python/i, icon: Binary, gradient: "linear-gradient(135deg, #2C5B45, #4F9D6E)" },
  { match: /c\+\+|cpp/i, icon: Cpu, gradient: "linear-gradient(135deg, #123528, #2C5B45)" },
  { match: /(^|\s)c(\s|$)/i, icon: Terminal, gradient: "linear-gradient(135deg, #0B2A1E, #1B4332)" },
  { match: /data structure|dsa|algorithm/i, icon: Network, gradient: "linear-gradient(135deg, #4F9D6E, #E8A33D)" },
  { match: /sql|database|dbms/i, icon: Database, gradient: "linear-gradient(135deg, #1B4332, #C7852A)" },
  { match: /web|html|css|javascript/i, icon: Globe, gradient: "linear-gradient(135deg, #C0533B, #E8A33D)" },
  { match: /git/i, icon: GitBranch, gradient: "linear-gradient(135deg, #6B6A5F, #C0533B)" },
  { match: /operating system|\bos\b/i, icon: Cpu, gradient: "linear-gradient(135deg, #123528, #4F9D6E)" },
  { match: /network/i, icon: Wifi, gradient: "linear-gradient(135deg, #2C5B45, #C0533B)" },
  { match: /aptitude|placement/i, icon: Target, gradient: "linear-gradient(135deg, #E8A33D, #C0533B)" },
  { match: /\boop\b|object[- ]oriented/i, icon: Layers, gradient: "linear-gradient(135deg, #4F9D6E, #123528)" },
  { match: /software engineering/i, icon: Wrench, gradient: "linear-gradient(135deg, #C7852A, #4F9D6E)" },
];
const FALLBACK_VISUALS = [
  { icon: BookOpen, gradient: "linear-gradient(135deg, #123528, #E8A33D)" },
  { icon: Code2, gradient: "linear-gradient(135deg, #2C5B45, #C0533B)" },
];

function courseVisual(course, index) {
  const label = `${course.name} ${course.slug}`;
  const found = COURSE_VISUALS.find((v) => v.match.test(label));
  return found || FALLBACK_VISUALS[index % FALLBACK_VISUALS.length];
}

function CourseCard({ course, index }) {
  const visual = courseVisual(course, index);
  const Icon = visual.icon;
  const banner = (
    <div style={{ height: 96, background: visual.gradient, display: "flex", alignItems: "center", justifyContent: "center", filter: course.isActive ? "none" : "grayscale(70%)" }}>
      <Icon size={40} color="#F4EFE3" strokeWidth={1.75} />
    </div>
  );
  const body = (
    <div style={{ padding: "16px 20px 20px" }}>
      <h3 style={{ fontSize: 17 }}>{course.name}</h3>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 6, minHeight: 34 }}>{course.description}</p>
      {course.isActive
        ? <span className="btn btn-primary" style={{ marginTop: 14, display: "inline-block", pointerEvents: "none" }}>Start learning →</span>
        : <span className="badge" style={{ marginTop: 14, display: "inline-block" }}>Coming soon</span>}
    </div>
  );

  if (!course.isActive) {
    return (
      <div className="card" style={{ overflow: "hidden", opacity: 0.65 }}>
        {banner}
        {body}
      </div>
    );
  }
  return (
    <Link to={`/learning/${course.slug}`} className="card course-card" style={{ overflow: "hidden", textDecoration: "none", color: "inherit", display: "block" }}>
      {banner}
      {body}
    </Link>
  );
}

export default function LearningHub() {
  const [courses, setCourses] = useState([]);

  useEffect(() => {
    api.get("/learning/courses").then((res) => setCourses(res.data));
  }, []);

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
        <h1>Learning</h1>
        <ChalkUnderline />
        <p style={{ color: "var(--ink-dim)", marginTop: 12 }}>
          Structured, self-paced courses to build up your skills before attempting a coding test.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, marginTop: 24 }}>
          {courses.map((c, i) => <CourseCard key={c.id} course={c} index={i} />)}
        </div>
      </div>
    </div>
  );
}
