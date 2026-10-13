# Replacement roles: exact least-privilege policy design (PROPOSAL, nothing created)

Status: design for review. **No role, policy, boundary or trust document below has been created in AWS.** Every policy was checked read-only with IAM Access Analyzer (`validate-policy`): zero findings each, after two fixes found by that tool (nonexistent `budgets:CreateBudget`/`DeleteBudget` removed; the admin-ops session-name wildcard lengthened).
Companion documents: [AWS_ADMIN_OPERATIONS_PLAN.md](AWS_ADMIN_OPERATIONS_PLAN.md), [AWS_DEPLOY_KEY_INVENTORY.md](AWS_DEPLOY_KEY_INVENTORY.md), [AWS_DEPLOY_IDENTITY.md](AWS_DEPLOY_IDENTITY.md). The JSON files are in `docs/aws/roles/` and reproduced in the appendix.

## 1. The design in one table

| Role | Purpose | Who can assume it | Session | Policies |
|---|---|---|---|---|
| `codearena-ssm-deploy` (exists, tested) | routine deploys through SSM | `user/codearena-admin`, MFA, MFA age under 1 h | 1 h | `CodeArenaSsmDeployOnly` |
| `codearena-readonly-audit` (proposed) | inventory and audits | `user/codearena-admin`, MFA, MFA age under 1 h, session name `audit-*` | 1 h | `CodeArenaAuditReadOnly` |
| `codearena-admin-ops` (proposed) | the migrated administrative workflows, with guardrails | `user/codearena-admin`, MFA, **MFA age under 15 min**, session name `admin-ops-*` | 1 h | `CodeArenaAdminOpsIamUsers`, `CodeArenaAdminOpsInstanceRole`, `CodeArenaAdminOpsServices`, `CodeArenaAdminOpsGuardrails` |
| `CodeArenaEc2RoleBoundary` (proposed boundary) | caps `codearena-ec2-role` | n/a (permissions boundary) | n/a | one policy |
| `CodeArenaServiceUserBoundary` (proposed boundary) | caps every `codearena-*` service user | n/a | n/a | one policy |

Region: regional services are restricted to ap-south-1 and us-east-1 (us-east-1 is also where IAM, Budgets, CloudFront and Route 53 are reached). Resource ARNs pin ap-south-1 where a resource has a region.

## 2. `codearena-readonly-audit`

Allows metadata only: IAM Get/List (users, groups, roles, policies, key last-used, MFA devices, `SimulatePrincipalPolicy`), CloudTrail lookup, EC2/RDS/CloudWatch/SNS/SES/SSM `Describe*`/`List*` inventory, S3 bucket configuration (not objects), Route 53 and CloudFront lists, Budgets view, Cost Explorer, ACM list. It deliberately excludes `ssm:GetCommandInvocation` (command output can contain secrets), CloudWatch log events and every secret or parameter read.
Explicit Deny on top of the allow-list: `secretsmanager:*`, `kms:Decrypt`, `ssm:GetParameter*`, `ssm:SendCommand`, `ssm:StartSession`, `s3:GetObject*`, `s3:PutObject`, `s3:DeleteObject*`, log reads, `sts:AssumeRole`, `iam:PassRole`, `iam:CreateAccessKey`.
CloudTrail visibility: every call carries the session name `audit-<purpose>`; the trust policy forces the prefix.
Escalation analysis: it has no write or credential action, cannot assume another role and cannot read secrets. `iam:GetLoginProfile` and `GetAccessKeyLastUsed` return metadata only. Result: **no escalation path**.

## 3. `codearena-admin-ops`

Workflows covered (from `AWS_ADMIN_OPERATIONS_PLAN.md`) and how each is scoped:

