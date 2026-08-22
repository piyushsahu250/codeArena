/**
 * Email sender — deliberately not a third-party transactional email API (no
 * Resend/SendGrid/Mailgun/etc.). Two real-SMTP-adjacent transports are
 * supported, tried in this order:
 *
 * 1. Google Apps Script bridge (APPS_SCRIPT_WEB_APP_URL + APPS_SCRIPT_SHARED_SECRET) —
 *    an HTTPS POST from this backend to a Web App deployed from the user's own Google
 *    account, which then calls MailApp.sendEmail() inside Google's infrastructure. This
 *    exists specifically because Render's free tier blocks outbound SMTP (ports 25/465/587)
 *    but does NOT block ordinary outbound HTTPS — the bridge only ever needs port 443, so
 *    it works on hosting tiers raw SMTP cannot reach at all. See
 *    docs/APPS_SCRIPT_EMAIL_SETUP.md for the Apps Script source and deployment steps (that
 *    side lives in the user's own Google account — nothing this repo can execute directly).
 * 2. Direct SMTP via nodemailer (MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASSWORD) — the
 *    original transport, kept as a fallback for any host that does permit outbound SMTP
 *    (e.g. a future Cloud Run migration). Untouched from before.
 *
 * Both return the exact same { ok, error?, messageId? } shape from sendMail() below, so
 * every caller (sendMailLogged, retryEmailLogged, and everything built on them) is
 * completely unaware of which transport actually sent a given message.
 */
const nodemailer = require("nodemailer");

// MAIL_FROM_NAME is optional — most providers (Gmail included) accept a plain address for
// MAIL_FROM, so this combines the two into "Name <address>" for the SMTP From header without
// requiring the address itself to be pre-formatted. If MAIL_FROM already looks pre-formatted
// (contains "<"), it's used as-is and MAIL_FROM_NAME is ignored to avoid double-wrapping.
const RAW_MAIL_FROM = process.env.MAIL_FROM || process.env.MAIL_USER || "";
const FROM = RAW_MAIL_FROM
  ? (process.env.MAIL_FROM_NAME && !RAW_MAIL_FROM.includes("<")
      ? `${process.env.MAIL_FROM_NAME} <${RAW_MAIL_FROM}>`
      : RAW_MAIL_FROM)
  : "CodeArena <no-reply@codearena.local>";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";
const LOGO_URL = `${FRONTEND_URL}/branding/logo.png`;

// Built once at module load, reused across every send — nodemailer transports are meant to be
// long-lived, not recreated per request. `secure: true` (implicit TLS) is only correct for port
// 465; every other port (587 STARTTLS, 25, etc.) needs `secure: false` and nodemailer negotiates
// STARTTLS on its own.
const transporter = (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASSWORD)
  ? nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT) || 587,
      secure: Number(process.env.MAIL_PORT) === 465,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    })
  : null;

// Wraps an email body with a consistent CodeArena-branded header/footer. The logo is referenced
// by its deployed frontend URL (not embedded) since that's how email clients reliably load
// images — inline attachments/data-URIs are stripped or degraded by most webmail providers.
function wrapBranded(bodyHtml) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="text-align: center; padding: 24px 0 8px;">
        <img src="${LOGO_URL}" alt="CodeArena" width="160" style="width:160px; max-width:100%; height:auto;" />
      </div>
      <div style="padding: 8px 24px 24px; color: #1C1B18; line-height: 1.6; font-size: 14px;">
        ${bodyHtml}
      </div>
      <div style="text-align: center; padding: 16px; color: #999; font-size: 11px; border-top: 1px solid #eee;">
        CodeArena — Code · Learn · Assess · Succeed
      </div>
    </div>
  `;
}

const { isValidEmail } = require("./emailValidation");

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_WEB_APP_URL || null;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SHARED_SECRET || null;
// Apps Script Web Apps commonly take several seconds to spin up on a cold call, plus a
// redirect hop (script.google.com -> script.googleusercontent.com) that fetch() follows
// automatically — 20s gives real headroom without hanging a request indefinitely if Google's
// side is genuinely unreachable.
const APPS_SCRIPT_TIMEOUT_MS = 20000;

// Posts one email through the Apps Script bridge (see file header). The secret travels in the
// POST body, never in a URL query string, so it can't end up in a proxy/access log anywhere
// between here and Google. Returns the same { ok, error?, messageId? } shape sendMail() itself
// returns, so callers never need to know which transport actually handled a message.
async function sendViaAppsScript({ to, subject, html }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT_MS);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, type: "send", to, subject, html, fromName: process.env.MAIL_FROM_NAME || "CodeArena" }),
      signal: controller.signal,
    });
    // Apps Script Web Apps always answer with HTTP 200 for a request that reached doPost() at
    // all (it has no concept of returning a different HTTP status code to the caller) — the
    // actual outcome lives entirely in the JSON body this bridge is written to return, so a
    // non-200 here means the request never reached the script's own logic (wrong URL, Google-
    // side outage, deployment not published, etc.), not a declared send failure.
    if (!res.ok) {
      return { ok: false, error: `Apps Script bridge returned HTTP ${res.status} — check the deployed Web App URL is correct and still published.` };
    }
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: "Apps Script bridge returned a non-JSON response." };
    if (!data.ok) return { ok: false, error: data.error || "Apps Script bridge reported failure with no reason given." };
    return { ok: true, messageId: null }; // MailApp.sendEmail() doesn't expose a message id
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, error: `Apps Script bridge timed out after ${APPS_SCRIPT_TIMEOUT_MS / 1000}s.` };
    return { ok: false, error: `Failed to reach Apps Script bridge: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// Returns { ok: boolean, error?: string, messageId?: string, simulated?: true }.
