# Production deploy + rollback

How to deploy ZT Decoder Ring to **prod** and how to roll back each layer when a deploy
goes wrong. Prod runs in a separate AWS account from dev with its own state bucket; nothing
is shared. Every CLI call passes `--region us-east-1` explicitly so it behaves the
same regardless of what the active profile defaults to.

The commands below use an AWS profile for the prod account's deploy role, written here as
`<prod-deploy-profile>`. How that profile is issued (SSO, a `credential_process`, or another
broker) is the estate's choice; the role behind it needs the permissions the Terraform in
`infra/` manages.

This runbook assumes the dev runbooks as background — it does not repeat their mechanics:

- [`build-and-push-image.md`](./build-and-push-image.md) — build + push the image.
- [`deploy-to-ecs.md`](./deploy-to-ecs.md) — apply + roll the service (dev-oriented).
- [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) — one-off migrate/seed tasks (has an `ENV=prod` section).
- [`auth-secret-rotation.md`](./auth-secret-rotation.md) — rotate the session key.
- [`prod-db-recovery.md`](./prod-db-recovery.md) — restore the database from PITR (the data escape hatch referenced below).

## When to use this runbook

- A planned prod release (new image and/or infra change).
- A hotfix to prod.
- Any change that touches the prod database, secrets, or ECS service.

## Conventions for prod

```bash
export AWS_PROFILE=<prod-deploy-profile>  # prod deploy role
export AWS_REGION=us-east-1               # prod profile has no default region
export REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT/infra/environments/prod"
make -C "$REPO_ROOT" aws-whoami           # the account and role the profile resolves to
```

All `aws` calls below assume these are set and pass `--region us-east-1` and
`--no-cli-pager` explicitly.

## Pre-deploy checklist

Confirm each before applying anything:

- [ ] Change is merged to `main` (or the intended release branch) and the image tag is
      built and present in the **prod** ECR repo (`aws ecr describe-images
      --repository-name ztdr-prod`).
- [ ] `make check-deploy-safety ENV=prod` passes. This compares the committed
      `container_image_tag` against the tag actually running and fails on a
      downgrade. Applying a branch whose tfvars lag production rolls prod
      **backwards**, and if a migration has landed since that tag, the older image
      fails at query time rather than at deploy — so the apply looks clean and the
      app is broken. Use `ALLOW_DOWNGRADE=1` only for a deliberate rollback.
- [ ] Reviewed `terraform plan` for prod carefully (the plan can be long). No unexpected
      destroys — a task-def *replacement* is normal; an
      `aws_ecs_service` / `aws_db_instance` / S3 state-bucket *destroy* is not. Abort if you
      see one.
- [ ] If the change includes a Prisma migration: the migration is reviewed for
      destructiveness. Destructive migrations (drop/alter column) have no automatic
      rollback — see "Rollback" below — so confirm a recent automated backup exists and note
      the `LatestRestorableTime`.
- [ ] If rotating `AUTH_SECRET`: team is notified of the forced re-login
      (see [`auth-secret-rotation.md`](./auth-secret-rotation.md)).
- [ ] A heightened-monitoring window is agreed (someone is watching the alarms/logs during
      and ~30 min after).
- [ ] You know the current good state to roll back to: current app task-def revision,
      current `container_image_tag`, and current applied migration name.

```bash
# Capture the current-good rollback anchors first:
AWS_PROFILE=$AWS_PROFILE aws ecs describe-services --cluster ztdr-prod \
  --services ztdr-prod-app --region us-east-1 --no-cli-pager \
  --query 'services[0].{TaskDef:taskDefinition,Running:runningCount}'
```

## Apply order

Apply bottom-up by dependency. Most prod releases only touch the compute + migrate layers;
the full order matters for a from-scratch standup or a cross-cutting change.

1. **State backend** — bootstrapped once per account, per step 1 of "Launching it" in
   [`aws-deployment.md`](../architecture/aws-deployment.md); nothing to apply per release.
2. **Networking** (VPC, subnets, routing, SGs) — rarely changes; apply first if it does.
3. **KMS + secrets** — CMKs, `AUTH_SECRET`, the RDS-managed master secret wiring. Rotating
   `AUTH_SECRET` lands here (the service redeploy is folded into the same apply via the
   `triggers` input).
4. **Database** — RDS changes. Note: some RDS changes (instance class, multi-AZ) cause a
   brief failover/downtime; schedule accordingly.
5. **Compute** — ECS service + task definitions + ALB. The image-tag bump and most
   releases live here.
6. **Migrate** — run the one-off `ztdr-prod-migrate` task **after** the new task def exists
   but, for additive migrations, **before** or alongside the app roll. For migrations that
   the new app code depends on, migrate first, then let the service finish rolling. See
   [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) `ENV=prod` section.
7. **Seed** — for a fresh environment, an intentional re-seed, or a release that changes
   `app/prisma/seed-sql/` (re-seed truncates via `00-cleanup.sql`). The seed ships inside the
   image, so a release with new seed files and no seed run serves the old rows without error.
   Never casually re-seed populated prod.
8. **DNS** — published by whoever owns the zone, from the records output `launch` gives; only
   touched again when the FQDN or certificate changes.

For a routine image release this collapses to: bump `container_image_tag` in
`infra/environments/prod/terraform.tfvars` → `terraform apply` (layers 5) → run migrate if
the release has a migration (layer 6) → seed if the release changes the seed files (layer 7) →
verify.

## Apply

