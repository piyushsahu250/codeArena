# AI Voice Interview (Adaptive Engine)

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-09-12 · **Routes:** `backend/src/routes/aiInterview.js` (mounted at `/api/ai-interviews`) · **Services:** `backend/src/services/aiInterview/` · **Feature flag:** `ai_voice_interview`

## Not the same module as Mock Interview
This is a genuinely separate system from the existing `/api/interview` module (see [MOCK_INTERVIEW.md](MOCK_INTERVIEW.md)), not a rename or extension of it. Mock Interview pre-creates every question up front from an admin-authored bank and grades free-text answers with keyword heuristics; this module generates each question live, from an LLM, based on the candidate's actual previous answer. The two coexist under different feature flags (`ai_mock_interview` vs `ai_voice_interview`) and different Prisma models (`InterviewSession`/`InterviewQuestion`/`InterviewAnswer` vs `AiInterviewSession`/`AiInterviewTurn`/`AiInterviewReport`).

## Phasing
**Phase 1 (this phase): text-only.** The adaptive reasoning core — state machine, competency planning, LLM-driven next-question selection, structured evidence-based evaluation, deterministic scoring — is built and tested over plain text turns. Real-time voice I/O (Gemini Live API, per the provider decision below) is a later phase; `AiInterviewSession.voiceEnabled`/`.realtimeProvider` exist in the schema now so that phase doesn't need a breaking migration, but are unused today.

**Provider:** Gemini, via the existing `aiService.js` gateway — not a new vendor. Real-time voice (when built) will use Google's Gemini Live API for the same reason: no second AI vendor relationship, same `GEMINI_API_KEY`.

## The adaptive loop
```
POST /api/ai-interviews          create session (role, experienceLevel, targetSkills, interviewType, duration, resume auto-attached)
POST /api/ai-interviews/:id/start        CREATED -> INTRODUCTION -> QUESTIONING, generates intro + first question
POST /api/ai-interviews/:id/answer       evaluates the answer just given, decides next objective/stage/difficulty FROM that evaluation, generates the next question (or ends the interview)
POST /api/ai-interviews/:id/complete     candidate-initiated early end (server re-verifies the timer, never trusts a client "time's up" claim)
GET  /api/ai-interviews/:id/transcript   full turn history
GET  /api/ai-interviews/:id/report       generates the final report on first request (mirrors Mock Interview's ai-insights generate-on-view pattern)
```
Deliberately **one** route for evaluate-then-generate-next (`/answer`), not two separate "submit answer" + "get next question" calls — splitting them would let a client fetch a next question without ever having submitted an answer for the current one, which breaks the module's entire reason for existing.

## State machine
`backend/src/services/aiInterview/stateMachine.js` — `canTransition(from, to)`, a pure, unit-tested function. Every write to `AiInterviewSession.status` goes through it; an invalid transition is a 409, never a silent write. `ABANDONED` is reachable from any non-terminal state (disconnect/timeout); `COMPLETED` is reachable from every active-questioning state (the server-authoritative timer can expire mid `FOLLOW_UP`/`DEEP_DIVE` just as easily as mid plain `QUESTIONING`).

## Competency plan (the "hidden objective list," not a fixed question list)
`backend/src/services/aiInterview/competencyPlan.js`. `buildCompetencyPlan()` distributes the candidate's target skills into equal-weighted objectives at session creation (an admin-configurable per-role weighting matching a real job-description competency matrix is a real future enhancement, not implemented in Phase 1 — every skill is weighted equally today). `selectNextObjective()` picks what the next question should target, honoring the LLM's own `recommendedNextObjective` from the previous evaluation when that skill still needs coverage. `computeDifficultyTrend()` adjusts difficulty (1-10) on a rolling 3-turn average, never mechanically after a single answer. `checkCompletion()` ends the interview on timer expiry or full plan coverage (with a minimum-turns floor), whichever comes first.

## Evaluation and scoring — where the LLM's opinion stops
Every answer gets one structured, evidence-based evaluation call (`AIInterviewEngine.evaluateAnswer`) returning 0-100 scores across correctness/technicalDepth/clarity/reasoning/confidence/relevance, plus strengths/weaknesses/missingConcepts/evidence and a `recommendedNextObjective`/`difficultyAdjustment` that steer the engine. **The final STRONG/GOOD/BORDERLINE/NEEDS_IMPROVEMENT decision is never an AI opinion** — `backend/src/services/aiInterview/scoring.js`'s `aggregateScores()`/`decideOutcome()` are pure arithmetic over the stored per-turn scores, against an explicit, versioned rubric (`RUBRIC`, `DECISION_RULE_VERSION`). The LLM's only role in report generation is the human-readable strengths/weaknesses/recommendedLearning narrative, grounded strictly in the evidence already collected.

