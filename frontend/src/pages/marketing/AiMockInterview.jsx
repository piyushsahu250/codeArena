import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

const TRACKS = ["HR", "Technical", "Coding", "Aptitude", "System Design", "Behavioral", "Managerial"];

export default function AiMockInterview() {
  useSeoHead({
    title: "AI Mock Interview",
    description:
      "Practice interviews across seven tracks — HR, Technical, Coding, Aptitude, System Design, Behavioral, and Managerial — evaluated by heuristic and AI-assisted scoring, with company-round simulations.",
    path: "/ai-mock-interview",
  });
  return (
    <MarketingPageShell
      eyebrow="AI Mock Interview"
      title="Interview practice that actually evaluates you."
      intro="Seven interview tracks, each scored by heuristic and AI-assisted evaluation — not a chatbot that just asks the next question regardless of how you answered the last one."
    >
      <h2>Seven tracks, one workspace</h2>
      <div className="ca-track-pill-row" style={{ marginTop: 8 }}>
        {TRACKS.map((t) => (
          <span key={t} className="ca-track-pill">{t}</span>
        ))}
      </div>
      <p style={{ marginTop: 18 }}>
        Each track is evaluated differently, matched to what it's actually testing: HR and
        Behavioral rounds are scored on communication and response structure; Aptitude and
        Technical rounds check correctness against the expected answer; Coding rounds run
        submissions through the same judge described on the{" "}
        <Link to="/coding-platform">Coding Platform</Link> page, scored against hidden test
        cases; System Design and Managerial rounds are evaluated with AI-assisted scoring against
        the depth and structure of the response.
      </p>

      <h2>Company-round simulations</h2>
      <p>
        Beyond the individual tracks, a <strong>Company Round</strong> composes a session that
        mirrors a specific recruiter's real interview format — question mix, difficulty, and
        round order tagged to that company — so practice reflects what a student will actually
        face, not a generic interview template. Follow-up questions can chain off a candidate's
        answer, the way a real interviewer probes deeper on a topic instead of moving on
        regardless of the response.
      </p>

      <h2>Proctored, like a real interview should be</h2>
      <p>
        Mock interview sessions run under the same camera/microphone proctoring described on the{" "}
        <Link to="/online-assessment">Online Assessment</Link> page — face-presence and noise
        detection computed locally in the browser, never recorded or uploaded as video — so
        practicing under mild pressure is part of the preparation, not just answering questions in
        a relaxed chat window.
      </p>

      <h2>What you get afterward</h2>
      <p>
        Every completed session produces a detailed report: an overall score, specific weak
        topics flagged, and recommended next steps — including{" "}
        <Link to="/employability-readiness">readiness</Link>-linked practice suggestions and, for
        coding rounds, links back to relevant practice questions. Completing a track can also
        issue a shareable, QR-verifiable certificate.
      </p>

      <h2>Resume-aware practice</h2>
      <p>
        CodeArena's resume builder — with real ATS scoring, not a cosmetic checklist — can inform
        interview question selection, so HR and Behavioral rounds can draw on the experience and
        projects actually listed on a student's resume rather than asking entirely generic
        questions.
      </p>
    </MarketingPageShell>
  );
}
