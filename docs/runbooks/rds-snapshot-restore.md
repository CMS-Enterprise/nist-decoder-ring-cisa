# RDS snapshot restore / disaster recovery (ztdr-&lt;env&gt;)

## What this is / when to use

Recover an `<name_prefix>-<env>` Postgres database after data loss or corruption, from either an RDS snapshot or a point-in-time (PITR). This is the **failure-case** procedure; it pairs with the recovery plan in [`prod-db-recovery.md`](./prod-db-recovery.md).

It is **CLI/runbook-driven on purpose** — the restore is never done through Terraform against the live instance (see Principles). Read the principles before touching anything.

## Principles (read first)

- **RDS cannot restore in place.** Every restore — snapshot or PITR — creates a **new** instance with a **new** endpoint. There is no "restore over the existing DB."
- **Never restore via Terraform on the live `module.database` block.** Setting `snapshot_identifier` (or a `restore_to_point_in_time` block) there forces a destroy + recreate of the *live* instance. `deletion_protection = true` is set on prod precisely so such an apply **fails closed** instead of destroying data — treat any prod plan that wants to replace `module.database` as a stop-and-investigate signal.
- **Restore is additive; cutover is deliberate.** Stand the restored instance up *alongside* the live one, validate it, then cut the app over in an **off-hours window**. Decommission the old instance only after a soak. Avoid destructive actions on the live prod DB during business hours.

## Prerequisites

- `AWS_PROFILE` for the target account (prod: `<prod-deploy-profile>`; dev: `<dev-admin-profile>`), `--region us-east-1`, `--no-cli-pager` on every call. Those stand for whatever profiles the estate issues for its prod deploy role and its dev administrator role.
- Decide the recovery source: a specific snapshot, or a point in time within the backup-retention window (prod retains 30 days, set by `db_backup_retention_period`).

## Step 1 — capture the live instance's config

The restore does **not** inherit subnet group, security groups, parameter group, or instance class — you pass them explicitly. Read them off the live instance so the restored one matches:

```bash
LIVE=ztdr-prod   # or ztdr-dev
aws rds describe-db-instances --db-instance-identifier "$LIVE" --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].{class:DBInstanceClass,sg:VpcSecurityGroups[].VpcSecurityGroupId,
           subnet:DBSubnetGroup.DBSubnetGroupName,pg:DBParameterGroups[0].DBParameterGroupName,
           kms:KmsKeyId,multiaz:MultiAZ}'
```

## Step 2 — identify the snapshot or recovery point

```bash
# Most recent automated snapshots:
aws rds describe-db-snapshots --db-instance-identifier "$LIVE" --snapshot-type automated \
  --region us-east-1 --no-cli-pager \
  --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[:5].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table

# Or, for PITR, the latest restorable time:
aws rds describe-db-instances --db-instance-identifier "$LIVE" --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].LatestRestorableTime'
```

## Step 3 — restore to a NEW instance

Snapshot restore (substitute the values from Step 1):

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier ztdr-prod-restore \
  --db-snapshot-identifier <snapshot-id> \
  --db-subnet-group-name <subnet> --vpc-security-group-ids <sg> \
  --db-parameter-group-name <pg> --db-instance-class <class> \
  --no-publicly-accessible --no-multi-az \
  --region us-east-1 --no-cli-pager

aws rds wait db-instance-available --db-instance-identifier ztdr-prod-restore --region us-east-1
```

PITR variant: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$LIVE" --target-db-instance-identifier ztdr-prod-restore --restore-time <ts>` + the same networking/class flags.

> **Master credentials gotcha:** `restore-db-instance-from-db-snapshot` does **not** accept `--manage-master-user-password` / `--master-user-secret-kms-key-id` — there is no such parameter (for PITR it exists but is Oracle-only). The restored instance inherits the *source's* master user, and for a managed-password source that password is not retrievable. So mint a fresh managed secret on the restored instance with a follow-up `modify`:

