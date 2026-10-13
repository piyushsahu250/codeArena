# AWS hardening and release: audit record (2026-10-13)

Identities used: `codearena-admin` (IAM user, passkey MFA) for IAM/CloudTrail reads; `codearena-ssm-deploy` (assumed with MFA) for every command run on the host. Root was not used for this work. No secret, parameter value or access-key value was read or recorded.

## Phase 1: baseline (read-only): PASS

* Release candidate: `77d289b5e2899dd8b0b97b0cb4818c2388ecf372` is the tip of `origin/main`; `d82db9f` is its ancestor; the range holds three commits (`d2d4767` login validation and schema-guard wording and tests, `57c4708` and `77d289b` docs). Required CI checks (lint, backend, frontend, integration) green for that exact SHA. Worktree clean except one untracked, unrelated spreadsheet (not touched, not to be committed).
* Production: host HEAD `d82db9f`, health `{"status":"ok","commit":"d82db9f"}`, running image `9ce648b43829`, read through the deploy role.
* AWS: account `640538431170`, region `ap-south-1`, caller `user/codearena-admin`.
* IAM baseline: `CodeArenaDeployers` = `PowerUserAccess` + `CodeArenaDeployIAMScoped`; `CodeArenaAdmins` = `AdministratorAccess`; roles `codearena-ec2-role`, `codearena-ssm-deploy`; customer policies `CodeArenaDeployIAMScoped`, `CodeArenaSsmDeployOnly`; no permissions boundary on any user or on `codearena-ec2-role`; host instance profile `codearena-ec2-profile`; MFA device on `codearena-admin`.
* New observation: a second instance, `i-075147bbdfea613de` (t3.micro, launched 2026-09-29), is **stopped** and carries the same instance profile. It is not the production host. If it is ever started it runs with the same role.

## Phase 2: consumers of `codearena-deploy`: PARTIAL, key removal BLOCKED

Confirmed consumer: PowerShell sessions on the owner's Windows machine using the stored profile `codearena-deploy` (AWS Tools for PowerShell; all 1,140 CloudTrail events share that user agent; the project memory notes confirm earlier assistant sessions used it for deployments). Last use 2026-09-11; none since. No CI workflow, scheduled task, or local script references it. Unresolved: whether any other computer holds a copy; GitHub Actions secret names cannot be listed without repository admin authentication (NOT TESTED, though no workflow references any AWS secret). See [AWS_DEPLOY_KEY_INVENTORY.md](AWS_DEPLOY_KEY_INVENTORY.md). Revocation stays BLOCKED until the owner confirms the device list.

## Phase 3: SSM parameter usage before boundaries: PASS for compatibility, attachment NEEDS APPROVAL

* Repository: no code, workflow or script reads SSM or Secrets Manager. The reads come from two scripts that live **only on the host**, outside version control: `/root/backup-db.sh` (cron daily 20:00 UTC; reads `/DIRECT_DATABASE_URL`, then `aws s3 cp` and `head-object` on the backups bucket) and `/root/deploy-backend.sh` (older deploy helper; reads parameters by name through a function; last modified 2026-09-30).
* CloudTrail, 89 days, calls made by `codearena-ec2-role`: 24 distinct parameters read, all inside the documented allowlist (`/DATABASE_URL`, `/DIRECT_DATABASE_URL`, `/MAIL_USER`, `/MAIL_PASSWORD`, `/MAIL_FROM`, `/PII_ENCRYPTION_KEY`, `/RDS_MASTER_PASSWORD`, and 17 under `/codearena/prod/`), plus the one secret `codearena/backend/secrets` (last read 2026-08-30) and 695 KMS `Decrypt` calls with the `PARAMETER_ARN` / `SecretARN` context. No `GetParametersByPath` or `GetParameters` call was seen. Two `AccessDenied` on the secret date from 2026-08-24, before its policy existed.
* The role's current access is wider than documented: `AmazonSSMManagedInstanceCore` itself grants `ssm:GetParameter`, so today the role can read any parameter in the account. Never read in 89 days and not in the allowlist: `NEON_DATABASE_URL_BACKUP`, `NEON_DIRECT_DATABASE_URL_BACKUP`, `RDS_DATABASE_URL`, `RDS_DIRECT_DATABASE_URL`.
* IAM simulator, 24 of 24 observed parameter reads, the secret read, and the backup job's `s3:PutObject` and `s3:GetObject`: allowed with and without `CodeArenaEc2RoleBoundary`. Earlier 32-action test: nothing allowed today is blocked except unlisted parameter reads.
* Caveats: CloudTrail history is 89 days; the legacy host script builds names dynamically (observed names cover it); runtime paths not exercised in the window are unknown; the two missing-from-the-record items are the unread NEON/RDS parameters, which the boundary would block, which is intended.

## Phase 4: role design review: PASS (design); creation NEEDS APPROVAL

See [AWS_REPLACEMENT_ROLES_DESIGN.md](AWS_REPLACEMENT_ROLES_DESIGN.md). Access Analyzer: no findings on 7 identity policies and 2 trust documents. Deploy role live-tested (`AWS_DEPLOY_IDENTITY.md` section 6). Nothing from the audit, admin-ops or boundary designs exists in AWS.

## Phase 5: detaching `PowerUserAccess` and `CodeArenaDeployIAMScoped`: NEEDS APPROVAL (not done)

Both are attached to the group `CodeArenaDeployers`, whose only member is `codearena-deploy`. The new deploy path (role plus MFA) is proven. The admin and audit replacement roles do not exist yet, and consumer confirmation is open, so detaching now would remove the only working path for infrastructure changes. Order required: roles created and tested, consumer confirmation, then one detachment at a time with the documented re-attach rollback.

## Phase 6: release gate (read-only part): PASS so far

* Diff from `d82db9f`: seven non-doc files; `schema.prisma`, dependencies and environment unchanged; no IAM change in the repository; no secret in the diff.
* `scripts/schema-guard-summary.sh` now describes the nine ignored trigram `DROP INDEX` statements accurately; tests (`backend/test/schemaGuardSummary.test.js`) pass in CI. The destructive-change check is unchanged. `addSearchIndexes.js` was read: it recreates the nine indexes idempotently at every boot.
* Login: malformed bodies now return 400 with a fixed message; wrong password, unknown email and missing password still return 401 (unit tests and the contract snapshot, green in CI). It is in the release scope.
* Deployment identity: every host command in this audit ran as `assumed-role/codearena-ssm-deploy`, not root and not a personal key.
* The deploy script has no dry-run mode, so none was claimed. Its non-mutating gates were exercised separately: release gate (`check-ci-green.sh`, all four checks green), schema diff (read-only, earlier).
* Trigram OIDs: baseline recorded 38696 to 38704 (2026-10-13 04:48 UTC). The mandatory capture happens immediately before the deploy, after approval.
