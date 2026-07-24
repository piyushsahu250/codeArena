import { useState } from "react";
import { Eye, X } from "lucide-react";
import ProblemStatement from "./ProblemStatement";

// Shared "preview as student" toggle for the 3 admin question-authoring surfaces (CreateQuestion,
// LearningManagement's coding panels, InterviewAdmin) — none of them previously rendered the
// question through the same ProblemStatement.jsx a student actually sees before saving, so a
// missing/malformed section only ever surfaced after publish. `question` is whatever shape the
// caller can currently assemble from its own form state — ProblemStatement.jsx already omits any
// field that's empty/missing, so a page whose form doesn't track a given optional field (e.g. no
// hints editor) simply shows less in preview rather than guessing at a value.
export default function QuestionPreviewToggle({ question }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setOpen(true)}>
        <Eye size={14} /> Preview as student
      </button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflowY: "auto" }} onClick={() => setOpen(false)}>
          <div className="card" style={{ maxWidth: 780, width: "100%", padding: 24, position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost" style={{ position: "absolute", top: 12, right: 12, padding: 6 }} onClick={() => setOpen(false)} aria-label="Close preview">
              <X size={16} />
            </button>
            <p className="mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 12 }}>PREVIEW — exactly what a student would see (not saved)</p>
            <ProblemStatement question={question} />
          </div>
        </div>
      )}
    </>
  );
}
