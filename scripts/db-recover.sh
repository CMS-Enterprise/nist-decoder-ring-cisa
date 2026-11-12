#!/usr/bin/env bash
# Recover an environment's database onto a new RDS instance, point the app at it, and check
# the result. Without --execute it prints every step it would take and calls nothing.
#
# Three phases, run in this order by --phase all, the default:
#   restore  Restore a snapshot, or a point in time, to a new instance with the live
#            instance's configuration, and give it an RDS-managed master secret under the
#            live secret's KMS key and on the live secret's rotation schedule.
#   cutover  Point the app at the new instance through Terraform: plan with
#            db_restored_instance_identifier set and the image the app already runs, apply
#            only if every change in the plan is part of the app's database wiring (task
#            definitions, the app service, the task roles' secret grants, the RDS alarms), and
#            wait for the app service to settle on the new task definition.
#   verify   Check that the app service reads the new instance and the load balancer's
#            targets are healthy, then, from a one-off task inside the VPC, that the database
#            holds the rows the deployed image's seed writes (scripts/db-recover-check.cjs).
#
# Every name it uses starts <name_prefix>-<env>: NAME_PREFIX, ztdr unless set, must be the
# name_prefix the environment's stack deploys with (infra/environments/<env>).
#
# The live instance, <name_prefix>-<env>, is only read. No call that changes anything names it.
#
# A real run that stops partway can be run again with the same arguments, on another day too:
# the restore finds the instance it created by the tags it gave it, and resumes there. Cutover
# and verify also run alone, given --target. Every run prints its target.
#
# It recovers the instance the app reads, <name_prefix>-<env>, and refuses when the app reads another
# one, which is an earlier recovery that is still serving.
#
# It recovers an instance that still exists, however damaged: its data lost or corrupted, or the
# instance unable to serve. It reads that instance's configuration and leaves the instance in
# place. An instance that is gone (deleted) is recovered by hand, as
# docs/runbooks/rds-snapshot-restore.md describes; the script stops at its first step.
#
# Afterwards the app reads an instance Terraform does not manage. Commit
# db_restored_instance_identifier to the environment's terraform.tfvars, or the next apply
# points the app back at the old instance. docs/runbooks/prod-db-recovery.md has the rest.
#
# Docs: docs/scripts/db-recover.md
set -euo pipefail

usage() {
  cat <<'EOF'
usage: [NAME_PREFIX=<prefix>] scripts/db-recover.sh --env <dev|prod>
         [--phase all|restore|cutover|verify]
         (--snapshot <id> | --restore-time <YYYY-MM-DDTHH:MM:SSZ> | --latest)
         [--target <prefix>-<env>-<suffix>] [--secret-kms-key-id <key>] [--wait-hours <1-48>]
         [--execute]

  NAME_PREFIX is the stack's name_prefix, ztdr unless set; every name starts <prefix>-<env>.

  --phase all and --phase restore need exactly one source; cutover and verify need --target
  and take no source. Without --target a restore resumes on the instance an earlier run of the
  same recovery created, found by its tags, or names a new <prefix>-<env>-recovered-<UTC time>.
  Without --execute nothing is called: the steps are printed.

  It recovers <prefix>-<env> while that instance still exists, however damaged. An instance that
  is gone is recovered by hand: docs/runbooks/rds-snapshot-restore.md, "When the instance is
  gone".

  make: AWS_PROFILE=<profile> make db-recover ENV=<env> SNAPSHOT=<id> [NAME_PREFIX=<prefix>] [CONFIRM=yes]
EOF
}

# Exit status: 0 when every step it ran succeeded, 1 when the run stopped (a refusal, a check
# that did not hold, or a failed aws, terraform or jq call, whose own error is printed above
# it), 2 for bad arguments. on_exit turns any other status a failed call leaves into 1, says
# which step stopped, prints the target so the run can be continued, and removes the plan.
STOPPED=0
die() {
  STOPPED=1
  echo "❌ $*" >&2
  exit 1
}

bad_usage() {
  STOPPED=1
  echo "❌ $*" >&2
  usage >&2
  exit 2
}

PLAN_DIR=""
TARGET_FOUND=0
on_exit() {
  local rc=$?
  if [ -n "$PLAN_DIR" ]; then rm -rf "$PLAN_DIR"; fi
  [ "$rc" = 0 ] && return 0
  if [ "$STOPPED" = 0 ]; then
    echo "❌ step ${STEP:-0} stopped: a command exited $rc, with its error above" >&2
  fi
  if [ "$TARGET_FOUND" = 1 ]; then
    echo "   target: $TARGET. Run again with the same arguments to continue." >&2
  fi
  if [ "$rc" = 2 ] && [ "$STOPPED" = 1 ]; then exit 2; fi
  exit 1
}
trap on_exit EXIT

ENV_NAME=""
PHASE="all"
SNAPSHOT=""
RESTORE_TIME=""
LATEST=0
TARGET=""
KMS_OVERRIDE=""
WAIT_HOURS=24
EXECUTE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env | --phase | --snapshot | --restore-time | --target | --secret-kms-key-id | --wait-hours)
      [ $# -ge 2 ] || bad_usage "$1 needs a value"
      case "$1" in
        --env) ENV_NAME=$2 ;;
        --phase) PHASE=$2 ;;
        --snapshot) SNAPSHOT=$2 ;;
        --restore-time) RESTORE_TIME=$2 ;;
        --target) TARGET=$2 ;;
        --secret-kms-key-id) KMS_OVERRIDE=$2 ;;
        --wait-hours) WAIT_HOURS=$2 ;;
      esac
      shift 2
      ;;
    --latest)
      LATEST=1
      shift
      ;;
    --execute)
      EXECUTE=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) bad_usage "unknown argument: $1" ;;
  esac
