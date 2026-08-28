import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as blazeface from "@tensorflow-models/blazeface";
import { requestFullscreenCompat, getFullscreenElement, onFullscreenChange } from "../utils/fullscreenCompat";

const FACE_CHECK_INTERVAL_MS = 2000;
const FACE_CONFIDENCE_THRESHOLD = 0.7;
const VIOLATION_DEDUPE_MS = 1200; // collapses e.g. fullscreenchange+visibilitychange firing together into one event
// Entering fullscreen via requestFullscreen() is itself a browser-level transition — on some
// OS/browser combinations it can cause a transient, spurious `visibilitychange` (document.hidden
// flips true for a frame) and/or the very first `fullscreenchange` settling a beat later than
// React's commit that attaches these listeners. Each is a distinct violation TYPE with its own
// independent dedupe timer (see lastViolationAtRef below), so without a grace window a single,
// genuine "click Begin Interview" could fire FULLSCREEN_EXIT and TAB_SWITCH back-to-back a few
// hundred ms apart — two of the three strikes needed to auto-terminate — before the student has
// done anything. This only suppresses the two transition-prone types, only for a few seconds
// right after activation, and never suppresses a real mid-interview tab switch or fullscreen exit.
const ACTIVATION_GRACE_MS = 3000;

// Shared proctoring primitives for a locked-down assessment — extracted so both the exam
// (TestTaking.jsx, unchanged, still has its own inline copy) and the new module coding
// assessment can use a consistent violation set. Covers: fullscreen enforcement, tab-switch,
// copy/paste/cut blocking, right-click blocking, F12/devtools-shortcut blocking (+ a best-effort
// docked-devtools size heuristic), a refresh/navigate-away warning, a best-effort multi-monitor
// check, and (if requireWebcam) face presence detection via the same blazeface model the exam
// side already uses — extended here to also flag MULTIPLE faces, not just a missing one. No
// image is ever captured or stored (this platform has no object storage) — face checks only
// ever produce a logged violation event.
export function useProctoring({ active, requireFullscreen = true, requireWebcam = false, requireMicrophone = false, onViolation }) {
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;

  // Marks the moment `active` most recently flipped true — the anchor for ACTIVATION_GRACE_MS.
  // useLayoutEffect (not useEffect) is deliberate: it must commit synchronously in the same paint
  // cycle that flips `active`, before the browser's own fullscreenchange/visibilitychange events
  // from that same requestFullscreen() call can reach the listeners below. A passive useEffect
  // schedules asynchronously after paint, which could in practice land AFTER those events fire —
  // silently defeating the grace window on exactly the "click Begin Interview" interaction it
  // exists to protect, and letting a phantom violation through as a real counted strike.
  const activatedAtRef = useRef(null);
  useLayoutEffect(() => {
    activatedAtRef.current = active ? Date.now() : null;
  }, [active]);

  const lastViolationAtRef = useRef({});
  const report = useCallback(
    (type) => {
      if (!active) return;
      if (
        (type === "FULLSCREEN_EXIT" || type === "TAB_SWITCH") &&
        activatedAtRef.current &&
        Date.now() - activatedAtRef.current < ACTIVATION_GRACE_MS
      ) {
        return; // fullscreen-entry transition artifact, not a real violation — see ACTIVATION_GRACE_MS above
      }
      const now = Date.now();
      const last = lastViolationAtRef.current[type] || 0;
      if (now - last < VIOLATION_DEDUPE_MS) return;
      lastViolationAtRef.current[type] = now;
      onViolationRef.current?.(type);
    },
    [active]
  );

  // fullscreenOk mirrors TestTaking.jsx's own state of the same name — true until an actual
  // request settles and we know otherwise, so a consumer can show an honest "fullscreen isn't
  // active" banner instead of silently proceeding as if it were (or reading document.fullscreen-
  // Element directly during render, which doesn't trigger a re-render when it changes).
  const [fullscreenOk, setFullscreenOk] = useState(true);

  // Tries the vendor-prefixed Fullscreen API variants too (see fullscreenCompat.js) — the
  // un-prefixed call alone silently no-ops on any browser that only exposes a prefixed version
  // (notably Safari <16.4), which is exactly what made a tab-switch-and-return never actually
  // restore fullscreen there with zero trace of why. Previously an entirely silent .catch(() =>
  // {}) — now logs the real rejection reason and updates fullscreenOk so it's visible, not just
  // diagnosable in the console.
  const requestFullscreen = useCallback(() => {
    return requestFullscreenCompat()
      .catch((err) => console.warn("[proctoring] requestFullscreen failed:", err))
      .finally(() => setFullscreenOk(!!getFullscreenElement()));
  }, []);

  // Fullscreen-exit detection — immediately attempts to re-enter; browsers that block
  // programmatic re-entry without a fresh gesture will silently no-op it. Registered via
  // onFullscreenChange so the vendor-prefixed change events are covered too, not just the
  // standard one — without this, a browser that only fires e.g. webkitfullscreenchange never
  // triggered this handler at all, so exiting fullscreen there was never even detected, let alone
  // auto-recovered from.
  useEffect(() => {
    if (!active || !requireFullscreen) return;
    function handleChange() {
      const isFs = !!getFullscreenElement();
      setFullscreenOk(isFs);
      if (!isFs) {
        report("FULLSCREEN_EXIT");
        requestFullscreen();
      }
    }
    return onFullscreenChange(handleChange);
  }, [active, requireFullscreen, report, requestFullscreen]);

  // Tab switch / window blur.
  useEffect(() => {
    if (!active) return;
    function handleVisibility() {
      if (document.hidden) {
        report("TAB_SWITCH");
      } else if (requireFullscreen && !getFullscreenElement()) {
        requestFullscreen();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [active, requireFullscreen, report, requestFullscreen]);

  // Copy / paste / cut — blocked outright, not just logged.
  useEffect(() => {
    if (!active) return;
    function block(type) {
      return (e) => {
        e.preventDefault();
        report(type);
      };
    }
    const onCopy = block("COPY");
    const onPaste = block("PASTE");
    const onCut = block("CUT");
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("cut", onCut);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("cut", onCut);
    };
  }, [active, report]);

  // Right-click.
  useEffect(() => {
    if (!active) return;
    function onContextMenu(e) {
      e.preventDefault();
      report("RIGHT_CLICK");
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [active, report]);

  // Drag-and-drop text into the page (e.g. dragging a selection from another window/tab into
  // the code editor) — same intent as the copy/paste block above, via a different browser API.
  // dragstart also covers dragging text *out* of the page.
  useEffect(() => {
    if (!active) return;
    function onDragStart(e) {
      e.preventDefault();
      report("DRAG_ATTEMPT");
    }
    function onDrop(e) {
      e.preventDefault();
      report("DRAG_ATTEMPT");
    }
    function onDragOver(e) {
      e.preventDefault(); // required for onDrop's preventDefault to actually block the drop
    }
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragover", onDragOver);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragover", onDragOver);
    };
  }, [active, report]);

  // F12 / devtools shortcuts / view-source / browser-chrome shortcuts — blocked where
  // preventDefault actually works. PrintScreen can be logged but never blocked (the OS captures
  // it before JS sees the event) — a real browser limitation, not a gap in this implementation.
  // Some of these (Ctrl+T/N/W/Tab, Alt+Tab) are reserved by the browser/OS and won't actually be
  // preventable even with preventDefault() — they're still listed here so the attempt is logged.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e) {
      const key = e.key;
      if (key === "PrintScreen") {
        report("PRINT_SCREEN_ATTEMPT");
        return;
      }
      const isDevtools =
        key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C", "i", "j", "c"].includes(key)) ||
        (e.ctrlKey && ["u", "U"].includes(key));
      const isBrowserChrome =
        (e.ctrlKey && ["s", "S", "p", "p", "w", "W", "n", "N", "t", "T", "r", "R", "l", "L"].includes(key)) ||
        (e.ctrlKey && key === "Tab") ||
        (e.ctrlKey && e.shiftKey && ["t", "T"].includes(key)) ||
        key === "F5" ||
        key === "F11";
      if (isDevtools || isBrowserChrome) {
        e.preventDefault();
        report(isDevtools ? "DEVTOOLS" : "BROWSER_SHORTCUT");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, report]);

  // Docked-devtools heuristic: a large outer/inner window size gap usually means devtools is
  // open docked to a side. Best-effort only — an undocked devtools window defeats it entirely;
  // documented as a known limitation, not hidden.
  useEffect(() => {
    if (!active) return;
    const THRESHOLD = 160;
    const interval = setInterval(() => {
      const widthGap = window.outerWidth - window.innerWidth;
      const heightGap = window.outerHeight - window.innerHeight;
      if (widthGap > THRESHOLD || heightGap > THRESHOLD) report("DEVTOOLS");
    }, 3000);
    return () => clearInterval(interval);
  }, [active, report]);

  // Refresh / navigate-away attempt — the browser's own native confirm dialog is the actual
  // deterrent; this just logs that the attempt happened.
  useEffect(() => {
    if (!active) return;
    function onBeforeUnload(e) {
      report("REFRESH_ATTEMPT");
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active, report]);

  // Best-effort multi-monitor check — Chrome's experimental, permission-free screen.isExtended
  // boolean. Most browsers simply don't expose it, in which case this never fires — the full
  // Window Management API (getScreenDetails()) would need an intrusive extra permission prompt,
  // deliberately not requested here.
  useEffect(() => {
    if (!active) return;
    if (typeof window.screen?.isExtended === "boolean" && window.screen.isExtended) {
      report("MULTI_MONITOR");
    }
  }, [active, report]);

  // Android system-level assistant overlays (e.g. "Circle to Search", triggered by a long-press
  // on the home button/gesture pill) draw their result sheet as an OS-level layer ON TOP of the
  // current app rather than switching away from it — the browser tab is never actually hidden or
  // backgrounded, so neither `visibilitychange` nor `fullscreenchange` fires, which is exactly
  // what lets a student search a visible on-screen question without tripping tab-switch
  // detection above. The one side effect it can't avoid: the result sheet still has to occupy
  // real screen space, so the visible viewport shrinks noticeably while it's open — the same
  // signal a docked on-screen keyboard produces, which is why this is gated to touch devices and
  // excludes any moment a text input/editor genuinely has focus. Not a perfect defense (nothing
  // client-side can be, against an OS-level overlay) but it catches the actual, unavoidable
  // footprint this class of overlay leaves on the page.
  useEffect(() => {
    if (!active) return;
    const isTouchDevice = navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
    if (!isTouchDevice) return;
    const viewport = window.visualViewport;
    const SHRINK_RATIO_THRESHOLD = 0.22;
    let baseline = viewport ? viewport.height : window.innerHeight;
    let flagged = false;

    function isEditableFocused() {
      const el = document.activeElement;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }

    function handleResize() {
      const height = viewport ? viewport.height : window.innerHeight;
      if (isEditableFocused()) {
        // Legitimate on-screen keyboard — re-baseline so its close doesn't look like a shrink.
        baseline = Math.max(baseline, height);
        flagged = false;
        return;
      }
      if (height >= baseline) {
        baseline = height;
        flagged = false;
        return;
      }
      const shrinkRatio = (baseline - height) / baseline;
      if (shrinkRatio > SHRINK_RATIO_THRESHOLD) {
        if (!flagged) {
          flagged = true;
          report("SCREEN_OVERLAY_DETECTED");
        }
      } else {
        flagged = false;
      }
    }

    const target = viewport || window;
    target.addEventListener("resize", handleResize);
    return () => target.removeEventListener("resize", handleResize);
  }, [active, report]);

  // ---- Webcam: face presence (missing / multiple) ----
  const [mediaGranted, setMediaGranted] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [requestingMedia, setRequestingMedia] = useState(false);
  const mediaStreamRef = useRef(null);
  const videoNodeRef = useRef(null);
  const [faceStatus, setFaceStatus] = useState("OK"); // OK | MISSING | MULTIPLE
  const faceStatusRef = useRef("OK");
  const faceModelRef = useRef(null);

  const stopMedia = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  // Callback ref (not a plain object ref) — every consumer of this hook renders a *different*
  // <video> element for the preflight camera-check preview vs. the persistent in-session video
  // badge (two separate DOM nodes at two different points in the render tree). A plain object
  // ref only gets reattached by React on mount; it doesn't re-run any effect. An effect keyed off
  // `mediaGranted` alone (the previous implementation) therefore only ever attached the live
  // MediaStream to the FIRST video element it saw and silently went dark — readyState stuck at 0
  // — the moment the second one mounted. That's exactly what was starving face detection during
  // the actual interview/assessment (readyState < 2 guard below never passed), even though the
  // camera-check preview during preflight looked fine. Using a callback ref re-attaches the
  // stream every time the mounted node changes, so it stays correct across the phase transition.
  const setVideoNode = useCallback((node) => {
    videoNodeRef.current = node;
    if (node && mediaStreamRef.current) node.srcObject = mediaStreamRef.current;
  }, []);

  const requestMedia = useCallback(async () => {
    setRequestingMedia(true);
    setMediaError(null);
    try {
      stopMedia(); // release any stale/partially-live stream before reacquiring
      const stream = await navigator.mediaDevices.getUserMedia({ video: requireWebcam, audio: requireMicrophone });
      mediaStreamRef.current = stream;
      if (videoNodeRef.current) videoNodeRef.current.srcObject = stream;
      setMediaGranted(true);
      cameraStatusRef.current = "OK";
      setCameraStatus("OK");
      micStatusRef.current = "OK";
      setMicStatus("OK");
    } catch (err) {
      setMediaError(
        err.name === "NotAllowedError"
          ? `${requireWebcam && requireMicrophone ? "Camera and microphone" : requireMicrophone ? "Microphone" : "Camera"} access was denied. Please allow it to begin.`
          : err.name === "NotFoundError"
          ? `No ${requireWebcam && requireMicrophone ? "camera or microphone" : requireMicrophone ? "microphone" : "camera"} was found on this device.`
          : "Could not access your camera/microphone. Please check your device and browser permissions."
      );
      setMediaGranted(false);
    } finally {
      setRequestingMedia(false);
    }
  }, [requireWebcam, requireMicrophone, stopMedia]);

  // ---- Camera / microphone device availability (ongoing status, not just a one-shot event) ----
  const [cameraStatus, setCameraStatus] = useState("OK"); // OK | UNAVAILABLE
  const [micStatus, setMicStatus] = useState("OK"); // OK | UNAVAILABLE
  const cameraStatusRef = useRef("OK");
  const micStatusRef = useRef("OK");

  useEffect(() => {
    if (!requireWebcam) return;
    let cancelled = false;
    tf.ready()
      .then(() => blazeface.load())
      .then((model) => {
        if (!cancelled) faceModelRef.current = model;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [requireWebcam]);

  // Gated on `mediaGranted` rather than `active` — the pre-test readiness checklist needs a live
  // "is a face actually visible" status before the student is allowed to press Start, not just
  // once the session is already running. `report()` itself still no-ops while `active` is false
  // (see its own guard above), so this never produces a counted violation before the test starts
  // — it only makes `faceStatus` a real readiness signal instead of staying stuck at "OK" (its
  // untouched initial value) for the entire preflight phase.
  useEffect(() => {
    if (!mediaGranted || !requireWebcam) return;
    const interval = setInterval(async () => {
      // Read the node fresh on every tick (not captured once outside the interval) — the
      // preflight and in-session video elements are different DOM nodes, and this effect's
      // lifetime spans both when `active` flips true right as the session view mounts.
      const video = videoNodeRef.current;
      const model = faceModelRef.current;
      if (!video || !model || document.hidden || video.readyState < 2) return;
      let predictions;
      try {
        predictions = await model.estimateFaces(video, false);
      } catch {
        return;
      }
      const faces = predictions.filter((p) => (p.probability?.[0] ?? 1) >= FACE_CONFIDENCE_THRESHOLD);
      const nextStatus = faces.length === 0 ? "MISSING" : faces.length > 1 ? "MULTIPLE" : "OK";
      if (nextStatus !== faceStatusRef.current) {
        faceStatusRef.current = nextStatus;
        setFaceStatus(nextStatus);
        if (nextStatus === "MISSING") report("FACE_MISSING");
        else if (nextStatus === "MULTIPLE") report("MULTIPLE_FACES");
      }
    }, FACE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [mediaGranted, requireWebcam, report]);

  // Ongoing camera/microphone availability — exposed as persistent status (like faceStatus),
  // not just a one-shot violation event, so the UI can show a standing "camera/mic unavailable"
  // banner that clears itself the moment the device comes back, the same way faceStatus does.
  // Checks both `readyState` (device physically stopped/disconnected/revoked) and `enabled`
  // (track muted programmatically) — either alone missed real-world drop scenarios reported as
  // "not reliably detecting". Polls every 2s (was 5s) since a mic/camera outage during a live
  // interview needs to surface fast, not lag up to 5 seconds behind.
  // A track going non-"live" for one poll is often a brief driver hiccup, not a real drop — burning
  // one of only MAX_INTERVIEW_VIOLATIONS strikes on a 2-second hardware blip contradicts the
  // proctoring policy's own intent (a temporary camera/mic failure should warn/recover, not
  // terminate). CAMERA_DROPPED/MIC_DROPPED is only actually reported once the track has stayed down
  // for DROP_REPORT_STREAK consecutive polls; the UI status badge still updates immediately either
  // way, so a genuine drop is visible to the student right away even before it counts as a strike.
  const DROP_REPORT_STREAK = 3; // 3 * 2s poll interval = 6s sustained before it counts as a violation
  const cameraDownStreakRef = useRef(0);
  const micDownStreakRef = useRef(0);

  useEffect(() => {
    if (!active || (!requireWebcam && !requireMicrophone)) return;
    const stream = mediaStreamRef.current;
    if (!stream) return;

    function checkTracks() {
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      if (requireWebcam && videoTracks.length) {
        const live = videoTracks.every((t) => t.readyState === "live" && t.enabled);
        const next = live ? "OK" : "UNAVAILABLE";
        if (next !== cameraStatusRef.current) {
          cameraStatusRef.current = next;
          setCameraStatus(next);
        }
        if (live) {
          cameraDownStreakRef.current = 0;
        } else {
          cameraDownStreakRef.current += 1;
          if (cameraDownStreakRef.current === DROP_REPORT_STREAK) report("CAMERA_DROPPED");
        }
      }
      if (requireMicrophone && audioTracks.length) {
        const live = audioTracks.every((t) => t.readyState === "live" && t.enabled);
        const next = live ? "OK" : "UNAVAILABLE";
        if (next !== micStatusRef.current) {
          micStatusRef.current = next;
          setMicStatus(next);
        }
        if (live) {
          micDownStreakRef.current = 0;
        } else {
          micDownStreakRef.current += 1;
          if (micDownStreakRef.current === DROP_REPORT_STREAK) report("MIC_DROPPED");
        }
      }
    }

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    videoTracks.forEach((t) => t.addEventListener("ended", checkTracks));
    audioTracks.forEach((t) => t.addEventListener("ended", checkTracks));
    const poll = setInterval(checkTracks, 2000);
    return () => {
      videoTracks.forEach((t) => t.removeEventListener("ended", checkTracks));
      audioTracks.forEach((t) => t.removeEventListener("ended", checkTracks));
      clearInterval(poll);
    };
  }, [active, requireWebcam, requireMicrophone, report]);

  // Background-noise / silent-environment reminder — purely informational, exactly like the
  // exam proctoring's noise check: never calls report(), never counts toward violations. Spec
  // is explicit that this "should not count as a cheating warning."
  const [noiseWarning, setNoiseWarning] = useState(false);
  const noiseWarningTimeoutRef = useRef(null);
  const lastNoiseWarningAtRef = useRef(0);

  useEffect(() => {
    if (!active || !requireMicrophone) return;
    const stream = mediaStreamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) return;

    let audioContext;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const NOISE_RMS_THRESHOLD = 0.35;
    const NOISE_WARNING_COOLDOWN_MS = 20000;

    const interval = setInterval(() => {
      if (document.hidden) return;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      if (rms > NOISE_RMS_THRESHOLD) {
        const now = Date.now();
        if (now - lastNoiseWarningAtRef.current > NOISE_WARNING_COOLDOWN_MS) {
          lastNoiseWarningAtRef.current = now;
          setNoiseWarning(true);
          clearTimeout(noiseWarningTimeoutRef.current);
          noiseWarningTimeoutRef.current = setTimeout(() => setNoiseWarning(false), 5000);
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(noiseWarningTimeoutRef.current);
      source.disconnect();
      audioContext.close().catch(() => {});
    };
  }, [active, requireMicrophone]);

  useEffect(() => {
    return () => stopMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    requestFullscreen, fullscreenOk,
    mediaGranted, mediaError, requestingMedia, requestMedia, stopMedia, videoRef: setVideoNode,
    faceStatus, cameraStatus, micStatus, noiseWarning,
  };
}
