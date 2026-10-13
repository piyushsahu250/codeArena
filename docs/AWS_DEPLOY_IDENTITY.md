# AWS deployment identity: findings and a least-privilege design (nothing here has been applied)

Read-only audit of 2026-10-13. No key was disabled, rotated or deleted, no policy or trust relationship was changed, and no key material was read or printed (key ids appear only as a four-character suffix).

## 1. What exists today

| Identity | Findings |
|---|---|
| Root | Used by the interactive `aws login` session that ran the 2026-10-13 deployment. Root MFA is enabled; no root access keys exist. CloudTrail (ap-south-1 event history, last 7 days, first 50 events) shows only SSM calls from that session. |
| `codearena-deploy` (IAM user) | One active access key (suffix `..Y5FH`, created 2026-08-21). **Last used 2026-09-11 08:09 UTC, service `ssm`, region ap-south-1**: it has been used for deployments, so it must not be called unused. No MFA device. Member of group `CodeArenaDeployers`, which carries **`PowerUserAccess`** plus the customer policy `CodeArenaDeployIAMScoped`. |
| `CodeArenaDeployIAMScoped` | Allows creating, deleting and **attaching or putting policies on any role or instance profile named `codearena-*`**, and passing them to EC2. Combined with `PowerUserAccess` this lets the holder grant `AdministratorAccess` to `codearena-ec2-role` and then act through the instance: an indirect privilege-escalation path. |
| `codearena-question-images` (IAM user) | One active key (suffix `..4AUH`, created 2026-09-12). **Last used 2026-09-12 07:28 UTC, service `s3`, ap-south-1.** Inline policy `QuestionImagesBucketAccess`: Put/Get/DeleteObject and ListBucket on one bucket only. This is already narrow. No MFA, no group. |
| `codearena-admin` (IAM user) | Console password last used 2026-08-21; group `CodeArenaAdmins` = `AdministratorAccess`; **no MFA device**. No access key. |
| `codearena-ec2-role` (instance profile `codearena-ec2-profile`) | `AmazonSSMManagedInstanceCore`, `CloudWatchAgentServerPolicy`, inline `codearena-secrets-read`, `ReadCodeArenaSSMParams`, `SendEmailViaSES`, `WriteCodeArenaBackupsBucket`. Instance metadata requires tokens (IMDSv2). |
| IAM Identity Center | `sso-admin list-instances` returned no instance in ap-south-1: not enabled there. |

Why this matters: running a command through SSM on this host runs as root on the host, which holds `container.env`. So the SSM permission itself is highly privileged; the aim is to restrict **which host, which document and who**, add MFA and an audit trail, and remove the surrounding privilege (`PowerUserAccess`, role attachment rights, root).

## 2. Design: a role used only for deploys

Role `codearena-ssm-deploy` with the permission policy in [aws/codearena-ssm-deploy-policy.json](aws/codearena-ssm-deploy-policy.json):

* `ssm:SendCommand` only on instance `i-02bedc5ba41539f46` and the document `AWS-RunShellScript` (the two resource ARNs `SendCommand` evaluates).
* `ssm:GetCommandInvocation`, `ListCommands`, `ListCommandInvocations`, `DescribeInstanceInformation`: these do not support resource-level restriction, so they are `*` limited to region ap-south-1.
* `ec2:DescribeInstances` (read-only) for the host status checks the deploy procedure uses.
* Nothing else: no IAM, no S3, no RDS, no other instances, no `ssm:StartSession`. The region is pinned by the instance ARN for `SendCommand` and by an `aws:RequestedRegion` condition on the read actions.

Trust policy ([aws/codearena-deploy-role-trust-policy.json](aws/codearena-deploy-role-trust-policy.json)): assumable only by one named operator IAM user (replace the placeholder), only with MFA present and an MFA age under one hour; set the role's maximum session duration to 1 hour.
If IAM Identity Center is enabled later, replace the trust policy with a permission set carrying the same policy and a 1-hour session.

Stronger variant (recommended after the first role works): create a custom SSM Command document `CodeArena-Deploy` whose only content is `cd /opt/codearena && git pull --ff-only origin main && bash scripts/deploy-aws-host.sh`
and allow `ssm:SendCommand` on that document instead of `AWS-RunShellScript`. The deployment role then cannot run arbitrary commands, and a separate read-only role (document `CodeArena-ReadOnlyChecks`) covers the audits.

## 3. Verification steps once the role exists (run by you or with your explicit approval)

1. `aws sts assume-role --role-arn <role> --role-session-name verify --serial-number <mfa> --token-code <code>`; confirm `aws sts get-caller-identity` shows the assumed role and not root.
2. Allowed: `aws ssm send-command` with `AWS-RunShellScript` and the command `echo ok` to `i-02bedc5ba41539f46`; `get-command-invocation` returns `ok`; `describe-instances` works.
3. Denied (expect `AccessDenied`): `send-command` to any other instance id; a different document; `ssm start-session`; `ec2 stop-instances`; `iam list-roles`; `s3 ls`; any call in another region.
4. Dry check without calling the services: `aws iam simulate-principal-policy --policy-source-arn <role> --action-names ssm:SendCommand ec2:StopInstances iam:AttachRolePolicy --resource-arns <instance arn>`.
5. CloudTrail shows the assumed-role session name for each deploy; add an alarm for `ConsoleLogin` by root and for `iam:AttachRolePolicy`/`PutRolePolicy`.

