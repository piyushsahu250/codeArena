// All database access for authentication. No rules here: the service decides what is allowed; this only reads and writes.
const prisma = require("../../prisma");

const findUserForLogin = (email) => prisma.user.findUnique({ where: { email }, include: { institute: true } });
const findUserByEmail = (email) => prisma.user.findUnique({ where: { email } });
const findUserByResetToken = (tokenHash) => prisma.user.findFirst({ where: { resetTokenHash: tokenHash }, include: { institute: true } });
const findUserByPendingEmailToken = (tokenHash) => prisma.user.findFirst({ where: { pendingEmailTokenHash: tokenHash } });

const countSessions = (userId) => prisma.loginSession.count({ where: { userId } });
const findSessionOnDevice = (userId, browser, os) => prisma.loginSession.findFirst({ where: { userId, browser, os } });

const findStudentProfile = (studentId) => prisma.studentProfile.findUnique({ where: { studentId } });
const findResumeSummary = (studentId) => prisma.resume.findUnique({ where: { studentId }, select: { education: true, fullName: true, email: true } });
const listDocumentIds = (studentId) => prisma.studentDocument.findMany({ where: { studentId }, select: { id: true } });

const markMustChangePassword = (userId) => prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });

// Atomic claim of the reset-request cooldown: the WHERE is re-checked by Postgres at write time, so of N simultaneous requests for one account exactly one matches.
const claimResetCooldown = (userId, now, cutoff) => prisma.user.updateMany({
  where: { id: userId, OR: [{ lastPasswordResetRequestedAt: null }, { lastPasswordResetRequestedAt: { lt: cutoff } }] },
  data: { lastPasswordResetRequestedAt: now },
});
const storeResetToken = (userId, tokenHash, expiry) => prisma.user.update({ where: { id: userId }, data: { resetTokenHash: tokenHash, resetTokenExpiry: expiry } });
const releaseResetCooldown = (userId) => prisma.user.update({ where: { id: userId }, data: { lastPasswordResetRequestedAt: null } });

// The new hash and its history/expiry stamp succeed or fail together; the token is cleared in the same write so it is single-use.
function replacePasswordFromReset(userId, passwordHash, recordChange) {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, resetTokenHash: null, resetTokenExpiry: null } });
    await recordChange(tx);
  });
}

const clearPendingEmail = (userId) => prisma.user.update({ where: { id: userId }, data: { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null } });
const confirmPendingEmail = (userId, email) => prisma.user.update({
  where: { id: userId },
  data: { email, emailVerified: true, emailVerifiedAt: new Date(), pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null },
});

module.exports = {
  findUserForLogin, findUserByEmail, findUserByResetToken, findUserByPendingEmailToken, countSessions, findSessionOnDevice, findStudentProfile, findResumeSummary, listDocumentIds,
  markMustChangePassword, claimResetCooldown, storeResetToken, releaseResetCooldown, replacePasswordFromReset, clearPendingEmail, confirmPendingEmail,
};
