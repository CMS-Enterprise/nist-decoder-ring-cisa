# ECS Migration & Seed Runbook

How to run Prisma migrations and the dev data seed against the running dev RDS instance via one-off ECS Fargate tasks. This is the **third** of three runbooks:

1. [`build-and-push-image.md`](./build-and-push-image.md) — build and push the image to ECR.
2. [`deploy-to-ecs.md`](./deploy-to-ecs.md) — pin tfvars to the new tag, `terraform apply`, verify the service rolls.
3. **This runbook** — invoke the one-off migration / seed tasks against the running cluster.

## When to use this runbook

- **First deploy** of a fresh environment — empty database, needs schema and seed data before the app service can serve traffic.
- **After a Prisma schema change** — migrations need to apply against the running DB.
- **After a change to `app/prisma/seed-sql/`** — the seed ships in the image, so the database keeps its old rows until the seed runs. Also after a `00-cleanup.sql` change or a database reset.

If you're rotating `AUTH_SECRET` or rolling a new image that changes neither the schema nor `app/prisma/seed-sql/`, you don't need this runbook — see Runbook 2. A release that changes the seed files needs step 2 even when it has no migration: the seed ships inside the image, and the database keeps its old rows until the seed runs. An additive migration with new seed files is the quiet case: the app serves without error and simply lacks the new rows.

> **Caution — a destructive schema migration must be paired with a re-seed.** When a migration drops or normalizes columns into a new table (e.g. the `ControlParameter` value columns into `ControlParameterValue`), it intentionally does **not** backfill. The parameter data is seed-derived, and the corrected values exist only in the regenerated seed, so backfilling from the old columns would carry forward the very values the change fixed. Run the migration and the seed together — step 1 then step 2. Applying such a migration migrate-only against a live environment leaves the new table empty until the next seed.

## Prerequisites

- Image pushed to ECR per [`build-and-push-image.md`](./build-and-push-image.md).
- The environment stack applied, including the latest revisions of the `ztdr-dev-migrate` and `ztdr-dev-seed` task definitions: for a first deployment, steps 1 to 3 of "Launching it" in [`aws-deployment.md`](../architecture/aws-deployment.md), which create the task definitions before the service exists; for a release, [`deploy-to-ecs.md`](./deploy-to-ecs.md).
- Preflight exports from Runbook 2 step 1 (`CLUSTER`, `LOG_GROUP`, `PRIVATE_SUBNETS`, `ECS_SG`, `AWS_REGION`).

If you're picking this up in a fresh shell, re-run the preflight block from [`deploy-to-ecs.md`](./deploy-to-ecs.md#1-preflight-exports) before the steps below.

## 1. Run Prisma migrations

The `ztdr-dev-migrate` task definition shares the app's image but overrides the container `command` to `["node", "node_modules/.bin/prisma", "migrate", "deploy"]`. The container's entrypoint composes `DATABASE_URL` from the RDS-managed master user secret first, then execs the override command.

**With make:**

```bash
AWS_PROFILE=<env-profile> make ecs-run-migrate ENV=dev
```

It reads the private subnets and the ECS security group from the environment's Terraform output, starts the `ztdr-dev-migrate` task, waits for it to stop, prints its exit code and its log stream, and fails unless the task exited 0. The expected log is below.

**By hand**, when the target fails or you need one step at a time:

**Start the task:**

```bash
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "ztdr-dev-migrate" --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}" --region "$AWS_REGION" --query 'tasks[0].taskArn' --output text); echo "$TASK_ARN"
```

Save the printed ARN. Wait ~45–60 seconds for the task to provision, run, and stop.

**Check status:**

```bash
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$AWS_REGION" --query 'tasks[0].{Status:lastStatus,ExitCode:containers[0].exitCode,StopCode:stopCode,Reason:stoppedReason}' --output json
```

Possible outcomes:
- `Status: STOPPED, ExitCode: 0` — migrations applied successfully. Continue to step 2.
- `Status: STOPPED, ExitCode: 1` — migration failed. Pull logs (below) to see why.
- `Status: PROVISIONING / PENDING / RUNNING` — not done yet. Wait 30s and re-check.

**Pull logs:**

```bash
TID=$(echo "$TASK_ARN" | awk -F/ '{print $NF}'); aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "task/migrate/$TID" --region "$AWS_REGION" --start-from-head --query 'events[].message' --output text
```

Expected on success:
```
[entrypoint] DATABASE_URL composed for ztdr-dev.<...>.rds.amazonaws.com:5432/zt_decoder_ring (user=ztdecoder)
Prisma schema loaded from prisma/schema.prisma
N migrations found in prisma/migrations
The following migration(s) have been applied:
...
All migrations have been successfully applied.
```

With nothing new to apply, the last line is `No pending migrations to apply.`

## 2. Seed the database

The `ztdr-dev-seed` task definition runs `app/prisma/seed-ecs.ts` via the `tsx` loader. The seed reads the numbered SQL files from `app/prisma/seed-sql/<catalog>/` (`00` through `19` for `nist-800-53`, 20 files) in order and runs each through the `pg` driver as a single multi-statement query. The catalog is declared by `SEED_CATALOG` or `--catalog`, never inferred.

