// What the sign-in page needs to know to guide a student through choosing a personal password on first login (or after the institute's password expiry). Pure functions, so
// frontend/scripts/passwordPolicyRegression.mjs can test them without a browser. Nothing here decides whether a password change is REQUIRED or ALLOWED: the server does, on
// every request (see backend/src/modules/auth/auth.service.js).
import { passwordMeetsPolicy } from "./passwordPolicy.js"; // with the extension: the regression script loads this file with plain Node, which does not resolve bare paths

export const WELCOME_MESSAGE = "Welcome to CodeArena! Please create your personal password before continuing.";
export const EXPIRED_MESSAGE = "Your password has expired. Please create a new password before continuing.";
export const SUCCESS_MESSAGE = "Password changed successfully. Welcome to CodeArena!";
export const SIGN_IN_AGAIN_MESSAGE = "Password changed successfully. Please sign in with your new password.";
export const MATCH_MESSAGE = "Passwords match.";
export const MISMATCH_MESSAGE = "Passwords do not match.";

// `reason` comes from the server: "TEMPORARY_PASSWORD" (an administrator issued or reset the password) or "PASSWORD_EXPIRED" (the institute's expiry window elapsed).
export const normalizeReason = (reason) => (reason === "PASSWORD_EXPIRED" ? "PASSWORD_EXPIRED" : "TEMPORARY_PASSWORD");
export const changeIntro = (reason) => (normalizeReason(reason) === "PASSWORD_EXPIRED" ? EXPIRED_MESSAGE : WELCOME_MESSAGE);
export const currentPasswordLabel = (reason) => (normalizeReason(reason) === "PASSWORD_EXPIRED" ? "Current Password" : "Temporary Password");

// "match" / "mismatch" once the student has typed into the confirmation field; null while it is empty, so two empty fields never show a success state.
export function confirmStatus(newPassword, confirmPassword) {
  if (!confirmPassword) return null;
  return newPassword === confirmPassword ? "match" : "mismatch";
}

// The submit button is enabled only when every required field is filled, every rule is met and both new-password fields agree. Convenience only: the server checks again.
export function canSubmitPasswordChange({ email, temporaryPassword, newPassword, confirmPassword }) {
  return Boolean(email && temporaryPassword && newPassword && confirmPassword) && passwordMeetsPolicy(newPassword) && newPassword === confirmPassword;
}

// Sign-in failures keep their long-standing wording. A request that never got an answer (network failure, DNS, refused connection, timeout) is a platform problem, not a
// wrong password, so it says so.
export function describeLoginFailure(err) {
  if (!err || !err.response) return "CodeArena is temporarily unavailable. We're working on it — please try again in a few minutes.";
  return (err.response.data && err.response.data.error) || "Login failed";
}

// Why a password-change request did not complete, in words for a student. `kind` tells the page what to do next: "network" and "server" mean the outcome is not known (the page
// then checks whether the new password already works); "credentials" means the temporary password was not accepted (it may already have been replaced); the rest are plain
// refusals the student can act on. The server's own text is used only for statuses whose text is written for the student (policy, limits, deactivated accounts).
export function describeChangeFailure(err) {
  const response = err && err.response;
  if (!response) {
    return { kind: "network", message: "We couldn't reach CodeArena, so your password may not have been changed. Check your connection and try again. If your temporary password is no longer accepted, sign in with your new password." };
  }
  const serverText = response.data && typeof response.data.error === "string" ? response.data.error : "";
  if (response.status === 401) {
    return { kind: "credentials", message: "Your temporary password was not accepted. If you have already created your personal password, go back and sign in with it." };
  }
  if (response.status === 429) return { kind: "limited", message: serverText || "Too many attempts. Please wait a few minutes and try again." };
  if (response.status === 400) return { kind: "rejected", message: serverText || "Your new password was not accepted. Please check the requirements and try again." };
  if (response.status === 403) return { kind: "refused", message: serverText || "This account cannot sign in right now. Please contact your administrator." };
  return { kind: "server", message: "Something went wrong on our side, so your password may not have been changed. Please try again in a moment." };
}

// Wording once we know the outcome of the follow-up sign-in with the new password: "not-changed" (the server answered and refused the new password, so the change did not
// happen) or "unknown" (still no answer).
export const NOT_CHANGED_MESSAGE = "Your password was not changed. Please try again.";