done

case "$ENV_NAME" in dev | prod) ;; *) bad_usage "--env must be dev or prod, not '$ENV_NAME'" ;; esac
case "$PHASE" in all | restore | cutover | verify) ;; *) bad_usage "--phase must be all, restore, cutover or verify, not '$PHASE'" ;; esac

# The stack's name_prefix, held to the rule its variable validation enforces.
NAME_PREFIX="${NAME_PREFIX:-ztdr}"
PREFIX_RE='^[a-z][a-z0-9-]{0,14}[a-z0-9]$'
if ! [[ $NAME_PREFIX =~ $PREFIX_RE ]] || [[ $NAME_PREFIX == *--* ]]; then
  bad_usage "NAME_PREFIX must be the stack's name_prefix, 2 to 16 lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit, not '$NAME_PREFIX'"
fi

SOURCES=0
if [ -n "$SNAPSHOT" ]; then SOURCES=$((SOURCES + 1)); fi
if [ -n "$RESTORE_TIME" ]; then SOURCES=$((SOURCES + 1)); fi
if [ "$LATEST" = 1 ]; then SOURCES=$((SOURCES + 1)); fi

case "$PHASE" in
  all | restore)
    [ "$SOURCES" = 1 ] || bad_usage "the restore needs exactly one of --snapshot, --restore-time and --latest"
    ;;
  *)
    [ "$SOURCES" = 0 ] || bad_usage "--snapshot, --restore-time and --latest belong to the restore phase"
    [ -n "$TARGET" ] || bad_usage "--phase $PHASE needs --target, the instance the restore created"
    ;;
esac

SNAPSHOT_RE='^[A-Za-z][A-Za-z0-9:-]{0,254}$'
TIME_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
TARGET_RE="^${NAME_PREFIX}-${ENV_NAME}-[a-z0-9]+(-[a-z0-9]+)*$"
KMS_RE='^[A-Za-z0-9:/_-]+$'
if [ -n "$SNAPSHOT" ] && ! [[ $SNAPSHOT =~ $SNAPSHOT_RE ]]; then bad_usage "--snapshot '$SNAPSHOT' is not a snapshot identifier"; fi
if [ -n "$RESTORE_TIME" ] && ! [[ $RESTORE_TIME =~ $TIME_RE ]]; then bad_usage "--restore-time takes UTC as YYYY-MM-DDTHH:MM:SSZ, not '$RESTORE_TIME'"; fi
if [ -n "$KMS_OVERRIDE" ] && ! [[ $KMS_OVERRIDE =~ $KMS_RE ]]; then bad_usage "--secret-kms-key-id '$KMS_OVERRIDE' is not a KMS key id, ARN or alias"; fi
if ! [[ $WAIT_HOURS =~ ^[0-9]+$ ]] || [ "$WAIT_HOURS" -lt 1 ] || [ "$WAIT_HOURS" -gt 48 ]; then bad_usage "--wait-hours takes 1 to 48, not '$WAIT_HOURS'"; fi

# Without --target, the restore resumes on an instance an earlier run of this recovery
# created, found by its tags (step 3), and otherwise names a new one for the minute it starts.
TARGET_GIVEN=0
if [ -n "$TARGET" ]; then TARGET_GIVEN=1; else TARGET="${NAME_PREFIX}-${ENV_NAME}-recovered-$(date -u +%Y%m%d-%H%M)"; fi
if ! [[ $TARGET =~ $TARGET_RE ]] || [ ${#TARGET} -gt 63 ]; then
  bad_usage "--target must be ${NAME_PREFIX}-${ENV_NAME}-<suffix> in lowercase letters, digits and single hyphens, at most 63 characters, and never the live instance ${NAME_PREFIX}-${ENV_NAME}"
fi

LIVE="${NAME_PREFIX}-${ENV_NAME}"
REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${NAME_PREFIX}-${ENV_NAME}"
SERVICE="${NAME_PREFIX}-${ENV_NAME}-app"
SEED_FAMILY="${NAME_PREFIX}-${ENV_NAME}-seed"
LOG_GROUP="/ecs/${NAME_PREFIX}-${ENV_NAME}"
TARGET_GROUP="${NAME_PREFIX}-${ENV_NAME}-ecs"
# The two tags that mark an instance as this recovery's, so a run started again resumes on it.
TAG_OF="${NAME_PREFIX}-recovery-of"
TAG_SOURCE="${NAME_PREFIX}-recovery-source"
HERE="$(cd "$(dirname "$0")" && pwd)"
TF_DIR="$(cd "$HERE/.." && pwd)/infra/environments/${ENV_NAME}"
CHECK_JS="$HERE/db-recover-check.cjs"
if [ -n "$SNAPSHOT" ]; then
  SOURCE_TAG="snapshot:${SNAPSHOT}"
elif [ -n "$RESTORE_TIME" ]; then
  SOURCE_TAG="time:${RESTORE_TIME}"
else
  SOURCE_TAG="time:latest"
fi

rds() { aws rds "$@" --region "$REGION" --no-cli-pager; }
ecs() { aws ecs "$@" --region "$REGION" --no-cli-pager; }
secrets() { aws secretsmanager "$@" --region "$REGION" --no-cli-pager; }
elb() { aws elbv2 "$@" --region "$REGION" --no-cli-pager; }
logs() { aws logs "$@" --region "$REGION" --no-cli-pager; }
tf() { terraform -chdir="$TF_DIR" "$@"; }

dry() { [ "$EXECUTE" = 0 ]; }

STEP=0
STARTED=$SECONDS
step() {
  STEP=$((STEP + 1))
  if dry; then
    printf '\n%d. %s\n' "$STEP" "$*"
  else
    printf '\n%d. %s  [%s, +%ds]\n' "$STEP" "$*" "$(date -u +%H:%M:%SZ)" "$((SECONDS - STARTED))"
  fi
}
show() { printf '   %s\n' "$*"; }
would() { show "would run: $*"; }
phase() { printf '\n== %s ==\n' "$*"; }

# --live-flag name true|false -> --name or --no-name
flag() { if [ "$2" = true ]; then echo "--$1"; else echo "--no-$1"; fi; }

# Polls the target every 30 seconds for up to WAIT_HOURS until it is available and, given
# "secret", until its managed secret is active too. A state it cannot leave stops the run.
wait_for_target() {
  local want_secret=$1 tries=$((WAIT_HOURS * 120)) state status secret
  while [ "$tries" -gt 0 ]; do
    state=$(rds describe-db-instances --db-instance-identifier "$TARGET" \
      --query 'DBInstances[0].[DBInstanceStatus,MasterUserSecret.SecretStatus]' --output text)
    status=$(printf '%s' "$state" | awk '{print $1}')
    secret=$(printf '%s' "$state" | awk '{print $2}')
    case "$status" in
      available)
        if [ "$want_secret" = no ]; then
          show "$TARGET is available"
          return 0
        elif [ "$secret" = active ]; then
          show "$TARGET is available, managed secret active"
          return 0
        fi
        ;;
      failed | incompatible-* | inaccessible-encryption-credentials* | storage-full | restore-error)
        die "$TARGET is $status and will not become available. Read its events in the RDS console, delete it once understood, and restore again."
        ;;
    esac
    if [ "$want_secret" = secret ] && [ "$secret" = impaired ]; then
      die "$TARGET's managed secret is impaired and will not become active. Read the secret's and the instance's events, fix the cause (often the KMS key; --secret-kms-key-id chooses another), and run again."
    fi
    tries=$((tries - 1))
    sleep 30
  done
  die "$TARGET was not ready after ${WAIT_HOURS} hour(s) (last: $state). Run again with the same arguments to keep waiting."
}

