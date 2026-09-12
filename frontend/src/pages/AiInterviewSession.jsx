import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mic, MicOff, PhoneOff, RefreshCw, Volume2 } from "lucide-react";
import api, { performExpiredRedirect } from "../api";
import Button from "../components/Button";
import { useMicCapture } from "../hooks/useMicCapture";
import { playPcm16, stopPlayback, closePcmPlayer } from "../utils/pcmPlayer";
import { aiInterviewVoiceWsUrl } from "../utils/wsUrl";
import "./aiInterview.css";

// The live voice-interview screen — the actual real-time loop:
//   mic --(audio_chunk, continuous while listening)--> this WS --> backend --> Gemini Live (STT)
//   backend --(question_audio, PCM16)--> this WS --> Web Audio playback
// See backend/src/services/aiInterview/voiceSessionHandler.js for the exact message contract this
// mirrors. Every UI state below is derived from a real message the server actually sent — no
// state here is simulated (e.g. "processing" only shows between a real answer_processed message
// and the next real question_audio/completed/error, which is genuinely how long the server takes
// to evaluate the answer and generate the next question).
const PHASES = { LOADING: "loading", PREFLIGHT: "preflight", CONNECTING: "connecting", ACTIVE: "active", COMPLETED: "completed", ERROR: "error" };

