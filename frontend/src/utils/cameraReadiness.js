// Camera readiness for the pre-exam check. REGRESSION (2026-10, reported with a phone screenshot): the page marked the camera "ready" the moment getUserMedia() resolved, so a camera that was
// granted but delivered no picture (held by another app or tab, a stuck stream, playback never starting, a black feed) showed a black preview under "✓ Camera and microphone are ready" and the
// student was allowed to begin. A resolved getUserMedia() proves only that the browser handed over a stream. Ready now means: an active video track exists, the video element is playing it, it has
// real dimensions, and an actual frame with visible content was seen. Everything here is pure or takes its browser pieces as arguments so it can be tested without a camera.

export const CAMERA_PROBLEM = Object.freeze({
  PERMISSION_DENIED: "PERMISSION_DENIED",
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  DEVICE_BUSY: "DEVICE_BUSY",
  NO_VIDEO_TRACK: "NO_VIDEO_TRACK",
  STREAM_ENDED: "STREAM_ENDED",
  PLAYBACK_BLOCKED: "PLAYBACK_BLOCKED",
  NO_VIDEO_FRAMES: "NO_VIDEO_FRAMES",
  NO_VISIBLE_IMAGE: "NO_VISIBLE_IMAGE",
  INSECURE_CONTEXT: "INSECURE_CONTEXT",
  UNKNOWN: "UNKNOWN",
});

const MESSAGES = {
  PERMISSION_DENIED: (what) => `${what} access is blocked for this site. Tap the lock or camera icon next to the address, set ${what} to Allow, then press Retry. If it still fails, check your phone or computer's system settings for this browser.`,
  DEVICE_NOT_FOUND: (what) => `No ${what.toLowerCase()} was found on this device. Connect one (or choose another device) and press Retry.`,
  DEVICE_BUSY: (what) => `Your ${what.toLowerCase()} could not start. Another app or browser tab may be using it. Close other apps that use the camera (video calls, camera apps, other tabs), then press Retry.`,
  NO_VIDEO_TRACK: () => "The browser gave access but no camera picture was provided. Press Retry, or try another browser.",
  STREAM_ENDED: () => "The camera stopped while it was starting. Press Retry.",
  PLAYBACK_BLOCKED: () => "The browser would not play the camera preview. Tap the preview or press Retry.",
  NO_VIDEO_FRAMES: () => "The camera is on, but no picture is arriving yet. Close other apps that use the camera, then press Retry.",
  NO_VISIBLE_IMAGE: () => "The camera picture is completely black. Check that the lens is not covered and no other app is using the camera, then press Retry.",
  INSECURE_CONTEXT: () => "The camera only works on a secure (https) page. Open the exam from its official https address.",
  UNKNOWN: (what) => `Could not start your ${what.toLowerCase()}. Please check the device and your browser permissions, then press Retry.`,
};

const whatNeeded = ({ needsWebcam, needsMic }) => (needsWebcam && needsMic ? "Camera and microphone" : needsMic && !needsWebcam ? "Microphone" : "Camera");

// Names a getUserMedia() rejection by its real cause, so a busy camera is not reported as a permission problem (and the other way round).
export function categorizeMediaError(err) {
  const name = String((err && err.name) || "");
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return CAMERA_PROBLEM.PERMISSION_DENIED;
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return CAMERA_PROBLEM.DEVICE_NOT_FOUND;
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return CAMERA_PROBLEM.DEVICE_BUSY;
  return CAMERA_PROBLEM.UNKNOWN;
}

export function describeCameraProblem(problem, needs = { needsWebcam: true, needsMic: false }) {
  const what = whatNeeded(needs);
  const make = MESSAGES[problem] || MESSAGES.UNKNOWN;
  return { problem, message: make(what) };
}

