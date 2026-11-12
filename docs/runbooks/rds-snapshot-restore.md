# RDS snapshot restore by hand (&lt;name_prefix&gt;-&lt;env&gt;)

## What this is / when to use

Each environment's database is one single-AZ RDS instance, so recovering it means restoring a snapshot, or a point in time (PITR), to a new instance.

**Run the recovery with `make db-recover`** (`scripts/db-recover.sh`), as [`prod-db-recovery.md`](./prod-db-recovery.md) describes: it restores, cuts the app over through Terraform and checks the result, and it is the one recovery runbook. This page holds the AWS commands the script runs, step by step, for when it cannot: the instance is gone (see [When the instance is gone](#when-the-instance-is-gone), which the script does not handle), the app reads an earlier recovery rather than `<name_prefix>-<env>`, a step needs doing differently, or you want to see what a step does. It also covers the restore-only drill, `make db-dr-test`.

Names follow the stacks' `name_prefix`, `ztdr` unless your deployment sets another; the commands set it once as `PREFIX`.

## Principles (read first)

- **RDS cannot restore in place.** Every restore, snapshot or PITR, creates a **new** instance with a **new** endpoint. There is no "restore over the existing DB."
- **Never restore through the live `module.database` block.** Setting `snapshot_identifier` (or a `restore_to_point_in_time` block) there forces a destroy and recreate of the *live* instance. `deletion_protection = true` is set on prod precisely so such an apply **fails closed** instead of destroying data; treat any prod plan that wants to replace `module.database` as a stop-and-investigate signal.
- **Restore is additive; cutover is deliberate.** Stand the restored instance up *alongside* the live one, validate it, then cut the app over through `db_restored_instance_identifier` (Step 5). The live instance is never changed or deleted as part of the recovery.

## Prerequisites

- `AWS_PROFILE` for the target account (prod: `<prod-profile>`; dev: `<dev-profile>`, whatever profiles your organisation issues for each environment's deploy role), `--region` on every call (`us-east-1` below, the stacks' default) and `--no-cli-pager`.
- Decide the recovery source: a specific snapshot, or a point in time within the backup-retention window (prod's committed `terraform.tfvars` keeps 30 days, `db_backup_retention_period`). [`prod-db-recovery.md`](./prod-db-recovery.md#choose-the-source) lists both.

## Step 1 — capture the live instance's config

The restore does **not** inherit subnet group, security groups, parameter group, or instance class; you pass them explicitly. Read them off the live instance so the restored one matches:

```bash
PREFIX=ztdr          # your stacks' name_prefix
LIVE="$PREFIX-prod"  # or "$PREFIX-dev"
aws rds describe-db-instances --db-instance-identifier "$LIVE" --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].{class:DBInstanceClass,sg:VpcSecurityGroups[].VpcSecurityGroupId,
           subnet:DBSubnetGroup.DBSubnetGroupName,pg:DBParameterGroups[0].DBParameterGroupName,
           kms:KmsKeyId,multiaz:MultiAZ,secretKms:MasterUserSecret.KmsKeyId}'
```

If the live instance cannot be described because it is gone, follow [When the instance is gone](#when-the-instance-is-gone) instead.

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

Snapshot restore (substitute the values from Step 1). The new identifier must be `<name_prefix>-<env>-<suffix>`, which is what `db_restored_instance_identifier` accepts:

```bash
NEW="$LIVE-recovered-$(date -u +%Y%m%d-%H%M)"
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "$NEW" \
  --db-snapshot-identifier <snapshot-id> \
  --db-subnet-group-name <subnet> --vpc-security-group-ids <sg> \
  --db-parameter-group-name <pg> --db-instance-class <class> \
  --no-publicly-accessible --no-multi-az --deletion-protection \
  --region us-east-1 --no-cli-pager

aws rds wait db-instance-available --db-instance-identifier "$NEW" --region us-east-1
```

PITR variant: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$LIVE" --target-db-instance-identifier "$NEW" --restore-time <ts>` (or `--use-latest-restorable-time`) with the same networking and class flags. A PITR given none of them comes up with the default security group, subnet group and parameter group: the app cannot reach it and SSL enforcement (SC-8) is silently lost. The `wait` gives up after 30 minutes; run it again until the instance is available.

> **Master credentials gotcha:** `restore-db-instance-from-db-snapshot` does **not** accept `--manage-master-user-password` / `--master-user-secret-kms-key-id`; there is no such parameter (for PITR it exists but is Oracle-only). The restored instance inherits the *source's* master user, and for a managed-password source that password is not retrievable. So mint a fresh managed secret on the restored instance with a follow-up `modify`:

```bash
aws rds modify-db-instance --db-instance-identifier "$NEW" \
  --manage-master-user-password --master-user-secret-kms-key-id <secretKms from Step 1> \
  --backup-retention-period <the live instance's> --apply-immediately --region us-east-1 --no-cli-pager
aws rds wait db-instance-available --db-instance-identifier "$NEW" --region us-east-1

# The secret must be active before the cutover:
aws rds describe-db-instances --db-instance-identifier "$NEW" --region us-east-1 \
  --no-cli-pager --query 'DBInstances[0].MasterUserSecret.{arn:SecretArn,status:SecretStatus}'
```

- **KMS access:** `--master-user-secret-kms-key-id <cmk>` requires the operator's role to have `kms:CreateGrant` and use on that CMK. If the key policy doesn't grant the operator's role, the `modify` fails with `KMSKeyNotAccessibleFault`: either grant the role KMS access to the secrets CMK first, or **omit the flag** to use the AWS-managed `aws/secretsmanager` key. Prod should use the prod secrets CMK, so confirm the role's KMS grant ahead of an incident. The script takes the same choice as `SECRET_KMS_KEY_ID=<key>`.
- **Rotation schedule:** the new secret rotates on RDS's default schedule. Copy the live secret's with `aws secretsmanager rotate-secret --secret-id <new secret> --rotation-rules '{"ScheduleExpression":"cron(0 10 ? * SUN *)","Duration":"2h"}' --no-rotate-immediately`, using the expression the live secret reports (`describe-secret --query RotationRules`).
- Confirm the parameter group enforces SSL: it should carry `rds.force_ssl = 1` (`apply_method = pending-reboot`; see the force_ssl note in `infra/modules/database`). Re-attach the param group and reboot if it didn't carry.

## Step 4 — validate the restored instance

The database is private, so the row counts are read from inside the VPC: after the cutover, `make db-recover ENV=<env> PHASE=verify TARGET=<id> CONFIRM=yes` runs the check as a one-off task on the seed task definition. Before a cutover, compare the configuration with Step 1's:

```bash
aws rds describe-db-instances --db-instance-identifier "$NEW" --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].{class:DBInstanceClass,sg:VpcSecurityGroups[].VpcSecurityGroupId,subnet:DBSubnetGroup.DBSubnetGroupName,pg:DBParameterGroups[0].DBParameterGroupName,endpoint:Endpoint.Address}'
```

## Step 5 — cut the app over (through Terraform)

The app composes `DATABASE_URL` at boot from `DB_HOST`, `DB_SECRET_ARN` and the rest of its task definition (`app/entrypoint.mjs`), and its task role may read only the secret it is given (`infra/modules/compute/iam.tf`). Setting `db_restored_instance_identifier` moves both to the restored instance in one apply. Run it where the stack is initialised, with its `backend.hcl` and the `*.auto.tfvars` that supply its inputs:

```bash
cd infra/environments/prod
terraform init -backend-config=backend.hcl
terraform plan -var "db_restored_instance_identifier=$NEW" \
  -var container_image_tag=<the tag the app runs> -out=cutover.tfplan
# Apply only if the plan replaces task definitions, updates the app service, the two task-role
# policies and the two RDS alarms, rebuilds the rotation Lambda's packaging step, reads data
# sources, and does nothing else
terraform apply cutover.tfplan
aws ecs wait services-stable --cluster "$PREFIX-prod" --services "$PREFIX-prod-app" --region us-east-1
```

Then commit the variable to `terraform.tfvars`, as [`prod-db-recovery.md`](./prod-db-recovery.md#terraform-after-the-cutover) describes, and verify. Do not register a task definition or grant the task role by hand: Terraform reverts both on the next apply.

## Step 6 — afterwards

What to do with the original instance, and how to bring the restored one under Terraform, is in [`prod-db-recovery.md`](./prod-db-recovery.md#terraform-after-the-cutover). Never delete the original during the recovery.

## When the instance is gone

`make db-recover` does not handle this case: it copies the live instance's configuration and leaves the instance in place, so it stops when `<name_prefix>-<env>` cannot be described. This procedure has not been rehearsed; walk it in dev before relying on it.

When the instance has been deleted, Terraform's state still records it, so a plain `plan` of the environment wants to create a new, empty `<name_prefix>-<env>`. Do not apply that. The identifier is free now, so restore under the module's own name and hand the instance back to the module.

1. **Find a source.** Deleting through Terraform takes a final snapshot (prod sets `db_skip_final_snapshot = false`), named `final-<name_prefix>-<env>-<suffix>`, and removes the automated backups. A deletion outside Terraform may have kept them instead. Check both:

   ```bash
   aws rds describe-db-snapshots --region us-east-1 --no-cli-pager \
     --query "DBSnapshots[?starts_with(DBSnapshotIdentifier,'final-$LIVE')].[DBSnapshotIdentifier,SnapshotCreateTime,Status]" --output table
   aws rds describe-db-instance-automated-backups --db-instance-identifier "$LIVE" --region us-east-1 --no-cli-pager \
     --query 'DBInstanceAutomatedBackups[].[DBInstanceAutomatedBackupsArn,RestoreWindow.LatestTime]' --output table
   ```

2. **Read the configuration from Terraform.** The subnet group, the database security group and the parameter group outlive the instance. Read their names from state (`terraform state list | grep -E 'db_subnet|db_sg|db_parameter_group'`, then `terraform state show` on each) and the class from the database module (`db.t4g.micro` unless your deployment changed it).
3. **Restore to `<name_prefix>-<env>` itself.** Step 3 above, with `--db-instance-identifier "$LIVE"` (or, from retained backups, `restore-db-instance-to-point-in-time --source-db-instance-automated-backups-arn <arn> --target-db-instance-identifier "$LIVE"`) and the values from step 2. Do not add `--manage-master-user-password`; the module enables it in step 5.
4. **Hand the instance back to the module:**

   ```bash
   cd infra/environments/prod
   terraform state rm 'module.database.module.rds.module.db_instance.aws_db_instance.this[0]'
   terraform import 'module.database.module.rds.module.db_instance.aws_db_instance.this[0]' "$LIVE"
   terraform plan
   ```

5. **Read the plan before applying it.** Expect in-place updates to the instance (the managed master password, tags, settings the restore did not carry) and, because the new instance's master secret is new, to the app's task definitions, the task roles' secret grants and the rotation schedule. Stop if the plan replaces or deletes the database instance. Apply it; the changed task definitions roll the app service.
6. **Verify by hand.** `DNS_FQDN_prod=<app_fqdn> make smoke ENV=prod`, then a data-backed request as in [`prod-deploy.md`](./prod-deploy.md#post-deploy-verification). The script's verify phase does not apply here: it checks a restored `<name_prefix>-<env>-<suffix>` instance, not the module's own.

---

## Restore-only drill: `make db-dr-test`

The restore half is exercisable in **dev**, additively: the dev *live* DB (`<name_prefix>-dev`) is never touched. The full rehearsal, with the cutover and the row-count check, is in [`prod-db-recovery.md`](./prod-db-recovery.md#rehearse-it-in-dev).

**With make:** `AWS_PROFILE=<dev-profile> make db-dr-test ENV=dev` (with `NAME_PREFIX=<prefix>` if yours is not `ztdr`) runs steps 1 to 3: it snapshots the live instance, restores the snapshot to `<instance>-restore-test` with the live instance's class, security group, subnet group and parameter group, enables a managed master secret on the restore and prints its connection details (`scripts/dr-restore-test.sh`). It does not cut over. `make db-dr-teardown ENV=dev` deletes the instance and its drtest snapshots; always run it.

**By hand**, when the target fails or to walk the steps one at a time:

```bash
export AWS_PROFILE=<dev-profile> AWS_REGION=us-east-1
PREFIX=ztdr   # your stacks' name_prefix
TS=$(date +%Y%m%d)

# 1. Snapshot dev (or reuse an automated one from Step 2)
aws rds create-db-snapshot --db-instance-identifier "$PREFIX-dev" \
  --db-snapshot-identifier "$PREFIX-dev-drtest-$TS" --region us-east-1 --no-cli-pager
aws rds wait db-snapshot-completed --db-snapshot-identifier "$PREFIX-dev-drtest-$TS" --region us-east-1

# 2-4. Steps 1-4 against the dev instance, restoring to a throwaway identifier:
#      LIVE="$PREFIX-dev", NEW="$PREFIX-dev-restore-test".

# 5. TEAR DOWN: no final snapshot, no lingering cost:
aws rds delete-db-instance --db-instance-identifier "$PREFIX-dev-restore-test" \
  --skip-final-snapshot --delete-automated-backups --region us-east-1 --no-cli-pager
aws rds delete-db-snapshot --db-snapshot-identifier "$PREFIX-dev-drtest-$TS" --region us-east-1 --no-cli-pager
```

- **Cost:** one `db.t4g.micro` for ~30-60 min ≈ negligible; the teardown step is what keeps it that way, so always run it.
- **Cadence:** run quarterly, and after any DB engine/version bump or networking change. Record each run below.

### Dry-run history

Record your runs here.

| Date | Env | Restore→available | Validation | Cutover tested? | Torn down? | Notes |
|---|---|---|---|---|---|---|

## Notes

- Restore time scales with DB size; snapshot-restored storage is lazily loaded, so the first touch of cold blocks is slower until the volume warms.
- **Not built: RDS IAM auth, which would restore with no app DB secret.** Once the app authenticates via IAM database auth (short-lived tokens as a dedicated `ztdr_app` user) instead of the managed master secret, the secret steps above (mint via `modify`, repoint `DB_SECRET_ARN`, grant the task role) **drop out** — there's no app secret to handle. The IAM-auth DB user + its `rds_iam` grant live *inside* the snapshot, so they're present in the restored instance automatically. Two things still apply on restore: (1) **re-enable IAM database authentication** on the restored instance (`--enable-iam-database-authentication` on restore, or `modify-db-instance` after — an instance flag that may not carry from the snapshot); (2) the `rds-db:connect` policy is scoped to the instance's **resource ID** (`DbiResourceId`), which changes on restore — so scope it **by username with a wildcard resource ID** (`arn:aws:rds-db:<region>:<acct>:dbuser:*/ztdr_app`) and a DR restore needs **zero IAM change**. Cutover then collapses to a single **`DB_HOST` repoint** to the restored endpoint. (The master user may keep a managed secret for admin/migrate tasks; only the app runtime goes secret-free.)