| Workflow | Allowed | Scope and guard |
|---|---|---|
| IAM user and key administration | `CreateUser`, `TagUser`, `PutUserPermissionsBoundary`, `Put/Delete/Attach/DetachUserPolicy`, `Create/Update/DeleteAccessKey`, `DeleteUser`, reads | only `user/codearena-*`; users can only be created with, or have policies edited while carrying, `CodeArenaServiceUserBoundary` (`iam:PermissionsBoundary` condition); **`user/codearena-admin` is explicitly denied** every write, so this role can never mint a key or password for the human administrator |
| EC2 instance-role policy changes | `Put/DeleteRolePolicy` and `Attach/DetachRolePolicy` on `role/codearena-ec2-role` only | allowed only while that role carries `CodeArenaEc2RoleBoundary`; attaches limited to the two AWS managed policies it already uses; `PutRolePermissionsBoundary`/`DeleteRolePermissionsBoundary` denied, so the cap cannot be lifted from here |
| Budget and alarm configuration | `budgets:ViewBudget`/`ModifyBudget` on `CodeArena-*`, `cloudwatch:PutMetricAlarm`/`DeleteAlarms`/enable/disable on `alarm:codearena-*`, SNS topic create/delete/attributes/subscribe on `codearena-*` topics | name-prefix scoped, regions ap-south-1 and us-east-1 |
| S3 bucket deletion | `s3:DeleteBucket` and create/harden only on `arn:aws:s3:::codearena-tmp-*` | the two data buckets (`codearena-backups-...`, `codearena-question-images-...`) carry an explicit Deny on delete, policy, lifecycle, versioning and public-access changes: **deleting a data bucket is not possible from this role** (it needs root or a separately reviewed policy change) |

