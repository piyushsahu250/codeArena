# Item 1: create seven customer-managed IAM policies. Execution plan (NOT EXECUTED; awaiting explicit approval)

Source of truth: branch `docs/iam-live-test-results`, files under `docs/aws/roles/`, reproduced in `AWS_REPLACEMENT_ROLES_DESIGN.md`. The policy documents are read from the branch commit, not from a working tree.
Scope: **Item 1 only.** No role, attachment, boundary application, detachment, key change, instance start or deployment is part of it.

## 1. Read-only review results (2026-10-13)

| Check | Result |
|---|---|
| Files located | PASS: branch `origin/docs/iam-live-test-results`; design doc last changed in commit `3809691`; branch tip `ae8b24f` at review time. `main` untouched at `77d289b`. |
| JSON validity, appendix equals file | PASS for all seven (each appendix block equals its file after normalising) |
| Size against the 6,144-character managed-policy limit (whitespace excluded) | PASS: 2942, 1494, 1043, 1751, 3128, 2779, 1008 |
| Names available | PASS: all seven return `NoSuchEntity`; the only existing customer policies are `CodeArenaDeployIAMScoped` and `CodeArenaSsmDeployOnly` (not touched) |
| Account quotas | PASS: 2 of 1,500 policies used; 5 versions per policy (each is created once, version `v1`, never edited) |
| Access Analyzer `validate-policy` | PASS: no findings on all seven |
| Referenced resources exist | PASS: both buckets, instance `i-02bedc5ba41539f46`, SNS topics (`codearena-alerts` in ap-south-1, `codearena-alerts-useast1`), budget `CodeArena-Monthly-Cost`, all 11 alarms start with `codearena-`, the secret `codearena/backend/secrets`, both AWS managed policies, role `codearena-ec2-role`, users `codearena-admin`, `codearena-deploy`, `codearena-question-images`. Account 640538431170 and region ap-south-1 in every ARN. |
| Effective permissions, admin-ops (four policies together, `simulate-custom-policy`) | PASS: 29 of 29 cases as designed (boundary-conditioned allows, guard denies, data-bucket and secret denies) |
| Effective permissions, audit policy | PASS: 11 of 11 |
| Caller permission | PASS: simulator allows `codearena-admin` `iam:CreatePolicy`, `GetPolicy`, `GetPolicyVersion`, `DeletePolicy` (via the `CodeArenaAdmins` group). **No root and no one-off root session is needed**, including for the two boundary policies: creating a policy needs only `iam:CreatePolicy`. |
| Identity right now | PASS: account 640538431170, `user/codearena-admin`. Re-checked immediately before each mutation. |
| Boundary dependency order | PASS: the policies only name each boundary by ARN inside conditions, so creation order does not matter and nothing references a policy that is missing at creation time |

Residual design note found during the review (for later items): `CodeArenaAdminOpsIamUsers` lets `codearena-admin-ops` call `iam:CreateAccessKey` on `user/codearena-deploy`. While that user's group still holds `PowerUserAccess`, a key minted that way would carry PowerUser. It is not a new privilege for `codearena-admin` (already AdministratorAccess) but it weakens the role's separation. Mitigation: detach `PowerUserAccess` and `CodeArenaDeployIAMScoped` (Item 5) before the admin-ops role is used, or accept the gap until then. This does not affect Item 1.

## 2. What Item 1 will do

Seven API calls, one at a time, caller `user/codearena-admin`, account 640538431170, region ap-south-1. Each creates one **unattached** policy at version `v1`. A policy with no attachments grants nothing to anyone and changes no existing behaviour; the two boundaries have no effect until applied in a later item.

| # | Policy name | Document (branch file) | Description to set |
|---|---|---|---|
| 1 | `CodeArenaAuditReadOnly` | `codearena-readonly-audit.policy.json` | Read-only inventory and audit; no secrets, no object reads |
| 2 | `CodeArenaAdminOpsIamUsers` | `codearena-admin-ops-1-iam-users.policy.json` | Admin-ops: codearena-* service users and keys, boundary-gated |
| 3 | `CodeArenaAdminOpsInstanceRole` | `codearena-admin-ops-2-instance-role.policy.json` | Admin-ops: codearena-ec2-role policies, boundary-gated |
| 4 | `CodeArenaAdminOpsServices` | `codearena-admin-ops-3-ops-services.policy.json` | Admin-ops: budgets, alarms, SNS, scratch buckets |
| 5 | `CodeArenaAdminOpsGuardrails` | `codearena-admin-ops-4-guardrails.policy.json` | Admin-ops: explicit denies that stop escalation |
| 6 | `CodeArenaEc2RoleBoundary` | `CodeArenaEc2RoleBoundary.policy.json` | Permissions boundary for codearena-ec2-role (not applied) |
| 7 | `CodeArenaServiceUserBoundary` | `CodeArenaServiceUserBoundary.policy.json` | Permissions boundary for codearena-* service users (not applied) |

Command per policy (`N` = name, `F` = the file extracted from the branch commit; no credentials appear anywhere):

```
aws iam create-policy --profile codearena-admin --policy-name N --description "<text above>" --policy-document file://F
```

After each call, before the next one:

1. `aws iam get-policy --policy-arn arn:aws:iam::640538431170:policy/N`: the ARN is exactly that, `DefaultVersionId` is `v1`, `AttachmentCount` is 0.
2. `aws iam get-policy-version --policy-arn ... --version-id v1`: the returned document, normalised, equals the branch file (hash compared).
3. `aws iam list-entities-for-policy --policy-arn ...`: nothing attached.
4. `aws sts get-caller-identity`: still `user/codearena-admin`, account 640538431170.

Stop immediately (no further calls) if: a policy already exists, the identity or account differs, a call is denied, the stored document differs from the file, or the count of customer policies is not what the sequence implies.

## 3. Expected effects and risks

* No principal gains or loses any permission. Nothing is attached, applied or assumed. Production, the instance role, users, keys and the deploy path are unchanged.
* The only AWS side effect is seven `CreatePolicy` events in CloudTrail by `codearena-admin`. The account's policy count goes from 2 to 9.
* Risk: low. A malformed policy would be rejected by IAM and Access Analyzer already passed.

## 4. Rollback

Each policy: `aws iam delete-policy --policy-arn arn:aws:iam::640538431170:policy/N`. This works while the policy is unattached and has only its default version, which is the state Item 1 leaves it in. Rolling back all seven: run that command for each name; the account returns to 2 customer policies. Verify with `aws iam list-policies --scope Local`.

## 5. What happens after Item 1

Report PASS/FAIL/BLOCKED per policy, then ask separately for Item 2 (create the roles). Items 2 to 6 are not approved by Item 1.