```bash
AWS_PROFILE=$AWS_PROFILE terraform plan -out=plan.tfplan
AWS_PROFILE=$AWS_PROFILE terraform apply plan.tfplan
```

Then wait for the service to reach steady state:

```bash
AWS_PROFILE=$AWS_PROFILE aws ecs wait services-stable \
  --cluster ztdr-prod --services ztdr-prod-app --region us-east-1
```

## Post-deploy verification

```bash
export PROD_FQDN=$(AWS_PROFILE=$AWS_PROFILE terraform output -json launch | jq -r .hostname)

# Health endpoint and target health in one step (the app is served only on app_fqdn, over TLS):
AWS_PROFILE=$AWS_PROFILE make -C "$REPO_ROOT" smoke ENV=prod DNS_FQDN_prod="$PROD_FQDN"
# By hand, the health endpoint alone (expect 200):
#   curl -sS -o /dev/null -w '%{http_code}\n' "https://$PROD_FQDN/api/health"

# A data-backed tRPC call returns real data, not an error:
curl -sS "https://$PROD_FQDN/api/trpc/decoder.getActiveVersion?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D"

# Confirm the rolled task def is the expected revision/image/arch:
AWS_PROFILE=$AWS_PROFILE aws ecs describe-task-definition --task-definition ztdr-prod-app \
  --region us-east-1 --no-cli-pager \
  --query 'taskDefinition.{Revision:revision,Arch:runtimePlatform.cpuArchitecture,Image:containerDefinitions[0].image}'
```

Watch CloudWatch alarms and the app log stream (prefix `app/app/`) through the monitoring
window before declaring success.

## Rollback

The service has `deployment_circuit_breaker { enable = true, rollback = true }` (see
`ecs_service.tf`), so the **first line of defense is automatic**: if a new deployment can't
reach steady state (failed health checks / tasks crash-looping), ECS rolls the service back
to the last `COMPLETED` deployment on its own. You don't trigger this — you observe it.

> A rollback is not silent: the `<name_prefix>-<env>-ecs-deployment-rollback` alarm
> (`infra/environments/prod/alarms.tf`) notifies the alarm topic when the circuit breaker
> rolls a deployment back.

The circuit breaker only catches deployments that **fail to stabilize**. For a regression
that passes health checks but is wrong (bad behavior, data corruption), roll back manually
by layer:

### App / image regression (passes health checks, but broken)
Re-pin the previous good image tag and re-apply — this rolls the service back onto the
prior task def:

```hcl
# infra/environments/prod/terraform.tfvars
container_image_tag = "vX.Y.Z"   # the previous-good tag captured in the checklist
```
```bash
AWS_PROFILE=$AWS_PROFILE terraform apply
AWS_PROFILE=$AWS_PROFILE aws ecs wait services-stable --cluster ztdr-prod --services ztdr-prod-app --region us-east-1
```

Faster, out-of-band alternative (no terraform): roll the service to the previous task-def
revision directly. Use only as an emergency stopgap — terraform state will then show drift
until you re-pin tfvars to match. It works only while that revision is still ACTIVE: the apply
that bumps the image tag deregisters the old revision, and a service cannot be pointed at an
INACTIVE one. Once it is gone, re-pin the previous tag in tfvars and apply instead.

```bash
AWS_PROFILE=$AWS_PROFILE aws ecs update-service --cluster ztdr-prod --service ztdr-prod-app \
  --task-definition ztdr-prod-app:<previous-revision> --region us-east-1 --no-cli-pager
```

### Schema / migration regression
Prisma `migrate deploy` has **no automatic down-migration**. `prisma migrate resolve
--rolled-back <name>` only marks the `_prisma_migrations` row so the migration can be
re-applied — it does **not** execute any revert SQL. So:

- **Default: roll forward.** Author a corrective migration that fixes the schema and deploy
  it. This is the preferred path for almost all schema issues.
- **Non-destructive migration applied but unwanted:** hand-write and run the revert SQL,
  then `prisma migrate resolve --rolled-back <name>` to clear the history row.
- **Destructive migration (dropped/altered a column, data loss):** schema rollback can't
  recover the data. Restore the database from PITR — see
  [`prod-db-recovery.md`](./prod-db-recovery.md). This is the data escape hatch.

### Secret regression
Re-bump `auth_secret_rotation_version` to write a known value and redeploy — see
[`auth-secret-rotation.md`](./auth-secret-rotation.md). (Forces another re-login.)

### Infra regression
For a Terraform change that applied cleanly but caused a problem, `git revert` the change
and re-apply. For anything that destroyed or replaced a stateful resource, stop and treat it
as an incident — do not "fix forward" blindly on state-bearing resources.

## Not supported on this stack

- **Blue/green deployments.** The service uses the rolling (`ECS`) deployment controller,
  not CodeDeploy. More importantly, **RDS Blue/Green Deployments are incompatible with an
  RDS-managed master password** (which this stack uses, `manage_master_user_password=true`).
  Do not propose blue/green for app or DB rollback without a larger redesign.

## Related runbooks

- [`deploy-to-ecs.md`](./deploy-to-ecs.md) — the dev-oriented apply/roll mechanics this builds on.
- [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) — migrate/seed task invocation (incl. `ENV=prod`).
- [`auth-secret-rotation.md`](./auth-secret-rotation.md) — session-key rotation sequencing.
- [`prod-db-recovery.md`](./prod-db-recovery.md) — PITR restore (data rollback for destructive migrations).
