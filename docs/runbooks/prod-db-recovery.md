# Production database recovery (PITR) + restore drill

How to recover the prod ZT Decoder Ring database from a point-in-time backup, the
RTO/RPO targets we hold ourselves to, how to detect that recovery is needed, and how to run
a restore drill so the procedure is proven before a real incident.

**In scope:** point-in-time restore (PITR) and snapshot restore of the prod database, and
the app cutover onto the restored instance.

**First, check whether a restore is needed at all.** Every catalog table is loaded from the
seed in the image, so lost or corrupted catalog data is rebuilt in minutes with
`make ecs-run-migrate ENV=prod` and then `make ecs-run-seed ENV=prod`. PITR is for what the
seed does not hold: the user, account and session rows sign-in writes when an OIDC provider
is configured.
**Out of scope (explicitly):** cross-region replication and automated failover — not part
of the current prod posture.

## Database shape (confirm before a real restore)

Prod runs the `terraform-aws-modules/rds/aws` module as a single `postgres` instance
(`infra/modules/database/main.tf`, engine `postgres` 16.13), with:

- `manage_master_user_password = true` — the master credential is an **RDS-managed**
  Secrets Manager secret. **This is load-bearing for recovery — see the gotcha below.**
- A custom DB parameter group enforcing `rds.force_ssl = 1` (SC-8).
- `storage_encrypted = true`, with the AWS-managed `aws/rds` key (the module passes no `kms_key_id`).
- Backups governed by `db_backup_retention_period` (an environment input, set in the env tfvars).

> If prod is ever migrated to an **Aurora PostgreSQL cluster**, the restore verb changes
> from `restore-db-instance-to-point-in-time` to
> `restore-db-cluster-to-point-in-time`, and note that **Aurora Backtrack is not available
> for Aurora PostgreSQL** (MySQL-only) — so backtrack is not an RTO lever here either way.
> Reconcile the actual prod engine before relying on this runbook verbatim.

## RTO / RPO targets

Targets (adjust them to your own service levels):

- **RPO ≤ 5 minutes.** RDS streams transaction logs to S3 roughly every 5 minutes, so the
  most recent restorable point (`LatestRestorableTime`) typically lags ~5 minutes behind
  now. This is a floor imposed by RDS; you cannot restore closer than that with PITR. The
  *window* you can restore within is bounded above by `backup_retention_period`.
- **RTO ≤ 2 hours.** A PITR provisions a brand-new instance (single-digit minutes to
  ~30+ min depending on size), then the post-restore reconfiguration + app cutover below
  add time. Multi-AZ, which this configuration does not enable, would shorten recovery for an
  *AZ/hardware* failure but
  does **not** help logical corruption — only a restore does.