**With make:** `AWS_PROFILE=<env-profile> make ecs-run-seed ENV=dev` runs the `ztdr-dev-seed` task the same way.

**By hand**, the same pattern as step 1 — start, wait, check, pull logs:

```bash
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "ztdr-dev-seed" --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}" --region "$AWS_REGION" --query 'tasks[0].taskArn' --output text); echo "$TASK_ARN"
```

```bash
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$AWS_REGION" --query 'tasks[0].{Status:lastStatus,ExitCode:containers[0].exitCode,Reason:stoppedReason}' --output json
```

```bash
TID=$(echo "$TASK_ARN" | awk -F/ '{print $NF}'); aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "task/seed/$TID" --region "$AWS_REGION" --start-from-head --query 'events[].message' --output text
```

Expected on success:
```
[entrypoint] DATABASE_URL composed for ...
[seed-ecs] catalog=nist-800-53 files=20
[seed-ecs] 00-cleanup.sql
[seed-ecs] 01-system-user.sql
...
[seed-ecs] 19-zt-references-omb.sql
[seed-ecs] Completed 20 file(s)
```

A file that fails ends the run. The task exits 1 and logs `[seed-ecs] Partial seed: loaded N of 20 file(s) (…); failed at <file>; not run: …`, then `[seed-ecs] Failed:` with the error. `make ecs-run-seed` fails on the exit code, and the `Failed` line raises the seed-failed alarm.

## 3. Verify the app sees the data

Hit the app over HTTPS and confirm seeded data is visible. `APP_URL` comes from the preflight exports; the app answers once `enable_https_listener` is on:

```bash
curl -s "$APP_URL/" | head -50
```

The home page should show 20 control families with non-zero counts. If you get a "no data" view or 500, check the app's CloudWatch log stream (prefix `app/app/`) for query errors.

## Logs deep-dive (when something fails)

`make ecs-run-migrate` and `make ecs-run-seed` already print the log of the task they start. To confirm whether a task ran at all, `AWS_PROFILE=<env-profile> make ecs-tasks-list ENV=dev FAMILY=ztdr-dev-migrate` lists the five most recent stopped tasks of a family.

By hand, single-line commands for hunting through CloudWatch — no backslash continuations.

**List all task streams ordered by recent activity:**

```bash
aws logs describe-log-streams --log-group-name "$LOG_GROUP" --log-stream-name-prefix "task/" --order-by LastEventTime --descending --max-items 10 --region "$AWS_REGION" --query 'logStreams[].{Stream:logStreamName,LastEvent:lastEventTimestamp}' --output table
```

**Pull the most recent migrate task's full log:**

```bash
TID=$(aws ecs list-tasks --cluster "$CLUSTER" --desired-status STOPPED --family ztdr-dev-migrate --region "$AWS_REGION" --max-items 1 --query 'taskArns[0]' --output text | awk -F/ '{print $NF}'); aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "task/migrate/$TID" --region "$AWS_REGION" --start-from-head --query 'events[].message' --output text
```

(Swap `--family ztdr-dev-migrate` → `ztdr-dev-seed` for seed tasks, or `ztdr-dev-app` for the app service.)

**Search across all streams for a specific error pattern over the last 24h:**

```bash
aws logs filter-log-events --log-group-name "$LOG_GROUP" --region "$AWS_REGION" --start-time $(( ($(date +%s) - 86400) * 1000 )) --filter-pattern '"MODULE_NOT_FOUND"' --query 'events[].[logStreamName, message]' --output text
```

**ECS-level failure (when the task never started, so no CloudWatch stream exists):**

```bash
aws ecs list-tasks --cluster "$CLUSTER" --desired-status STOPPED --region "$AWS_REGION" --max-items 10 --query 'taskArns' --output text | tr '\t' '\n' | while read t; do aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$t" --region "$AWS_REGION" --query 'tasks[0].{Family:taskDefinitionArn,StopCode:stopCode,Reason:stoppedReason,Exit:containers[0].exitCode}' --output json; done
```