// `ok: true` is only ever returned once the mail transport (Apps Script bridge or direct SMTP)
// has actually confirmed the message was accepted for delivery — there is no path that reports
// success without that confirmation.
async function sendMail({ to, subject, html }) {
  console.log(`[mailer] Sending "${subject}" to ${to}…`);

  if (!to || !isValidEmail(String(to).trim())) {
    console.error(`[mailer] Invalid recipient email: "${to}"`);
    return { ok: false, error: "Invalid recipient email address" };
  }

  if (APPS_SCRIPT_URL && APPS_SCRIPT_SECRET) {
    console.log("[mailer] Sending via Google Apps Script bridge...");
    const result = await sendViaAppsScript({ to, subject, html });
    if (result.ok) console.log("[mailer] Email accepted by Apps Script bridge — Status: SUCCESS");
    else console.error("[mailer] Apps Script bridge send error:", result.error);
    return result;
  }

  if (!transporter) {
    console.error(`[mailer] Neither the Apps Script bridge (APPS_SCRIPT_WEB_APP_URL/APPS_SCRIPT_SHARED_SECRET) nor SMTP (MAIL_HOST/MAIL_USER/MAIL_PASSWORD) is configured — email NOT sent (logging content only):\n  to: ${to}\n  subject: ${subject}`);
    return { ok: false, simulated: true, error: "Email service is not configured on the server — no email was actually sent." };
  }

  console.log("[mailer] Connecting to SMTP server...");
  try {
    const info = await transporter.sendMail({ from: FROM, to, subject, html });
    console.log(`[mailer] Email accepted by mail server. Message ID: ${info.messageId || "(none returned)"} — Status: SUCCESS`);
    return { ok: true, messageId: info.messageId || null };
  } catch (err) {
    console.error("[mailer] SMTP send error:", err.code || "", err.message);
    if (err.code === "EAUTH") {
      return { ok: false, error: `Email provider authentication failed: ${err.message}` };
    }
    if (err.responseCode === 421 || err.responseCode === 450 || err.responseCode === 452) {
      return { ok: false, error: `Email provider rate limit or temporary failure: ${err.message}` };
    }
    if (err.code === "ECONNECTION" || err.code === "ETIMEDOUT" || err.code === "ESOCKET") {
      return { ok: false, error: `Network error while contacting the mail server: ${err.message}` };
    }
    return { ok: false, error: err.message || "Unknown SMTP error" };
  }
}

// Same as sendMail(), but writes an EmailLog row so admins can see real delivery status/history
// per student instead of a fire-and-forget send. `prisma` is passed in rather than required at
// module load, since utils/mailer.js has no other dependency on the Prisma client.
async function sendMailLogged(prisma, { to, name, subject, html, emailType, studentId, batchId }) {
  const log = await prisma.emailLog.create({
    data: { studentId: studentId || null, recipientName: name || "", recipientEmail: to || "", emailType, status: "PENDING", batchId: batchId || null },
  });
  const result = await sendMail({ to, subject, html });
  await prisma.emailLog.update({
    where: { id: log.id },
    data: {
      status: result.ok ? "SENT" : "FAILED",
      errorMessage: result.ok ? null : result.error || "Unknown error",
      messageId: result.messageId || null,
      sentAt: result.ok ? new Date() : null,
    },
  }).catch(() => {});
  return result;
}

const MAX_EMAIL_RETRIES = Number(process.env.MAX_EMAIL_RETRIES) || 5;

// Retries a specific, already-failed EmailLog row in place — updates the SAME row's
// status/retryCount/errorMessage rather than sendMailLogged's usual "create a fresh row" behavior,
// since a retry is a continuation of one delivery attempt, not a new email event. `sendFn` is the
// actual `() => sendMail({...})` call, built by the caller (typically with a freshly generated
// password baked into a fresh template — plaintext passwords are never stored, so there is no
// original message body to literally resend, only the same kind of email built again).
async function retryEmailLogged(prisma, logId, sendFn) {
  const log = await prisma.emailLog.findUnique({ where: { id: logId } });
  if (!log) return { ok: false, error: "Email log entry not found" };
  if (log.retryCount >= MAX_EMAIL_RETRIES) {
    return { ok: false, error: `Retry limit reached (${MAX_EMAIL_RETRIES} attempts) — this email will not be retried automatically again.` };
  }

  await prisma.emailLog.update({ where: { id: logId }, data: { status: "RETRYING", retryCount: log.retryCount + 1 } });
  const result = await sendFn();
  await prisma.emailLog.update({
    where: { id: logId },
    data: {
      status: result.ok ? "SENT" : "FAILED",
      errorMessage: result.ok ? null : result.error || "Unknown error",
      messageId: result.messageId || null,
      sentAt: result.ok ? new Date() : null,
    },
  }).catch(() => {});
  return { ...result, retryCount: log.retryCount + 1 };
}

module.exports = { sendMail, sendMailLogged, retryEmailLogged, wrapBranded, MAX_EMAIL_RETRIES };
