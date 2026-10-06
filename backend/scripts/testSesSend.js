// Sends one real test email through Amazon SES using the server's instance role.
// Run with the SES env set for this process only, e.g.:
//   docker exec -e MAIL_PROVIDER=ses -e MAIL_FROM=<verified sender> -e SES_CONFIGURATION_SET=codearena-default \
//     codearena-backend node scripts/testSesSend.js <recipient>
// (In the SES sandbox both sender and recipient must be verified identities.)
const { sendMail } = require("../src/utils/mailer");
(async () => {
  const to = process.argv[2];
  const r = await sendMail({ to, subject: "CodeArena SES test", html: "<p>This is a test email sent through <strong>Amazon SES</strong> from the CodeArena server. If you can read this, SES sending works.</p>" });
  console.log("RESULT", JSON.stringify({ ok: r.ok, messageId: r.messageId || null, error: r.error || null }));
  process.exit(0);
})();