## Duplicate-question prevention
`backend/src/services/aiInterview/duplicateDetection.js` — a token-overlap (Jaccard) heuristic checked against every previous question this session before a newly generated one is accepted; one regeneration attempt if it trips. This is a defensive backstop after the generation prompt already instructs the model not to repeat itself — not the only line of defense, and deliberately not a second embedding-model API call (cost/latency).

## Security
Same four-layer stack as every other AI-backed route on this platform: `authenticate` → `requireRole("STUDENT")` → `attachRequesterInstitute` (instituteId always server-derived, never client-supplied) → `requireFeature("ai_voice_interview")`, plus per-user rate limits (`createLimiter` 5/min, `answerLimiter` 20/min — real, billed Gemini calls on every turn) and `aiService`'s existing daily quota enforcement. Every session-scoped route 404s (not 403s) on ownership mismatch, matching the platform's existing "don't confirm another user's resource exists" convention.

## Phase 2: real-time voice I/O

**Architecture decision, made deliberately:** Gemini Live is used ONLY as a real-time speech-to-text
+ turn-detection layer — never to let it generate the interview's own conversational content. A
full speech-to-speech conversational model asked to "conduct the interview" would bypass
everything Phase 1 built (structured evaluation, deterministic scoring, duplicate-question
prevention, competency planning) and — just as importantly for a graded assessment — has no clean
way to guarantee it speaks the EXACT question text the engine decided on rather than paraphrasing
it. So:

```
Browser mic  --(WS, this backend only)-->  Gemini Live (BidiGenerateContent)
                                             - responseModalities: ["TEXT"], inputAudioTranscription: {}
                                             - automatic VAD left ON (Gemini's own turn detection = spec §3's
                                               "AI should detect when the candidate has finished speaking")
                                             - Gemini's own generated reply is always discarded; only
                                               inputTranscription + turnComplete are used
turnComplete (finalText) --> processAnswer() [Phase 1 engine, UNCHANGED, shared with the text route]
next question text --> Gemini TTS (plain :generateContent, responseModalities: ["AUDIO"]) --> exact audio
                        --> sent to the browser over the SAME WebSocket for playback
```

The browser never connects to Google directly and never sees `GEMINI_API_KEY` — every Gemini
credential stays server-side, in this same process, exactly like every other AI call on this
platform.

**Secure session establishment** (spec §28): `POST /api/ai-interviews/:id/voice-session` (normal
authenticated REST, real JWT) mints a random, 30-second, single-use ticket
(`services/aiInterview/voiceTickets.js`, in-memory — same "not multi-instance-safe, documented as
such" convention as `aiQueue.js`). The browser opens `wss://.../api/ai-interviews/:id/voice?ticket=...`
— the ticket, not the student's real JWT, is what's in that URL, so nothing long-lived ever risks
being captured in a proxy/CDN log. `index.js`'s `'upgrade'` handler consumes (and thus invalidates)
the ticket before ever completing the WebSocket handshake.

**Shared adaptive core**: the actual "evaluate the answer, decide what's next, generate the next
question" logic was extracted into `services/aiInterview/answerProcessor.js` specifically so the
text route (`POST .../answer`) and the voice handler (`services/aiInterview/voiceSessionHandler.js`)
call the exact same implementation — one place this logic is allowed to live, not two that could
drift apart between transports.

**Interruption/barge-in** (spec §14): Gemini Live's own `serverContent.interrupted` signal, and an
explicit client-sent `{type:"interrupt"}` message, both map to a `{type:"stop_playback"}` message
sent to the browser — the frontend's job is to immediately stop whatever TTS audio is currently
playing when it receives that message.

**New env vars**: `GEMINI_LIVE_MODEL` (default `gemini-2.5-flash-native-audio-preview-09-2025`),
`GEMINI_TTS_MODEL` (default `gemini-2.5-flash-preview-tts`), `GEMINI_TTS_VOICE` (default `Kore`) —
all optional, reusing the existing `GEMINI_API_KEY`. No new vendor relationship.

**What Phase 2 does NOT include yet**: the candidate-facing frontend UI (browser mic capture,
PCM16 encoding, audio playback, the actual interview screen) — this phase is the complete,
independently-testable BACKEND voice pipeline. See the delivery conversation for exactly what was
verified live (Gemini Live connectivity with real transcribed audio, real TTS synthesis, the full
WS relay loop) versus what still needs a real browser to exercise (actual microphone capture,
real human speech, mobile audio quirks, multi-device testing).

## Deferred (not built yet)
The candidate-facing frontend UI (both text and voice), resume/job-description-driven weighted
competency matrices (spec §9), admin configuration UI for the scoring rubric (spec §38),
per-institute AI-cost dollar tracking (today's `AiUsageLog` tracks tokens/latency/success, not
USD), multilingual generation beyond a `language` field placeholder, and load testing at scale
(100/500/1000 concurrent interviews — spec §39). See the delivery conversation for the full list.
