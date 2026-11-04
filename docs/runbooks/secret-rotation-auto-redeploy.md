# RDS secret-rotation auto-redeploy

## What this does

The app reads the RDS master DB password once at container boot (`app/entrypoint.mjs`) and bakes it into `DATABASE_URL`. When the RDS-managed master secret auto-rotates, a long-running task keeps the old password and every new DB connection fails Prisma auth (`P1000`) until the task is replaced.

This is handled automatically in **dev and prod** (`enable_rotation_auto_redeploy = true`; see `infra/modules/compute/rotation_redeploy.tf`):

- **Part A — scheduled rotation:** pins the managed-rotation schedule to a low-traffic early-morning UTC window (`cron(0 10 ? * SUN *)` ≈ 06:00 ET Sun) so the unavoidable sub-minute rotation window lands when nobody's using the app.
- **Part B — event-driven redeploy:** an EventBridge rule on the Secrets Manager `RotationSucceeded` event invokes the `<name_prefix>-<env>-rotation-redeploy` Lambda, which calls `ecs:UpdateService(forceNewDeployment=true)`. A fresh task boots, re-reads the rotated secret, and takes over — no human action.

**Manual fallback** (still valid any time): `AWS_PROFILE=<env-profile> make ecs-redeploy ENV=<env>`.

## Self-heal latency benchmark

The end-to-end self-heal is the thing to watch for regressions over time (e.g., a larger image, slower boot, Lambda cold-start growth, or CloudTrail delivery slowdown would all show up here). Re-measure after any change to the image, the entrypoint, the Lambda, or the service health-check config.

### Expected timing

Measured on a dev deployment of this module (one t4g.micro task). Record your own runs in the run history below.

| Stage | Span (UTC) | Duration |
|---|---|---|
| Rotation trigger → Lambda invoked | 05:25:11 → 05:26:26 | ~75s (managed rotation ~60s + CloudTrail→EventBridge delivery + Lambda cold-start init 442ms) |
| Lambda execution (`UpdateService`) | 05:26:26 → 05:26:27 | ~1.1s |
| Deployment created → new task started | 05:26:27 → 05:27:29 | ~63s (schedule + ECR pull + container start) |
| New task started → service stable | 05:27:29 → 05:29:03 | ~94s (health-check startPeriod 40s + old-task drain) |
| **Total: rotation → stable** | **05:25:11 → 05:29:03** | **≈ 3m52s (232s)** |

Result: service stabilized on the new task, **0 auth failures** after the new task came up.

### Regression signals
- **Lambda doesn't fire within ~3 min of rotation** → check the EventBridge rule (`<name_prefix>-<env>-db-secret-rotation`), its event pattern, and that a management-events CloudTrail trail exists in the account/region (events are CloudTrail-sourced).
- **Total self-heal > ~6 min** → check ECR pull time / image size, task health-check `startPeriod`/`interval`, and Lambda duration.
- **Auth failures persist after the new task is HEALTHY** → the new task didn't get the rotated secret; check `entrypoint.mjs` secret read and the secret value.

### Re-measure procedure (dev)

```bash
cd infra/environments/dev
export AWS_PROFILE=<dev-admin-profile> AWS_REGION=us-east-1
SECRET=$(aws ecs describe-task-definition --task-definition ztdr-dev-app --region us-east-1 --no-cli-pager \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='DB_SECRET_ARN'].value | [0]" --output text)

date -u +"rotation trigger: %Y-%m-%dT%H:%M:%SZ"
aws secretsmanager rotate-secret --secret-id "$SECRET" --region us-east-1 --no-cli-pager --query VersionId

# Lambda invocation:
aws logs filter-log-events --log-group-name /aws/lambda/ztdr-dev-rotation-redeploy --region us-east-1 \
  --no-cli-pager --start-time $(date -v-5M +%s)000 --query 'events[].{t:timestamp,m:message}' --output table

# Deployment created -> stabilized:
aws ecs describe-services --cluster ztdr-dev --services ztdr-dev-app --region us-east-1 --no-cli-pager \
  --query 'services[0].deployments[0].{created:createdAt,updated:updatedAt,rollout:rolloutState}'

# Confirm clean:
aws ecs wait services-stable --cluster ztdr-dev --services ztdr-dev-app --region us-east-1
aws logs filter-log-events --log-group-name /ecs/ztdr-dev --region us-east-1 --no-cli-pager \
  --start-time $(date -v-3M +%s)000 --filter-pattern 'Authentication failed' --query 'length(events)'
```

Record the run in the history table below.

### Run history

Record each run here.

| Date | Env | Image | Rotation→Lambda | →Stable (total) | Auth failures after stable | Notes |
|---|---|---|---|---|---|---|

## Long-term note

This is the bridge fix. The north-star is RDS IAM database authentication with a dedicated least-privilege app user — the app would hold no static DB password, the master secret could rotate freely, and this entire workaround (Lambda + EventBridge rule + scheduled rotation) would be removed. Tracked separately.
