// Orchestrates one live voice interview connection end-to-end:
//   Browser mic audio --(this WS)--> here --(relayed)--> Gemini Live (STT + turn detection)
//   Gemini Live turnComplete --> processAnswer() [THE SAME Phase 1 adaptive engine, unchanged]
//   next question text --> Gemini TTS (exact wording, verbatim) --> here --(this WS)--> Browser speaker
//
// Deliberately does NOT let Gemini Live generate the interview's own conversational content — see
// geminiLiveClient.js's own header comment for why. This file is the "conductor": it owns the
// per-connection state (which turn is open, whether TTS is currently playing, timers) and drives
// both Gemini connections (Live for STT, plain REST for TTS) from one place.
const prisma = require("../../prisma");
const { GeminiLiveSttSession } = require("./geminiLiveClient");
const { synthesizeSpeech } = require("./geminiTts");
const engine = require("./AIInterviewEngine");
const { processAnswer } = require("./answerProcessor");
const { selectNextObjective, recordObjectiveAsked } = require("./competencyPlan");
const { canTransition, ACTIVE_QUESTIONING_STATES } = require("./stateMachine");
const { Prisma } = require("@prisma/client");

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

async function speakText(ws, text) {
  try {
    const { audioBase64, mimeType, sampleRateHz } = await synthesizeSpeech(text);
    send(ws, { type: "question_audio", questionText: text, audioBase64, mimeType, sampleRateHz });
  } catch (err) {
    console.error("[voiceSession] TTS synthesis failed:", err.message);
    // Degrade to text-only rather than dropping the question entirely — a candidate who can still
    // read the question (spec §19's live transcript) can keep going even if audio briefly fails,
    // which is strictly better than the interview silently stalling.
    send(ws, { type: "question_text_only", questionText: text, error: "Speech synthesis unavailable — showing text." });
  }
}

