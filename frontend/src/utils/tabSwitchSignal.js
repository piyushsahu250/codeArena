// Graduated page-hidden ("tab switch") detector — shared by TestTaking.jsx and useProctoring.js
// (Mock Test / Mock Interview / Module Coding Assessment all route through one of these two).
//
// Root cause this replaces: both call sites used to have exactly one grace window (~3s) before
// reporting a page-hidden spell — hidden under it said nothing, hidden past it immediately
// reported plain TAB_SWITCH, a CONFIRMED_VIOLATION penalized on the very first occurrence, with
// nothing in between. `document.hidden` fires identically whether the student genuinely switched
// away to search, or the screen just timed out/locked itself, a phone call came in, or they
// dismissed a notification that needed more than a glance — browsers deliberately don't expose
// which, for privacy, so a single flat threshold can't actually tell them apart; it can only pick
// one point to stop giving the student the benefit of the doubt.
//
// This adds the real middle tier that was missing:
//
//   hidden < shortGraceMs                    -> nothing at all (an instant glance)
//   shortGraceMs <= hidden < longGraceMs      -> onBrief() once (TAB_SWITCH_BRIEF — SUSPICIOUS,
//                                                logged, a soft notice, only escalates to a
//                                                penalized strike after a repeated pattern; see
//                                                proctoringSeverity.js)
//   hidden >= longGraceMs (still hidden)      -> onSwitch() once (TAB_SWITCH — CONFIRMED_VIOLATION,
//                                                penalized immediately, exactly as before)
//
// A call answered or a notification actually read overwhelmingly resolves within a few to ~10
// seconds; a genuine switch-away to search overwhelmingly runs well past longGraceMs — so this
// only closes the "a phone call costs an instant strike" false positive, real detection of a
// sustained absence is completely unweakened.
export const TAB_SWITCH_SHORT_GRACE_MS = 3000;
export const TAB_SWITCH_LONG_GRACE_MS = 15000;

export function createTabSwitchSignal({
  shortGraceMs = TAB_SWITCH_SHORT_GRACE_MS,
  longGraceMs = TAB_SWITCH_LONG_GRACE_MS,
  onBrief,
  onSwitch,
  onVisible,
} = {}) {
  let shortTimer = null;
  let longTimer = null;

  function clearTimers() {
    clearTimeout(shortTimer);
    clearTimeout(longTimer);
    shortTimer = null;
    longTimer = null;
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimers();
      shortTimer = setTimeout(() => {
        if (document.hidden) onBrief?.();
      }, shortGraceMs);
      longTimer = setTimeout(() => {
        if (document.hidden) onSwitch?.();
      }, longGraceMs);
    } else {
      clearTimers();
      onVisible?.();
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return {
    destroy() {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimers();
    },
  };
}
