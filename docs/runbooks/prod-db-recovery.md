# Database recovery (single-AZ)

How to recover the ZT Decoder Ring database when the instance is lost or its data is damaged, in prod or dev, with `scripts/db-recover.sh`. This is the one recovery runbook. [`rds-snapshot-restore.md`](./rds-snapshot-restore.md) holds the AWS commands the script runs, for working by hand when it cannot.

Names below follow the stacks: every resource is named `<name_prefix>-<env>-...`, where `name_prefix` is the stacks' variable, `ztdr` unless your deployment sets another. The scripts and Make targets take the same value as `NAME_PREFIX`. `<prod-profile>` and `<dev-profile>` stand for the AWS profiles your organisation issues for each environment's deploy role, and the commands use `us-east-1`, the stacks' default region; set `AWS_REGION` and `--region` to yours if it differs.

## The recovery path

Each environment runs one RDS for PostgreSQL instance, `<name_prefix>-<env>`, in one Availability Zone, on the database module's `db.t4g.micro` default. There is no standby to fail over to. Losing the instance, or its data, is recovered by restoring a snapshot, or a point in time, to a new instance and pointing the app at it.

A standby is yours to choose: `multi_az` on the rds module in `infra/modules/database`. It shortens recovery from an Availability Zone or hardware failure and does nothing for lost or corrupted data, which only a restore recovers, so this runbook applies either way. How long a recovery may take is your recovery time objective to set; [RTO and RPO](#rto-and-rpo) gives reference figures. Until the cutover, the app reads the damaged instance, or nothing if that instance cannot serve.

`scripts/db-recover.sh` does the whole path, from a workstation (`make db-recover`) or from a manually triggered workflow your repository can enable. It runs three phases:

1. **Restore.** It reads the live instance's configuration, checks the app reads that instance and that a snapshot given is that instance's own, restores the snapshot or point in time to a new instance with that configuration, gives the new instance an RDS-managed master secret under the live secret's KMS key, copies the live secret's rotation schedule to it, and confirms the configuration carried across: class, subnet group, security groups, parameter group, storage type, encryption at rest and its KMS key, the CloudWatch log exports, IAM database authentication, the CA certificate, multi-AZ, deletion protection and backup retention each equal the live instance's, the new instance is not publicly accessible, and its managed secret is active. Any difference stops the run before the cutover, naming the setting.
2. **Cutover.** It points the app at the new instance through Terraform, by planning with `db_restored_instance_identifier` set and with the image the app already runs. It applies only when every change in the plan is part of the app's database wiring: the task definitions replaced, the app service and the two task-role secret grants updated, the RDS alarms moved, the rotation Lambda's packaging step rebuilt, data sources read. Anything else refuses the plan, with each refused address listed and nothing applied. Then it waits for the app service to settle.
3. **Verify.** It confirms the app service reads the new instance and the load balancer's targets are healthy, then runs a one-off task inside the VPC that checks every table the deployed image's seed loads holds the rows the seed writes, and that every migration the image carries is applied.

It is safe by default. Without `CONFIRM=yes` (`--execute`) it prints every step and calls nothing. It never changes or deletes the live instance: the live instance is only described, or named as the source of a point-in-time restore, and the cutover refuses any Terraform plan that would change the database module. Each step prints the time it started, so a run's timings can be recorded.

Do not cut over by hand, by registering a task definition with the restored host and secret and pointing the service at it. Terraform owns that wiring, and the next `terraform apply` puts the app back on the original instance. `db_restored_instance_identifier` is the cutover Terraform keeps.

## When the script applies

The script recovers `<name_prefix>-<env>` while that instance still exists, however damaged: its data lost or corrupted, or the instance unable to serve. It copies the instance's configuration from it and leaves it in place, and the database module goes on managing it.

An instance that is gone, deleted, is outside what the script does: it stops at its first step, which reads the live instance. Recover a gone instance by hand, as [`rds-snapshot-restore.md`](./rds-snapshot-restore.md#when-the-instance-is-gone) describes. That path also has to settle Terraform, whose state still records the deleted instance, and has not been rehearsed; walk it in dev before relying on it.

## First, check whether a restore is needed

Every catalog table is loaded from the seed in the image, so lost or corrupted catalog data is rebuilt in minutes with `make ecs-run-migrate ENV=<env>` and then `make ecs-run-seed ENV=<env>`. A restore is for what the seed does not hold: the user, account and session rows sign-in writes when an OIDC provider is configured, or an instance that cannot serve.

Do not restore for a stale-credential outage, which is a redeploy ([`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md), `make ecs-redeploy`), or for an app bug.

## Choose the source

Recover the instance the app reads. That is `<name_prefix>-<env>`, unless an earlier recovery is still serving; the script checks, and refuses to restore `<name_prefix>-<env>` when the app reads another instance, since that would lose every write made since. To see which instance the app reads, take the first label of its `DB_HOST`:

```bash
PREFIX=ztdr   # your stacks' name_prefix
TD=$(aws ecs describe-services --cluster "$PREFIX-prod" --services "$PREFIX-prod-app" --region us-east-1 --no-cli-pager \
  --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition "$TD" --region us-east-1 --no-cli-pager \
  --query "taskDefinition.containerDefinitions[?name=='app'] | [0].environment[?name=='DB_HOST'] | [0].value" --output text
LIVE="$PREFIX-prod"   # the first label of the host above
```

If it is not `<name_prefix>-<env>`, the script cannot recover it: restore it by hand ([`rds-snapshot-restore.md`](./rds-snapshot-restore.md) with that `LIVE`), or first bring it under Terraform as `<name_prefix>-<env>` ([Terraform after the cutover](#terraform-after-the-cutover)).

A snapshot, the most recent automated ones first. It must be a snapshot of `$LIVE`: the script refuses a snapshot of any other instance, naming the instance it came from.

```bash
aws rds describe-db-snapshots --db-instance-identifier "$LIVE" --snapshot-type automated \
  --region us-east-1 --no-cli-pager \
  --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[:5].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' --output table
```

Or a point in time just before the bad event, no later than the latest restorable time, which typically trails now by about five minutes. The backup retention period bounds how far back a restore can reach: prod's committed `terraform.tfvars` keeps 30 days (`db_backup_retention_period`), and dev keeps the database module's default of 7.

```bash
aws rds describe-db-instances --db-instance-identifier "$LIVE" --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].LatestRestorableTime'
```

## Run it from a workstation

With the environment's credentials (`<prod-profile>` or `<dev-profile>`) and `aws`, `jq` and `terraform` on the path. The cutover runs Terraform in `infra/environments/<env>` as an apply from that workstation would: with the stack's `backend.hcl` beside it (a copy of `backend.hcl.example` holding `infra/bootstrap`'s output `environment_backend_config`), or with the directory already initialised against the state bucket, and with the `*.auto.tfvars` files that supply the stack's inputs (`vpc_id`, `subnet_name_prefix`, `app_fqdn`, and any others the deployment sets). A plan missing a required input fails; one missing an optional input the deployment sets, such as `alarm_email_endpoints`, plans a change the cutover refuses.

**Permissions.** Beyond what a `terraform apply` of the environment needs, the operator's role needs:

- RDS: `DescribeDBInstances`, `DescribeDBSnapshots`, `RestoreDBInstanceFromDBSnapshot`, `RestoreDBInstanceToPointInTime`, `ModifyDBInstance`, `AddTagsToResource`. `RestoreDBInstanceToPointInTime` is what `RESTORE_TIME` and `LATEST` call, and a role scoped for day-to-day applies often lacks it, so check it before relying on either.
- The managed master secret: `kms:DescribeKey`, `secretsmanager:CreateSecret` and `secretsmanager:TagResource`, and with a customer managed key, `kms:Decrypt`, `kms:GenerateDataKey` and `kms:CreateGrant` on that key. `secretsmanager:DescribeSecret` on the live secret and `secretsmanager:RotateSecret` on the new one copy the rotation schedule.
- ECS and the rest: `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`, `ecs:RunTask` and `ecs:DescribeTasks`, `iam:PassRole` for the task roles, `elasticloadbalancing:DescribeTargetGroups` and `DescribeTargetHealth`, and `logs:GetLogEvents` on the app's log group.

```bash
# Print every step; calls nothing
AWS_PROFILE=<prod-profile> make db-recover ENV=prod SNAPSHOT=<snapshot-id>

# Run it
AWS_PROFILE=<prod-profile> make db-recover ENV=prod SNAPSHOT=<snapshot-id> CONFIRM=yes
```

- `NAME_PREFIX=<prefix>` when the stacks deploy with a `name_prefix` other than `ztdr`. It must match the stack's: the Terraform variable accepts a restored instance only under the stack's own prefix, so a mismatch stops at the cutover's plan, before anything is applied.
- The source is one of `SNAPSHOT=<id>`, `RESTORE_TIME=<YYYY-MM-DDTHH:MM:SSZ>` (UTC) or `LATEST=yes`.
- `TARGET=<id>` names the new instance. It must be `<name_prefix>-<env>-<suffix>`. Without it the script names one for the minute the restore starts, `<name_prefix>-<env>-recovered-<YYYYMMDD-HHMM>`. Every run prints its target as a `Target:` line.
- `PHASE=restore`, `PHASE=cutover` or `PHASE=verify` runs one phase. Cutover and verify need `TARGET`.
- A run that stops partway can be started again with the same arguments, on another day too. The restore tags the instance it creates with `<name_prefix>-recovery-of` and `<name_prefix>-recovery-source`, and a run without `TARGET` finds it by those tags and resumes on it if it was created in the last 48 hours. It refuses when more than one instance matches, and lists them. With `TARGET`, it resumes only on an instance carrying both tags for this recovery, and refuses any other existing instance.
- Run `make check-deploy-safety ENV=<env>` first, as before any apply. The cutover passes the running image tag to Terraform, so it does not move the image, but the plan still carries anything else that differs between the configuration and the running environment, and the script refuses a plan that does.

## Run it from CI

`.github/workflows-export/db-recover.yml` holds the same `make db-recover` as a manually triggered workflow, commented out like the gates beside it, since this repository runs no workflow of its own. Its header says how to enable it: copy it into `.github/workflows/`, uncomment it, and give each GitHub Environment what the job needs. Its inputs are the environment, the phase, one source, the target and an `execute` box, which is unticked by default, so a run prints the steps and calls nothing.

- **Credentials.** The job assumes an AWS role through GitHub OIDC. The role ARN is the `DB_RECOVER_ROLE_ARN` variable of the GitHub Environment the job runs in, `dev` or `prod`. The role needs the permissions listed above and what a `terraform apply` of the environment needs, including its state bucket, and a maximum session of at least six hours.
- **The stack's backend and inputs.** What a workstation keeps out of the repository reaches the job from the Environment: `TF_BACKEND_HCL`, a variable holding the stack's `backend.hcl`; `NAME_PREFIX`, a variable, when the prefix is not `ztdr`; and `TF_AUTO_TFVARS`, a secret holding every input the workstation's `*.auto.tfvars` supply. Leave out an optional input the deployment sets and the cutover plans a change to it, which the script refuses, applying nothing.
- **Approval.** The `prod` Environment needs a deployment protection rule that requires approval, so a prod run waits until someone named in the rule approves it, and its deployment branches restricted to the default branch, so the job never runs code that has not merged.
- **Time.** A GitHub-hosted job stops after six hours. A restore that takes longer is picked up by running the workflow again with the same inputs, as above.

## Terraform after the cutover

The database is Terraform-managed, and the cutover goes through Terraform rather than around it. `db_restored_instance_identifier`, a variable in each environment's stack, names the restored instance. While it is set, Terraform reads that instance (a data source) and points the app's task definitions, its task role's secret grant and the migrate and seed tasks at it, and the RDS CPU and free-storage alarms watch it instead of the original. The database module goes on managing `<name_prefix>-<env>`, which the recovery never changed, and the secret rotation schedule Terraform pins stays on that instance's secret; the script copied it to the new secret instead.

The script passes the variable on the command line, so the change lives only in that apply. **Commit it next, before any other apply:**

```hcl
# infra/environments/<env>/terraform.tfvars: the Target: line the run printed
db_restored_instance_identifier = "ztdr-prod-recovered-20261105-1430"
```

Until that merges, any other `terraform apply` of the environment, including `make deploy`, points the app back at `<name_prefix>-<env>`. If the cutover's plan was refused, the script prints the resources that blocked it and applies nothing.

The app then reads an instance Terraform does not manage. The script gave it the live instance's deletion protection, backup retention and windows, and its tags less `ManagedBy`, so it is protected while it serves. What follows is a decision for a calm window, not part of the recovery:

- **Keep it.** Leave the variable set. The original `<name_prefix>-<env>` stays in state, unchanged; it can be stopped or snapshotted by hand once nobody needs it.
- **Bring it under Terraform.** Retire the original by hand (snapshot it, turn off its deletion protection, delete it), then move the restored instance into the database module's state address with `terraform state rm` and `terraform import`, unset the variable, and apply only once `terraform plan` shows no destructive change to the database. The module names the instance `<name_prefix>-<env>`, so the import needs the restored instance renamed first, and that is a change worth rehearsing in dev.

## When the verify phase reports a difference

The check compares the restored database with the seed in the image the app runs.

- **A seeded table differs.** The snapshot predates the image's last reseed, or a point-in-time restore landed during one. Reload the catalog with `make ecs-run-seed ENV=<env>` (it does not touch user, account or session rows) and run `make db-recover ENV=<env> PHASE=verify TARGET=<id> CONFIRM=yes` again.
- **A migration is missing.** The restore predates a migration the image expects. Run `make ecs-run-migrate ENV=<env>`, then the seed, then verify again.
- **The app reads the wrong host.** The cutover has not run, or an apply since has undone it. Run `PHASE=cutover`.
- **The check could not run.** It names why. A missing or unknown `SEED_CATALOG` means the seed task definition names no catalog the image carries, which `make ecs-run-seed` would fail on too.

## RTO and RPO

- **RPO.** About five minutes for a point-in-time restore, the lag of RDS's transaction-log upload. For a snapshot, the snapshot's age.
- **RTO.** Yours to set, and to measure with a rehearsal on your own instance. As reference figures, rehearsals of this script against a `db.t4g.micro` instance with this configuration took, from a snapshot (2026-11-06), 17m 56s from the first step to the app serving from the restored instance (restore 13m 06s, cutover 3m 29s, verify 1m 21s), 11m 13s of it RDS making the restored instance available; and to the latest restorable time (2026-11-09), 37m 38s from the first step to serving, 31m 27s of it RDS. A point-in-time restore took nearly three times as long as a snapshot restore of the same instance, and a larger or busier instance takes longer to restore either way.

## Rehearse it in dev

The procedure that proves the script on your deployment before an incident, run in dev with dev credentials. It changes nothing on `<name_prefix>-dev`: it restores a copy, moves the dev app onto it, checks it, moves the app back and deletes the copy.

```bash
export AWS_PROFILE=<dev-profile> AWS_REGION=us-east-1
PREFIX=ztdr   # your stacks' name_prefix
cd infra/environments/dev && terraform init -backend-config=backend.hcl && cd ../../..
make check-deploy-safety ENV=dev

# 0. The cutover plan must show only the cutover. A plain `terraform plan` of dev should show
#    nothing but the rotation Lambda's packaging step. If dev runs an older release than this
#    checkout, pin the settings it runs with (container_image_tag, and any other that differs) in a
#    local, gitignored infra/environments/dev/drill.auto.tfvars until it does.

# 1. A recent automated snapshot of the dev instance
aws rds describe-db-snapshots --db-instance-identifier "$PREFIX-dev" --snapshot-type automated \
  --region us-east-1 --no-cli-pager \
  --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier' --output text

# 2. Read the dry run, then run it. Keep the output: every step prints its start time.
#    For a point-in-time run, pass LATEST=yes (or RESTORE_TIME=...) instead of SNAPSHOT, with a TARGET of its own.
make db-recover ENV=dev NAME_PREFIX="$PREFIX" SNAPSHOT=<snapshot-id> TARGET="$PREFIX-dev-recovered-drill"
make db-recover ENV=dev NAME_PREFIX="$PREFIX" SNAPSHOT=<snapshot-id> TARGET="$PREFIX-dev-recovered-drill" CONFIRM=yes 2>&1 | tee tmp/db-recover-dev.log

# 3. Move the dev app back to the dev instance: an apply without the variable
cd infra/environments/dev && terraform plan    # expect the task definitions and the task role's secret grant back on the dev instance
terraform apply && cd ../../..
DNS_FQDN_dev=<app_fqdn> make smoke ENV=dev

# 4. Delete the copy; dev's deletion protection is off, which the copy carried
aws rds delete-db-instance --db-instance-identifier "$PREFIX-dev-recovered-drill" \
  --skip-final-snapshot --delete-automated-backups --region us-east-1 --no-cli-pager
```

Record each phase's time from the log in the table below, with anything that surprised you. The step numbers are the dry run's: restore is steps 1 to 10, cutover 11 to 17 and verify 18 to 20.

### Rehearsal record

Record your runs here.

| Date | Source | Restore (steps 1-10) | Cutover (steps 11-17) | Verify (steps 18-20) | Move back and delete | Script time | Notes |
|---|---|---|---|---|---|---|---|

## Related runbooks

- [`rds-snapshot-restore.md`](./rds-snapshot-restore.md): the AWS commands behind each step, for restoring by hand when the script cannot run, and the restore-only drill (`make db-dr-test`).
- [`prod-deploy.md`](./prod-deploy.md): deploy and rollback; routes data loss from a destructive migration here.
- [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md): the migrate and seed tasks, and the stale-credential redeploy that is not a restore.
- [`secret-rotation-auto-redeploy.md`](./secret-rotation-auto-redeploy.md): the rotation schedule and the redeploy that follows each rotation.