// One call per connection. `ws` is an already-upgraded, already-ticket-validated WebSocket;
// `sessionId`/`studentId`/`instituteId` come from the consumed ticket, never re-derived from
// anything the browser sends over the socket itself.
async function handleVoiceConnection(ws, { sessionId, studentId, instituteId }) {
  let liveStt;
  let currentTurn = null;
  let closed = false;
  let expiryTimer = null;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    if (liveStt) liveStt.close();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
  }

  try {
    const session = await prisma.aiInterviewSession.findUnique({ where: { id: sessionId } });
    if (!session || session.studentId !== studentId) {
      send(ws, { type: "error", error: "Interview session not found" });
      return cleanup();
    }
    if (session.status !== "CREATED" && !ACTIVE_QUESTIONING_STATES.includes(session.status)) {
      send(ws, { type: "error", error: `Cannot start voice for an interview in status ${session.status}` });
      return cleanup();
    }

    await prisma.aiInterviewSession.update({ where: { id: sessionId }, data: { voiceEnabled: true, realtimeProvider: "gemini_live" } });

    // Server-authoritative timer (spec §15) — scheduled the moment we know expiresAt (either
    // already set from a prior text-mode start, or set below once THIS connection starts the
    // interview fresh). setTimeout, not a re-check loop: precise enough for an interview-length
    // window, and trivially cleared on cleanup() so it never fires after the connection ends.
    function scheduleExpiry(expiresAt) {
      if (expiryTimer) clearTimeout(expiryTimer);
      const msLeft = new Date(expiresAt).getTime() - Date.now();
      expiryTimer = setTimeout(async () => {
        await prisma.aiInterviewSession.update({
          where: { id: sessionId }, data: { status: "COMPLETED", completedAt: new Date(), terminationReason: "TIME_EXPIRED" },
        }).catch(() => {});
        send(ws, { type: "completed", terminationReason: "TIME_EXPIRED" });
        cleanup();
      }, Math.max(0, msLeft));
    }
    if (session.expiresAt) scheduleExpiry(session.expiresAt);

    liveStt = new GeminiLiveSttSession();

    liveStt.on("error", (err) => {
      console.error("[voiceSession] Gemini Live error:", err.message);
      send(ws, { type: "error", error: "Voice service temporarily unavailable. Please retry." });
      cleanup();
    });

    liveStt.on("interrupted", () => send(ws, { type: "stop_playback" })); // spec §14 barge-in

    liveStt.on("partialTranscript", (text) => send(ws, { type: "partial_transcript", text })); // spec §19 optional live caption

    liveStt.on("turnComplete", async (finalText) => {
      if (!currentTurn) return; // stray event after cleanup/before the first question exists yet
      const turnBeingAnswered = currentTurn;
      currentTurn = null; // no new answer accepted until the next question is issued
      try {
        const freshSession = await prisma.aiInterviewSession.findUnique({ where: { id: sessionId } });
        if (!freshSession || !ACTIVE_QUESTIONING_STATES.includes(freshSession.status)) return;

        const result = await processAnswer({
          session: freshSession, currentTurn: turnBeingAnswered,
          answerText: finalText, skipped: !finalText, userId: studentId, instituteId,
        });
        send(ws, { type: "answer_processed", status: result.status, evaluation: result.evaluation });

        if (result.status === "COMPLETED" || !result.nextQuestion) {
          send(ws, { type: "completed", terminationReason: "PLAN_COMPLETE_OR_TIME" });
          return cleanup();
        }
        currentTurn = await prisma.aiInterviewTurn.findUnique({ where: { id: result.nextQuestion.id } });
        await speakText(ws, result.nextQuestion.questionText);
      } catch (err) {
        console.error("[voiceSession] processAnswer failed:", err.message);
        send(ws, { type: "error", error: "Failed to process your answer. Please try again." });
      }
    });

    liveStt.on("ready", async () => {
      try {
        if (session.status === "CREATED") {
          const introduction = await engine.generateIntroduction({ session, userId: studentId, instituteId });
          await speakText(ws, introduction);

          const now = new Date();
          const expiresAt = new Date(now.getTime() + session.durationMin * 60 * 1000);
          const objective = selectNextObjective({ competencyPlan: session.competencyPlan, recommendedNextObjective: null });
          const firstQuestion = await engine.generateNextQuestion({
            session, recentTurns: [], objective, stage: "QUESTIONING",
            resumeSnapshot: session.resumeSnapshot, jobDescription: session.jobDescription,
            userId: studentId, instituteId,
          });
          const updatedPlan = recordObjectiveAsked(session.competencyPlan, objective, 0);

          const [, turn] = await prisma.$transaction([
            prisma.aiInterviewSession.update({
              where: { id: sessionId },
              data: { status: "QUESTIONING", startedAt: now, expiresAt, currentObjective: objective, competencyPlan: updatedPlan },
            }),
            prisma.aiInterviewTurn.create({
              data: { sessionId, turnIndex: 0, objective, questionType: firstQuestion.questionType, questionText: firstQuestion.questionText, difficultyAtTurn: session.difficulty },
            }),
          ]);
          currentTurn = turn;
          scheduleExpiry(expiresAt);
          await speakText(ws, firstQuestion.questionText);
        } else {
          // Resuming (reconnect, or voice started mid text-mode interview, spec §29) — re-speak
          // whichever turn is still open rather than generating a brand new question, so a
          // reconnect never silently skips or duplicates a question.
          currentTurn = await prisma.aiInterviewTurn.findFirst({
            where: { sessionId, evaluation: { equals: Prisma.DbNull } }, orderBy: { turnIndex: "desc" },
          });
          if (currentTurn) await speakText(ws, currentTurn.questionText);
        }
        send(ws, { type: "ready" });
      } catch (err) {
        console.error("[voiceSession] failed to start:", err.message);
        send(ws, { type: "error", error: "Failed to start the interview" });
        cleanup();
      }
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "audio_chunk" && msg.audioBase64) liveStt?.sendAudioChunk(msg.audioBase64);
      else if (msg.type === "interrupt") send(ws, { type: "stop_playback" }); // client-initiated barge-in, spec §14
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  } catch (err) {
    console.error("[voiceSession] connection setup failed:", err.message);
    send(ws, { type: "error", error: "Failed to start voice session" });
    cleanup();
  }
}

module.exports = { handleVoiceConnection };