# Sets APP_HOST to the database host the app service's running task definition gives the app.
read_app_host() {
  local td
  td=$(ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
  { [ -n "$td" ] && [ "$td" != None ]; } || die "could not find the $SERVICE service's task definition"
  APP_HOST=$(ecs describe-task-definition --task-definition "$td" \
    --query "taskDefinition.containerDefinitions[?name=='app'] | [0].environment[?name=='DB_HOST'] | [0].value" --output text)
  { [ -n "$APP_HOST" ] && [ "$APP_HOST" != None ]; } || die "$td gives the app no DB_HOST"
}

# The live instance's configuration, read once by the restore phase.
read_live() {
  # Only DBInstanceNotFound means the instance is gone. Any other failure, most often a
  # dropped VPN or an expired credential, says so instead of pointing at the gone case.
  local err_file
  err_file=$(mktemp "${TMPDIR:-/tmp}/db-recover-read.XXXXXX")
  if ! LIVE_JSON=$(rds describe-db-instances --db-instance-identifier "$LIVE" --query 'DBInstances[0]' --output json 2>"$err_file"); then
    cat "$err_file" >&2
    if grep -q 'DBInstanceNotFound' "$err_file"; then
      rm -f "$err_file"
      die "$LIVE does not exist. This script recovers an instance that still exists: it copies that instance's configuration and leaves it in place. Recover a gone instance by hand, as docs/runbooks/rds-snapshot-restore.md describes under \"When the instance is gone\"."
    fi
    rm -f "$err_file"
    die "could not read $LIVE (the error is above), and nothing was changed. That is usually access, not the instance: check the VPN, AWS_PROFILE and its credential helper, and the region, then run again."
  fi
  rm -f "$err_file"
  live() { printf '%s' "$LIVE_JSON" | jq -r "$1"; }
  CLASS=$(live '.DBInstanceClass')
  SUBNET=$(live '.DBSubnetGroup.DBSubnetGroupName')
  SGS=$(live '[.VpcSecurityGroups[].VpcSecurityGroupId] | join(" ")')
  PARAMS=$(live '.DBParameterGroups[0].DBParameterGroupName')
  STORAGE=$(live '.StorageType')
  MULTI_AZ=$(live '.MultiAZ')
  DELETION=$(live '.DeletionProtection')
  COPY_TAGS=$(live '.CopyTagsToSnapshot')
  MINOR=$(live '.AutoMinorVersionUpgrade')
  IAM_AUTH=$(live '.IAMDatabaseAuthenticationEnabled')
  CA=$(live '.CACertificateIdentifier // empty')
  LOG_EXPORTS=$(live '(.EnabledCloudwatchLogsExports // []) | join(" ")')
  RETENTION=$(live '.BackupRetentionPeriod')
  BACKUP_WINDOW=$(live '.PreferredBackupWindow // empty')
  MAINT_WINDOW=$(live '.PreferredMaintenanceWindow // empty')
  MAX_STORAGE=$(live '.MaxAllocatedStorage // empty')
  LIVE_SECRET=$(live '.MasterUserSecret.SecretArn // empty')
  LATEST_TIME=$(live '.LatestRestorableTime // empty')
  SECRET_KMS=${KMS_OVERRIDE:-$(live '.MasterUserSecret.KmsKeyId // empty')}
  # The live tags, less AWS's own and ManagedBy (Terraform does not manage the copy), plus
  # two that name this recovery, which a run started again uses to resume on its own instance.
  TAGS_JSON=$(printf '%s' "$LIVE_JSON" | jq -c --arg live "$LIVE" --arg src "$SOURCE_TAG" --arg of_key "$TAG_OF" --arg src_key "$TAG_SOURCE" '
    [(.TagList // [])[] | select((.Key | startswith("aws:")) or .Key == "ManagedBy" or .Key == $of_key or .Key == $src_key | not)]
    + [{Key: $of_key, Value: $live}, {Key: $src_key, Value: $src}]')
  show "class $CLASS, subnet group $SUBNET, security groups $SGS, parameter group $PARAMS"
  show "storage $STORAGE, multi-AZ $MULTI_AZ, deletion protection $DELETION, backups kept $RETENTION days"
}

restore_phase() {
  phase "Restore $SOURCE_TAG"

  step "Read the live instance's configuration ($LIVE); it is only read"
  if dry; then
    would "aws rds describe-db-instances --db-instance-identifier $LIVE"
  else
    read_live
  fi

  step "Check the recovery source ($SOURCE_TAG)"
  if [ -n "$SNAPSHOT" ]; then
    if dry; then
      would "aws rds describe-db-snapshots --db-snapshot-identifier $SNAPSHOT (must be a snapshot of $LIVE, and available)"
    else
      # The script recovers $LIVE, which still exists, so only $LIVE's own snapshots are a
      # valid source. A snapshot of another instance would restore that instance's data.
      local snap snap_status snap_source
      snap=$(rds describe-db-snapshots --db-snapshot-identifier "$SNAPSHOT" \
        --query 'DBSnapshots[0].[Status,DBInstanceIdentifier,SnapshotCreateTime]' --output text) ||
        die "could not read snapshot $SNAPSHOT"
      snap_status=$(printf '%s' "$snap" | awk '{print $1}')
      snap_source=$(printf '%s' "$snap" | awk '{print $2}')
      [ "$snap_source" = "$LIVE" ] ||
        die "snapshot $SNAPSHOT is a snapshot of ${snap_source:-an unknown instance}, not $LIVE. This script recovers $LIVE from its own snapshots and backups only; restoring another instance's snapshot is done by hand (docs/runbooks/rds-snapshot-restore.md)."
      [ "$snap_status" = available ] || die "snapshot $SNAPSHOT is not available: $snap"
      show "snapshot $SNAPSHOT: $snap"
    fi
  elif dry; then
    show "the restore time must not be later than $LIVE's latest restorable time"
  else
    [ -n "$LATEST_TIME" ] || die "$LIVE reports no latest restorable time; are its automated backups on?"
    if [ -n "$RESTORE_TIME" ] && [[ ${RESTORE_TIME%Z} > ${LATEST_TIME:0:19} ]]; then
      die "--restore-time $RESTORE_TIME is later than $LIVE's latest restorable time, $LATEST_TIME"
    fi
    show "latest restorable time $LATEST_TIME"
  fi

  step "Find the target: this recovery's instance from an earlier run, or a new one"
  RESUME=0
  if dry; then
    if [ "$TARGET_GIVEN" = 0 ]; then
      would "aws rds describe-db-instances, for a $LIVE-* instance tagged $TAG_OF=$LIVE and $TAG_SOURCE=$SOURCE_TAG in the last 48 hours; with none, a new $TARGET"
    else
      would "aws rds describe-db-instances --db-instance-identifier $TARGET (not found, or tagged $TAG_OF=$LIVE and $TAG_SOURCE=$SOURCE_TAG)"
    fi
  else
    if [ "$TARGET_GIVEN" = 0 ]; then
      # An earlier run's instance, named for the minute that run started, so found by its tags.
      # Only one created in the last 48 hours, the longest a run waits, counts as in progress:
      # an older one is a finished recovery, which a new run must not take over.
      local found count
      found=$(rds describe-db-instances \
        --query 'DBInstances[].{id: DBInstanceIdentifier, created: InstanceCreateTime, tags: TagList}' --output json |
        jq -r --arg live "$LIVE" --arg src "$SOURCE_TAG" --arg of_key "$TAG_OF" --arg src_key "$TAG_SOURCE" '
          .[] | select(.id | startswith($live + "-"))
          | select(any(.tags[]?; .Key == $of_key and .Value == $live))
          | select(any(.tags[]?; .Key == $src_key and .Value == $src))
          | select(.created == null or (now - ((.created[0:19] + "Z") | fromdateiso8601)) < 172800)
          | .id')
      count=$(printf '%s' "$found" | grep -c . || true)
      if [ "$count" -gt 1 ]; then
        die "more than one instance is tagged as this recovery's ($SOURCE_TAG) from the last 48 hours. Pass --target to choose one, after deleting any you do not want:
$found"
      elif [ "$count" = 1 ]; then
        TARGET=$found
        RESUME=1
        show "$TARGET was created by an earlier run of this recovery; resuming on it"
      fi
    fi
    if [ "$RESUME" = 0 ]; then
      local out of src
      if out=$(rds describe-db-instances --db-instance-identifier "$TARGET" --query 'DBInstances[0].TagList' --output json 2>&1); then
        of=$(printf '%s' "$out" | jq -r --arg k "$TAG_OF" '.[]? | select(.Key == $k) | .Value')
        src=$(printf '%s' "$out" | jq -r --arg k "$TAG_SOURCE" '.[]? | select(.Key == $k) | .Value')
        if [ "$of" = "$LIVE" ] && [ "$src" = "$SOURCE_TAG" ]; then
          RESUME=1
          show "$TARGET exists from an earlier run of this recovery; resuming on it"
        else
          die "$TARGET already exists and is not this recovery's instance ($TAG_OF=${of:-none}, $TAG_SOURCE=${src:-none}). Choose another --target."
        fi
      else
        case "$out" in
          *DBInstanceNotFound*) show "$TARGET is free; the restore creates it" ;;
          *) die "could not check whether $TARGET exists: $out" ;;
        esac
      fi
    fi
  fi
  if dry && [ "$TARGET_GIVEN" = 0 ]; then
    echo "Target: $TARGET_NOTE"
  else
    echo "Target: $TARGET"
  fi
  TARGET_FOUND=1

  step "Check the app reads $LIVE, the instance being recovered"
  if dry; then
    would "aws ecs describe-services --cluster $CLUSTER --services $SERVICE, then describe-task-definition: DB_HOST must be $LIVE's endpoint"
  else
    local live_host target_host=""
    live_host=$(printf '%s' "$LIVE_JSON" | jq -r '.Endpoint.Address // empty')
    read_app_host
    if [ "$RESUME" = 1 ]; then
      target_host=$(rds describe-db-instances --db-instance-identifier "$TARGET" \
        --query 'DBInstances[0].Endpoint.Address' --output text)
    fi
    if [ -n "$live_host" ] && [ "$APP_HOST" = "$live_host" ]; then
      show "$SERVICE reads $LIVE"
    elif [ -n "$target_host" ] && [ "$APP_HOST" = "$target_host" ]; then
      show "$SERVICE already reads $TARGET, from an earlier run of this recovery"
    else
      die "$SERVICE reads ${APP_HOST%%.*} ($APP_HOST), not $LIVE (${live_host:-no endpoint}). An earlier recovery is still serving, and restoring $LIVE would lose every write made since. Recover the instance the app reads by hand (docs/runbooks/rds-snapshot-restore.md, with LIVE=${APP_HOST%%.*}), or first bring it under Terraform as $LIVE (docs/runbooks/prod-db-recovery.md, Terraform after the cutover)."
    fi
  fi

  step "Restore to $TARGET with the live instance's configuration"
  if dry; then
    if [ -n "$SNAPSHOT" ]; then
      would "aws rds restore-db-instance-from-db-snapshot --db-instance-identifier $TARGET --db-snapshot-identifier $SNAPSHOT <live configuration>"
    else
      would "aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier $LIVE --target-db-instance-identifier $TARGET ${RESTORE_TIME:+--restore-time $RESTORE_TIME}$([ "$LATEST" = 1 ] && echo --use-latest-restorable-time) <live configuration>"
    fi
    show "<live configuration>: class, subnet group, security groups, parameter group, storage type, multi-AZ, deletion protection, CloudWatch log exports, CA, tags; never publicly accessible"
  elif [ "$RESUME" = 1 ]; then
    show "skipped: $TARGET already exists"
  else
    # shellcheck disable=SC2086 # SGS and LOG_EXPORTS are space-separated lists, one argument each
    set -- --db-subnet-group-name "$SUBNET" --vpc-security-group-ids $SGS \
      --db-parameter-group-name "$PARAMS" --db-instance-class "$CLASS" --storage-type "$STORAGE" \
      --no-publicly-accessible "$(flag multi-az "$MULTI_AZ")" "$(flag deletion-protection "$DELETION")" \
      "$(flag copy-tags-to-snapshot "$COPY_TAGS")" "$(flag auto-minor-version-upgrade "$MINOR")" \
      "$(flag enable-iam-database-authentication "$IAM_AUTH")" --tags "$TAGS_JSON"
    if [ -n "$CA" ]; then set -- "$@" --ca-certificate-identifier "$CA"; fi
    # shellcheck disable=SC2086
    if [ -n "$LOG_EXPORTS" ]; then set -- "$@" --enable-cloudwatch-logs-exports $LOG_EXPORTS; fi
    if [ -n "$SNAPSHOT" ]; then
      rds restore-db-instance-from-db-snapshot --db-instance-identifier "$TARGET" \
        --db-snapshot-identifier "$SNAPSHOT" "$@" --query 'DBInstance.DBInstanceStatus' --output text
    elif [ -n "$RESTORE_TIME" ]; then
      rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$LIVE" \
        --target-db-instance-identifier "$TARGET" --restore-time "$RESTORE_TIME" "$@" \
        --query 'DBInstance.DBInstanceStatus' --output text
    else
      rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$LIVE" \
        --target-db-instance-identifier "$TARGET" --use-latest-restorable-time "$@" \
        --query 'DBInstance.DBInstanceStatus' --output text
    fi
  fi

  step "Wait for $TARGET to become available (up to $WAIT_HOURS hours)"
  if dry; then
    would "aws rds describe-db-instances --db-instance-identifier $TARGET every 30 seconds"
  else
    wait_for_target no
  fi

  step "Give $TARGET an RDS-managed master secret and the live backup and maintenance settings"
  if dry; then
    would "aws rds modify-db-instance --db-instance-identifier $TARGET --manage-master-user-password --master-user-secret-kms-key-id <the live secret's key${KMS_OVERRIDE:+, overridden by $KMS_OVERRIDE}> --backup-retention-period <live> --preferred-backup-window <live> --preferred-maintenance-window <live> --max-allocated-storage <live> --apply-immediately"
  else
    local current
    current=$(rds describe-db-instances --db-instance-identifier "$TARGET" \
      --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
    set -- --backup-retention-period "$RETENTION"
    if [ -n "$BACKUP_WINDOW" ]; then set -- "$@" --preferred-backup-window "$BACKUP_WINDOW"; fi
    if [ -n "$MAINT_WINDOW" ]; then set -- "$@" --preferred-maintenance-window "$MAINT_WINDOW"; fi
    if [ -n "$MAX_STORAGE" ]; then set -- "$@" --max-allocated-storage "$MAX_STORAGE"; fi
    if [ -z "$current" ] || [ "$current" = None ]; then
      set -- "$@" --manage-master-user-password
      if [ -n "$SECRET_KMS" ]; then set -- "$@" --master-user-secret-kms-key-id "$SECRET_KMS"; fi
    else
      show "$TARGET already has a managed secret; keeping it"
    fi
    rds modify-db-instance --db-instance-identifier "$TARGET" "$@" --apply-immediately \
      --query 'DBInstance.DBInstanceStatus' --output text
  fi

  step "Wait for $TARGET's managed secret to become active"
  if dry; then
    would "aws rds describe-db-instances --db-instance-identifier $TARGET every 30 seconds, until MasterUserSecret is active"
  else
    wait_for_target secret
  fi

  step "Copy the live secret's rotation schedule to $TARGET's secret"
  if dry; then
    would "aws secretsmanager describe-secret --secret-id <live secret> (read only)"
    would "aws secretsmanager rotate-secret --secret-id <$TARGET's secret> --rotation-rules <live schedule> --no-rotate-immediately"
  else
    local new_secret rules
    new_secret=$(rds describe-db-instances --db-instance-identifier "$TARGET" \
      --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
    if [ -z "$LIVE_SECRET" ]; then
      show "skipped: $LIVE has no managed secret to copy a schedule from"
    elif rules=$(secrets describe-secret --secret-id "$LIVE_SECRET" --query 'RotationRules' --output json) &&
      [ -n "$rules" ] && [ "$rules" != null ]; then
      # RotateSecret takes a schedule expression or a number of days, never both.
      rules=$(printf '%s' "$rules" | jq -c 'if .ScheduleExpression then {ScheduleExpression, Duration} | with_entries(select(.value != null)) else {AutomaticallyAfterDays} end')
      secrets rotate-secret --secret-id "$new_secret" --rotation-rules "$rules" --no-rotate-immediately \
        --query 'Name' --output text >/dev/null
      show "rotation schedule copied: $rules"
    else
      show "⚠️  could not read the live secret's rotation schedule, so the new secret keeps RDS's default. The app still redeploys after every rotation."
    fi
  fi

  step "Confirm the configuration carried across to $TARGET"
  if dry; then
    would "aws rds describe-db-instances --db-instance-identifier $TARGET, compared with $LIVE"
  else
    local target_json mismatches
    target_json=$(rds describe-db-instances --db-instance-identifier "$TARGET" --query 'DBInstances[0]' --output json)
    mismatches=$(jq -rn --argjson live "$LIVE_JSON" --argjson t "$target_json" '
      def sgs: [.VpcSecurityGroups[].VpcSecurityGroupId] | sort | join(",");
      def log_exports: (.EnabledCloudwatchLogsExports // []) | sort | join(",") | if . == "" then "none" else . end;
      [
        ["instance class", $live.DBInstanceClass, $t.DBInstanceClass],
        ["subnet group", $live.DBSubnetGroup.DBSubnetGroupName, $t.DBSubnetGroup.DBSubnetGroupName],
        ["security groups", ($live | sgs), ($t | sgs)],
        ["parameter group", $live.DBParameterGroups[0].DBParameterGroupName, $t.DBParameterGroups[0].DBParameterGroupName],
        ["storage type", $live.StorageType, $t.StorageType],
        ["encryption at rest", $live.StorageEncrypted, $t.StorageEncrypted],
        ["storage KMS key", $live.KmsKeyId, $t.KmsKeyId],
        ["CloudWatch log exports", ($live | log_exports), ($t | log_exports)],
        ["IAM database authentication", $live.IAMDatabaseAuthenticationEnabled, $t.IAMDatabaseAuthenticationEnabled],
        ["CA certificate", $live.CACertificateIdentifier, $t.CACertificateIdentifier],
        ["multi-AZ", $live.MultiAZ, $t.MultiAZ],
        ["deletion protection", $live.DeletionProtection, $t.DeletionProtection],
        ["backup retention", $live.BackupRetentionPeriod, $t.BackupRetentionPeriod],
        ["publicly accessible", false, $t.PubliclyAccessible],
        ["managed secret", "active", ($t.MasterUserSecret.SecretStatus // "none")]
      ] | .[] | select(.[1] != .[2]) | "\(.[0]): wanted \(.[1]), \($t.DBInstanceIdentifier) has \(.[2])"')
    [ -z "$mismatches" ] || die "$TARGET differs from $LIVE:
$mismatches"
    show "✅ $TARGET matches $LIVE; endpoint $(printf '%s' "$target_json" | jq -r '.Endpoint.Address')"
  fi
}

cutover_phase() {
  phase "Cut the $ENV_NAME app over to $TARGET through Terraform"

  step "Check $TARGET is available with an active managed secret"
  if dry; then
    would "aws rds describe-db-instances --db-instance-identifier $TARGET"
  else
    local state
    state=$(rds describe-db-instances --db-instance-identifier "$TARGET" \
      --query 'DBInstances[0].[DBInstanceStatus,MasterUserSecret.SecretStatus]' --output text) ||
      die "could not read $TARGET"
    [ "$state" = "$(printf 'available\tactive')" ] || die "$TARGET is not ready to serve the app (status and secret: $state). Run the restore phase first."
    show "$TARGET is available, managed secret active"
  fi

  step "Read the image the app runs, so the cutover keeps it"
  local image_tag="<running tag>"
  if dry; then
    would "aws ecs describe-services --cluster $CLUSTER --services $SERVICE, then describe-task-definition"
  else
    local td image
    td=$(ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
    image=$(ecs describe-task-definition --task-definition "$td" \
      --query "taskDefinition.containerDefinitions[?name=='app'] | [0].image" --output text)
    image_tag=${image##*:}
    { [ -n "$image" ] && [ "$image" != None ] && [ "$image_tag" != "$image" ]; } || die "could not read the app's image tag from $td"
    show "the app runs $image_tag"
  fi

  # The stack's backend block is partial: the state bucket comes from backend.hcl, which is
  # not committed. With it, init uses it; without it, init keeps the backend the directory
  # was initialised with, and fails on a directory never initialised.
  step "Initialise Terraform in infra/environments/$ENV_NAME"
  if dry; then
    if [ -f "$TF_DIR/backend.hcl" ]; then
      would "terraform -chdir=infra/environments/$ENV_NAME init -input=false -backend-config=backend.hcl"
    else
      would "terraform -chdir=infra/environments/$ENV_NAME init -input=false (no backend.hcl, so the backend the directory was initialised with)"
    fi
  elif [ -f "$TF_DIR/backend.hcl" ]; then
    tf init -input=false -no-color -backend-config=backend.hcl
  else
    show "no backend.hcl in infra/environments/$ENV_NAME; keeping the backend the directory was initialised with"
    tf init -input=false -no-color
  fi

  step "Plan with db_restored_instance_identifier = $TARGET"
  if dry; then
    would "terraform plan -var db_restored_instance_identifier=$TARGET -var container_image_tag=$image_tag -out=<plan>"
  else
    PLAN_DIR=$(mktemp -d)
    tf plan -input=false -no-color -var "db_restored_instance_identifier=$TARGET" \
      -var "container_image_tag=$image_tag" -out="$PLAN_DIR/cutover.tfplan"
  fi

  step "Check the plan changes only the app's database wiring"
  if dry; then
    would "terraform show -json <plan>, refused unless every change is on the allowed list below"
    show "allowed: task definitions created or replaced, the app service updated, the two task-role secret grants updated, the RDS CPU and free-storage alarms updated, the rotation Lambda packaging step replaced, data sources read"
  else
    local verdict refused
    tf show -json "$PLAN_DIR/cutover.tfplan" >"$PLAN_DIR/plan.json"
    # Every change the cutover makes, and nothing else. Moving DB_HOST and DB_SECRET_ARN
    # registers new revisions of the app, migrate and seed task definitions (a replace, since
    # a revision cannot change) and points the app service at its new one. The two task-role
    # policies grant the restored instance's secret instead of the original's. The RDS CPU and
    # free-storage alarms take their instance from the same variable (alarms.tf). Data sources,
    # the restored instance among them, are only read. Anything else, a create, an update or a
    # delete, is drift or a mistake that a recovery must not apply unattended.
    verdict=$(jq -c '
      def acts: .change.actions | sort;
      def line: "\(.change.actions | join("/")) \(.address)";
      def allowed:
        acts == ["no-op"]
        or (.mode == "data" and acts == ["read"])
        or (.type == "aws_ecs_task_definition" and (acts == ["create"] or acts == ["delete"] or acts == ["create", "delete"]))
        or (.type == "aws_ecs_service" and acts == ["update"])
        or (.type == "aws_iam_role_policy" and acts == ["update"]
            and (.address == "module.compute.aws_iam_role_policy.task_inline"
              or .address == "module.compute.aws_iam_role_policy.task_exec_inline"))
        or (.type == "aws_cloudwatch_metric_alarm" and acts == ["update"]
            and (.address | test("^module\\.alarm_rds_(cpu|free_storage)\\.")))
        # The packaging step of the rotation Lambda builds its zip on this machine. Its trigger
        # includes the build time, so every plan replaces it, and it changes nothing in AWS. A
        # change to the function itself is still refused.
        or (.mode == "managed" and .type == "null_resource" and acts == ["create", "delete"]
            and .address == "module.compute.module.rotation_redeploy_lambda[0].null_resource.archive[0]");
      {
        refused: [.resource_changes[]? | select(allowed | not) | line],
        changes: [.resource_changes[]? | select(acts != ["no-op"]) | line]
      }' "$PLAN_DIR/plan.json")
    refused=$(printf '%s' "$verdict" | jq -r '.refused[]')
    if [ -n "$refused" ]; then
      die "refusing to apply: the plan changes more than the app's database wiring. Nothing was applied. Refused:
$refused"
    fi
    printf '%s' "$verdict" | jq -r '.changes[] | "   will " + .'
  fi

  step "Apply the plan"
  if dry; then
    would "terraform apply <plan>"
  else
    tf apply -input=false -no-color "$PLAN_DIR/cutover.tfplan"
    rm -rf "$PLAN_DIR"
    PLAN_DIR=""
  fi

  step "Wait for the $SERVICE service to settle on the new task definition"
  if dry; then
    would "aws ecs wait services-stable --cluster $CLUSTER --services $SERVICE"
  else
    ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
    show "$SERVICE is stable"
  fi
}

verify_phase() {
  phase "Verify the $ENV_NAME app on $TARGET"

  local target_host="<$TARGET's endpoint>"
  step "Confirm the $SERVICE service reads $TARGET"
  if dry; then
    would "aws rds describe-db-instances --db-instance-identifier $TARGET; aws ecs describe-services, describe-task-definition (DB_HOST)"
  else
    target_host=$(rds describe-db-instances --db-instance-identifier "$TARGET" \
      --query 'DBInstances[0].Endpoint.Address' --output text)
    read_app_host
    [ "$APP_HOST" = "$target_host" ] || die "$SERVICE reads $APP_HOST, not $TARGET ($target_host). Run the cutover phase first."
    show "$SERVICE reads $target_host"
  fi

  step "Check the load balancer's targets are healthy"
  if dry; then
    would "aws elbv2 describe-target-groups ($TARGET_GROUP), describe-target-health (every target healthy or draining, at least one healthy)"
  else
    local tg states healthy bad
    # By its exact name: another deployment's prefix may begin with this one's.
    tg=$(elb describe-target-groups \
      --query "TargetGroups[?TargetGroupName=='${TARGET_GROUP}'].TargetGroupArn | [0]" --output text)
    { [ -n "$tg" ] && [ "$tg" != None ]; } || die "found no target group named $TARGET_GROUP"
    states=$(elb describe-target-health --target-group-arn "$tg" \
      --query 'TargetHealthDescriptions[].TargetHealth.State' --output text | tr '\t' '\n' | sed '/^$/d')
    healthy=$(printf '%s\n' "$states" | grep -c '^healthy$' || true)
    bad=$(printf '%s\n' "$states" | grep -vc -e '^healthy$' -e '^draining$' -e '^$' || true)
    if [ "$bad" != 0 ] || [ "$healthy" = 0 ]; then
      die "the load balancer's targets are not healthy: $(printf '%s' "$states" | tr '\n' ' ')"
    fi
    show "$healthy healthy target(s)"
  fi

  step "Count the seeded rows in $TARGET from a one-off task inside the VPC"
  local code overrides
  # Comment lines only document the check; leaving them out keeps the task's overrides
  # under ECS's 8,192-character limit.
  code=$(grep -v '^[[:space:]]*//' "$CHECK_JS")
  overrides=$(jq -cn --arg code "$code" '{containerOverrides: [{name: "seed", command: ["node", "-e", $code]}]}')
  [ ${#overrides} -lt 8192 ] || die "the row-count check is ${#overrides} characters as ECS overrides; ECS takes fewer than 8,192"
  if dry; then
    would "aws ecs run-task --cluster $CLUSTER --task-definition $SEED_FAMILY, the seed container's command replaced by scripts/db-recover-check.cjs (${#overrides} characters)"
    would "aws logs get-log-events --log-group-name $LOG_GROUP for its db-recover-check line"
  else
    local net task tid status n=0 exit_code line
    net=$(ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
      --query 'services[0].networkConfiguration' --output json |
      jq -c '.awsvpcConfiguration.assignPublicIp = "DISABLED"')
    task=$(ecs run-task --cluster "$CLUSTER" --task-definition "$SEED_FAMILY" --launch-type FARGATE \
      --network-configuration "$net" --overrides "$overrides" --started-by db-recover \
      --query 'tasks[0].taskArn' --output text)
    { [ -n "$task" ] && [ "$task" != None ]; } || die "ECS started no $SEED_FAMILY task"
    show "task $task"
    until status=$(ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" \
      --query 'tasks[0].lastStatus' --output text) && [ "$status" = STOPPED ]; do
      n=$((n + 1))
      [ "$n" -le 90 ] || die "the check task has not stopped after 15 minutes (last status ${status:-unknown}): $task"
      sleep 10
    done
    exit_code=$(ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" \
      --query "tasks[0].containers[?name=='seed'] | [0].exitCode" --output text)
    tid=${task##*/}
    line=$(logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "task/seed/$tid" \
      --start-from-head --query 'events[].message' --output json |
      jq -r '.[] | select(startswith("db-recover-check "))' | tail -n 1) || line=""
    [ -n "$line" ] || die "the check task (exit $exit_code) logged no result; read task/seed/$tid in $LOG_GROUP"
    line=${line#db-recover-check }
    # The check logs one JSON object: its counts, or {"error": ...} when it could not run.
    printf '%s' "$line" | jq -e 'type == "object"' >/dev/null 2>&1 ||
      die "the check task (exit $exit_code) logged a result that is not JSON: $line"
    local check_error
    check_error=$(printf '%s' "$line" | jq -r '.error // empty')
    [ -z "$check_error" ] || die "the row check could not run (exit $exit_code): $check_error"
    printf '%s' "$line" | jq -e '(.host | type) == "string" and (.tables | type) == "object" and (.migrations.missing | type) == "array"' >/dev/null 2>&1 ||
      die "the check task (exit $exit_code) logged a result without its counts: $line"
    printf '%s' "$line" | jq -r '
      (.tables | to_entries[] | "   \(.key): \(.value.actual) rows, the seed writes \(.value.expected)"),
      "   migrations: \(.migrations.expected - (.migrations.missing | length)) of \(.migrations.expected) applied"'
    [ "$(printf '%s' "$line" | jq -r '.host')" = "$target_host" ] ||
      die "the check read $(printf '%s' "$line" | jq -r '.host'), not $TARGET ($target_host)"
    [ "$exit_code" = 0 ] || die "$TARGET does not hold what the deployed image's seed writes (exit $exit_code). The runbook says what to do."
    show "✅ every seeded table holds the rows the seed writes"
  fi
}

command -v jq >/dev/null 2>&1 || die "jq not found"
if [ "$TARGET_GIVEN" = 1 ]; then
  TARGET_NOTE=$TARGET
  TARGET_FOUND=1
else
  TARGET_NOTE="an earlier run's instance found in step 3, or a new $TARGET"
fi
if dry; then
  echo "DRY RUN for $ENV_NAME: nothing below is called. Add --execute (make: CONFIRM=yes) to run it."
  echo "Target: $TARGET_NOTE"
else
  command -v aws >/dev/null 2>&1 || die "aws not found"
  case "$PHASE" in all | cutover) command -v terraform >/dev/null 2>&1 || die "terraform not found" ;; esac
  echo "Recovering $ENV_NAME: phase $PHASE, region $REGION"
  echo "Target: $TARGET_NOTE"
fi

case "$PHASE" in
  all)
    restore_phase
    cutover_phase
    verify_phase
    ;;
  restore) restore_phase ;;
  cutover) cutover_phase ;;
  verify) verify_phase ;;
esac

if [ "$PHASE" = all ] || [ "$PHASE" = cutover ]; then
  echo ""
  if dry; then
    echo "After a real cutover, the app reads $TARGET, which Terraform does not manage:"
  else
    echo "✅ The $ENV_NAME app reads $TARGET. Terraform does not manage $TARGET:"
  fi
  echo "   commit db_restored_instance_identifier = \"$TARGET\" to infra/environments/$ENV_NAME/terraform.tfvars."
  echo "   Until that lands, any other terraform apply points the app back at $LIVE."
fi