`StopCode = TaskFailedToStart` with no log stream usually means image-pull error or IAM denial before the container ever ran — see [`deploy-to-ecs.md`](./deploy-to-ecs.md#troubleshooting-faq).

---

## Troubleshooting FAQ — migration/seed-specific

- **Migration task exits 1 with `Error: The datasource.url property is required` in logs** — two known causes:
  1. **`prisma.config.ts` not copied into the runner image.** The config file lives at `app/prisma.config.ts` (NOT inside `app/prisma/`), and the runner stage of `Dockerfile` must explicitly `COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts`. Without it, Prisma can't find the config; `schema.prisma` has no `url = env(...)`, so there's no fallback. Verify the COPY is present in `Dockerfile`.
  2. **`prisma.config.ts` regression — using the `env()` helper.** The config should read `process.env.DATABASE_URL ?? ""` directly, not `env('DATABASE_URL')` from `prisma/config`. The helper doesn't pick up env vars set by a parent process via `spawn()`. See the long comment block at the top of `app/prisma.config.ts` for why.

- **Migration task exits 1 with `prisma:warn Prisma failed to detect the libssl/openssl version`** as the only output — this warning is harmless and migrations should still proceed. If they don't, see [`prisma-client-troubleshooting.md`](./prisma-client-troubleshooting.md).

- **Migration task exits 0 but app still returns 503 at `/api/health`** — service hasn't finished rolling onto the new task def revision. Wait for `aws ecs wait services-stable` (Runbook 2 step 5) or force a new deployment with `AWS_PROFILE=<env-profile> make ecs-redeploy ENV=dev`, which waits for the service to stabilise (by hand: `aws ecs update-service --cluster "$CLUSTER" --service ztdr-dev-app --force-new-deployment --region "$AWS_REGION"`).

- **Seed task exits 1 with a `[seed-ecs] Partial seed` line** — a SQL file errored. The line names the file that failed and the ones that did not run, and the `[seed-ecs] Failed:` line after it carries the error. Common causes: schema drift between migrations and seed SQL (run migrations first), bad data in `09-zt-mappings.sql` from a regenerated CSV. Re-run the seed pipeline (`make zt-overlay` for the Zero Trust files) and rebuild the image.

- **Seed task exits with `relation "..." does not exist`** — migrations haven't run yet. Always migrate first (step 1), then seed (step 2). Re-running migrations on top of a partial seed is safe; re-running the seed on top of a clean migrated DB will hit `00-cleanup.sql` first and reset the data.

- **Migration task exits 1 with IAM/auth error** (`is not authorized to perform: secretsmanager:GetSecretValue` or `ECS was unable to assume the role`) — see [`deploy-to-ecs.md`](./deploy-to-ecs.md#troubleshooting-faq) for IAM regressions.

- **Running app suddenly returns `Authentication failed against the database server, the provided database credentials for 'ztdecoder' are not valid`** on every tRPC/Prisma call, with no recent deploy and a healthy database — the RDS-managed master-user secret auto-rotated and the long-running app task is still using the password it read at startup. RDS-managed secrets rotate on a 7-day schedule by default; `entrypoint.mjs` composes `DATABASE_URL` once at container start and never re-reads the secret, so a task that crosses a rotation boundary goes stale. This bites whichever environment's service runs across a rotation, which is any environment serving traffic.

  **Workaround — force a fresh task** so `entrypoint.mjs` re-reads the current secret (zero-downtime rolling deploy). With make, `AWS_PROFILE=<env-profile> make ecs-redeploy ENV=<env>` forces the deployment and waits for the service to stabilise. By hand:

  ```bash
  AWS_PROFILE=<env-profile> aws ecs update-service \
    --cluster <name_prefix>-<env> --service <name_prefix>-<env>-app \
    --force-new-deployment --region us-east-1 --no-cli-pager
  AWS_PROFILE=<env-profile> aws ecs wait services-stable \
    --cluster <name_prefix>-<env> --services <name_prefix>-<env>-app --region us-east-1
  ```

  Confirm recovery with a tRPC call, e.g. `curl -sS 'https://<fqdn>/api/trpc/decoder.getActiveVersion?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D'`. With `enable_rotation_auto_redeploy` on, each rotation triggers this redeploy itself ([`secret-rotation-auto-redeploy.md`](./secret-rotation-auto-redeploy.md)); with it off, repeat it after every rotation.

- **Migration task hits `exec format error` or missing `@aws-*` modules** — image build problem, not migration problem. See [`build-and-push-image.md`](./build-and-push-image.md#troubleshooting-faq).

## Running against prod

The `make ecs-run-migrate` / `make ecs-run-seed` wrappers take `ENV=dev|prod` and default to `dev`, like every target that reads `ENV`. For prod, set `AWS_PROFILE` to the prod deploy role and pass `ENV=prod`:

```bash
AWS_PROFILE=<prod-deploy-profile> make ecs-run-migrate ENV=prod
AWS_PROFILE=<prod-deploy-profile> make ecs-run-seed    ENV=prod
```

The recipe internally `cd`s into `infra/environments/prod`, pulls `private_subnet_ids` and `ecs_security_group_id` from the prod state, and targets task families `ztdr-prod-migrate` / `ztdr-prod-seed` against cluster `ztdr-prod` with log group `/ecs/ztdr-prod`. The prod profile has no default region, so the underlying CLI calls pass `--region us-east-1` explicitly.

To save cost while an environment is idle, scale its service to zero and back with `make ecs-scale ENV=<env> COUNT=0` (then `COUNT=1`; the service defaults to the app service). Nothing does this by default: a deployment serves traffic until it is scaled down.

## Related runbooks

- [`refresh-reference-links.md`](./refresh-reference-links.md) — refresh the reference links before a release so the seed carries that date.

- [`build-and-push-image.md`](./build-and-push-image.md) — produce the image these tasks run.
- [`deploy-to-ecs.md`](./deploy-to-ecs.md) — register the task definitions and roll the service.
- [`prisma-client-troubleshooting.md`](./prisma-client-troubleshooting.md) — Prisma-specific issues (`prisma generate`, schema/client mismatches).
