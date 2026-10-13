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
* Nothing else: no IAM, no S3, no RDS, no other instances, no other regions, no `ssm:StartSession`.

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
