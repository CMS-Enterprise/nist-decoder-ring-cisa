#!/usr/bin/env bash
# Disaster-recovery dry-run helper for the <name_prefix>-<env> RDS instance.
#
# `restore`  — snapshot <name_prefix>-<env>, restore it to a throwaway instance
#              (<name_prefix>-<env>-restore-test), enable a managed master secret on the
#              restore, and print connection details. ADDITIVE — the live DB is
#              never touched. It does not cut the app over: scripts/db-recover.sh
#              restores, cuts over and checks (docs/runbooks/prod-db-recovery.md).
# `teardown` — delete the throwaway instance (no final snapshot) and the drtest
#              snapshots, so nothing lingers / accrues cost.
#
# Usage:
#   AWS_PROFILE=<env-profile> ENV=dev scripts/dr-restore-test.sh restore
#   AWS_PROFILE=<env-profile> ENV=dev scripts/dr-restore-test.sh teardown
set -euo pipefail

ENV="${ENV:-dev}"
REGION="${AWS_REGION:-us-east-1}"
NAME_PREFIX="${NAME_PREFIX:-ztdr}"
SRC="${NAME_PREFIX}-${ENV}"
TGT="${NAME_PREFIX}-${ENV}-restore-test"
ACTION="${1:-restore}"

rds() { aws rds "$@" --region "$REGION" --no-cli-pager; }

case "$ACTION" in
  restore)
    SNAP="${NAME_PREFIX}-${ENV}-drtest-$(date +%Y%m%d-%H%M)"
    echo "📸 Snapshotting ${SRC} -> ${SNAP} ..."
    rds create-db-snapshot --db-instance-identifier "$SRC" --db-snapshot-identifier "$SNAP" \
      --query 'DBSnapshot.Status' --output text
    rds wait db-snapshot-completed --db-snapshot-identifier "$SNAP"

    echo "🔧 Reading ${SRC} config (class / SG / subnet group / parameter group) ..."
    CLASS=$(rds describe-db-instances --db-instance-identifier "$SRC" --query 'DBInstances[0].DBInstanceClass' --output text)
    SG=$(rds describe-db-instances --db-instance-identifier "$SRC" --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)
    SUBNET=$(rds describe-db-instances --db-instance-identifier "$SRC" --query 'DBInstances[0].DBSubnetGroup.DBSubnetGroupName' --output text)
    PG=$(rds describe-db-instances --db-instance-identifier "$SRC" --query 'DBInstances[0].DBParameterGroups[0].DBParameterGroupName' --output text)

    echo "♻️  Restoring ${SNAP} -> ${TGT} (${CLASS}) ..."
    # NOTE: restore-db-instance-from-db-snapshot does NOT accept --manage-master-user-password;
    # the managed secret is minted by the modify step below (see the runbook).
    rds restore-db-instance-from-db-snapshot --db-instance-identifier "$TGT" \
      --db-snapshot-identifier "$SNAP" --db-subnet-group-name "$SUBNET" \
      --vpc-security-group-ids "$SG" --db-parameter-group-name "$PG" \
      --db-instance-class "$CLASS" --no-publicly-accessible --no-multi-az >/dev/null
    rds wait db-instance-available --db-instance-identifier "$TGT"

    echo "🔑 Minting a managed master secret on ${TGT} (AWS-managed key) ..."
    # Omits --master-user-secret-kms-key-id: the env CMK may not be usable by the operator
    # role (KMSKeyNotAccessibleFault). Pass the CMK where the operator role has kms:CreateGrant on it.
    rds modify-db-instance --db-instance-identifier "$TGT" --manage-master-user-password --apply-immediately >/dev/null
    sleep 25
    rds wait db-instance-available --db-instance-identifier "$TGT"

    echo "✅ Restored ${TGT}. Connection details:"
    rds describe-db-instances --db-instance-identifier "$TGT" \
      --query 'DBInstances[0].{endpoint:Endpoint.Address,secret:MasterUserSecret.SecretArn}' --output table
    echo ""
    echo "Next: validate it, then make db-dr-teardown ENV=${ENV}. To restore and cut the app over"
    echo "in one run, use make db-recover (docs/runbooks/prod-db-recovery.md)."
    ;;

  teardown)
    echo "🧹 Deleting ${TGT} (no final snapshot) ..."
    rds delete-db-instance --db-instance-identifier "$TGT" --skip-final-snapshot --delete-automated-backups >/dev/null \
      || echo "  (instance not present)"
    echo "🧹 Deleting ${NAME_PREFIX}-${ENV}-drtest-* snapshots ..."
    for s in $(rds describe-db-snapshots --snapshot-type manual \
        --query "DBSnapshots[?starts_with(DBSnapshotIdentifier,'${NAME_PREFIX}-${ENV}-drtest-')].DBSnapshotIdentifier" --output text); do
      echo "  - $s"; rds delete-db-snapshot --db-snapshot-identifier "$s" >/dev/null
    done
    echo "✅ Teardown complete."
    ;;

  *)
    echo "usage: ENV=<dev|prod> AWS_PROFILE=<env-profile> $0 [restore|teardown]" >&2
    exit 2
    ;;
esac
