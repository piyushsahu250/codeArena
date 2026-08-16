// Reusable HTML bodies for the credential-flow emails specifically (account creation, credential
// resend/reset) — not a platform-wide email-template refactor. Every other email in the codebase
// (login alerts, interview-report-ready, talent-pool notifications, etc.) is unrelated to account
// credentials and stays exactly as it is; consolidating those too would be a much bigger, riskier
// change for no functional gain here. Both functions return a body ready to pass through
// wrapBranded() — they don't call it themselves, so callers stay in control of exactly when the
// branded header/footer gets applied (matches every existing call site's current pattern).
const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena-app.vercel.app";

// Used by single-create and bulk-upload — the very first email a new account ever receives,
// combining "your account exists" and "here's how to log in" into one message (matches the
// spec's own example subject/body, and there's no separate "account created" notification
// anywhere in this codebase to keep in sync with a second email). `institute`/`departmentSection`/
// `batchYear`/`registrationNumber` are all optional so the same function covers both the richer
// student-signup email and the plainer staff/admin/clerk one.
function accountCredentialsTemplate({ name, email, password, registrationNumber, institute, departmentSection, batchYear }) {
  const detailLines = [
    institute ? `Institute: ${institute}` : null,
    departmentSection ? departmentSection : null,
    batchYear ? `Batch: ${batchYear}` : null,
    `Email: ${email}`,
    registrationNumber ? `Registration Number: ${registrationNumber}` : null,
    `Temporary Password: <strong>${password}</strong>`,
  ].filter(Boolean).join("<br/>");

  return `
    <p>Hi ${name},</p>
    <p>Your CodeArena account has been created.</p>
    <p>${detailLines}</p>
    <p><a href="${FRONTEND_URL}/login">Log in to CodeArena</a> — you'll be asked to set a new password on first login.</p>
    <p style="font-size: 12px; color: #999;">For security, please change your password after your first login and never share it with anyone.</p>
  `;
}

// Used by admin-initiated reset-password, bulk-regenerate-password, and the Email Logs retry
// route — any time a NEW temporary password is issued for an EXISTING account (as opposed to
// account creation itself).
function credentialsResendTemplate({ name, email, password }) {
  return `
    <p>Hi ${name},</p>
    <p>Your password has been reset by an administrator.</p>
    <p>
      <strong>Login email:</strong> ${email}<br/>
      <strong>New temporary password:</strong> ${password}
    </p>
    <p><a href="${FRONTEND_URL}/login">Log in to CodeArena</a> — you'll be asked to set a new password on first login.</p>
    <p style="font-size: 12px; color: #999;">If you didn't expect this, contact your institute administrator.</p>
  `;
}

module.exports = { accountCredentialsTemplate, credentialsResendTemplate };
