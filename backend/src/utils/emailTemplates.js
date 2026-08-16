// Reusable HTML bodies for the credential-flow emails specifically (account creation, credential
// resend/reset) — not a platform-wide email-template refactor. Every other email in the codebase
// (login alerts, interview-report-ready, talent-pool notifications, etc.) is unrelated to account
// credentials and stays exactly as it is; consolidating those too would be a much bigger, riskier
// change for no functional gain here. Unlike the rest of the codebase's emails, these two return a
// COMPLETE, self-contained HTML document (their own branded header/footer) rather than a body meant
// to be passed through mailer.js's wrapBranded() — the credential-email design (gradient banner,
// details card, CTA button, instructions box) is distinct enough from the generic wrapBranded()
// layout that reusing it would mean fighting its assumptions. Callers should pass the return value
// of these functions directly as `html`, not wrap it again.
const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena-app.vercel.app";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Shared chrome for the credential-family emails: gradient header banner + card body + amber
// "Important Instructions" box + footer. `instructions` is an array of plain-text bullet strings.
function wrapCredentialsEmail({ heading, subheading, bodyHtml, instructions }) {
  const instructionsHtml = instructions?.length
    ? `
      <div style="margin-top:24px; background:#FFF8E1; border:1px solid #FCE8A8; border-radius:8px; padding:16px 20px;">
        <div style="font-weight:700; font-size:13px; color:#7A5B00; margin-bottom:8px;">Important Instructions</div>
        <ul style="margin:0; padding-left:18px; color:#7A5B00; font-size:13px; line-height:1.7;">
          ${instructions.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; background:#ffffff;">
      <div style="background: linear-gradient(135deg, #2F6FE0, #4FA6F2); padding: 40px 24px 32px; text-align:center;">
        <div style="width:56px; height:56px; margin:0 auto 16px; background:#ffffff; border-radius:14px; font-size:26px; line-height:56px;">💻</div>
        <div style="color:#ffffff; font-size:22px; font-weight:700;">${escapeHtml(heading)}</div>
        <div style="color:rgba(255,255,255,0.85); font-size:13px; margin-top:6px;">${escapeHtml(subheading)}</div>
      </div>
      <div style="padding: 32px 28px; color:#1C1B18;">
        ${bodyHtml}
        ${instructionsHtml}
      </div>
      <div style="text-align:center; padding:20px; color:#999; font-size:11px; border-top:1px solid #eee;">
        © ${new Date().getFullYear()} CodeArena<br/>
        Empowering Students Through Coding, AI &amp; Innovation
      </div>
    </div>
  `;
}

function detailsCard(rows) {
  const visible = rows.filter(Boolean);
  return `
    <div style="background:#F7F8FA; border-radius:10px; padding:6px 20px; margin-bottom:24px;">
      ${visible.map(([label, value], i) => `
        <div style="padding:10px 0; ${i < visible.length - 1 ? "border-bottom:1px solid #eee;" : ""}">
          <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.03em;">${escapeHtml(label)}</div>
          <div style="font-size:14px; font-weight:700; color:#1C1B18; margin-top:2px;">${escapeHtml(value)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function loginButton() {
  return `
    <div style="text-align:center; margin-bottom:6px;">
      <a href="${FRONTEND_URL}/login" style="display:inline-block; background:#2F6FE0; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:12px 32px; border-radius:8px;">Login to CodeArena</a>
    </div>
    <div style="text-align:center; margin-bottom:8px;">
      <a href="${FRONTEND_URL}/login" style="color:#2F6FE0; font-size:12px;">${FRONTEND_URL}/login</a>
    </div>
  `;
}

// Used by single-create and bulk-upload — the very first email a new account ever receives,
// combining "your account exists" and "here's how to log in" into one message. `institute`/
// `departmentSection`/`batchYear`/`registrationNumber` are all optional so the same function
// covers both the richer student-signup email and the plainer staff/admin/clerk one. The card
// shows "Registration Number (PRN)" rather than a separate Roll Number — PRN is this platform's
// primary student identifier (roll number is only ever a 3-character suffix derived from it), so
// showing PRN here is what's actually useful to a student logging in for the first time.
function accountCredentialsTemplate({ name, email, password, registrationNumber, institute, departmentSection, batchYear }) {
  const body = `
    <p style="margin:0 0 16px;">Hello <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px; line-height:1.6;">Your CodeArena account has been successfully created. Please use the following credentials to log in.</p>
    ${detailsCard([
      ["Student Name", name],
      institute ? ["Institute", institute] : null,
      departmentSection ? ["Department / Section", departmentSection] : null,
      batchYear ? ["Batch", batchYear] : null,
      ["Email", email],
      registrationNumber ? ["Registration Number (PRN)", registrationNumber] : null,
      ["Temporary Password", password],
    ])}
    ${loginButton()}
  `;

  return wrapCredentialsEmail({
    heading: "Welcome to CodeArena",
    subheading: "AI Powered Coding Assessment Platform",
    bodyHtml: body,
    instructions: [
      "Use the temporary password for your first login.",
      "Change your password immediately after logging in.",
      "Keep your credentials confidential.",
      "If you encounter any issue, contact your faculty or administrator.",
    ],
  });
}

// Used by admin-initiated reset-password, bulk-regenerate-password, and the Email Logs retry
// route — any time a NEW temporary password is issued for an EXISTING account (as opposed to
// account creation itself).
function credentialsResendTemplate({ name, email, password }) {
  const body = `
    <p style="margin:0 0 16px;">Hello <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px; line-height:1.6;">Your password has been reset by an administrator. Please use the following credentials to log in.</p>
    ${detailsCard([
      ["Login Email", email],
      ["New Temporary Password", password],
    ])}
    ${loginButton()}
  `;

  return wrapCredentialsEmail({
    heading: "Password Reset",
    subheading: "CodeArena Account Security",
    bodyHtml: body,
    instructions: [
      "Use the temporary password for your next login.",
      "Change your password immediately after logging in.",
      "Keep your credentials confidential.",
      "If you didn't expect this, contact your institute administrator right away.",
    ],
  });
}

module.exports = { accountCredentialsTemplate, credentialsResendTemplate };
