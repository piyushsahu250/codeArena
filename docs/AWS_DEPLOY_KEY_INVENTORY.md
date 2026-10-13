# `codearena-deploy` access key: consumer inventory (read-only investigation, 2026-10-13)

Method: CloudTrail event history for the IAM user `codearena-deploy` (last 89 days; ap-south-1, us-east-1, us-east-2, us-west-2, eu-west-1; 1,140 events), the AWS credential stores and profile names on the authoring machine (names only), the repository and its workflows. No credential, secret or full access-key id was read or printed (key ids appear as a four-character suffix). Nothing was disabled, rotated, deleted or modified.

## 1. Summary

| Question | Finding |
|---|---|
| Which key? | One active key, suffix `..Y5FH`, created 2026-08-21. A different key id (`..W6ON`) appears on a single event on 2026-08-21 (`CreateServiceLinkedRole`, 14:22 UTC) and is unexplained; only one key exists now. |
| First / last observed use | 2026-08-21 07:45 UTC / **2026-09-11 08:09 UTC**. Zero events in the 33 days since. |
| Tooling | **100% `AWSPowerShell.Common`** (AWS Tools for PowerShell). No `aws-cli`, SDK, CI or browser user agents. |
| Where the key lives | On this Windows machine: the PowerShell AWS SDK credential store has profiles `codearena-deploy` and `default` (names only; the store file was last modified 2026-08-21). The AWS CLI credentials file does not exist; the CLI profiles are the new `codearena-admin` login and the logged-out `default`. |
| CI / repository | No workflow, script or document references the key or an AWS access key for deployment (`.github/workflows/*` use no AWS secrets; `keep-warm.yml` only calls the public health URL). The only AWS key in the repository's configuration is `QUESTION_IMAGES_AWS_*`, which belongs to the other user `codearena-question-images`. |
| Source IPs | 60+ distinct addresses in Indian ISP/mobile ranges (`152.56.x.x` about 80 percent, `103.112.9.x`, `136.233.205.186`, one `152.59.6.198`). The churn is what one operator on a mobile connection or rotating carrier addresses looks like. They cannot be tied to named machines from CloudTrail alone. |

## 2. Activity by kind

| Kind | Events | Dates | Notes |
|---|---|---|---|
| Routine deployment (`ssm:SendCommand` 369, `ListCommandInvocations`, `GetCommandInvocation`) | about 970 SSM events | 2026-09-06 to 2026-09-11 | All deploys and host commands in that window came through this key. |
| Read-only inspection (Describe/List/Get on EC2, RDS, CloudWatch, S3, Route 53, CloudFront, Budgets, Cost Explorer, Support) | about 120 | 2026-08-21 to 2026-09-11 | Audit-style calls. |
| Administrative: IAM | `PutRolePolicy` 12, `DeleteRolePolicy` 6, `AttachRolePolicy` 2, `CreateRole` 1, `CreateInstanceProfile` 1, `AddRoleToInstanceProfile` 1, `CreatePolicy` 1, `CreateUser` 4, `PutUserPolicy` 3, `CreateAccessKey` 2 | 2026-08-21 to 2026-09-11 | Building and later editing `codearena-ec2-role`, creating the question-images user and its key. Latest writes 2026-09-11. |
| Administrative: platform setup | `CreateDistribution` 6, `CreateOriginAccessControl`, `CreateResponseHeadersPolicy`, Route 53 health checks 3/2, `PutMetricAlarm` 5, budget and notification 6, SNS topic and subscription, `PutParameter` 4, `ModifyInstanceMetadataOptions` 2 | 2026-08-21 to 2026-09-11 | One-time infrastructure setup. |
| Administrative: S3 | `CreateBucket`, `PutBucketPublicAccessBlock`, `PutBucketEncryption`, `DeleteBucket` (one each) | 2026-09-11 | A bucket was created, hardened and a bucket deleted the same day. |
| Denied (AccessDenied 27) | `CreateUser` 4, `CreateAccessKey` 2, `PutUserPolicy` 3, `CreateDistribution` 6, `CreatePolicy` 1, `ListUsers` 4, `GetAccountSummary` 3, other IAM reads | various | The identity was already refused some IAM-user and CloudFront actions at times, which shows its permissions changed over its life. |

## 3. Unresolved or unattributed

1. **Who and which machine(s)** used the key cannot be proven from CloudTrail: every event is the same PowerShell user agent from rotating Indian carrier IPs. The key is stored on the owner's Windows machine, and PowerShell sessions on it are the most likely and only identified consumer. Confirm whether the key was ever copied to another computer, phone hotspot laptop, or shared.
2. The 27 denied calls show intent to do things this identity could not do at the time; they are not unauthorised evidence by themselves.
3. CloudTrail event history covers management events only and 90 days. Data-plane use (for example S3 object access) would not appear.
4. The `..W6ON` id on one event is unexplained beyond a short-lived or replaced key; check whether another copy of that older key survives anywhere.
5. The inventory covers this account's CloudTrail history. It cannot see use from outside CloudTrail (for example a key pasted into some other service's configuration that has not called AWS in 33 days).

## 4. What would break if `PowerUserAccess` and `CodeArenaDeployIAMScoped` were detached from `CodeArenaDeployers`

| Workflow (as observed) | Effect | Replacement |
|---|---|---|
| PowerShell sessions using profile `codearena-deploy` for deploys (`ssm:SendCommand`, results) | Stops: AccessDenied | Role `codearena-ssm-deploy` via `codearena-admin` with MFA (tested). |
| Read-only audits with that profile | Stops | `codearena-readonly-audit` (proposed). |
| IAM role/user/key changes, instance-role policy edits | Stops | `codearena-admin-ops` (proposed, with boundaries). |
| Budgets, alarms, SNS topics, scratch buckets | Stops | `codearena-admin-ops` (proposed). |
| CloudFront, Route 53 health checks, `ssm:PutParameter`, `ec2:ModifyInstanceMetadataOptions` | Stops; **not covered by any proposed role** | Decide per task: use a break-glass admin session, or add a reviewed role later. |
| The application, EC2 instance role, database, uploads (use `codearena-question-images` and the instance role), CI, Vercel, health checks | **No effect** | None needed. |

## 5. Migration recommendation per consumer

1. **This machine's PowerShell profile `codearena-deploy`.** Create AWS CLI/PowerShell profiles that assume `codearena-ssm-deploy` (`role_arn`, `source_profile=codearena-admin`, MFA via `aws login`) and use them for all deploys. After one successful deploy through the role, stop using the key. Remove the stored profile from the SDK store when the key is retired.
2. **Administrative tasks.** Use `codearena-admin-ops` only with a fresh MFA session (15 minutes); every call is attributable by session name in CloudTrail.
3. **Unattributed use.** Before retiring the key, ask the owner to confirm every device that might hold it. Then (separately approved) disable the key for one week; CloudTrail will show any consumer that breaks (`AccessDenied` or `InvalidClientTokenId` events), then delete it.
4. **Key retirement stays separate from policy detachment**, as the owner required.
