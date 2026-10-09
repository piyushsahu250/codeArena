// Fullscreen lifecycle for locked-down sessions (interviews, assessments, coding tests).
//
// Why this exists: pages used to request fullscreen and rely on each individual exit path (finish, terminate...) to leave it. Leaving the page any other way
// -- a router <Link>, the browser Back button, an unmount during a pending request -- never released it, so the student stayed in fullscreen on screens
// that have nothing to do with the session. This module gives every session one owner id, releases fullscreen for that owner whenever it ends or unmounts,
// and never touches a fullscreen session that another feature started.
//
//   enterFullscreen(ownerId)    request fullscreen (must be called from a user gesture); concurrent calls share one request
//   releaseFullscreen(ownerId)  leave fullscreen if THIS owner entered it; safe to call any number of times
//   isReleasingFullscreen()     true while a release is in progress, so "you left fullscreen" detectors do not treat it as a violation or re-enter
//   subscribeFullscreenStatus   lets the UI show a recoverable notice when the browser refuses to leave fullscreen
import { requestFullscreenCompat, exitFullscreenCompat, getFullscreenElement } from "./fullscreenCompat";

let ownerId = null;
let releasing = false;
let pendingEnter = null;
let status = { exitFailed: false };
const subscribers = new Set();

function setStatus(next) {
  status = next;
  subscribers.forEach((fn) => { try { fn(status); } catch { /* a bad subscriber must not break the others */ } });
}

export const getFullscreenStatus = () => status;
export function subscribeFullscreenStatus(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export const isReleasingFullscreen = () => releasing;
export const fullscreenOwner = () => ownerId;

// Resolves { ok, entered, error? }. entered is true only when this call actually switched the page into fullscreen.
export function enterFullscreen(owner) {
  if (getFullscreenElement()) return Promise.resolve({ ok: true, entered: false });
  if (pendingEnter) return pendingEnter;
  pendingEnter = requestFullscreenCompat()
    .then(() => { ownerId = owner; return { ok: true, entered: true }; })
    .catch((error) => ({ ok: false, entered: false, error }))
    .finally(() => { pendingEnter = null; });
  return pendingEnter;
}

// Resolves { ok, skipped?, error? }. Only the owner that entered fullscreen can release it; anyone else gets { ok: true, skipped: true }.
export async function releaseFullscreen(owner) {
  if (ownerId !== owner) return { ok: true, skipped: true };
  if (pendingEnter) await pendingEnter; // never leave a request half-way through
  if (!getFullscreenElement()) { ownerId = null; return { ok: true, alreadyOut: true }; }
  releasing = true;
  try {
    await exitFullscreenCompat();
    if (getFullscreenElement()) throw new Error("The browser stayed in fullscreen after the exit request");
    ownerId = null;
    if (status.exitFailed) setStatus({ exitFailed: false });
    return { ok: true };
  } catch (error) {
    setStatus({ exitFailed: true });
    return { ok: false, error };
  } finally {
    // the fullscreenchange event can arrive just after the promise settles; keep the flag up until it has
    setTimeout(() => { releasing = false; }, 400);
  }
}

// User-triggered retry from the "could not leave fullscreen" notice (a click is a valid gesture for the browser).
export async function retryExitFullscreen() {
  releasing = true;
  try {
    await exitFullscreenCompat();
    if (getFullscreenElement()) throw new Error("still fullscreen");
    ownerId = null;
    setStatus({ exitFailed: false });
    return { ok: true };
  } catch (error) {
    setStatus({ exitFailed: true });
    return { ok: false, error };
  } finally {
    setTimeout(() => { releasing = false; }, 400);
  }
}

export function dismissFullscreenNotice() {
  if (status.exitFailed) setStatus({ exitFailed: false });
}

// Test hook: forget all state.
export function __resetFullscreenSession() {
  ownerId = null; releasing = false; pendingEnter = null; status = { exitFailed: false }; subscribers.clear();
}
