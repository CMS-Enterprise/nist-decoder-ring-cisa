# db-recover

**Script:** `scripts/db-recover.sh`, with `scripts/db-recover-check.cjs` · **Make target:** `make db-recover` · **Workflow:** `.github/workflows-export/db-recover.yml` (manual, once a deployment enables it) · **Runbook:** [`prod-db-recovery.md`](../runbooks/prod-db-recovery.md)

## Purpose

Recovers an environment's database onto a new RDS instance, points the app at it through Terraform, and checks the result. The runbook says when and how to use it; this page covers its arguments and behaviour.

It recovers `<name_prefix>-<env>` while that instance still exists, however damaged, and only while the app reads it. An instance that is gone is recovered by hand ([`rds-snapshot-restore.md`](../runbooks/rds-snapshot-restore.md#when-the-instance-is-gone)); the script stops at its first step, naming that page.

## Usage

```bash
AWS_PROFILE=<profile> make db-recover ENV=<dev|prod> SNAPSHOT=<id>               # prints the steps
AWS_PROFILE=<profile> make db-recover ENV=<dev|prod> SNAPSHOT=<id> CONFIRM=yes   # runs them
NAME_PREFIX=<prefix> scripts/db-recover.sh --env <dev|prod> --snapshot <id> --execute   # the same, directly
```

| Script | Make | Meaning |
|---|---|---|
| `NAME_PREFIX` (environment) | `NAME_PREFIX=` | The stack's `name_prefix`, `ztdr` unless set. Every name the script uses starts `<name_prefix>-<env>`: the live instance, the cluster, the `-app` service, the `-seed` task definition, the `-ecs` target group, the `/ecs/` log group, and the recovery tags. It must be the value the environment's stack deploys with; it is held to the same rule as the stack's variable. |
| `--env dev\|prod` | `ENV=` | The environment. Required. |
| `--phase all\|restore\|cutover\|verify` | `PHASE=` | The phases to run, `all` by default. |
| `--snapshot <id>` | `SNAPSHOT=` | Restore this snapshot. |
| `--restore-time <YYYY-MM-DDTHH:MM:SSZ>` | `RESTORE_TIME=` | Restore this point in time, UTC, no later than the latest restorable time. |
| `--latest` | `LATEST=yes` | Restore the latest restorable time. |
| `--target <id>` | `TARGET=` | The new instance, `<name_prefix>-<env>-<suffix>`. Required for cutover and verify. Without it a restore resumes on the instance an earlier run of the same recovery created (found by its tags), or names a new `<name_prefix>-<env>-recovered-<YYYYMMDD-HHMM>`. |
| `--secret-kms-key-id <key>` | `SECRET_KMS_KEY_ID=` | Encrypt the new master secret with this key rather than the live secret's. |
| `--wait-hours <1-48>` | | How long to wait for the new instance, 24 hours by default. |
| `--execute` | `CONFIRM=yes` | Run the steps. Without it the script prints them and calls nothing. |

The restore and `all` take exactly one of `--snapshot`, `--restore-time` and `--latest`; cutover and verify take none. Of the recovery's own variables, the Make target passes only values given on its command line, so a variable of the same name exported in the shell changes nothing. `NAME_PREFIX` is the exception, as it is for every target in the Makefile: an exported value counts.

## Behaviour

- **Restore** reads the live instance, refuses a snapshot that is not the live instance's own (naming the instance it is of) or is not available, refuses unless the app service's `DB_HOST` is the live instance's endpoint (or, on a resumed run, the target's), restores with its class, subnet group, security groups, parameter group, storage type, multi-AZ, deletion protection, log exports, CA and tags (less `ManagedBy`), never publicly accessible, then sets its backup retention, windows and storage ceiling, asks RDS for a managed master secret under the live secret's key, copies the live secret's rotation schedule, and compares the result with the live instance. The comparison wants the live value for the class, subnet group, security groups, parameter group, storage type, `StorageEncrypted`, `KmsKeyId`, `EnabledCloudwatchLogsExports` (as a sorted list), `IAMDatabaseAuthenticationEnabled`, `CACertificateIdentifier`, multi-AZ, deletion protection and backup retention, no public access, and an active managed secret; any difference stops the run, naming each differing setting. Encryption and its key are not restore flags: they come with the snapshot or the source instance, which is why only the live instance's own snapshots are accepted.
- **Cutover** reads the app's running image tag, initialises `infra/environments/<env>` and plans it with `db_restored_instance_identifier` and that tag. The stack's backend block is partial: with a `backend.hcl` beside the stack, init reads it; without one, init keeps the backend the directory was initialised with, and a directory never initialised fails at that step. The plan reads the stack's `*.auto.tfvars` like any other. It applies the plan only if every change is on an allowed list: `aws_ecs_task_definition` created or replaced, `aws_ecs_service` updated, the two task-role policies (`task_inline`, `task_exec_inline`) updated, the `alarm_rds_cpu` and `alarm_rds_free_storage` alarms updated, the rotation Lambda's packaging step (`null_resource.archive`, rebuilt on every plan) replaced, and data sources read. Any other change refuses the plan, lists each refused address and applies nothing. It then waits for the app service to settle.
- **Verify** checks the app service's `DB_HOST` is the new instance and the load balancer's targets are healthy, then runs `db-recover-check.cjs` as a one-off task on the seed task definition, on the app service's network. The check reads the catalog the seed task names in `SEED_CATALOG`, counts the rows each `INSERT` in that catalog's seed writes, compares them with the database, checks the image's migrations are applied, and logs one `db-recover-check` line that the script reads back. With no `SEED_CATALOG`, or one that is not a catalog directory, it reports an error rather than guess, as the seed loader does.
- The live instance is only described, or named as the source of a point-in-time restore. Its secret is only described.
- A real run prints each step's start time, and every run prints a `Target:` line. Run again with the same arguments, it resumes on the instance it created, recognised by its `<name_prefix>-recovery-of` and `<name_prefix>-recovery-source` tags: without `--target`, any `<name_prefix>-<env>-*` instance carrying both and created in the last 48 hours (more than one is refused and listed); with `--target`, that instance only if it carries both. Any other existing instance is refused.

## Exit status

`0` when every step it ran succeeded. `1` when the run stopped: a refusal or a check that did not hold, with the reason, or a failed `aws`, `terraform` or `jq` call, whose own error is printed above a line naming the step that stopped. Either way the last line gives the target to run again on, once one is known. `2` for bad arguments or a `NAME_PREFIX` the stack would refuse, before anything is called. A failed call's own status (`aws` exits 254, for one) is never passed through.

The check, `db-recover-check.cjs`, exits `0` when every table and migration matches and `1` when one does not, logging its counts as one `db-recover-check {...}` JSON line either way. When it cannot run at all, the line is `db-recover-check {"error": "<why>"}` and it exits `2`; the script reports that reason. A line that is not JSON, or lacks the counts, stops the run with the line itself and the task's exit code.

## Tests

`make test-scripts` runs it against stubbed `aws` and `terraform` (`scripts/test_shell_scripts.py`): arguments, the dry-run default, the step order, the configuration carried across, that nothing changes the live instance, the plan guard, resuming, a failure partway, each verify failure, the name prefix on every name, the stack's backend configuration, and the row counter against the committed seed of the catalog the seed task names.