```bash
aws rds modify-db-instance --db-instance-identifier ztdr-prod-restore \
  --manage-master-user-password --master-user-secret-kms-key-id <kms> \
  --apply-immediately --region us-east-1 --no-cli-pager
aws rds wait db-instance-available --db-instance-identifier ztdr-prod-restore --region us-east-1

# The new managed secret ARN the app will point at:
aws rds describe-db-instances --db-instance-identifier ztdr-prod-restore --region us-east-1 \
  --no-cli-pager --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text
```

- **KMS access:** `--master-user-secret-kms-key-id <cmk>` requires the DR operator's role to have `kms:CreateGrant` + use on that CMK. If the key policy doesn't grant the operator (the `modify` then fails with `KMSKeyNotAccessibleFault`), either grant the DR role KMS access to the secrets CMK first, or **omit the flag** to use the AWS-managed `aws/secretsmanager` key. Prod should use the prod secrets CMK, so confirm the DR role's KMS grant ahead of an incident.
- Confirm the parameter group enforces SSL — it should carry `rds.force_ssl = 1` (`apply_method = pending-reboot`; see the force_ssl note in `infra/modules/database`). Re-attach the param group + reboot if it didn't carry.

## Step 4 — validate the restored instance

```bash
HOST=$(aws rds describe-db-instances --db-instance-identifier ztdr-prod-restore --region us-east-1 \
  --no-cli-pager --query 'DBInstances[0].Endpoint.Address' --output text)
SECRET_ARN=$(aws rds describe-db-instances --db-instance-identifier ztdr-prod-restore --region us-east-1 \
  --no-cli-pager --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
# Pull creds from $SECRET_ARN (secretsmanager get-secret-value), then psql to $HOST and sanity-check:
#   SELECT count(*) FROM "ControlFamily";  -- expect 20
#   SELECT status, count(*) FROM "NistControl" GROUP BY status;  -- expect LIVE 1014, WITHDRAWN 182
#   SELECT count(*) FROM "ControlLineage";  -- expect 203
```

## Step 5 — cut the app over (OFF-HOURS)

The app composes `DATABASE_URL` at boot from `DB_SECRET_ARN` + the DB host env on the ECS task definition (`app/entrypoint.mjs`). Cut over by pointing those at the restored instance:

- **Break-glass (fast):** register a new task-def revision with `DB_SECRET_ARN` = the restored secret ARN and the DB host = the restored endpoint, then point the service at it with `aws ecs update-service --cluster <name_prefix>-<env> --service <name_prefix>-<env>-app --task-definition <family>:<new-revision>`. `make ecs-redeploy` is not enough here: it redeploys the revision the service already runs. Then reconcile Terraform (Step 6) afterward.
- **IaC-clean (slower):** reconcile Terraform first (Step 6) so the service redeploys from state.
- **Either way, the app task role must be able to read the restored secret.** Its secret permission covers only the original master secret's ARN and that ARN with a `*` suffix (`infra/modules/compute/iam.tf`), so the break-glass path also needs a grant on the restored `rds!db-…` secret; the IaC path gets it once state names the restored instance.
- Smoke: `AWS_PROFILE=<env-profile> DNS_FQDN_<env>=<app_fqdn> make smoke ENV=<env>` (the target needs the hostname); confirm `/api/health` *and* a data-backed call (the health check alone won't catch a bad DB pointer).

## Step 6 — reconcile Terraform (the IaC tension)

After a CLI restore, `module.database` in state still points at the **old** instance. Once the app is stable on the restored instance:

- Point the module at the restored instance and reconcile state — `terraform state rm` the old `aws_db_instance` + `terraform import` the restored one (or rename identifiers and import). 
- Verify `terraform plan` shows **no destructive diff** before any prod apply.
- **Until reconciled, do not run a prod `terraform apply`** — it would try to recreate the old instance or fight the cutover.

## Step 7 — decommission the old instance (after a soak)

```bash
aws rds create-db-snapshot --db-instance-identifier ztdr-prod-old \
  --db-snapshot-identifier ztdr-prod-pre-dr-$(date +%Y%m%d) --region us-east-1 --no-cli-pager
# deletion_protection must be off to delete; re-enable it on the restored (now primary) instance.
aws rds delete-db-instance --db-instance-identifier ztdr-prod-old \
  --final-db-snapshot-identifier ztdr-prod-final-$(date +%Y%m%d) --region us-east-1 --no-cli-pager
```

---

## Dev dry-run — validate this runbook without touching prod

The whole flow is exercisable in **dev**, additively — the dev *live* DB (`ztdr-dev`) is never touched; the restore creates a throwaway instance you delete at the end. Run this to prove the commands, the timing, and the cutover steps before you ever need them in anger.

**With make:** `AWS_PROFILE=<dev-profile> make db-dr-test ENV=dev` runs steps 1 to 4 below: it snapshots the live instance, restores the snapshot to `<instance>-restore-test` with the live instance's class, security group, subnet group and parameter group, enables a managed master secret on the restore and prints its connection details (`scripts/dr-restore-test.sh`). The cutover in step 5 stays by hand. `make db-dr-teardown ENV=dev` is step 6, and always run it.

**By hand**, when the target fails or to walk the steps one at a time:

```bash
export AWS_PROFILE=<dev-admin-profile> AWS_REGION=us-east-1
TS=$(date +%Y%m%d)

# 1. Snapshot dev (or reuse an automated one from Step 2)
aws rds create-db-snapshot --db-instance-identifier ztdr-dev \
  --db-snapshot-identifier ztdr-dev-drtest-$TS --region us-east-1 --no-cli-pager
aws rds wait db-snapshot-completed --db-snapshot-identifier ztdr-dev-drtest-$TS --region us-east-1

# 2-4. Steps 1-4 against ztdr-dev, restoring to a throwaway identifier:
#      LIVE=ztdr-dev, target = ztdr-dev-restore-test. Validate row counts.

# 5. OPTIONAL: cut the dev app over to ztdr-dev-restore-test + smoke, then cut back.
#    (Skip if you only want to validate restore + data; the dev app stays on ztdr-dev.)

# 6. TEAR DOWN — no final snapshot, no lingering cost:
aws rds delete-db-instance --db-instance-identifier ztdr-dev-restore-test \
  --skip-final-snapshot --delete-automated-backups --region us-east-1 --no-cli-pager
aws rds delete-db-snapshot --db-snapshot-identifier ztdr-dev-drtest-$TS --region us-east-1 --no-cli-pager
```

- **Cost:** one `db.t4g.micro` for ~30-60 min ≈ negligible; the teardown step is what keeps it that way — always run it.
- **Non-destructive:** Steps 1-4 + 6 never touch `ztdr-dev`. Only the optional Step 5 repoints the dev app, and it cuts back.
- **Cadence:** run quarterly, and after any DB engine/version bump or networking change. Record each run below.

### Dry-run history

Record each run here.

| Date | Env | Restore→available | Validation | Cutover tested? | Torn down? | Notes |
|---|---|---|---|---|---|---|

## Notes

- Restore time scales with DB size; snapshot-restored storage is lazily loaded, so the first touch of cold blocks is slower until the volume warms.
- **Not built: RDS IAM auth, which would restore with no app DB secret.** Once the app authenticates via IAM database auth (short-lived tokens as a dedicated `ztdr_app` user) instead of the managed master secret, the secret steps above (mint via `modify`, repoint `DB_SECRET_ARN`, grant the task role) **drop out** — there's no app secret to handle. The IAM-auth DB user + its `rds_iam` grant live *inside* the snapshot, so they're present in the restored instance automatically. Two things still apply on restore: (1) **re-enable IAM database authentication** on the restored instance (`--enable-iam-database-authentication` on restore, or `modify-db-instance` after — an instance flag that may not carry from the snapshot); (2) the `rds-db:connect` policy is scoped to the instance's **resource ID** (`DbiResourceId`), which changes on restore — so scope it **by username with a wildcard resource ID** (`arn:aws:rds-db:<region>:<acct>:dbuser:*/ztdr_app`) and a DR restore needs **zero IAM change**. Cutover then collapses to a single **`DB_HOST` repoint** to the restored endpoint. (The master user may keep a managed secret for admin/migrate tasks; only the app runtime goes secret-free.)
