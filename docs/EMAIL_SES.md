# Amazon SES for platform email

Why: the old transport was a personal Gmail account (~500 emails/day, login throttling). Two bulk student
uploads on 2026-10-06 left ~227 students with accounts but no delivered password. SES removes both limits.

## State (ap-south-1, account 640538431170)
- Code: `utils/mailer.js` supports `MAIL_PROVIDER=ses` (AWS SDK, auth via the EC2 instance role -- no mail
  password or keys stored). Default stays SMTP until the switch below.
- IAM: inline policy `SendEmailViaSES` on role `codearena-ec2-role` (ses:SendEmail/SendRawEmail only).
- SES: domain identity `codearena.site` (Easy DKIM), configuration set `codearena-default`,
  sandbox test identity `breathe122025@gmail.com`.
- Production access requested (TRANSACTIONAL). Until AWS approves it the account is in the SANDBOX:
  200 emails/day, 1/sec, and delivery ONLY to verified addresses -- do not switch over before approval.

## DNS records to add at GoDaddy (DNS is `ns31/ns32.domaincontrol.com`)
Type CNAME, three records (Name -> Value):
  `<token>._domainkey` -> `<token>.dkim.amazonses.com`
Tokens: see `aws sesv2 get-email-identity --email-identity codearena.site --region ap-south-1`
(DkimAttributes.Tokens). In GoDaddy the Name is the part before `.codearena.site`.
Recommended (not required) TXT: Name `_dmarc`, Value `v=DMARC1; p=none; rua=mailto:<your address>`.

## Go-live checklist
1. DNS records added -> `get-email-identity codearena.site` shows `VerifiedForSendingStatus: true`, Dkim `SUCCESS`.
2. AWS approves production access (`aws sesv2 get-account` -> `ProductionAccessEnabled: true`). Note `Max24HourSend`/`MaxSendRate`.
3. Test: `docker exec -e MAIL_PROVIDER=ses -e MAIL_FROM=no-reply@codearena.site -e SES_CONFIGURATION_SET=codearena-default codearena-backend node scripts/testSesSend.js <you>`
4. In `/opt/codearena/container.env` set:
   `MAIL_PROVIDER=ses`, `MAIL_FROM=no-reply@codearena.site`, `SES_CONFIGURATION_SET=codearena-default`,
   `MAIL_RATE_PER_SEC=<a bit under MaxSendRate, e.g. 10>`; leave the old MAIL_HOST/USER/PASSWORD in place as a fallback.
5. Redeploy (`scripts/deploy-aws-host.sh`), check Admin > Email Logs status, then run
   `node scripts/resendFailedCredentials.js 25 30` to deliver the undelivered student credentials.
Rollback: remove `MAIL_PROVIDER` (or set it to `smtp`) and redeploy.
