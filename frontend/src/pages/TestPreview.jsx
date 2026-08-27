import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import MathText from "../components/MathText";

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select" };

export default function TestPreview() {
  const { id } = useParams();
  const [test, setTest] = useState(null);

  useEffect(() => {
    api.get(`/tests/${id}`).then((res) => setTest(res.data));
  }, [id]);

  if (!test) return <div style={{ padding: 48 }} className="mono">Loading…</div>;

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        {/* This view intentionally shows correct answers and hidden test cases — it is the
            instructor answer-key preview, not a simulation of what a student sees during an
            attempt. The banner below exists specifically so nobody mistakes one for the other
            (spec requirement: never expose this information without explicitly labeling it as
            an admin view). There is currently no separate student-simulation preview mode. */}
        <div className="card" style={{ padding: "10px 16px", marginBottom: 20, background: "var(--warn-bg, #fff8e1)", border: "1px solid var(--warn-border, #f0c95f)" }}>
          <strong style={{ fontSize: 13 }}>⚠ Instructor Answer-Key Preview</strong>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "4px 0 0" }}>
            This shows correct answers and hidden test cases so you can review the test before publishing.
            Students never see this — during an attempt they see only the question text, options, and visible test cases.
          </p>
        </div>
        <h1>{test.title}</h1>
        <ChalkUnderline />
        {test.description && <p style={{ color: "var(--ink-dim)", marginTop: 12 }}>{test.description}</p>}
        <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
          {new Date(test.startTime).toLocaleString()} → {new Date(test.endTime).toLocaleString()} · {test.durationMin} min · {test.isPublished ? "Published" : "Draft"}
        </p>

        <div style={{ display: "grid", gap: 16, marginTop: 32 }}>
          {test.questions.map((tq, idx) => (
            <div key={tq.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <h3 style={{ fontSize: 16 }}>Q{idx + 1}. {tq.question.title || "(untitled)"}</h3>
                <span className="badge">{TYPE_LABELS[tq.question.questionType]}</span>
                <span className={`badge badge-${tq.question.difficulty.toLowerCase()}`}>{tq.question.difficulty}</span>
                <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-dim)" }}>
                  {tq.question.points} pts
                </span>
              </div>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 10, lineHeight: 1.6 }}><MathText text={tq.question.description} /></p>

              {tq.question.questionType === "CODING" ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>TEST CASES ({tq.question.testCases.length})</div>
                  {tq.question.testCases.map((tc) => (
                    <div key={tc.id} className="card" style={{ padding: 10, marginTop: 6, fontSize: 12 }}>
                      <div className="mono"><strong>Input:</strong> {tc.input}</div>
                      <div className="mono"><strong>Expected:</strong> {tc.expected}</div>
                      {tc.isHidden && <div className="mono" style={{ color: "var(--ink-dim)" }}>hidden from students during the attempt</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-dim)" }}>OPTIONS (✓ marks the correct answer — shown to you only)</div>
                  <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                    {(tq.question.options || []).map((opt, i) => {
                      const isCorrect = (tq.question.correctAnswer || []).includes(i);
                      return (
                        <div key={i} style={{ fontSize: 13, color: isCorrect ? "var(--mint)" : "inherit", fontWeight: isCorrect ? 700 : 400 }}>
                          {isCorrect ? "✓ " : "· "}<MathText text={opt} />
                        </div>
                      );
                    })}
                  </div>
                  {tq.question.explanation && (
                    <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 10 }}>
                      <strong>Explanation:</strong> <MathText text={tq.question.explanation} />
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          {test.questions.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--ink-dim)" }}>
              No questions added to this test yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