Guardrails (explicit Deny, evaluated before any allow): no attach of `AdministratorAccess`, `PowerUserAccess`, `IAMFullAccess`, `job-function/*` or `CodeArenaDeployIAMScoped`; no change to this role, the deploy role or the audit role (inline or attached policies, trust, tags, deletion, boundaries); no `UpdateAssumeRolePolicy`, `CreateRole`, `DeleteRole`, `PassRole`, `CreateServiceLinkedRole` anywhere; no create, modify or delete of policies or policy versions (so the boundaries are immutable from here); no `sts:AssumeRole`; no new groups, group membership, OIDC/SAML providers or password-policy changes; no secret, parameter, command or object reads; no `StopInstances`, `TerminateInstances`, `ModifyDBInstance`, `DeleteDBInstance`.
CloudTrail visibility: the session name `admin-ops-<task>` is enforced by the trust policy; 15-minute MFA freshness means a human approved each session; every IAM change is a management event.
Not covered, deliberately (all seen in the key's history): CloudFront, Route 53 health checks, `ssm:PutParameter`, `ec2:ModifyInstanceMetadataOptions`. They are rarely needed and individually powerful; each should be a separate reviewed request or a break-glass session.

### Escalation analysis

| Permission | Risk | Mitigation |
|---|---|---|
| `PutRolePolicy` on `codearena-ec2-role` | the instance could be given anything | the role must carry `CodeArenaEc2RoleBoundary`; the boundary allows only today's actions (verified by the simulator, section 5); the boundary cannot be removed or edited by this role |
| `PutUserPolicy`/`CreateAccessKey` on service users | broad rights, or a key for a more powerful user | boundary condition on every write; only `codearena-*` service users are in scope; the human admin is denied |
| `CreateUser` | a new powerful user | only with the boundary, which denies `iam:*` and `sts:AssumeRole` |
| Deleting alarms or topics | blinding monitoring | recoverable and CloudTrail-visible; the guardrails cannot prevent it; accepted |
| Budget changes | silencing cost alerts | same; accepted |
| The boundary policies themselves | they are the root of trust | created and changed only by root or a deliberate, separately approved admin session; this role is denied policy writes |

Residual risk: whoever can assume `codearena-admin-ops` (only `codearena-admin` with a fresh MFA) can still change the instance role within the boundary, which includes reading the production secrets the application reads. That is unavoidable for the application and is why the role is MFA-fresh, named and audited.

## 4. The two boundary policies

* `CodeArenaEc2RoleBoundary`: SSM agent and session transport, CloudWatch agent, the one application secret and exactly the SSM parameters in today's inline policy, `kms:Decrypt`, SES send, read and write on the backups bucket. Deny: `iam:*`, `sts:AssumeRole`, `organizations:*`, `account:*`, S3 deletes, `RunInstances`, `TerminateInstances`.
* `CodeArenaServiceUserBoundary`: the question-images bucket, `SendCommand` on the one host with `AWS-RunShellScript`, SSM results, `ec2:DescribeInstances`. Deny: IAM, `AssumeRole`, Organizations, Account, Budgets, secrets, `kms:Decrypt`, `ssm:GetParameter*`, `StartSession`.

## 5. Evidence gathered read-only

* Access Analyzer `validate-policy` on all seven identity policies and both trust documents: no findings after the two fixes above.
* **Boundary impact test** (IAM policy simulator, `codearena-ec2-role`, 32 actions with and without `CodeArenaEc2RoleBoundary`): all 27 actions the role is allowed today stay allowed under the boundary; `iam:CreateUser`, `iam:AttachRolePolicy`, `s3:DeleteObject` and `ec2:RunInstances` become explicit denies. **One difference, and it is a finding**: the role is allowed today to read an SSM parameter outside the documented list (`parameter/other/unlisted`), so its effective access is wider than its documented intent. The boundary would remove that. **Before applying the boundary, confirm the application and the CloudWatch agent read no other parameters** (for example CloudTrail `GetParameter` events by the instance role over 30 days).
* Live-test results of the existing deploy role are in `AWS_DEPLOY_IDENTITY.md` section 6.

## 6. Exact IAM operations that will need your separate approval later

None of these has been run. Each lists the object and the reversal.

1. Create managed policies `CodeArenaAuditReadOnly`, `CodeArenaAdminOpsIamUsers`, `CodeArenaAdminOpsInstanceRole`, `CodeArenaAdminOpsServices`, `CodeArenaAdminOpsGuardrails` (revert: `delete-policy`).
2. Create the boundary policies `CodeArenaEc2RoleBoundary` and `CodeArenaServiceUserBoundary` (revert: `delete-policy`). Done by root or an explicit one-off admin session.
3. Create roles `codearena-readonly-audit` and `codearena-admin-ops` with the trust documents and session length 3600 s, and attach their policies (revert: `detach-role-policy`, `delete-role`).
4. Apply `CodeArenaServiceUserBoundary` to `codearena-deploy` and `codearena-question-images` (`put-user-permissions-boundary`; revert `delete-user-permissions-boundary`).
5. Apply `CodeArenaEc2RoleBoundary` to `codearena-ec2-role` (`put-role-permissions-boundary`; revert `delete-role-permissions-boundary`), only after the parameter-read check above. This is the one step that can affect production behaviour.
6. Detach `PowerUserAccess` and `CodeArenaDeployIAMScoped` from `CodeArenaDeployers` (revert: `attach-group-policy`).
7. Later and separate: disable, then delete, the `codearena-deploy` key; remove the stored PowerShell profile.
8. Not part of this design but recommended: versioning and deletion protection on the two data buckets.

## Appendix: the exact documents

### codearena-readonly-audit.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IdentityMetadataReadOnly",
      "Effect": "Allow",
      "Action": [
        "iam:GetAccountSummary", "iam:GetAccountPasswordPolicy", "iam:GetUser", "iam:GetGroup", "iam:GetRole",
        "iam:GetPolicy", "iam:GetPolicyVersion", "iam:GetUserPolicy", "iam:GetGroupPolicy", "iam:GetRolePolicy",
        "iam:GetAccessKeyLastUsed", "iam:GetLoginProfile",
        "iam:ListUsers", "iam:ListGroups", "iam:ListRoles", "iam:ListPolicies", "iam:ListPolicyVersions",
        "iam:ListAttachedUserPolicies", "iam:ListAttachedGroupPolicies", "iam:ListAttachedRolePolicies",
        "iam:ListUserPolicies", "iam:ListGroupPolicies", "iam:ListRolePolicies", "iam:ListGroupsForUser",
        "iam:ListAccessKeys", "iam:ListMFADevices", "iam:ListInstanceProfiles", "iam:ListEntitiesForPolicy",
        "iam:SimulatePrincipalPolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AuditTrailRead",
      "Effect": "Allow",
      "Action": ["cloudtrail:LookupEvents", "cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:GetEventSelectors"],
      "Resource": "*"
    },
    {
      "Sid": "RegionalInventoryReadOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances", "ec2:DescribeInstanceStatus", "ec2:DescribeVolumes", "ec2:DescribeSnapshots",
        "ec2:DescribeSecurityGroups", "ec2:DescribeAddresses", "ec2:DescribeNetworkInterfaces", "ec2:DescribeTags",
        "rds:DescribeDBInstances", "rds:DescribeDBSnapshots", "rds:DescribeDBClusters", "rds:ListTagsForResource",
        "cloudwatch:DescribeAlarms", "cloudwatch:DescribeAlarmHistory", "cloudwatch:GetMetricData", "cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics",
        "logs:DescribeLogGroups", "logs:DescribeLogStreams",
        "sns:ListTopics", "sns:GetTopicAttributes", "sns:ListSubscriptionsByTopic",
        "ssm:DescribeInstanceInformation", "ssm:ListCommands", "ssm:ListCommandInvocations",
        "ses:GetAccount", "ses:GetSendQuota", "ses:GetSendStatistics", "ses:ListIdentities"
      ],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": ["ap-south-1", "us-east-1"] } }
    },
    {
      "Sid": "GlobalServicesReadOnly",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets", "s3:GetBucketLocation", "s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock",
        "s3:GetEncryptionConfiguration", "s3:GetBucketPolicyStatus", "s3:GetBucketTagging", "s3:GetLifecycleConfiguration",
        "route53:ListHostedZones", "route53:ListResourceRecordSets", "route53:ListHealthChecks", "route53:GetHealthCheckStatus",
        "cloudfront:ListDistributions", "cloudfront:GetDistribution",
        "budgets:ViewBudget", "ce:GetCostAndUsage",
        "acm:ListCertificates", "acm:DescribeCertificate",
        "access-analyzer:ValidatePolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "NeverReadSecretsDataOrRunCommands",
      "Effect": "Deny",
      "Action": [
        "secretsmanager:*", "kms:Decrypt", "kms:GenerateDataKey",
        "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetCommandInvocation", "ssm:SendCommand", "ssm:StartSession", "ssm:ResumeSession",
        "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion",
        "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery",
        "sts:AssumeRole", "iam:PassRole", "iam:CreateAccessKey"
      ],
      "Resource": "*"
    }
  ]
}
```

### codearena-readonly-audit.trust.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OnlyCodearenaAdminWithMFA",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::640538431170:user/codearena-admin" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "Bool": { "aws:MultiFactorAuthPresent": "true" },
        "NumericLessThan": { "aws:MultiFactorAuthAge": "3600" },
        "StringLike": { "sts:RoleSessionName": "audit-*" }
      }
    }
  ]
}
```