Revisit them after the first real drill (the drill's measured wall-clock is the honest RTO).

## Detection — when to invoke this runbook

Restore is the right tool for **data loss or logical corruption**, not for an app that's
simply down. Invoke when:

- A destructive migration or bad bulk operation dropped/corrupted data and rolling forward
  can't recover it (see [`prod-deploy.md`](./prod-deploy.md) rollback section).
- Data integrity alarms / user reports indicate corruption with a known "good before" time.
- The instance is unrecoverable (storage failure) and there is no faster path.

Do **not** restore for: a stale-credential outage (that's a redeploy — see
[`secret-rotation-auto-redeploy.md`](./secret-rotation-auto-redeploy.md) /
[`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md)), an app bug, or an AZ blip on a
Multi-AZ instance (it fails over automatically).

First, pin the target restore time (just before the bad event):

```bash
export AWS_PROFILE=<prod-deploy-profile>
AWS_PROFILE=$AWS_PROFILE aws rds describe-db-instances --db-instance-identifier ztdr-prod \
  --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].{Latest:LatestRestorableTime,Earliest:null}'
AWS_PROFILE=$AWS_PROFILE aws rds describe-db-instances --db-instance-identifier ztdr-prod \
  --region us-east-1 --no-cli-pager --query 'DBInstances[0].InstanceCreateTime'
```

## Restore procedure

PITR always creates a **new** instance (`ztdr-prod-restore` below); the original is left
untouched. The app must then be cut over to the new endpoint.

### 1. Restore to a new instance

Pass the live instance's subnet group, security group and parameter group on the restore
call. A PITR restore given none of them comes up with the **default** security group, DB
subnet group and parameter group — the app cannot reach it and SSL enforcement (SC-8) is
silently lost — and the subnet group is the hardest of the three to change afterwards.

```bash
AWS_PROFILE=$AWS_PROFILE aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier ztdr-prod \
  --target-db-instance-identifier ztdr-prod-restore \
  --restore-time 2026-06-04T14:30:00Z \
  --db-subnet-group-name <ztdr-prod-db-subnet-group> \
  --vpc-security-group-ids <ztdr-prod-db-sg-id> \
  --db-parameter-group-name <ztdr-prod-force-ssl-param-group> \
  --no-multi-az --no-publicly-accessible \
  --region us-east-1 --no-cli-pager
```

(Use `--use-latest-restorable-time` instead of `--restore-time` to go to the most recent
point. Read the three values from the live instance, as step 1 of
[`rds-snapshot-restore.md`](./rds-snapshot-restore.md) does; the instance class defaults to
the source's.)

### 2. Confirm the non-default configuration carried ⚠️

```bash
AWS_PROFILE=$AWS_PROFILE aws rds describe-db-instances --db-instance-identifier ztdr-prod-restore \
  --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].{Subnets:DBSubnetGroup.DBSubnetGroupName,SGs:VpcSecurityGroups[].VpcSecurityGroupId,Params:DBParameterGroups[].ParameterGroupName}'
```

If the security group or parameter group is wrong, re-attach it with `modify-db-instance
--vpc-security-group-ids … --db-parameter-group-name … --apply-immediately`; a new parameter
group takes effect only after a reboot. A wrong subnet group is simplest fixed by restoring
again with the flag.

### 3. Re-establish the managed master password ⚠️ (the #1 gotcha)

For RDS **PostgreSQL**, a PITR does **not** carry over the RDS-managed master password
(that auto-recreate-on-restore behavior exists only for RDS for Oracle). The restored
instance has no managed secret, so the app — which reads `DB_SECRET_ARN` — has nothing to
authenticate with. Re-enable management to mint a fresh managed secret:

```bash
AWS_PROFILE=$AWS_PROFILE aws rds modify-db-instance --db-instance-identifier ztdr-prod-restore \
  --manage-master-user-password \
  --master-user-secret-kms-key-id <prod-master-secret-cmk-arn> \
  --apply-immediately --region us-east-1 --no-cli-pager
```

Then capture the new secret ARN for the cutover:

```bash
AWS_PROFILE=$AWS_PROFILE aws rds describe-db-instances --db-instance-identifier ztdr-prod-restore \
  --region us-east-1 --no-cli-pager \
  --query 'DBInstances[0].{Secret:MasterUserSecret.SecretArn,Endpoint:Endpoint.Address}'
```

### 4. Cut the app over to the restored endpoint

The app reads `DB_HOST` and `DB_SECRET_ARN` from the ECS task-def environment
(`ecs_service.tf`), wired from `module.database`'s outputs in `main.tf`; they are not
tfvars inputs. Point them at the restored instance and roll the service. Preferred
(terraform, keeps state truthful): reconcile state so `module.database` is the restored
instance, as in [`rds-snapshot-restore.md`](./rds-snapshot-restore.md) step 6 (`terraform
state rm` the old `aws_db_instance`, `terraform import` the restored one, and confirm the
plan shows no destructive diff), then apply. The fast path is the break-glass task-definition
revision in that runbook's step 5.

```bash
cd infra/environments/prod
AWS_PROFILE=$AWS_PROFILE terraform apply         # repoints task def + forces redeploy
AWS_PROFILE=$AWS_PROFILE aws ecs wait services-stable --cluster ztdr-prod --services ztdr-prod-app --region us-east-1
```

Verify per [`prod-deploy.md`](./prod-deploy.md#post-deploy-verification) (health + a data
tRPC call).

### 5. Promote / clean up

Once the restored instance is confirmed healthy and serving, decide the steady-state shape:
either keep `ztdr-prod-restore` as the new prod (rename/re-import into the canonical
terraform identifier; the instance is guarded by `deletion_protection`, the
`db_deletion_protection` input, not by `prevent_destroy`), or, if you restored only to
extract data, copy what's needed back into the original and decommission the restore. Either
way, reconcile terraform state so the live instance matches the module — do not leave a
hand-restored instance unmanaged.

## Restore drill

Prove the procedure ~quarterly (and after any change to the DB module) **without touching
real prod traffic**:

1. Run steps 1–3 against prod to produce `ztdr-prod-drill-<date>` (use a drill-specific
   target id; do **not** cut the app over).
2. Connect to the drill instance from a one-off task or bastion and validate: row counts in
   key tables (e.g. 20 control families, 1,014 controls with `status = 'LIVE'` and 182
   `WITHDRAWN`, 203 `ControlLineage` rows), `rds.force_ssl` is on, and a
   `sslmode=verify-full` connection succeeds.
3. **Measure wall-clock** from "restore initiated" to "validated" — that is your real RTO;
   compare to target and update the targets section.
4. Tear the drill instance down (`aws rds delete-db-instance --db-instance-identifier
   ztdr-prod-drill-<date> --skip-final-snapshot`).
5. Record the drill date, measured RTO, and any surprises in this runbook.

## RTO/RPO levers (for tuning, not part of the restore itself)

- **`db_backup_retention_period`** — sets how far back PITR can reach (the restore *window*).
  Longer retention = more recovery options; prod keeps 30 days.
- **Multi-AZ** (not enabled in this configuration) — faster recovery from AZ/hardware failure (automatic failover); does
  not help corruption.
- **Pre-staged restore terraform** — having the cutover tfvars changes scripted shortens RTO
  vs. doing it by hand under pressure.

## Related runbooks

- [`prod-deploy.md`](./prod-deploy.md) — deploy + rollback; routes destructive-migration data loss here.
- [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) — migrate/seed tasks (and the stale-credential redeploy that is *not* a restore).
