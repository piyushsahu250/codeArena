import { useEffect, useRef, useState } from "react";
import api from "../api";

// Two layers, matching what a browser can and can't actually promise:
//   1. Live, browser-verified checks (camera/mic/face, internet reachability, fullscreen support,
//      required Web APIs present) — these gate the Start button.
//   2. Self-attestation checkboxes for things no browser API can verify (device charge, other
//      tabs/apps closed) — a browser cannot force-close another tab or another application for
//      security reasons, so the only honest option is to instruct the student and have them
//      confirm it, not pretend to detect it.
// Reused by both ModuleCodingAssessment.jsx and InterviewSession.jsx (the two proctored surfaces
// already built on the shared useProctoring hook) so a change here reaches both at once instead
// of drifting into two slightly-different preflight screens.
const PING_INTERVAL_MS = 8000;
const PING_TIMEOUT_MS = 5000;
const SLOW_PING_THRESHOLD_MS = 1200;

function checkBrowserSupport() {
  const missing = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push("camera/microphone access");
  if (!document.documentElement.requestFullscreen) missing.push("fullscreen mode");
  if (!window.AudioContext && !window.webkitAudioContext) missing.push("audio monitoring");
  return { ok: missing.length === 0, missing };
}

export default function ReadinessChecklist({ proctor, requireWebcam, requireMicrophone, requireFullscreen = true, onReadyChange }) {
  const [browserSupport] = useState(checkBrowserSupport);
  const [pingStatus, setPingStatus] = useState("checking"); // checking | ok | slow | offline
  const [pingMs, setPingMs] = useState(null);
  const [attestPower, setAttestPower] = useState(false);
  const [attestClosedOthers, setAttestClosedOthers] = useState(false);
  const pingTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      if (!navigator.onLine) {
        if (!cancelled) { setPingStatus("offline"); setPingMs(null); }
        return;
      }
      const start = performance.now();
      try {
        await api.get("/health", { timeout: PING_TIMEOUT_MS });
        if (cancelled) return;
        const elapsed = Math.round(performance.now() - start);
        setPingMs(elapsed);
        setPingStatus(elapsed > SLOW_PING_THRESHOLD_MS ? "slow" : "ok");
      } catch {
        if (!cancelled) { setPingStatus("offline"); setPingMs(null); }
      }
    }
    ping();
    pingTimerRef.current = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(pingTimerRef.current);
    };
  }, []);

  const cameraOk = !requireWebcam || (proctor.mediaGranted && proctor.cameraStatus === "OK" && proctor.faceStatus === "OK");
  const micOk = !requireMicrophone || (proctor.mediaGranted && proctor.micStatus === "OK");
  const internetOk = pingStatus === "ok" || pingStatus === "slow";
  const fullscreenOk = !requireFullscreen || !!document.documentElement.requestFullscreen;
  const allMandatoryReady = browserSupport.ok && internetOk && fullscreenOk && cameraOk && micOk && attestPower && attestClosedOthers;

  useEffect(() => {
    onReadyChange?.(allMandatoryReady);
  }, [allMandatoryReady, onReadyChange]);

  return (
    <div style={{ marginTop: 20, padding: 16, border: "1px solid var(--line)", borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pre-test readiness check</div>

      <CheckRow ok={browserSupport.ok} label="Browser Compatible" detail={browserSupport.ok ? undefined : `Missing: ${browserSupport.missing.join(", ")} — try the latest Chrome or Edge.`} />
      <CheckRow
        ok={internetOk}
        pending={pingStatus === "checking"}
        label="Internet Ready"
        detail={
          pingStatus === "checking" ? "Checking connection…" :
          pingStatus === "offline" ? "No connection to the server — check your internet and try again." :
          pingStatus === "slow" ? `Connected, but slow (${pingMs} ms) — a stable connection is recommended.` :
          `Connected (${pingMs} ms)`
        }
      />
      {requireFullscreen && <CheckRow ok={fullscreenOk} label="Fullscreen Ready" detail={fullscreenOk ? "Will activate automatically when you begin." : "This browser doesn't support fullscreen mode."} />}

      {(requireWebcam || requireMicrophone) && (
        <div style={{ marginTop: 4 }}>
          {proctor.mediaGranted ? (
            <>
              {requireWebcam && (
                <video ref={proctor.videoRef} autoPlay muted playsInline style={{ width: 160, height: 120, borderRadius: 8, margin: "6px 0", background: "#000", objectFit: "cover" }} />
              )}
              {requireWebcam && (
                <CheckRow
                  ok={cameraOk}
                  label="Camera Ready"
                  detail={proctor.cameraStatus !== "OK" ? "Camera unavailable — check it isn't in use by another app." : proctor.faceStatus === "MISSING" ? "No face detected — make sure you're visible in frame." : proctor.faceStatus === "MULTIPLE" ? "Multiple faces detected — only you should be in frame." : undefined}
                />
              )}
              {requireMicrophone && <CheckRow ok={micOk} label="Microphone Ready" detail={micOk ? undefined : "Microphone unavailable — check it isn't in use by another app."} />}
            </>
          ) : (
            <>
              <button className="btn btn-dark" style={{ marginTop: 4 }} onClick={proctor.requestMedia} disabled={proctor.requestingMedia}>
                {proctor.requestingMedia ? "Requesting access…" : requireWebcam && requireMicrophone ? "Grant camera & microphone access" : requireMicrophone ? "Grant microphone access" : "Grant camera access"}
              </button>
              {proctor.mediaError && <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 8 }}>{proctor.mediaError}</p>}
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <p style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 8 }}>
          Browsers can't close other tabs or apps for you — please confirm these yourself:
        </p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={attestPower} onChange={(e) => setAttestPower(e.target.checked)} style={{ marginTop: 2 }} />
          My device is sufficiently charged or connected to power
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={attestClosedOthers} onChange={(e) => setAttestClosedOthers(e.target.checked)} style={{ marginTop: 2 }} />
          I have closed unnecessary applications and browser tabs
        </label>
      </div>
    </div>
  );
}

function CheckRow({ ok, pending, label, detail }) {
  const color = pending ? "var(--ink-dim)" : ok ? "var(--mint)" : "var(--rust)";
  const icon = pending ? "…" : ok ? "✓" : "✗";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 6 }}>
      <span className="mono" style={{ color, fontWeight: 700, width: 16, flexShrink: 0 }}>{icon}</span>
      <div>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {detail && <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 1 }}>{detail}</div>}
      </div>
    </div>
  );
}