### codearena-admin-ops.trust.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OnlyCodearenaAdminWithFreshMFA",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::640538431170:user/codearena-admin" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "Bool": { "aws:MultiFactorAuthPresent": "true" },
        "NumericLessThan": { "aws:MultiFactorAuthAge": "900" },
        "StringLike": { "sts:RoleSessionName": "admin-ops-*" }
      }
    }
  ]
}
```

### codearena-admin-ops-1-iam-users.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CreateServiceUsersOnlyWithTheBoundary",
      "Effect": "Allow",
      "Action": ["iam:CreateUser", "iam:TagUser"],
      "Resource": "arn:aws:iam::640538431170:user/codearena-*",
      "Condition": { "StringEquals": { "iam:PermissionsBoundary": "arn:aws:iam::640538431170:policy/CodeArenaServiceUserBoundary" } }
    },
    {
      "Sid": "ApplyTheBoundaryToExistingServiceUsers",
      "Effect": "Allow",
      "Action": "iam:PutUserPermissionsBoundary",
      "Resource": "arn:aws:iam::640538431170:user/codearena-*",
      "Condition": { "StringEquals": { "iam:PermissionsBoundary": "arn:aws:iam::640538431170:policy/CodeArenaServiceUserBoundary" } }
    },
    {
      "Sid": "ManageServiceUserPoliciesOnlyForBoundedUsers",
      "Effect": "Allow",
      "Action": ["iam:PutUserPolicy", "iam:DeleteUserPolicy", "iam:AttachUserPolicy", "iam:DetachUserPolicy"],
      "Resource": "arn:aws:iam::640538431170:user/codearena-*",
      "Condition": { "StringEquals": { "iam:PermissionsBoundary": "arn:aws:iam::640538431170:policy/CodeArenaServiceUserBoundary" } }
    },
    {
      "Sid": "ServiceUserAccessKeyLifecycle",
      "Effect": "Allow",
      "Action": ["iam:CreateAccessKey", "iam:UpdateAccessKey", "iam:DeleteAccessKey", "iam:ListAccessKeys", "iam:GetAccessKeyLastUsed", "iam:DeleteUser"],
      "Resource": "arn:aws:iam::640538431170:user/codearena-*"
    },
    {
      "Sid": "ReadIdentityState",
      "Effect": "Allow",
      "Action": [
        "iam:GetUser", "iam:ListUsers", "iam:ListUserPolicies", "iam:GetUserPolicy", "iam:ListAttachedUserPolicies",
        "iam:ListGroupsForUser", "iam:ListMFADevices", "iam:GetAccountSummary", "iam:GetPolicy", "iam:GetPolicyVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

### codearena-admin-ops-2-instance-role.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EditInlinePoliciesOfTheInstanceRoleOnlyWhileItIsBounded",
      "Effect": "Allow",
      "Action": ["iam:PutRolePolicy", "iam:DeleteRolePolicy"],
      "Resource": "arn:aws:iam::640538431170:role/codearena-ec2-role",
      "Condition": { "StringEquals": { "iam:PermissionsBoundary": "arn:aws:iam::640538431170:policy/CodeArenaEc2RoleBoundary" } }
    },
    {
      "Sid": "AttachOnlyTheTwoAwsManagedPoliciesTheInstanceRoleAlreadyUses",
      "Effect": "Allow",
      "Action": ["iam:AttachRolePolicy", "iam:DetachRolePolicy"],
      "Resource": "arn:aws:iam::640538431170:role/codearena-ec2-role",
      "Condition": {
        "StringEquals": {
          "iam:PermissionsBoundary": "arn:aws:iam::640538431170:policy/CodeArenaEc2RoleBoundary",
          "iam:PolicyARN": [
            "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
            "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
          ]
        }
      }
    },
    {
      "Sid": "ReadTheInstanceRole",
      "Effect": "Allow",
      "Action": ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole"],
      "Resource": "arn:aws:iam::640538431170:role/codearena-*"
    }
  ]
}
```

