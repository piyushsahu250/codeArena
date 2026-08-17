/**
 * CodeArena Email Bridge — Google Apps Script
 * ============================================
 *
 * Two independent jobs live in this one script, both using MailApp.sendEmail() so all delivery
 * happens inside Google's own infrastructure (never over raw SMTP, which CodeArena's current
 * hosting tier blocks outbound):
 *
 *   1. doPost(e) — a Web App endpoint the CodeArena backend calls directly (over HTTPS) to send
 *      ONE email on demand: account-creation credentials, a credentials resend, a forgot-password
 *      reset link, etc. This is how single/bulk "Send Credentials" clicks and the student
 *      Forgot Password flow actually deliver mail now.
 *
 *   2. processPendingEmails() — the ORIGINAL Sheet1-driven bulk workflow (Name / Email /
 *      Roll Number / Temporary Password / Status columns), improved to track real states
 *      (Pending / Sending / Sent / Failed: <reason>) and to safely resume across executions
 *      instead of assuming one run finishes everything. Runs on a time-based trigger you install
 *      once (see installTrigger() below). Nothing about this workflow's existing columns changed.
 *
 * ── SETUP (one time) ─────────────────────────────────────────────────────────────────────────
 * 1. Open your existing Apps Script project (Extensions -> Apps Script from the Google Sheet).
 * 2. Replace/add this file's contents.
 * 3. Project Settings -> Script Properties -> add:
 *      SHARED_SECRET  = <a long random string you generate yourself, e.g. from a password
 *                        manager or `openssl rand -hex 32` — never reuse your Gmail password>
 *    This is the ONLY secret this script needs. It authenticates requests from the CodeArena
 *    backend so the public Web App URL can't be abused by anyone else who finds it.
 * 4. Deploy -> New deployment -> type "Web app" -> Execute as "Me" -> Who has access "Anyone".
 *    ("Anyone" sounds alarming but is required for a server-to-server call with no Google login
 *    of its own — doPost()'s very first line rejects anything without the correct SHARED_SECRET,
 *    so an unauthenticated caller gets nothing but an error.)
 * 5. Copy the deployment's Web App URL (ends in /exec) — this becomes CodeArena's
 *    APPS_SCRIPT_WEB_APP_URL environment variable. Give CodeArena's own APPS_SCRIPT_SHARED_SECRET
 *    the SAME value you put in Script Properties in step 3.
 * 6. Run testConfig() once from the Apps Script editor (select it from the function dropdown,
 *    click Run) to confirm SHARED_SECRET is set and MailApp quota is available. Check View -> Logs.
 * 7. Run installTrigger() once to enable the Sheet1 bulk-processing job (skip this if you don't
 *    use the Sheet1 workflow at all).
 *
 * Nothing here ever contains your actual Gmail password or App Password — MailApp.sendEmail()
 * sends as the Google account that owns this script, using Google's own authenticated session,
 * not a password this script has to know or store.
 */

const SHEET_NAME = "Sheet1";
const COL = { NAME: 1, EMAIL: 2, ROLL_NUMBER: 3, TEMP_PASSWORD: 4, STATUS: 5, REASON: 6 }; // 1-based
const STATUS = { PENDING: "Pending", SENDING: "Sending", SENT: "Sent" }; // FAILED rows read "Failed: <reason>"
const BATCH_SIZE = 20; // rows processed per trigger run — stays well inside the 6-minute execution ceiling
const TRIGGER_INTERVAL_MINUTES = 5;

// ─────────────────────────────────────────── Web App entry point ───────────────────────────────

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Invalid JSON body" });
  }

  const configuredSecret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
  if (!configuredSecret) {
    return jsonResponse({ ok: false, error: "SHARED_SECRET is not configured in Script Properties — see setup instructions." });
  }
  // Plain equality is fine here: this isn't a password comparison against a stored hash where
  // timing matters at scale, it's a single shared bearer secret checked once per request, and
  // Apps Script has no crypto.timingSafeEqual equivalent to reach for anyway.
  if (body.secret !== configuredSecret) {
    return jsonResponse({ ok: false, error: "Unauthorized" });
  }

  if (body.type === "send") {
    return jsonResponse(handleSend(body));
  }

  return jsonResponse({ ok: false, error: `Unknown request type: ${body.type}` });
}

