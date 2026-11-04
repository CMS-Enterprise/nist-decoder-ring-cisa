# Deploy from ECR to ECS (dev)

How to point the dev ECS task definitions at a new image (or apply Terraform-only infra changes) and roll the service. This is the **second** of three runbooks:

1. [`build-and-push-image.md`](./build-and-push-image.md) — build and push the image to ECR.
2. **This runbook** — pin tfvars to the new tag, `terraform apply`, verify the service rolls.
3. [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) — invoke the one-off migration / seed tasks against the running cluster.

## When to use this runbook

- After pushing a new image (per Runbook 1), to roll the ECS service onto it.
- After a Terraform-only infra change (no image rebuild — IAM, KMS, networking, etc.).
- To rotate `AUTH_SECRET` (Terraform-driven; service auto-rolls).
- To scale the service up or down.

## Prerequisites

- HTTPS is on (`enable_https_listener = true`): the ECS service exists only from then. A first deployment follows [`aws-deployment.md`](../architecture/aws-deployment.md) instead.
- Image already in ECR for the tag you're about to deploy. Verify with `aws ecr describe-images` per Runbook 1 step 7.
- AWS CLI authenticated to the dev account.
- Local working tree on a branch with the desired infra state (see `infra/modules/compute/*.tf`, `infra/environments/dev/*.tf`).

## 1. Preflight exports

Re-run when your shell loses env vars. Captures everything later steps need from Terraform outputs:

```bash
export REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT/infra/environments/dev"
export AWS_REGION=us-east-1
export CLUSTER=$(terraform output -raw ecs_cluster_name)
export LOG_GROUP=$(terraform output -raw ecs_log_group_name)
export PRIVATE_SUBNETS=$(terraform output -json private_subnet_ids | jq -r '[.[] | tostring] | join(",")')
export ECS_SG=$(terraform output -raw ecs_security_group_id)
export APP_URL=$(terraform output -json launch | jq -r .url)
echo "CLUSTER=$CLUSTER ECS_SG=$ECS_SG PRIVATE_SUBNETS=$PRIVATE_SUBNETS APP_URL=$APP_URL"
```

The `echo` confirms all four are set. If any are empty, the Terraform state isn't readable from this directory.

## 2. Pin tfvars to the new image tag

In `infra/environments/dev/terraform.tfvars`:

```hcl
container_image_tag = "v0.1.5"   # match the tag you pushed in Runbook 1
```

Without this bump, the task definitions stay pinned to whatever tag was set last time and your image push has no effect on the deployed service.

For Terraform-only changes (no image change), you can skip this step and go straight to apply.

## 3. Plan and apply

Check first that this apply does not roll the running image backwards across a migration: `AWS_PROFILE=<env-profile> make check-deploy-safety ENV=dev` reads the running task definition and fails if the committed tag is older. `ALLOW_DOWNGRADE=1` is for a deliberate rollback.

```bash
terraform plan -out=plan.tfplan
```

For an image-tag bump, the plan should show **3 task definition replacements** (app, migrate, seed all repoint to the new tag) and **1 in-place service update** (rolls onto the new task def revision). A parameter-group change in the plan is a real change, not drift: the database module sets `apply_method = "pending-reboot"` on `rds.force_ssl` so that it no longer reappears on every plan.

```bash
terraform apply plan.tfplan
```

Expected: `Apply complete! Resources: 3 added, 1 changed, 3 destroyed.` (plus any incidental cosmetic drift).

## 4. Confirm the new task def is what you expect

```bash
aws ecs describe-task-definition --task-definition ztdr-dev-app --region "$AWS_REGION" --query 'taskDefinition.{Revision:revision,Arch:runtimePlatform.cpuArchitecture,Image:containerDefinitions[0].image}'
```

Expected: latest `Revision`, `Arch: "ARM64"`, `Image` ending in `:vX.Y.Z` matching what you pushed. If any of those is wrong, the apply didn't take or tfvars wasn't bumped.

## 5. Wait for the service to stabilize

```bash
aws ecs wait services-stable --cluster "$CLUSTER" --services "ztdr-dev-app" --region "$AWS_REGION"
```

This polls for up to ~10 minutes. If it returns successfully, the service has finished rolling onto the new task def revision.

If you want to watch progress instead of waiting silently:

```bash
aws ecs describe-services --cluster "$CLUSTER" --services "ztdr-dev-app" --region "$AWS_REGION" --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Deployment:deployments[0].rolloutState}'
```

Re-run that every ~30 seconds. `Deployment.rolloutState` should go from `IN_PROGRESS` → `COMPLETED`.

## 6. Hit the app

`APP_URL` is `https://<app_fqdn>`, the app's only address. It answers once `enable_https_listener` is on and a task is healthy; port 80 only redirects to it.

With make: `AWS_PROFILE=<env-profile> make smoke ENV=dev DNS_FQDN_dev=<app_fqdn>` requests `/api/health` on that name, retries through the proxy if a direct request is refused, and then checks the target group's health. By hand:

```bash
curl -v "$APP_URL/api/health"
```

Expected: HTTP 200 with body `{"status":"ok","timestamp":"..."}`. If you get 503, the target group has no healthy targets — see Troubleshooting below.

```bash
curl -s "$APP_URL/" | head -50
```

The home page should render the decoder ring HTML.

## AUTH_SECRET rotation

Rotation is Terraform-driven — no CLI action after the tfvars bump.

1. Bump `auth_secret_rotation_version` in `terraform.tfvars`:
   ```hcl
   auth_secret_rotation_version = "2"   # was "1" or null
   ```
2. `terraform apply`. Expected diff:
   - `module.secrets.module.auth_secret.aws_secretsmanager_secret_version.this[0]` updated (new secret value).
   - `module.compute.module.ecs_service.aws_ecs_service.this[0]` updated in-place — the service's `triggers` map changed, which forces a new deployment.
