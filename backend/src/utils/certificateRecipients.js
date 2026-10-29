// Who may be given a manually issued certificate, and by whom. Students can be given one by any administrator or staff member (within their own institute, which the route checks).
// Staff, clerks and institute administrators can be given one only by the Super Admin: those are the people who run the institutes, so their certificates are not handed out by
// the people they supervise. Platform administrators and the Super Admin themselves cannot receive one here.
// Pure: no Prisma client, so test/certificateRecipients.test.js can check every combination.

const STAFF_RECIPIENT_ROLES = Object.freeze(["STAFF", "CLERK", "INSTITUTE_ADMIN"]);

// -> { ok: true } or { ok: false, status, error }
function checkRecipient({ requesterRole, targetRole }) {
  if (targetRole === "STUDENT") return { ok: true };
  if (STAFF_RECIPIENT_ROLES.includes(targetRole)) {
    if (requesterRole === "SUPER_ADMIN") return { ok: true };
    return { ok: false, status: 403, error: "Only the Super Admin can issue certificates to staff, clerks and institute admins." };
  }
  return { ok: false, status: 400, error: "A certificate can be issued to a student, staff member, clerk or institute admin." };
}

// A person cannot withdraw the certificate they were given (a revocation is for someone else to decide), except the Super Admin, who can revoke anything.
function canRevokeOwn(requesterRole, requesterId, certificateHolderId) {
  return requesterRole === "SUPER_ADMIN" || requesterId !== certificateHolderId;
}

module.exports = { STAFF_RECIPIENT_ROLES, checkRecipient, canRevokeOwn };