### codearena-admin-ops-3-ops-services.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BudgetsForCodearenaOnly",
      "Effect": "Allow",
      "Action": ["budgets:ViewBudget", "budgets:ModifyBudget"],
      "Resource": "arn:aws:budgets::640538431170:budget/CodeArena-*"
    },
    {
      "Sid": "AlarmsForCodearenaOnly",
      "Effect": "Allow",
      "Action": ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:EnableAlarmActions", "cloudwatch:DisableAlarmActions"],
      "Resource": [
        "arn:aws:cloudwatch:ap-south-1:640538431170:alarm:codearena-*",
        "arn:aws:cloudwatch:us-east-1:640538431170:alarm:codearena-*"
      ]
    },
    {
      "Sid": "ReadAlarms",
      "Effect": "Allow",
      "Action": ["cloudwatch:DescribeAlarms", "cloudwatch:DescribeAlarmHistory"],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": ["ap-south-1", "us-east-1"] } }
    },
    {
      "Sid": "AlertTopicsForCodearenaOnly",
      "Effect": "Allow",
      "Action": ["sns:CreateTopic", "sns:DeleteTopic", "sns:SetTopicAttributes", "sns:Subscribe", "sns:Unsubscribe", "sns:GetTopicAttributes", "sns:ListSubscriptionsByTopic"],
      "Resource": [
        "arn:aws:sns:ap-south-1:640538431170:codearena-*",
        "arn:aws:sns:us-east-1:640538431170:codearena-*"
      ]
    },
    {
      "Sid": "ListTopics",
      "Effect": "Allow",
      "Action": "sns:ListTopics",
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": ["ap-south-1", "us-east-1"] } }
    },
    {
      "Sid": "CreateAndHardenScratchBucketsOnly",
      "Effect": "Allow",
      "Action": ["s3:CreateBucket", "s3:PutBucketPublicAccessBlock", "s3:PutEncryptionConfiguration", "s3:PutBucketVersioning", "s3:PutBucketTagging"],
      "Resource": "arn:aws:s3:::codearena-tmp-*"
    },
    {
      "Sid": "DeleteScratchBucketsOnly",
      "Effect": "Allow",
      "Action": ["s3:DeleteBucket"],
      "Resource": "arn:aws:s3:::codearena-tmp-*"
    },
    {
      "Sid": "ListBuckets",
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets", "s3:GetBucketLocation", "s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock"],
      "Resource": "*"
    }
  ]
}
```

### codearena-admin-ops-4-guardrails.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "NoPrivilegedAwsManagedPolicies",
      "Effect": "Deny",
      "Action": ["iam:AttachUserPolicy", "iam:AttachRolePolicy", "iam:AttachGroupPolicy"],
      "Resource": "*",
      "Condition": {
        "ArnLike": {
          "iam:PolicyARN": [
            "arn:aws:iam::aws:policy/AdministratorAccess",
            "arn:aws:iam::aws:policy/PowerUserAccess",
            "arn:aws:iam::aws:policy/IAMFullAccess",
            "arn:aws:iam::aws:policy/job-function/*",
            "arn:aws:iam::640538431170:policy/CodeArenaDeployIAMScoped"
          ]
        }
      }
    },
    {
      "Sid": "TheHumanAdminAndRootAreOutOfScope",
      "Effect": "Deny",
      "Action": [
        "iam:CreateAccessKey", "iam:UpdateAccessKey", "iam:DeleteAccessKey", "iam:DeleteUser",
        "iam:PutUserPolicy", "iam:AttachUserPolicy", "iam:DetachUserPolicy", "iam:DeleteUserPolicy", "iam:PutUserPermissionsBoundary",
        "iam:CreateLoginProfile", "iam:UpdateLoginProfile", "iam:DeleteLoginProfile", "iam:DeactivateMFADevice", "iam:DeleteVirtualMFADevice"
      ],
      "Resource": "arn:aws:iam::640538431170:user/codearena-admin"
    },
    {
      "Sid": "GuardTheAccessControlRolesAndPolicies",
      "Effect": "Deny",
      "Action": [
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:DeleteRole",
        "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary", "iam:TagRole", "iam:UntagRole"
      ],
      "Resource": [
        "arn:aws:iam::640538431170:role/codearena-admin-ops",
        "arn:aws:iam::640538431170:role/codearena-readonly-audit",
        "arn:aws:iam::640538431170:role/codearena-ssm-deploy"
      ]
    },
    {
      "Sid": "NoTrustPolicyChangesNoNewRolesNoPassRole",
      "Effect": "Deny",
      "Action": ["iam:UpdateAssumeRolePolicy", "iam:CreateRole", "iam:DeleteRole", "iam:PassRole", "iam:CreateServiceLinkedRole"],
      "Resource": "*"
    },
    {
      "Sid": "BoundariesAndAccessPoliciesAreImmutableFromHere",
      "Effect": "Deny",
      "Action": [
        "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:DeletePolicy", "iam:CreatePolicy",
        "iam:DeleteUserPermissionsBoundary", "iam:DeleteRolePermissionsBoundary", "iam:PutRolePermissionsBoundary"
      ],
      "Resource": "*"
    },
    {
      "Sid": "NoOtherPrincipalTypesAndNoAssumeRole",
      "Effect": "Deny",
      "Action": [
        "sts:AssumeRole", "iam:CreateGroup", "iam:AddUserToGroup", "iam:RemoveUserFromGroup", "iam:AttachGroupPolicy", "iam:PutGroupPolicy",
        "iam:CreateOpenIDConnectProvider", "iam:CreateSAMLProvider", "iam:UpdateAccountPasswordPolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DataBucketsAreNeverTouchedFromThisRole",
      "Effect": "Deny",
      "Action": ["s3:DeleteBucket", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutLifecycleConfiguration", "s3:PutBucketVersioning", "s3:PutBucketPublicAccessBlock"],
      "Resource": [
        "arn:aws:s3:::codearena-backups-640538431170", "arn:aws:s3:::codearena-backups-640538431170/*",
        "arn:aws:s3:::codearena-question-images-640538431170", "arn:aws:s3:::codearena-question-images-640538431170/*"
      ]
    },
    {
      "Sid": "NeverReadSecretsOrRunCommands",
      "Effect": "Deny",
      "Action": [
        "secretsmanager:*", "kms:Decrypt", "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetCommandInvocation",
        "ssm:SendCommand", "ssm:StartSession", "s3:GetObject", "s3:GetObjectVersion", "rds:DeleteDBInstance", "rds:ModifyDBInstance", "ec2:TerminateInstances", "ec2:StopInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

### CodeArenaEc2RoleBoundary.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SsmAgentAndSessionTransport",
      "Effect": "Allow",
      "Action": [
        "ssm:DescribeAssociation", "ssm:GetDeployablePatchSnapshotForInstance", "ssm:GetDocument", "ssm:DescribeDocument", "ssm:GetManifest",
        "ssm:ListAssociations", "ssm:ListInstanceAssociations", "ssm:PutInventory", "ssm:PutComplianceItems", "ssm:PutConfigurePackageResult",
        "ssm:UpdateAssociationStatus", "ssm:UpdateInstanceAssociationStatus", "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel",
        "ec2messages:AcknowledgeMessage", "ec2messages:DeleteMessage", "ec2messages:FailMessage", "ec2messages:GetEndpoint", "ec2messages:GetMessages", "ec2messages:SendReply"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchAgent",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData", "ec2:DescribeVolumes", "ec2:DescribeTags", "ec2:DescribeInstances",
        "logs:PutLogEvents", "logs:PutRetentionPolicy", "logs:DescribeLogStreams", "logs:DescribeLogGroups", "logs:CreateLogStream", "logs:CreateLogGroup",
        "xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets", "xray:GetSamplingStatisticSummaries"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AgentConfigParameter",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:*:*:parameter/AmazonCloudWatch-*"
    },
    {
      "Sid": "ApplicationSecretAndParameters",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
      "Resource": [
        "arn:aws:secretsmanager:ap-south-1:640538431170:secret:codearena/backend/secrets-*",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/codearena/prod/*",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/DATABASE_URL",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/DIRECT_DATABASE_URL",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/PII_ENCRYPTION_KEY",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/MAIL_USER",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/MAIL_PASSWORD",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/MAIL_FROM",
        "arn:aws:ssm:ap-south-1:640538431170:parameter/RDS_MASTER_PASSWORD"
      ]
    },
    {
      "Sid": "DecryptSecureStringsAndSecret",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*"
    },
    {
      "Sid": "SendEmail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail", "ses:GetAccount"],
      "Resource": "*"
    },
    {
      "Sid": "BackupsBucketReadWrite",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::codearena-backups-640538431170", "arn:aws:s3:::codearena-backups-640538431170/*"]
    },
    {
      "Sid": "NeverIamNeverOtherAccounts",
      "Effect": "Deny",
      "Action": ["iam:*", "sts:AssumeRole", "organizations:*", "account:*", "s3:DeleteBucket", "s3:DeleteObject", "s3:DeleteObjectVersion", "ec2:RunInstances", "ec2:TerminateInstances"],
      "Resource": "*"
    }
  ]
}
```

### CodeArenaServiceUserBoundary.policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "QuestionImagesBucketOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::codearena-question-images-640538431170", "arn:aws:s3:::codearena-question-images-640538431170/*"]
    },
    {
      "Sid": "RunCommandOnTheCodeArenaHostOnly",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": ["arn:aws:ec2:ap-south-1:640538431170:instance/i-02bedc5ba41539f46", "arn:aws:ssm:ap-south-1::document/AWS-RunShellScript"]
    },
    {
      "Sid": "ReadResultsAndHostStatus",
      "Effect": "Allow",
      "Action": ["ssm:GetCommandInvocation", "ssm:ListCommands", "ssm:ListCommandInvocations", "ssm:DescribeInstanceInformation", "ec2:DescribeInstances"],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "ap-south-1" } }
    },
    {
      "Sid": "NeverIamNeverRolesNeverBilling",
      "Effect": "Deny",
      "Action": ["iam:*", "sts:AssumeRole", "organizations:*", "account:*", "budgets:*", "secretsmanager:*", "kms:Decrypt", "ssm:GetParameter*", "ssm:StartSession"],
      "Resource": "*"
    }
  ]
}
```