// Brightness of an RGBA pixel buffer: the largest and the average colour value. A live sensor, even in a dark room, never produces an exactly empty frame; a dead or blocked feed does.
export function frameStats(rgba) {
  let max = 0; let sum = 0; let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const v = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (v > max) max = v;
    sum += v; n++;
  }
  return { max, mean: n ? sum / n : 0 };
}
export const isBlackFrame = (stats) => !stats || stats.max <= 2;

// Samples a small copy of the current frame through a canvas. Returns null when the browser refuses (the caller then relies on dimensions alone and says so).
export function sampleVideoFrame(video, doc = (typeof document !== "undefined" ? document : null)) {
  try {
    if (!doc) return null;
    const canvas = doc.createElement("canvas");
    canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return frameStats(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the preview shows a real picture, or says exactly why not. Polls instead of trusting one event (loadedmetadata, playing and friends can fire before a listener is attached, or never).
//   { ok: true, width, height, sampled }            a frame with visible content was seen (`sampled` false when the browser would not let the page read pixels: dimensions and playback only)
//   { ok: false, problem, detail }                   the camera is not usable, with the reason
// `isCancelled()` lets a newer request abandon this one. Injected arguments (sample, pollMs, timeoutMs) exist for the tests.
export async function verifyVideoPreview(video, stream, { timeoutMs = 8000, pollMs = 200, blackFramesToFail = 6, sample = sampleVideoFrame, isCancelled = () => false } = {}) {
  const started = Date.now();
  let playError = null;
  let blackSeen = 0;
  let playTried = false;
  let sampled = false;
  for (;;) {
    if (isCancelled()) return { ok: false, problem: CAMERA_PROBLEM.UNKNOWN, detail: "cancelled" };
    const tracks = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks() : [];
    if (tracks.length === 0) return { ok: false, problem: CAMERA_PROBLEM.NO_VIDEO_TRACK, detail: "the stream has no video track" };
    if (tracks.every((t) => t.readyState === "ended")) return { ok: false, problem: CAMERA_PROBLEM.STREAM_ENDED, detail: "the video track ended" };

    if (video.srcObject !== stream) video.srcObject = stream;
    if (video.paused && !playTried) {
      playTried = true;
      try { await video.play(); } catch (err) { playError = err; }
    }
    const haveSize = video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2;
    if (haveSize && !video.paused) {
      const stats = sample(video);
      if (stats === null) return { ok: true, width: video.videoWidth, height: video.videoHeight, sampled: false };
      sampled = true;
      if (!isBlackFrame(stats)) return { ok: true, width: video.videoWidth, height: video.videoHeight, sampled: true };
      blackSeen++;
      if (blackSeen >= blackFramesToFail) return { ok: false, problem: CAMERA_PROBLEM.NO_VISIBLE_IMAGE, detail: `${blackSeen} completely black frames in a row` };
    }
    if (Date.now() - started >= timeoutMs) {
      if (playError && video.paused) return { ok: false, problem: CAMERA_PROBLEM.PLAYBACK_BLOCKED, detail: String(playError && playError.name) };
      if (!(video.videoWidth > 0)) return { ok: false, problem: CAMERA_PROBLEM.NO_VIDEO_FRAMES, detail: "no video dimensions after waiting" };
      return { ok: false, problem: sampled ? CAMERA_PROBLEM.NO_VISIBLE_IMAGE : CAMERA_PROBLEM.NO_VIDEO_FRAMES, detail: "timed out" };
    }
    await sleep(pollMs);
  }
}

// A microphone-only test has no picture to check: the stream must hold a live audio track.
export function verifyAudioOnly(stream) {
  const tracks = stream && typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : [];
  if (tracks.length === 0) return { ok: false, problem: CAMERA_PROBLEM.NO_VIDEO_TRACK, detail: "the stream has no audio track" };
  if (tracks.every((t) => t.readyState === "ended")) return { ok: false, problem: CAMERA_PROBLEM.STREAM_ENDED, detail: "the audio track ended" };
  return { ok: true };
}

export function stopStream(stream) {
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
}