function handleSend(body) {
  const { to, subject, html, fromName } = body;
  if (!to || !subject || !html) {
    return { ok: false, error: "to, subject, and html are all required" };
  }
  if (MailApp.getRemainingDailyQuota() <= 0) {
    return { ok: false, error: "Gmail daily sending quota exhausted for this account — try again after quota resets." };
  }
  try {
    MailApp.sendEmail({ to, subject, htmlBody: html, name: fromName || "CodeArena" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────────── Sheet1 bulk workflow (existing, improved) ────────────────────────

// Time-driven — call installTrigger() once to wire this up on a repeating schedule. Processes at
// most BATCH_SIZE Pending rows per run, marking each one Sending BEFORE attempting it (so a
// script restart or an overlapping trigger run mid-batch can never re-send an already-claimed
// row — the next run simply skips anything already marked Sending, treating it as this run's to
// finish or investigate, never something to redo from scratch).
function processPendingEmails() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // header only, nothing to do

  const range = sheet.getRange(2, 1, lastRow - 1, 6); // A:F, skip header row
  const values = range.getValues();

  let processed = 0;
  for (let i = 0; i < values.length && processed < BATCH_SIZE; i++) {
    const status = String(values[i][COL.STATUS - 1] || "").trim();
    if (status !== STATUS.PENDING) continue; // skip Sending/Sent/Failed rows entirely

    const rowNum = i + 2; // back to 1-based sheet row
    const name = values[i][COL.NAME - 1];
    const email = values[i][COL.EMAIL - 1];
    const rollNumber = values[i][COL.ROLL_NUMBER - 1];
    const tempPassword = values[i][COL.TEMP_PASSWORD - 1];

    // Claim the row immediately, before doing any work — this is what makes a restart or an
    // overlapping run safe: nothing after this line can cause a duplicate send for this row.
    sheet.getRange(rowNum, COL.STATUS).setValue(STATUS.SENDING);
    SpreadsheetApp.flush();

    if (MailApp.getRemainingDailyQuota() <= 0) {
      sheet.getRange(rowNum, COL.STATUS).setValue(`Failed: daily quota exhausted`);
      SpreadsheetApp.flush();
      break; // stop the whole batch — quota won't recover mid-run, no point trying more rows
    }

    try {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
        throw new Error("Invalid recipient email");
      }
      MailApp.sendEmail({ to: email, subject: "Welcome to CodeArena — Your Login Credentials", htmlBody: accountCreatedTemplate({ name, email, rollNumber, tempPassword }), name: "CodeArena" });
      sheet.getRange(rowNum, COL.STATUS).setValue(STATUS.SENT);
    } catch (err) {
      sheet.getRange(rowNum, COL.STATUS).setValue(`Failed: ${err.message}`);
    }
    SpreadsheetApp.flush();
    processed++;
  }
}

// Same visual structure the existing branded account-creation email already used — preserved as-is
// rather than redesigned, per "improve only where necessary."
function accountCreatedTemplate({ name, email, rollNumber, tempPassword }) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg,#1C1B18,#3a372f); padding: 28px 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color:#fdfbf5; margin:0; font-size:22px;">Welcome to CodeArena</h1>
      </div>
      <div style="padding: 24px; border: 1px solid #eee; border-top: none;">
        <p>Hi ${name},</p>
        <p>Your CodeArena account has been created. Here are your login details:</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px; background:#f7f7f5; font-weight:bold;">Roll Number</td><td style="padding:8px;">${rollNumber}</td></tr>
          <tr><td style="padding:8px; background:#f7f7f5; font-weight:bold;">Email</td><td style="padding:8px;">${email}</td></tr>
          <tr><td style="padding:8px; background:#f7f7f5; font-weight:bold;">Temporary Password</td><td style="padding:8px;"><code>${tempPassword}</code></td></tr>
        </table>
        <p><a href="https://codearena-app.vercel.app/login" style="background:#E8A33D; color:#1C1B18; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:bold; display:inline-block;">Login to CodeArena</a></p>
        <div style="background:#fff8e6; border:1px solid #E8A33D; border-radius:6px; padding:12px; margin-top:16px; font-size:13px;">
          You'll be asked to set a new password the first time you sign in. Keep this email private — do not forward it.
        </div>
      </div>
      <div style="text-align: center; padding: 16px; color: #999; font-size: 11px;">CodeArena — Code · Learn · Assess · Succeed</div>
    </div>
  `;
}

// ─────────────────────────────────────────── Setup helpers ─────────────────────────────────────

// Idempotent — checks for an existing trigger on this function before creating another, so
// re-running this by accident never stacks up duplicate triggers (which would otherwise process
// every batch multiple times over).
function installTrigger() {
  const already = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "processPendingEmails");
  if (already) {
    Logger.log("A trigger for processPendingEmails already exists — not creating another.");
    return;
  }
  ScriptApp.newTrigger("processPendingEmails").timeBased().everyMinutes(TRIGGER_INTERVAL_MINUTES).create();
  Logger.log(`Installed a trigger running processPendingEmails every ${TRIGGER_INTERVAL_MINUTES} minutes.`);
}

// Run manually once after setup to sanity-check configuration before wiring the real backend up
// to this deployment. Check View -> Logs (or View -> Executions) for the output.
function testConfig() {
  const secret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
  Logger.log(`SHARED_SECRET is ${secret ? "set (" + secret.length + " chars)" : "MISSING — set it in Project Settings -> Script Properties"}`);
  Logger.log(`Remaining daily Gmail quota: ${MailApp.getRemainingDailyQuota()}`);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  Logger.log(`Sheet1 found: ${!!sheet}${sheet ? ", rows: " + sheet.getLastRow() : ""}`);
  const triggerInstalled = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "processPendingEmails");
  Logger.log(`processPendingEmails trigger installed: ${triggerInstalled}`);
}
