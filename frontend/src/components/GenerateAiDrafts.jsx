import { useState } from "react";
import api from "../api";
import SubjectUnitPicker from "./SubjectUnitPicker";
import useAiStatus from "../hooks/useAiStatus";

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, marginTop: 4 };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" };
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const DIFFICULTY_LABEL = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };
const MAX_BLUEPRINT_TOTAL = 20; // matches the shared per-user AI rate budget's realistic ceiling -- see postWithRateLimitRetry below

// Fisher-Yates -- client-side only, purely cosmetic (so a blueprint batch doesn't visibly
// generate "all the Easy ones, then all the Medium ones, then all the Hard ones" in a row);
// never anything security- or fairness-sensitive the way the server-side option shuffle is.
function shuffleClientSide(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Retries once on a 429 from the shared per-user AI rate limit (aiQuestions.js's generateLimiter,
// 5/min) instead of counting it as a hard failure -- a batch of more than 5 items (now more likely
// than ever, since independent answer verification roughly doubles each call's latency) could
// previously exhaust that budget partway through and have the rest of the batch fail outright.
// Waits for the server's own Retry-After header when present, else a fixed fallback -- never a
// tight retry loop that just re-triggers the same limit immediately.
async function postWithRateLimitRetry(url, body) {
  try {
    return await api.post(url, body);
  } catch (err) {
    if (err.response?.status !== 429) throw err;
    const retryAfterSec = Number(err.response.headers?.["retry-after"]) || 15;
    await new Promise((resolve) => setTimeout(resolve, (retryAfterSec + 1) * 1000));
    return api.post(url, body); // one retry only -- a second 429 is a real failure, not silently retried forever
  }
}

// Closes the one real gap found auditing "AI Draft Review" against the Question Bank: the
// existing InterviewQuestionDraft/InterviewDraftReview.jsx pair already gives Interview Prep
// content a full persisted-draft-then-async-review workflow (see that file's own header comment),
// but Question Bank generation (routes/aiQuestions.js's POST /generate-question) was purely
// ephemeral -- it returns JSON for CreateQuestion.jsx to pre-fill, and is lost forever the moment
// the generating staff member navigates away without clicking Save themselves. There was no way
// for one person to generate a batch and have someone else review it later.
//
// Deliberately NOT a new parallel draft model/dashboard -- Question already has exactly the two
// fields this needs (questionStatus, aiGenerated), and QuestionBank.jsx already has the entire
// review surface built: the "AI-generated only" + "Draft" filters, the non-PUBLISHED status badge
// on every row, the existing edit form, and bulk-status actions (setBulkStatus, including bulk
// Archive) that already double as "reject". Reusing all of that instead of duplicating it is the
// literal "smallest clean architectural integration" the request itself asked for. This component
// only does the one missing step: call the existing (unmodified) generate-question endpoint, then
// the existing (unmodified) POST /questions create route with questionStatus forced to "DRAFT"
// and aiGenerated forced to true, regardless of what the AI or caller supplies for either --
// nothing generated here can ever land as already-published. Every one of subjectId/unitId
// resolution, institute scoping, duplicate detection, test-case-count validation, the
// starter-code-is-not-a-solution guard, and audit logging (QUESTION_CREATED) already run inside
// that create route exactly as they do for a human-authored question -- none of it is
// re-implemented here.
export default function GenerateAiDrafts({ onGenerated }) {
  const aiAvailable = useAiStatus();
  const [subjectId, setSubjectId] = useState(null);
  const [unitId, setUnitId] = useState(null);
  const [topicId, setTopicId] = useState(null);
  // Real curriculum names from the picker (not just ids) — sent to the AI as the authoritative
  // subject/topic context. Previously this component sent `subtopic || "General"` as the AI's
  // *only* subject context, completely disconnected from the Subject/Unit actually picked above
  // it — leaving "General" as the literal prompt subject whenever subtopic was left blank, so the
  // AI could generate a question about anything while the question was filed under, say, "Java →
  // Collections." Real root cause of "the generated question doesn't match the selected topic."
  const [subjectName, setSubjectName] = useState(null);
  const [unitName, setUnitName] = useState(null);
  const [questionType, setQuestionType] = useState("MCQ");
  const [difficulty, setDifficulty] = useState("MEDIUM");
  const [skillTested, setSkillTested] = useState("");
  const [subtopic, setSubtopic] = useState("");
  const [count, setCount] = useState(3);
  // Batch difficulty blueprint (spec: "20 questions -> Easy 6, Medium 10, Hard 4" instead of one
  // difficulty per batch). Off by default -- the common case (a few questions at one difficulty)
  // stays exactly as simple as it always was; this is the "Advanced Options" equivalent.
  const [blueprintMode, setBlueprintMode] = useState(false);
  const [blueprint, setBlueprint] = useState({ EASY: 4, MEDIUM: 4, HARD: 2 });
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } while working
  const [result, setResult] = useState(null);

  const blueprintTotal = DIFFICULTIES.reduce((sum, d) => sum + (Number(blueprint[d]) || 0), 0);

  // The actual per-slot difficulty sequence this run will generate against -- single-difficulty
  // mode is just a degenerate one-entry blueprint, so both modes share one generation path below.
  function buildPlan() {
    if (!blueprintMode) {
      const n = Math.min(10, Math.max(1, Number(count) || 1));
      return Array(n).fill(difficulty);
    }
    const plan = DIFFICULTIES.flatMap((d) => Array(Math.max(0, Number(blueprint[d]) || 0)).fill(d));
    return shuffleClientSide(plan).slice(0, MAX_BLUEPRINT_TOTAL);
  }

  // Runs one plan and returns its own tally (never touches component state directly) -- both a
  // fresh Generate and a "+N more X" top-up share this, with the caller deciding whether the
  // result replaces or merges into whatever's already displayed.
  async function executePlan(plan) {
    setProgress({ done: 0, total: plan.length });
    let created = 0;
    let failed = 0;
    let needsReview = 0;
    const errors = [];
    const flagged = []; // per-item notices worth showing even though the draft still saved fine
    const byDifficulty = { EASY: { requested: 0, created: 0 }, MEDIUM: { requested: 0, created: 0 }, HARD: { requested: 0, created: 0 } };
    for (const d of plan) byDifficulty[d].requested++;

    // Sequential, not Promise.all: each generation call is itself a real AI request already
    // subject to the shared per-user rate limit (5/min, see aiQuestions.js's generateLimiter) --
    // firing a batch in parallel would just burn that whole budget in one request and fail the
    // rest with 429s, which is a worse experience than a few extra seconds of sequential waiting.
    for (let i = 0; i < plan.length; i++) {
      const slotDifficulty = plan[i];
      try {
        const { data: draft } = await postWithRateLimitRetry("/ai/questions/generate-question", {
          questionType,
          // Real Subject/Unit names (from the picker above, not a disconnected free-text field) as
          // the AI's authoritative context -- subtopic/skillTested only ever refine within that,
          // never replace it. subjectId/unitId let the backend pre-check for a likely duplicate
          // before this even tries to save.
          subject: subjectName || "General", topic: unitName || undefined,
          subtopic: subtopic || undefined, difficulty: slotDifficulty, skillTested: skillTested || undefined,
          subjectId, unitId,
        });
        // Verification never blocks the save (a NEEDS_REVIEW/NOT_VERIFIED draft still lands as a
        // normal Draft, same as any other AI-generated question -- it just needs a closer look
        // before publishing) -- but it's surfaced here, at generation time, rather than silently
        // dropped once the draft becomes just another Question Bank row.
        if (draft.verificationStatus && draft.verificationStatus !== "VERIFIED") {
          needsReview++;
          flagged.push({ title: draft.title || draft.description?.slice(0, 60), reason: draft.verificationDetail });
        }
        if (draft.duplicateWarning) {
          flagged.push({ title: draft.title || draft.description?.slice(0, 60), reason: `Looks like it may duplicate an existing question: "${draft.duplicateWarning.title || draft.duplicateWarning.description}"` });
        }
        await api.post("/questions", {
          ...draft,
          questionType: draft.questionType || questionType,
          subjectId, unitId, topicId: topicId || undefined,
          difficulty: slotDifficulty,
          aiGenerated: true,
          questionStatus: "DRAFT",
        });
        created++;
        byDifficulty[slotDifficulty].created++;
      } catch (err) {
        failed++;
        // A duplicate rejection from POST /questions has no `.error` string at all (just
        // `{duplicate: true, existing: {...}}`) -- previously fell through to a bare "Unknown
        // error" here with no indication of what actually happened.
        errors.push(
          err.response?.data?.duplicate
            ? `Duplicate of an existing question: "${err.response.data.existing?.title || err.response.data.existing?.description || "(untitled)"}"`
            : err.response?.data?.error || (err.response?.status === 429 ? "Rate-limited twice in a row — try again in a minute" : "Unknown error")
        );
      }
      setProgress({ done: i + 1, total: plan.length });
    }
    return { created, failed, needsReview, errors, flagged, byDifficulty };
  }

  async function generate() {
    if (!subjectId || !unitId) return alert("Pick a Subject and Unit first — every Question Bank row needs one, drafts included.");
    const plan = buildPlan();
    if (plan.length === 0) return alert("Set at least one question count above zero.");
    setWorking(true);
    setResult(null);
    const outcome = await executePlan(plan);
    setWorking(false);
    setResult({ ...outcome, usedBlueprint: blueprintMode });
    if (outcome.created > 0) onGenerated?.();
  }

  // "Generate N more Medium" etc. -- tops up a shortfall from the last run (some rows failed/were
  // duplicates) by MERGING into the existing summary, rather than replacing it -- the questions
  // the first run already created are still sitting in the Question Bank; the displayed counts
  // must keep reflecting that, not reset to only whatever this follow-up run did.
  async function topUp(diff, howMany) {
    setWorking(true);
    const outcome = await executePlan(Array(howMany).fill(diff));
    setWorking(false);
    setResult((prev) => {
      if (!prev) return { ...outcome, usedBlueprint: true };
      const byDifficulty = { ...prev.byDifficulty };
      byDifficulty[diff] = {
        requested: (prev.byDifficulty[diff]?.requested || 0) + outcome.byDifficulty[diff].requested,
        created: (prev.byDifficulty[diff]?.created || 0) + outcome.byDifficulty[diff].created,
      };
      return {
        created: prev.created + outcome.created,
        failed: prev.failed + outcome.failed,
        needsReview: prev.needsReview + outcome.needsReview,
        errors: [...prev.errors, ...outcome.errors],
        flagged: [...prev.flagged, ...outcome.flagged],
        byDifficulty,
        usedBlueprint: true,
      };
    });
    if (outcome.created > 0) onGenerated?.();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
        AI-generated content lands here as a draft — original questions written in a similar style/difficulty to
        what's commonly discussed for a topic, never a copy of a real problem. Nothing here reaches a student until
        you review and publish it. Generated questions are saved with status <strong>Draft</strong> — find them
        below with the "AI-generated only" filter, edit if needed using the normal question editor, then publish
        (or archive) exactly like any other question.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Subject / Unit (required)</label>
          <div style={{ marginTop: 4 }}>
            <SubjectUnitPicker subjectId={subjectId} unitId={unitId} topicId={topicId}
              onChange={({ subjectId: s, unitId: u, topicId: t, subjectName: sn, unitName: un }) => {
                setSubjectId(s); setUnitId(u); setTopicId(t); setSubjectName(sn); setUnitName(un);
              }} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Question Type</label>
          <select style={inputStyle} value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
            <option value="MCQ">Multiple Choice</option>
            <option value="TRUE_FALSE">True/False</option>
            <option value="MULTISELECT">Multiple Select</option>
            <option value="CODING">Coding</option>
          </select>
        </div>
        {!blueprintMode && (
          <div>
            <label style={labelStyle}>Difficulty</label>
            <select style={inputStyle} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </div>
        )}
        <div>
          <label style={labelStyle}>Subtopic (optional — narrows within the Subject/Unit above)</label>
          <input style={inputStyle} value={subtopic} onChange={(e) => setSubtopic(e.target.value)} placeholder="e.g. Binary Search Trees" />
        </div>
        <div>
          <label style={labelStyle}>Skill tested (optional)</label>
          <input style={inputStyle} value={skillTested} onChange={(e) => setSkillTested(e.target.value)} placeholder="e.g. Recursion" />
        </div>
        {!blueprintMode && (
          <div>
            <label style={labelStyle}>How many (1–10)</label>
            <input type="number" min="1" max="10" style={inputStyle} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
        )}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 14 }}>
        <input type="checkbox" checked={blueprintMode} onChange={(e) => setBlueprintMode(e.target.checked)} />
        Mixed-difficulty batch (set exactly how many Easy/Medium/Hard, instead of one difficulty for the whole batch)
      </label>
      {blueprintMode && (
        <div style={{ marginTop: 8, padding: 12, borderRadius: 8, background: "var(--card-bg, #F7F7F5)", border: "1px solid var(--line)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {DIFFICULTIES.map((d) => (
              <div key={d}>
                <label style={labelStyle}>{DIFFICULTY_LABEL[d]}</label>
                <input
                  type="number" min="0" max={MAX_BLUEPRINT_TOTAL} style={inputStyle}
                  value={blueprint[d]}
                  onChange={(e) => setBlueprint((b) => ({ ...b, [d]: Math.max(0, Number(e.target.value) || 0) }))}
                />
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: blueprintTotal > MAX_BLUEPRINT_TOTAL ? "var(--rust)" : "var(--ink-dim)", marginTop: 8 }}>
            Total: {blueprintTotal} question{blueprintTotal === 1 ? "" : "s"}
            {blueprintTotal > MAX_BLUEPRINT_TOTAL && ` — max ${MAX_BLUEPRINT_TOTAL} per batch`}
            . Each one is still generated, answer-verified, and duplicate-checked individually — a larger batch just takes longer (roughly {blueprintTotal * 5}–{blueprintTotal * 10} seconds).
          </p>
        </div>
      )}

      <button
        className="btn btn-primary" style={{ marginTop: 14 }}
        disabled={working || aiAvailable !== true || (blueprintMode && (blueprintTotal === 0 || blueprintTotal > MAX_BLUEPRINT_TOTAL))}
        onClick={generate}
      >
        {working ? `Generating… (${progress?.done ?? 0}/${progress?.total ?? 0})` : "🤖 Generate drafts"}
      </button>
      {aiAvailable === false && (
        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>AI generation isn't available on this server yet — set GEMINI_API_KEY to enable it.</p>
      )}
      {result && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: result.failed > 0 ? "var(--rust)" : "var(--mint)" }}>
            Created {result.created} draft{result.created === 1 ? "" : "s"}.
            {result.failed > 0 && ` ${result.failed} failed: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? "…" : ""}`}
          </p>
          {/* Coverage check (spec: "if actual distribution doesn't match requested, show it and
              allow topping up") -- shown only in blueprint mode, since single-difficulty mode has
              nothing to compare against (it either made the count or didn't, already shown above). */}
          {result.usedBlueprint && (
            <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {DIFFICULTIES.map((d) => {
                const stat = result.byDifficulty[d];
                if (!stat || stat.requested === 0) return null;
                const short = stat.requested - stat.created;
                return (
                  <div key={d} style={{ fontSize: 11.5 }} className="mono">
                    {DIFFICULTY_LABEL[d]}: {stat.created}/{stat.requested}
                    {short > 0 && (
                      <button
                        type="button" className="btn btn-ghost"
                        style={{ fontSize: 10, padding: "2px 6px", marginLeft: 6 }}
                        disabled={working}
                        onClick={() => topUp(d, short)}
                      >
                        +{short} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Never silent -- a draft that saved fine but didn't pass automatic answer verification
              (or looks like it might duplicate an existing question) still needs a closer look
              before it's published, even though nothing here blocked it from being created. */}
          {result.needsReview > 0 && (
            <p style={{ fontSize: 12, color: "var(--amber-dark)", marginTop: 4 }}>
              ⚠ {result.needsReview} draft{result.needsReview === 1 ? "" : "s"} saved but flagged for review — see below.
            </p>
          )}
          {result.flagged?.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
              {result.flagged.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: "var(--amber-dark)", marginTop: 2 }} className="mono">
                  "{f.title}": {f.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