## 4. Key and group review (decisions for you; nothing was changed)

1. `codearena-deploy`: it is in use. Once the role works, **detach `PowerUserAccess` and `CodeArenaDeployIAMScoped` from `CodeArenaDeployers`** (or delete the group) and move the key's job to the role. Before disabling the key, confirm nothing else runs with it (CI, laptops); last-used shows only the most recent use. Rotate rather than delete: create a new key, switch, disable the old key for a week, then delete.
2. `CodeArenaDeployIAMScoped`: remove, or restrict `AttachRolePolicy`/`PutRolePolicy` with a permissions boundary or an `iam:PolicyARN` condition limited to the exact policies the roles legitimately need.
3. `codearena-admin`: add an MFA device now (it is an AdministratorAccess user without MFA); prefer assuming an admin role over standing admin rights.
4. `codearena-question-images`: scope is already one bucket; keep, rotate on a schedule, and prefer an instance role if the application runs only on the EC2 host.
5. Root: keep MFA on, no access keys, use only for break-glass; the 2026-10-13 deployment should have used an assumed role once one exists.

Do not rotate, disable or delete anything without a separate explicit approval for that exact key.

## 5. Change log: what was actually applied on 2026-10-13 (approved by the owner)

Identity used: the interactive root session (account 640538431170, region ap-south-1, host `i-02bedc5ba41539f46`). Recovery paths confirmed before any change: root MFA enabled (no root access keys), the `codearena-admin` console login, and the unchanged EC2 instance role / SSM agent.

| # | Change | Result |
|---|---|---|
| 1 | `chmod 600 /opt/codearena/container.env.bak-1791195875` (via SSM; contents never read) | mode 644 -> 600, owner stays `root:root`, size and mtime unchanged; the other three variants were already 600; health unchanged on `d82db9f`. No restart. |
| 2 | Created managed policy `CodeArenaSsmDeployOnly` (v1) from `aws/codearena-ssm-deploy-policy.json` | created |
| 3 | Created role `codearena-ssm-deploy`, max session 3600 s, trust: only `user/codearena-admin`, only with MFA present and MFA age under 3600 s; attached the policy above; no inline policies | created |

Validation by the IAM policy simulator (no live calls): `ssm:SendCommand` on the host plus `AWS-RunShellScript` is allowed; the same on another instance, or with another document, is implicitly denied; the read actions are allowed; `iam:AttachRolePolicy`, `PutRolePolicy`, `CreateRole`, `CreateAccessKey`, `PassRole`, `CreatePolicyVersion`, `sts:AssumeRole`, `ssm:StartSession`, `ec2:StopInstances`/`TerminateInstances`, `s3:*`, `rds:DeleteDBInstance`, `secretsmanager:GetSecretValue` and `ssm:GetParameter` are all implicitly denied. The new role cannot escalate by attaching policies.

Escalation path that still exists (not yet removed): the simulator shows the current `codearena-deploy` user is **allowed** `iam:AttachRolePolicy` and `iam:PutRolePolicy` on `codearena-ec2-role` and on the new role (via `CodeArenaDeployIAMScoped`). It is denied `UpdateAssumeRolePolicy`, `CreateAccessKey`, `AttachUserPolicy` and `CreateUser`.

Not done, and why:

| Step | Status |
|---|---|
| Live test of the role (assume with MFA, `echo ok` through SSM, denials) | BLOCKED: the role requires MFA and `codearena-admin` has no MFA device. Adding one needs the owner's authenticator app. |
| MFA on `codearena-admin` | BLOCKED: owner action (console: IAM > Users > codearena-admin > Security credentials > Assign MFA device). The seed was deliberately not generated or handled here. |
| Detach `PowerUserAccess` and `CodeArenaDeployIAMScoped` from `CodeArenaDeployers` | NOT DONE, held back deliberately: after the live test, and because CloudTrail shows that `codearena-deploy` was also used for infrastructure setup, not only SSM (see below). |

CloudTrail (last ~89 days, event history) for `codearena-deploy`: routine deployment use is 12 `SendCommand` and 20 `ListCommandInvocations` calls in ap-south-1. It was also used for setup work: IAM (`CreateUser` x3, `CreateAccessKey` x2, `PutUserPolicy` x2, `PutRolePolicy` and `DeleteRolePolicy` on instance-role policies, last write 2026-09-11), budgets and SNS alarms, a CloudWatch alarm, S3 bucket checks and one `DeleteBucket`, Route 53/CloudFront reads. Detaching the two policies will end that ability for this key; any future infrastructure work then needs the admin role or the owner's admin login.

Audited recovery procedure: if the deploy role is locked out or misconfigured, sign in as root (MFA enabled) or `codearena-admin`, then `aws iam detach-role-policy` / `delete-role` for `codearena-ssm-deploy` and `delete-policy` for `CodeArenaSsmDeployOnly`; nothing else depends on them. To restore the group's old permissions if step 7 is later taken and needs to be reverted: `aws iam attach-group-policy --group-name CodeArenaDeployers --policy-arn arn:aws:iam::aws:policy/PowerUserAccess` and `--policy-arn arn:aws:iam::640538431170:policy/CodeArenaDeployIAMScoped`.
