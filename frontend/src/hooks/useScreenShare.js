import { useCallback, useEffect, useRef, useState } from "react";

// Optional "share your entire screen" requirement for PROCTORED exams (policy.requireScreenShare). Browser capture is a signal,
// not a lock: the page can verify that the student chose a whole-monitor share and notice when it stops, and report both as
// evidence, but it cannot see what is on the screen unless the institution records it. LOCKDOWN exams use the secure client
// instead (the client itself is the only window). Nothing is recorded or uploaded by this hook; the stream is never attached to
// a video element or sent anywhere, it is only watched for ending.
export function useScreenShare({ required, active, onStopped }) {
  const [state, setState] = useState("idle"); // idle | requesting | sharing | wrong-surface | stopped | denied | unsupported
  const streamRef = useRef(null);
  const onStoppedRef = useRef(onStopped);
  onStoppedRef.current = onStopped;
  const activeRef = useRef(active);
  activeRef.current = active;

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  const stop = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) s.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  }, []);

  const request = useCallback(async () => {
    if (!supported) { setState("unsupported"); return false; }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "monitor" }, audio: false });
      const track = stream.getVideoTracks()[0];
      const surface = track?.getSettings?.().displaySurface; // "monitor" | "window" | "browser" (undefined on some browsers)
      if (surface && surface !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        setState("wrong-surface");
        return false;
      }
      stop();
      streamRef.current = stream;
      track.onended = () => {
        streamRef.current = null;
        setState("stopped");
        if (activeRef.current) onStoppedRef.current?.();
      };
      setState("sharing");
      return true;
    } catch {
      setState("denied");
      return false;
    }
  }, [supported, stop]);

  useEffect(() => stop, [stop]);
  return { state, supported, request, stop, ok: !required || state === "sharing" };
}
