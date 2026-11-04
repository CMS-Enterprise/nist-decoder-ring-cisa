# AUTH_SECRET rotation

How to rotate `AUTH_SECRET` (the Auth.js session-signing key) in dev or prod, in the
correct order, and what users will experience while it rolls.

This is an operational-sequencing runbook. The mechanical happy path also appears in
[`deploy-to-ecs.md`](./deploy-to-ecs.md#auth_secret-rotation) (dev); this runbook is the
fuller treatment, including the prod sequence and the session-impact you must communicate
before rotating.

## When to use this runbook

- Scheduled rotation of the session-signing key.
- Suspected exposure of `AUTH_SECRET` (rotate immediately).
- Standing up a new environment (the first apply sets the initial value).

Do **not** use this for the RDS-managed *database* secret — that auto-rotates on AWS's
schedule and is handled differently (see
[`secret-rotation-auto-redeploy.md`](./secret-rotation-auto-redeploy.md) and
[`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md)).

## How rotation actually works here

`AUTH_SECRET` lives in Secrets Manager (the `terraform-aws-modules/secrets-manager`
instance in the secrets module) and is injected into the app container via ECS-native
`secrets` / `valueFrom` (see `infra/modules/compute/ecs_service.tf`, the `secrets` block).

Two facts drive the whole procedure:

1. **ECS reads secret values only at task launch.** A running task holds the value it
   read when it started. Changing the secret in Secrets Manager does nothing to a running
   task until that task is replaced. (AWS: *"If your secret changes, you must force a new
   deployment or launch a new task to retrieve the latest secret value."*)
2. **The compute module already forces the redeploy for you.** The ECS service is wired
   with a `triggers = { auth_secret_rotation_version = ... }` input
   (`ecs_service.tf`, the `triggers` block). When you bump that tfvars value, the *same*
   `terraform apply` both writes the new secret version **and** forces a new ECS
   deployment to pick it up. There is no separate `aws ecs update-service
   --force-new-deployment` step in the happy path — the manual command is only a fallback
   if the trigger wiring is bypassed.

> No `null_resource` + `local-exec` wrapper is needed — the native module `triggers` input
> does this, and is the current best practice per the Terraform AWS ECS module docs. Don't
> add a local-exec wrapper.

## ⚠️ User-visible impact — read before rotating

`AUTH_SECRET` signs Auth.js session tokens. Rotating it **invalidates every existing
session**: signed-in users are logged out and must re-authenticate. Auth.js does not
support verifying against multiple keys from a single `AUTH_SECRET` string, so there is
**no zero-downtime / overlap window** without an app-code change.

Additionally, during the rolling deployment old and new tasks run **side by side with
different secrets** for ~1–2 minutes. A session minted on a new task is rejected by an old
task (and vice versa) until the rollout completes. Where few users are signed in that is
acceptable, but treat rotation as a brief auth blip, not a transparent change.

**Before rotating prod:** announce the forced re-login to signed-in users, and prefer a low-usage
window. Do not document or imply a seamless rotation unless/until the app is changed to
verify against both an old and new key during an overlap window.

## Procedure

Replace `<env>` with `dev` or `prod` and `<env-profile>` with the matching AWS profile.
The prod profile has no default region, so prod CLI calls pass `--region us-east-1`.

### 1. Bump the rotation version in tfvars

In `infra/environments/<env>/terraform.tfvars`:

```hcl
auth_secret_rotation_version = "3"   # increment from the current value
```

Any change to this string is the cue. Use a simple incrementing integer-as-string.

### 2. Plan and apply

```bash
cd infra/environments/<env>
AWS_PROFILE=<env-profile> terraform plan -out=plan.tfplan
```

Expected diff (two resources):
- `module.secrets.module.auth_secret.aws_secretsmanager_secret_version.this[0]` — updated
  (new secret value written).
- `module.compute.module.ecs_service.aws_ecs_service.this[0]` — updated in place (the
  `triggers` map changed, which forces a new deployment).

If the plan shows the secret update but **no** service update, the trigger isn't wired —
stop and check `ecs_service.tf`; do not hand-roll a force-new-deployment to paper over it.

```bash
AWS_PROFILE=<env-profile> terraform apply plan.tfplan
```

### 3. Wait for the service to stabilize

```bash
AWS_PROFILE=<env-profile> aws ecs wait services-stable \
  --cluster <name_prefix>-<env> --services <name_prefix>-<env>-app --region us-east-1
```

### 4. Verify the rollout picked up a new deployment

```bash
AWS_PROFILE=<env-profile> aws ecs describe-services \
  --cluster <name_prefix>-<env> --services <name_prefix>-<env>-app --region us-east-1 --no-cli-pager \
  --query 'services[0].{Running:runningCount,Desired:desiredCount,Deployment:deployments[0].{Status:status,Rollout:rolloutState,CreatedAt:createdAt}}'
```

Expect a single `PRIMARY` deployment with `rolloutState: COMPLETED`, a fresh `CreatedAt`,
and `Running == Desired`.

### 5. Confirm auth works end-to-end

Sign in through the app (forces a fresh session against the new key). A successful login
plus an authenticated tRPC call confirms the new secret is live.

## Fallback — manual force-new-deployment

Only if the `triggers` path is unavailable (e.g. you wrote the secret out of band). With make, `AWS_PROFILE=<env-profile> make ecs-redeploy ENV=<env>` forces the deployment and waits for the service to stabilise. By hand:

```bash
AWS_PROFILE=<env-profile> aws ecs update-service \
  --cluster <name_prefix>-<env> --service <name_prefix>-<env>-app \
  --force-new-deployment --region us-east-1 --no-cli-pager
AWS_PROFILE=<env-profile> aws ecs wait services-stable \
  --cluster <name_prefix>-<env> --services <name_prefix>-<env>-app --region us-east-1
```

## Troubleshooting

- **Plan shows the secret updating but the service unchanged** — the `triggers` input
  isn't seeing a changed value (tfvars not actually bumped, or the conditional in
  `ecs_service.tf` evaluated to `null`). Fix the wiring; don't substitute a manual
  redeploy as the standard path.
- **Users report "session expired" / repeated logout after rotation** — expected for the
  rollout window (see impact section). If it persists after `services-stable` reports
  `COMPLETED`, confirm only one `PRIMARY` deployment is running (step 4); a stuck old
  deployment means some tasks still hold the previous key.
- **Apply succeeds but the app 500s on auth** — the app couldn't read the secret. Check
  the task role's Secrets Manager permission and the `valueFrom` ARN in the task def; see
  the IAM troubleshooting in [`deploy-to-ecs.md`](./deploy-to-ecs.md#troubleshooting-faq).

## Related runbooks

- [`deploy-to-ecs.md`](./deploy-to-ecs.md) — general apply + service roll (dev).
- [`prod-deploy.md`](./prod-deploy.md) — prod deploy + rollback (rotation slots into the
  secrets layer of the apply order).
