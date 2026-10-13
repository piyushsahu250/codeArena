# Migration plan for the setup operations done by `codearena-deploy` (PROPOSAL, not applied)

Purpose: remove the privilege-escalation path (`PowerUserAccess` + `CodeArenaDeployIAMScoped` on group `CodeArenaDeployers`) without locking anyone out. Nothing in this plan has been executed.
Source of the operation list: CloudTrail event history for the user `codearena-deploy`, last ~89 days (ap-south-1 and the us-east-1 global endpoint).
Companion documents: [AWS_DEPLOY_IDENTITY.md](AWS_DEPLOY_IDENTITY.md) (findings, deploy role, change log).

## 1. Operations performed with this identity and what happens to each

| Operation seen | Count | Classification | Replacement |
|---|---|---|---|
| `ssm:SendCommand`, `ListCommandInvocations`, `GetCommandInvocation` on the host | 12 / 20 | Routine deployment | Role `codearena-ssm-deploy` (created; live test pending MFA). |
| `ec2:Describe*`, `rds:DescribeDBInstances`, `cloudwatch:DescribeAlarms`, `s3:ListBuckets`/`GetBucket*`, Route 53 and CloudFront reads, `sts:GetCallerIdentity` | about 20 | Routine read-only inspection | New role `codearena-readonly-audit` with the AWS managed `ReadOnlyAccess` policy plus an explicit deny of `secretsmanager:GetSecretValue`, `ssm:GetParameter*`, `kms:Decrypt`, `s3:GetObject`. MFA-gated, 1 hour. |
| `iam:CreateUser` (3), `CreateAccessKey` (2), `PutUserPolicy` (2) | 7 | Administrative: identity and credential administration | Retire as a standing capability. Done by `codearena-admin` after MFA, through a new role `codearena-admin-ops` (see below), with a change recorded in `AWS_DEPLOY_IDENTITY.md`. |
| `iam:PutRolePolicy` (latest 2026-09-11), `DeleteRolePolicy`, `AttachRolePolicy`, `CreateRole`, `Get*`/`List*` on roles | about 18 | Administrative: instance-role policy management (this is the escalation path) | Same admin workflow. Keep the policy documents in the repository (`docs/aws/`), review them in a pull request, apply them as `codearena-admin-ops`. No identity used for deployments may hold these actions. |
| `budgets:CreateNotification`, `DescribeBudgets`, `sns:CreateTopic`, `Subscribe`, `cloudwatch:PutMetricAlarm` | about 15 | One-time setup | Retire. Future changes through `codearena-admin-ops`. |
| `s3:DeleteBucket` | 1 | Administrative, destructive | Retire from routine identities. Only `codearena-admin-ops`, with MFA. Recommend enabling bucket versioning and deletion protection on the data buckets so one call cannot destroy data. |

## 2. Roles to create (each behind MFA, 1 hour, assumable only by named users)

| Role | Permissions | Assumed by | Status |
|---|---|---|---|
| `codearena-ssm-deploy` | `CodeArenaSsmDeployOnly` (SSM on the one host, results, describe) | `codearena-admin` with MFA | created, live test pending |
| `codearena-readonly-audit` | `ReadOnlyAccess` plus the explicit secret-read deny | `codearena-admin` with MFA | proposed |
| `codearena-admin-ops` | `AdministratorAccess` limited to 1 hour, MFA age under 15 minutes | `codearena-admin` only | proposed; replaces standing admin use; the user keeps its console password but the day-to-day identity becomes the assumed role |

Why `codearena-admin` stays the operator: it is the only IAM user that will have MFA. Root (MFA enabled, no access keys) remains break-glass.

## 3. Sequence (each step verified before the next; none executed yet)

1. Owner adds MFA to `codearena-admin` (console) and confirms. No secret or recovery code is shared.
2. Live test of `codearena-ssm-deploy`: assume with MFA; `echo ok` through SSM on the host succeeds; SSM to any other instance, another document, `StartSession`, IAM changes, `AssumeRole`, S3, RDS and secrets are denied; the session ends after one hour; CloudTrail shows the assumed-role session for each call. Record only results.
3. Create and test `codearena-readonly-audit` and `codearena-admin-ops` the same way. Run one real administrative task through `codearena-admin-ops` (for example a read-only `iam list-roles`) to prove the workflow.
4. Inventory who else uses the `codearena-deploy` key: ask the owner which machines or CI jobs hold it; check CloudTrail `userAgent` and source IP for the key over the last 30 days.
5. Owner reviews this plan and gives final approval.
6. Detach exactly two policies from the group, nothing else: `arn:aws:iam::aws:policy/PowerUserAccess` and `arn:aws:iam::640538431170:policy/CodeArenaDeployIAMScoped` from `CodeArenaDeployers`.
7. Verify: simulator shows the `codearena-deploy` user is denied `iam:AttachRolePolicy`, `PutRolePolicy`, `ssm:SendCommand`; the deploy role and the admin role still work; a production health check is unchanged.
8. Retire the key separately and later: disable (not delete), wait a week, then delete, each with its own approval.

## 4. Expected impact of step 6

* `codearena-deploy` and its access key can no longer run SSM, describe resources, create IAM identities, change role policies, or delete buckets. Anything that still uses that key (a laptop profile, a script) will fail with `AccessDenied`; step 4 is meant to find those first.
* The application, the EC2 instance role, the database, S3 uploads (they use `codearena-question-images` and the instance role) and all running services are unaffected.
* The group `CodeArenaDeployers` stays (empty) so the policies can be re-attached.

## 5. Tested recovery path (keep before step 6)

* Root login with MFA, or `codearena-admin` (MFA) assuming `codearena-admin-ops`.
* Revert step 6: `aws iam attach-group-policy --group-name CodeArenaDeployers --policy-arn arn:aws:iam::aws:policy/PowerUserAccess` and `aws iam attach-group-policy --group-name CodeArenaDeployers --policy-arn arn:aws:iam::640538431170:policy/CodeArenaDeployIAMScoped`.
* Remove a faulty new role: `aws iam detach-role-policy` then `aws iam delete-role` (nothing else depends on the new roles).
* The host stays reachable independently of all of this: the EC2 instance role carries `AmazonSSMManagedInstanceCore`, so SSM keeps working for any identity that is allowed to call it.