3. Wait for the service to stabilize (step 5 above).
4. Verify the new task picked up the rolled secret value:
   ```bash
   aws ecs describe-services --cluster "$CLUSTER" --services "ztdr-dev-app" --region "$AWS_REGION" --query 'services[0].{Running:runningCount,Desired:desiredCount,LastDeployment:deployments[0].{Status:status,CreatedAt:createdAt}}'
   ```

## Scale to zero (cost savings)

When dev isn't being used:

```bash
AWS_PROFILE=<env-profile> make ecs-scale ENV=dev COUNT=0
```

The service defaults to the app service. By hand: `aws ecs update-service --cluster "$CLUSTER" --service "ztdr-dev-app" --desired-count 0 --region "$AWS_REGION"`.

Running costs drop to ALB (~$16/mo) + the VPC's NAT (the VPC is looked up, not created, so its NAT belongs to whoever owns the VPC) + CloudWatch/ECR/Secrets (~$2/mo). Fargate billing stops within a minute.

## Scale back up

```bash
AWS_PROFILE=<env-profile> make ecs-scale ENV=dev COUNT=1
aws ecs wait services-stable --cluster "$CLUSTER" --services "ztdr-dev-app" --region "$AWS_REGION"
AWS_PROFILE=<env-profile> make smoke ENV=dev DNS_FQDN_dev=<app_fqdn>
```

By hand, the first and last lines are `aws ecs update-service … --desired-count 1` and the health check in step 6.

## Next step

A first deployment follows the launch order in [`aws-deployment.md`](../architecture/aws-deployment.md), not this runbook. For a release with a migration or new seed files, continue with [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md).

---

## Troubleshooting FAQ

- **`Subnets can't be empty` / `Cluster not found`** when running an `aws ecs run-task` or update-service command — preflight exports were lost. Re-run step 1.

- **`CannotPullContainerError ... not found`** in task `stoppedReason` — the `container_image_tag` in `terraform.tfvars` references a tag that doesn't exist in ECR. Verify with `aws ecr describe-images --repository-name ztdr-dev --region us-east-1 --query 'imageDetails[].imageTags' --output text`. Common cause: typed `0.1.4` but the image was pushed as `v0.1.4` (or vice versa).

- **`ECS was unable to assume the role 'arn:aws:iam::...:role/ztdr-dev-task'`** — the task role's trust policy condition on `aws:SourceArn` doesn't match what AWS actually passes. The current code uses AWS's documented broad pattern `arn:aws:ecs:${region}:${account}:*` paired with `aws:SourceAccount`. If a "tighter" pattern was reintroduced (cluster ARN, task-specific ARN), it will silently fail to match and ECS won't be able to assume the role. See `infra/modules/compute/iam.tf`.

- **Container exits with code 1 and CloudWatch shows `User: ... is not authorized to perform: secretsmanager:GetSecretValue`** — task role is missing the inline policy that grants Secrets Manager access. Should be present as `aws_iam_role_policy.task_inline` in `infra/modules/compute/iam.tf` covering `var.master_user_secret_arn` (and its suffixed wildcard) plus `kms:Decrypt` on the CMK with `kms:ViaService = secretsmanager`. Flag in case of regression.

- **Container exits with code 1 and CloudWatch shows `Cannot find module '@aws/<x>'`** or similar — the image is missing AWS SDK transitive deps. Dockerfile should copy the full `node_modules` from the builder stage, not cherry-pick scopes. See `Dockerfile` runner stage.

- **Container exits with code 1 and CloudWatch shows `Can't write to /app/node_modules/@prisma/engines`** — the runner stage `COPY` directives are missing `--chown=node:node`. Prisma CLI re-validates engine binaries at runtime and needs to write metadata files; `USER node` can't write to root-owned dirs.

- **Service stuck at `PROVISIONING` or `PENDING`** with no rollout progress — usually a task definition / SG / subnet config issue. Check `aws ecs describe-services --cluster "$CLUSTER" --services ztdr-dev-app --region "$AWS_REGION" --query 'services[0].events[0:5]'` for the most recent event messages, which often name the specific failure (e.g. "task failed ELB health checks", "unable to attach ENI to task").

- **`/api/health` returns 503 from ALB** with otherwise-running tasks — target group has unhealthy targets. Inspect: `aws elbv2 describe-target-health --region "$AWS_REGION" --target-group-arn "$(aws elbv2 describe-target-groups --region "$AWS_REGION" --query "TargetGroups[?contains(TargetGroupName,'ztdr-dev')].TargetGroupArn | [0]" --output text)"` (the lookup `make smoke` uses; the environment stack has no target-group output) to see which targets are draining/unhealthy and why. Common causes: container hasn't finished starting (wait), health check command is failing inside the container (look at task logs), or SG egress from ALB to ECS on port 3000 is blocked.

- **`terraform apply` shows the `aws_db_parameter_group` updating in place** — the module pins `apply_method = "pending-reboot"` on `rds.force_ssl` so this no longer recurs; a parameter-group change in a plan is real, so read it before applying.

- **Plan shows unexpected destroys** — a task def replacement is normal (new revision); a service destroy is NOT normal. If you see destruction of `aws_ecs_service.this[0]` with no recreation, abort the apply and inspect what changed in the module config.

## Related runbooks

- [`build-and-push-image.md`](./build-and-push-image.md) — produce the image this runbook deploys.
- [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) — invoke one-off Prisma tasks against the running cluster.
- [`prisma-client-troubleshooting.md`](./prisma-client-troubleshooting.md) — Prisma-specific issues (`prisma generate`, schema/client mismatches).