export default function AiInterviewSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const mic = useMicCapture();

  const [phase, setPhase] = useState(PHASES.LOADING);
  const phaseRef = useRef(PHASES.LOADING);
  const [session, setSession] = useState(null);
  const [fatalError, setFatalError] = useState(null);
  const [uiState, setUiState] = useState("connecting"); // connecting | ai_speaking | listening | processing
  const [currentQuestionText, setCurrentQuestionText] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [lastEvaluation, setLastEvaluation] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [micMuted, setMicMuted] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  const wsRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const readyReceivedRef = useRef(false);
  const listeningRef = useRef(false); // "listening phase" of the state machine (drives UI + queue)
  const captureActiveRef = useRef(false); // whether the mic is ACTUALLY streaming right now
  const micMutedRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // A concurrent login elsewhere (or any other authExpired 401) mid-interview dispatches this
  // instead of api.js's usual instant window.location.href redirect (see api.js) — an in-page
  // notice lets the candidate see it rather than having the mic/WS yanked out with no explanation.
  useEffect(() => {
    function handleExpired() { setSessionExpiredNotice(true); }
    window.addEventListener("app:session-expired", handleExpired);
    return () => window.removeEventListener("app:session-expired", handleExpired);
  }, []);

  useEffect(() => {
    api.get(`/ai-interviews/${id}`).then((res) => setSession(res.data)).then(() => setPhase(PHASES.PREFLIGHT)).catch((err) => {
      setFatalError(err.response?.data?.error || "Could not load this interview.");
      setPhase(PHASES.ERROR);
    });
  }, [id]);

  // Mic capture is deliberately decoupled from the "listening" UI phase: muting must be able to
  // stop/start the actual audio stream without disturbing the ai_speaking/listening/processing
  // state machine below (an earlier version of this toggled both together, which meant unmuting
  // while the AI was still talking incorrectly flipped the UI straight to "Listening…").
  const syncCapture = useCallback(() => {
    const shouldCapture = listeningRef.current && !micMutedRef.current;
    if (shouldCapture && !captureActiveRef.current) {
      captureActiveRef.current = true;
      mic.start((base64) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "audio_chunk", audioBase64: base64 }));
        }
      });
    } else if (!shouldCapture && captureActiveRef.current) {
      captureActiveRef.current = false;
      mic.stop();
    }
  }, [mic]);

  // --- audio playback queue (the intro + first question can both arrive before "ready") ---
  const startListening = useCallback(() => {
    if (listeningRef.current) return;
    listeningRef.current = true;
    setUiState("listening");
    setPartialTranscript("");
    syncCapture();
  }, [syncCapture]);

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    syncCapture();
  }, [syncCapture]);

  const processQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      if (readyReceivedRef.current) startListening();
      return;
    }
    stopListening();
    isPlayingRef.current = true;
    setUiState("ai_speaking");
    setCurrentQuestionText(next.questionText);
    const onDone = () => {
      isPlayingRef.current = false;
      processQueue();
    };
    if (next.audioBase64) {
      playPcm16(next.audioBase64, next.sampleRateHz, onDone);
    } else {
      // TTS degraded to text-only — give the candidate a moment to read it before moving on.
      setTimeout(onDone, Math.max(2500, next.questionText.length * 60));
    }
  }, [startListening, stopListening]);

  const enqueueSpeech = useCallback((item) => {
    audioQueueRef.current.push(item);
    processQueue();
  }, [processQueue]);

  // --- WebSocket lifecycle ---
  const connect = useCallback(async () => {
    setPhase(PHASES.CONNECTING);
    setFatalError(null);
    readyReceivedRef.current = false;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    listeningRef.current = false;
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      try { wsRef.current.close(); } catch { /* already closing */ }
    }

    try {
      const { data } = await api.post(`/ai-interviews/${id}/voice-session`);
      const ws = new WebSocket(aiInterviewVoiceWsUrl(id, data.ticket));
      wsRef.current = ws;

      ws.onopen = () => setPhase(PHASES.ACTIVE);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "question_audio":
            enqueueSpeech({ questionText: msg.questionText, audioBase64: msg.audioBase64, sampleRateHz: msg.sampleRateHz });
            break;
          case "question_text_only":
            enqueueSpeech({ questionText: msg.questionText, audioBase64: null });
            break;
          case "partial_transcript":
            setPartialTranscript(msg.text);
            break;
          case "stop_playback":
            stopPlayback();
            isPlayingRef.current = false;
            audioQueueRef.current = [];
            startListening();
            break;
          case "ready":
            readyReceivedRef.current = true;
            api.get(`/ai-interviews/${id}`).then((res) => setSession(res.data)).catch(() => {});
            if (!isPlayingRef.current && audioQueueRef.current.length === 0) startListening();
            break;
          case "answer_processed":
            stopListening();
            setUiState("processing");
            setLastEvaluation(msg.evaluation || null);
            setPartialTranscript("");
            break;
          case "completed":
            stopListening();
            mic.release();
            ws.close();
            setPhase(PHASES.COMPLETED);
            setTimeout(() => navigate(`/ai-interview/report/${id}`), 1200);
            break;
          case "error":
            setFatalError(msg.error || "Something went wrong during the interview.");
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        if (phaseRef.current !== PHASES.COMPLETED) setFatalError("Lost connection to the interview. You can reconnect below.");
      };
      ws.onclose = () => {
        stopListening();
      };
    } catch (err) {
      setFatalError(err.response?.data?.error || "Could not start the voice session.");
      setPhase(PHASES.ERROR);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enqueueSpeech, startListening, stopListening, mic, navigate]);

  async function beginInterview() {
    const granted = await mic.requestPermission();
    if (granted) connect();
  }

  function toggleMute() {
    const next = !micMuted;
    setMicMuted(next);
    micMutedRef.current = next;
    syncCapture();
  }

  function sendInterrupt() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  async function endInterview() {
    try { await api.post(`/ai-interviews/${id}/complete`); } catch { /* server-side timer will also catch this */ }
    stopListening();
    mic.release();
    wsRef.current?.close();
    navigate(`/ai-interview/report/${id}`);
  }

  function reconnect() {
    setFatalError(null);
    connect();
  }

  function acknowledgeSessionExpired() {
    stopListening();
    mic.release();
    wsRef.current?.close();
    performExpiredRedirect();
  }

  // --- server-authoritative countdown display (source of truth is session.expiresAt; the
  // backend's own scheduleExpiry force-completes the interview regardless of what this shows) ---
  useEffect(() => {
    if (!session?.expiresAt) return;
    function tick() {
      setRemainingSeconds(Math.max(0, Math.round((new Date(session.expiresAt) - Date.now()) / 1000)));
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [session?.expiresAt]);

  useEffect(() => {
    return () => {
      stopListening();
      mic.release();
      wsRef.current?.close();
      closePcmPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === PHASES.LOADING) {
    return <div className="ai-int-page ai-int-centered"><p>Loading interview…</p></div>;
  }

  if (phase === PHASES.ERROR && !session) {
    return (
      <div className="ai-int-page ai-int-centered">
        <p className="ai-int-error">{fatalError}</p>
        <Button variant="ghost" onClick={() => navigate("/ai-interview")}>Back to setup</Button>
      </div>
    );
  }

  if (phase === PHASES.PREFLIGHT) {
    return (
      <div className="ai-int-page ai-int-centered">
        <div className="ai-int-preflight-card">
          <h2>System check</h2>
          <p>{session.role} · {session.interviewType.replace(/_/g, " ")} · {session.durationMin} minutes</p>
          <ul className="ai-int-checklist">
            <li>Find a quiet space with a stable internet connection.</li>
            <li>Speak clearly — the AI will ask a follow-up if it needs you to repeat something.</li>
            <li>You can interrupt the AI at any time if you want it to repeat or rephrase.</li>
          </ul>
          {mic.error && <p className="ai-int-error">{mic.error}</p>}
          <Button variant="primary" loading={mic.permission === "requesting"} onClick={beginInterview} style={{ width: "100%", justifyContent: "center" }}>
            <Mic size={16} /> Enable microphone &amp; begin
          </Button>
        </div>
      </div>
    );
  }

  if (phase === PHASES.COMPLETED) {
    return <div className="ai-int-page ai-int-centered"><p>Interview complete. Preparing your report…</p></div>;
  }

  if (sessionExpiredNotice) {
    return (
      <div className="ai-int-page ai-int-centered">
        <p>Your session has expired (you may have signed in elsewhere). Your progress up to your last answered question is saved.</p>
        <Button variant="primary" onClick={acknowledgeSessionExpired}>Sign in again</Button>
      </div>
    );
  }

  return (
    <div className="ai-int-page ai-int-session">
      <div className="ai-int-topbar">
        <div>
          <strong>{session?.role}</strong>
          <span className="ai-int-topbar-sub">{session?.interviewType?.replace(/_/g, " ")}</span>
        </div>
        <div className="ai-int-timer">{remainingSeconds != null ? formatTime(remainingSeconds) : "--:--"}</div>
        <Button variant="ghost" onClick={endInterview}><PhoneOff size={14} /> End interview</Button>
      </div>

      {fatalError && (
        <div className="ai-int-banner error">
          <span>{fatalError}</span>
          <Button variant="ghost" onClick={reconnect}><RefreshCw size={14} /> Reconnect</Button>
        </div>
      )}

      <div className="ai-int-main">
        <div className={`ai-int-orb ${uiState}`}>
          <Volume2 size={36} />
        </div>
        <div className="ai-int-state-label">{stateLabel(uiState)}</div>

        <div className="ai-int-question-card">
          <p>{currentQuestionText || "The interview is about to begin…"}</p>
        </div>

        {uiState === "listening" && partialTranscript && (
          <div className="ai-int-caption">"{partialTranscript}"</div>
        )}

        {lastEvaluation && uiState !== "ai_speaking" && (
          <div className="ai-int-eval-hint">Last answer recorded.</div>
        )}
      </div>

      <div className="ai-int-controls">
        <button className={`ai-int-mic-btn ${micMuted ? "muted" : ""}`} onClick={toggleMute} aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}>
          {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <div className="ai-int-mic-level" style={{ "--level": mic.level }} />
        {uiState === "ai_speaking" && (
          <Button variant="ghost" onClick={sendInterrupt}>Interrupt</Button>
        )}
      </div>
    </div>
  );
}

function stateLabel(uiState) {
  switch (uiState) {
    case "ai_speaking": return "Speaking…";
    case "listening": return "Listening…";
    case "processing": return "Thinking…";
    default: return "Connecting…";
  }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
