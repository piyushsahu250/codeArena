// Regression test for src/utils/cameraReadiness.js (the camera must not be called ready until a real picture was seen). Uses fake streams and fake video elements: no camera, no browser.
// Run: node frontend/scripts/cameraReadinessRegression.mjs
import { CAMERA_PROBLEM, categorizeMediaError, describeCameraProblem, frameStats, isBlackFrame, verifyVideoPreview, verifyAudioOnly } from "../src/utils/cameraReadiness.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

const track = (kind = "video", readyState = "live") => ({ kind, readyState });
const stream = (tracks) => ({ getVideoTracks: () => tracks.filter((t) => t.kind === "video"), getAudioTracks: () => tracks.filter((t) => t.kind === "audio"), getTracks: () => tracks });
// A fake <video>: dimensions and readiness are what the test sets; play() resolves or rejects as told.
function fakeVideo({ w = 640, h = 480, readyState = 4, paused = true, playRejects = null, playingAfterPlay = true } = {}) {
  const v = { srcObject: null, videoWidth: w, videoHeight: h, readyState, paused, play: async () => { if (playRejects) throw Object.assign(new Error("blocked"), { name: playRejects }); if (playingAfterPlay) v.paused = false; } };
  return v;
}
const FAST = { pollMs: 2, timeoutMs: 80, blackFramesToFail: 3 };
const lit = () => ({ max: 180, mean: 90 });
const black = () => ({ max: 0, mean: 0 });

// ---- error categories: a busy camera is not a permission problem
for (const [name, want] of [["NotAllowedError", "PERMISSION_DENIED"], ["SecurityError", "PERMISSION_DENIED"], ["NotFoundError", "DEVICE_NOT_FOUND"], ["OverconstrainedError", "DEVICE_NOT_FOUND"], ["NotReadableError", "DEVICE_BUSY"], ["AbortError", "DEVICE_BUSY"], ["Weird", "UNKNOWN"]]) {
  check(`getUserMedia rejection ${name} -> ${want}`, categorizeMediaError({ name }) === want);
}
check("a missing error object is UNKNOWN, not a crash", categorizeMediaError(undefined) === "UNKNOWN");
check("a busy camera is not told to 'grant permission again'", !/allow|permission|blocked/i.test(describeCameraProblem("DEVICE_BUSY").message));
check("a denied camera explains how to allow it", /Allow/.test(describeCameraProblem("PERMISSION_DENIED").message) && /Retry/.test(describeCameraProblem("PERMISSION_DENIED").message));
check("the wording follows what the test needs (camera only, microphone only, both)", /^Camera access/.test(describeCameraProblem("PERMISSION_DENIED", { needsWebcam: true, needsMic: false }).message) && /^Microphone access/.test(describeCameraProblem("PERMISSION_DENIED", { needsWebcam: false, needsMic: true }).message) && /^Camera and microphone access/.test(describeCameraProblem("PERMISSION_DENIED", { needsWebcam: true, needsMic: true }).message));

// ---- frame statistics
check("an all-zero frame is black; a lit frame is not", isBlackFrame(frameStats(new Uint8ClampedArray(32 * 4))) && !isBlackFrame(frameStats(new Uint8ClampedArray([0, 0, 0, 255, 40, 50, 60, 255]))));
check("a dim, noisy frame from a dark room is NOT called black", !isBlackFrame({ max: 12, mean: 4 }));

// ---- the preview verification
{
  const v = fakeVideo(); const s = stream([track()]);
  const r = await verifyVideoPreview(v, s, { ...FAST, sample: lit });
  check("a playing stream with a lit frame is ready", r.ok === true && r.width === 640 && r.sampled === true);
  check("the stream was attached to the video element", v.srcObject === s);
}
{
  const r = await verifyVideoPreview(fakeVideo(), stream([]), { ...FAST, sample: lit });
  check("a stream with no video track is not ready", r.ok === false && r.problem === CAMERA_PROBLEM.NO_VIDEO_TRACK);
}
{
  const r = await verifyVideoPreview(fakeVideo(), stream([track("video", "ended")]), { ...FAST, sample: lit });
  check("an ended video track is not ready", r.ok === false && r.problem === CAMERA_PROBLEM.STREAM_ENDED);
}
{
  const r = await verifyVideoPreview(fakeVideo({ w: 0, h: 0, readyState: 0 }), stream([track()]), { ...FAST, sample: lit });
  check("no video dimensions (no frames arriving) is not ready", r.ok === false && r.problem === CAMERA_PROBLEM.NO_VIDEO_FRAMES, r.problem);
}
{
  const r = await verifyVideoPreview(fakeVideo({ readyState: 1 }), stream([track()]), { ...FAST, sample: lit });
  check("dimensions but no decoded frame yet (readyState 1) is not ready", r.ok === false);
}
{
  const r = await verifyVideoPreview(fakeVideo({ playRejects: "NotAllowedError", playingAfterPlay: false }), stream([track()]), { ...FAST, sample: lit });
  check("a rejected play() is reported as playback blocked", r.ok === false && r.problem === CAMERA_PROBLEM.PLAYBACK_BLOCKED, r.problem);
}
{
  const r = await verifyVideoPreview(fakeVideo(), stream([track()]), { ...FAST, sample: black });
  check("a feed of completely black frames (the reported blank preview) is NOT ready", r.ok === false && r.problem === CAMERA_PROBLEM.NO_VISIBLE_IMAGE, r.problem);
}
{
  let n = 0;
  const r = await verifyVideoPreview(fakeVideo(), stream([track()]), { ...FAST, blackFramesToFail: 5, sample: () => (++n < 3 ? black() : lit()) });
  check("a camera that starts black and then shows a picture becomes ready", r.ok === true);
}
{
  const r = await verifyVideoPreview(fakeVideo(), stream([track()]), { ...FAST, sample: () => null });
  check("when the browser will not let the page read pixels, ready rests on playback and size, and says so (sampled=false)", r.ok === true && r.sampled === false);
}
{
  const r = await verifyVideoPreview(fakeVideo({ paused: false, playingAfterPlay: true }), stream([track()]), { ...FAST, sample: lit, isCancelled: () => true });
  check("a cancelled (stale) check never reports ready", r.ok === false && r.detail === "cancelled");
}
{
  const t = track(); const s = stream([t]); const v = fakeVideo();
  setTimeout(() => { t.readyState = "ended"; v.videoWidth = 0; v.readyState = 0; }, 10);
  const r = await verifyVideoPreview(v, s, { ...FAST, timeoutMs: 400, sample: black, blackFramesToFail: 1000 });
  check("a track that ends while waiting is noticed", r.ok === false && r.problem === CAMERA_PROBLEM.STREAM_ENDED, r.problem);
}

// ---- microphone-only
check("a microphone-only stream needs a live audio track", verifyAudioOnly(stream([track("audio")])).ok === true && verifyAudioOnly(stream([])).ok === false && verifyAudioOnly(stream([track("audio", "ended")])).ok === false);

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
