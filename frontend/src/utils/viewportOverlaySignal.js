// Orientation- and zoom-aware viewport-shrink ("on-screen overlay") heuristic — shared by
// TestTaking.jsx and useProctoring.js.
//
// What this detects: Android system-level assistant overlays (e.g. "Circle to Search", triggered
// by a long-press on the home button/gesture pill) draw their result sheet as an OS-level layer ON
// TOP of the current app rather than switching away from it — the tab is never actually hidden or
// backgrounded, so neither visibilitychange nor fullscreenchange fires. The one side effect it
// can't avoid: the visible viewport shrinks noticeably while it's open. That is the only
// client-side footprint this class of overlay leaves, so that's what's checked for.
//
// Root cause this replaces: a bare "viewport got shorter and no input is focused" check also
// fires for two entirely normal things that have nothing to do with an overlay:
//   - Rotating the device (portrait <-> landscape) — often a large, sudden height change.
//   - Pinch-zooming in (or an OS/browser accessibility zoom) — visualViewport reports the
//     CSS-pixel size of the visible region, which shrinks as the user zooms into more of the
//     page at a larger scale, even though nothing is actually covering the content.
// Both are now detected directly and excluded before the shrink-ratio check ever runs, instead of
// being caught (or not) as a side effect of the existing "is an input focused" carve-out:
// orientation via screen.orientation's 'change' event (falling back to window.orientationchange,
// then a matchMedia orientation query, whichever this browser actually supports), zoom via
// visualViewport.scale. Either one re-baselines silently against the NEW height — the shrink
// heuristic below only ever compares against the current context, never a stale pre-rotation or
// pre-zoom one.
const SHRINK_RATIO_THRESHOLD = 0.22;
const ZOOM_SCALE_DELTA = 0.05; // a visualViewport.scale change bigger than this = the user zoomed, not an overlay

export function createOverlaySignal({ onOverlayDetected, onOrientationChange } = {}) {
  const viewport = typeof window !== "undefined" ? window.visualViewport : null;

  function currentHeight() {
    return viewport ? viewport.height : window.innerHeight;
  }
  function currentScale() {
    return viewport ? viewport.scale : 1;
  }

  let baseline = currentHeight();
  let baselineScale = currentScale();
  let flagged = false;

  function isEditableFocused() {
    const el = document.activeElement;
    if (!el) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  }

  function handleResize() {
    const height = currentHeight();
    const scale = currentScale();

    if (isEditableFocused()) {
      // Legitimate on-screen keyboard — re-baseline so its close doesn't look like a shrink.
      baseline = Math.max(baseline, height);
      baselineScale = scale;
      flagged = false;
      return;
    }
    if (Math.abs(scale - baselineScale) > ZOOM_SCALE_DELTA) {
      // Pinch-zoom / accessibility zoom, not an overlay — re-baseline against the new zoomed size.
      baseline = height;
      baselineScale = scale;
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
        onOverlayDetected?.();
      }
    } else {
      flagged = false;
    }
  }

  function handleOrientationChange() {
    // Re-baseline immediately against whatever the viewport measures right now — the resize this
    // rotation triggers (which can fire before or after this event, depending on browser) must
    // never be measured against the pre-rotation baseline, or a rotation reads as a huge "shrink."
    baseline = currentHeight();
    baselineScale = currentScale();
    flagged = false;
    onOrientationChange?.();
  }

  const resizeTarget = viewport || window;
  resizeTarget.addEventListener("resize", handleResize);

  // screen.orientation isn't available in every browser (notably older iOS Safari) — fall back to
  // the deprecated but still-widely-supported window.orientationchange, and finally to a
  // matchMedia query. Whichever one this browser actually supports, all three mean the same thing
  // here, so only the first available is used.
  let cleanupOrientation = () => {};
  if (typeof window !== "undefined" && window.screen?.orientation?.addEventListener) {
    window.screen.orientation.addEventListener("change", handleOrientationChange);
    cleanupOrientation = () => window.screen.orientation.removeEventListener("change", handleOrientationChange);
  } else if (typeof window !== "undefined" && "onorientationchange" in window) {
    window.addEventListener("orientationchange", handleOrientationChange);
    cleanupOrientation = () => window.removeEventListener("orientationchange", handleOrientationChange);
  } else if (typeof window !== "undefined" && window.matchMedia) {
    const mql = window.matchMedia("(orientation: portrait)");
    const listener = () => handleOrientationChange();
    if (mql.addEventListener) mql.addEventListener("change", listener);
    else mql.addListener(listener); // Safari <14
    cleanupOrientation = () => {
      if (mql.removeEventListener) mql.removeEventListener("change", listener);
      else mql.removeListener(listener);
    };
  }

  return {
    destroy() {
      resizeTarget.removeEventListener("resize", handleResize);
      cleanupOrientation();
    },
  };
}
