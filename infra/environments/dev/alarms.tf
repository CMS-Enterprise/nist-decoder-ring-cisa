# --- Alerts SNS topic + CloudWatch alarms ---
#
# One SNS topic per env (`<name_prefix>-<env>-alerts`) gathers alarm state-change
# notifications. Encrypted with the AWS-managed `alias/aws/sns` (no extra
# CMK policy work for dev's alarm volume). Subscriptions are email; any
# other endpoint the topic supports can subscribe alongside them.
#
# Alarms cover the basics:
#   - ALB 5xx rate
#   - ALB target health
#   - RDS CPU sustained-high
#   - RDS free storage low
#   - ECS service running task count below desired
#   - ECS deployment rollback count
#
# Module: terraform-aws-modules/cloudwatch/aws (modules/metric-alarm
# submodule), per the project's community-module-first convention.

locals {
  # ALB and target-group CloudWatch dimensions take the *arn suffix*, not
  # the full ARN. We extract via regex on the existing module outputs to
  # avoid extending the compute module's outputs surface.
  alb_arn_suffix    = regex("loadbalancer/(app/.+)$", module.compute.alb_arn)[0]
  ecs_tg_arn_suffix = regex("(targetgroup/[^:]+)$", module.compute.alb_target_group_ecs_arn)[0]
  # The instance the app reads: a restored one while db_restored_instance_identifier
  # names it (main.tf), so the RDS alarms follow a recovery's cutover.
  db_instance_id       = coalesce(var.db_restored_instance_identifier, "${var.name_prefix}-${var.environment}")
  rds_free_storage_min = 4 * 1024 * 1024 * 1024 # 4 GiB ≈ 20% of 20 GiB allocated
  alarm_tags = merge(local.tags, {
    Component = "alerts"
  })
}

# --- SNS topic ---

module "sns_alerts" {
  source  = "terraform-aws-modules/sns/aws"
  version = "7.2.0"

  name = "${var.name_prefix}-${var.environment}-alerts"

  # AWS-managed key: alarm payloads carry no sensitive data. Switch to a
  # CMK only if the alert payload picks up sensitive data.
  kms_master_key_id = "alias/aws/sns"

  # Default topic policy already grants the account principal Publish.
  # Add an explicit grant for cloudwatch.amazonaws.com so alarms can
  # deliver state-change notifications.
  topic_policy_statements = {
    AllowCloudWatchPublish = {
      sid     = "AllowCloudWatchAlarmsPublish"
      actions = ["sns:Publish"]
      principals = [{
        type        = "Service"
        identifiers = ["cloudwatch.amazonaws.com"]
      }]
    }
  }

  # Map of subscriptions; each email subscription requires a one-time
  # click-confirm by the recipient on first apply. Until confirmed,
  # the subscription stays in PendingConfirmation status.
  #
  # Keyed by the email address itself (not list index) so reordering
  # var.alarm_email_endpoints does not force a destroy/recreate of
  # every subscription (which would re-trigger confirmation emails).
  subscriptions = {
    for email in toset(var.alarm_email_endpoints) :
    email => {
      protocol = "email"
      endpoint = email
    }
  }

  tags = local.alarm_tags
}

# --- ALB alarms ---

module "alarm_alb_5xx" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-alb-target-5xx"
  alarm_description   = "ALB target-side 5xx responses are sustained over the last 5 minutes."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  threshold           = 10
  period              = 60
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  metric_name = "HTTPCode_Target_5XX_Count"
  namespace   = "AWS/ApplicationELB"
  dimensions = {
    LoadBalancer = local.alb_arn_suffix
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

module "alarm_alb_unhealthy_hosts" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-alb-unhealthy-hosts"
  alarm_description   = "At least one ECS target has been unhealthy for 2 consecutive minutes."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 0
  period              = 60
  statistic           = "Maximum"
  treat_missing_data  = "notBreaching"

  metric_name = "UnHealthyHostCount"
  namespace   = "AWS/ApplicationELB"
  dimensions = {
    LoadBalancer = local.alb_arn_suffix
    TargetGroup  = local.ecs_tg_arn_suffix
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

# --- RDS alarms ---

module "alarm_rds_cpu" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-rds-cpu-high"
  alarm_description   = "RDS CPU has averaged above 80% for 15 minutes."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  threshold           = 80
  period              = 300
  statistic           = "Average"
  treat_missing_data  = "notBreaching"

  metric_name = "CPUUtilization"
  namespace   = "AWS/RDS"
  dimensions = {
    DBInstanceIdentifier = local.db_instance_id
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

module "alarm_rds_free_storage" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-rds-free-storage-low"
  alarm_description   = "RDS free storage has been below ~20% of allocated for 15 minutes; storage autoscaling should kick in but flag it."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  threshold           = local.rds_free_storage_min
  period              = 300
  statistic           = "Average"
  treat_missing_data  = "notBreaching"

  metric_name = "FreeStorageSpace"
  namespace   = "AWS/RDS"
  dimensions = {
    DBInstanceIdentifier = local.db_instance_id
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

# --- ECS service alarms (Container Insights metrics; on by default) ---

module "alarm_ecs_running_tasks" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-ecs-running-tasks-low"
  alarm_description   = "ECS service running task count has been below 1 for 2 consecutive minutes."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  threshold           = 1
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"

  metric_name = "RunningTaskCount"
  namespace   = "ECS/ContainerInsights"
  dimensions = {
    ClusterName = module.compute.ecs_cluster_name
    ServiceName = module.compute.ecs_service_name
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

module "alarm_ecs_deployment_rollback" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-ecs-deployment-rollback"
  alarm_description   = "ECS deployment circuit breaker rolled a deployment back."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 60
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  metric_name = "DeploymentRollbackCount"
  namespace   = "ECS/ContainerInsights"
  dimensions = {
    ClusterName = module.compute.ecs_cluster_name
    ServiceName = module.compute.ecs_service_name
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

# --- Rotation auto-redeploy Lambda alarm ------------------------------------
#
# Only exists when the auto-redeploy Lambda does (same flag). If the Lambda
# errors on a RotationSucceeded event, the forced ECS redeploy may not have
# happened, re-exposing the stale-credential outage — alert on it.

module "alarm_rotation_redeploy_errors" {
  count = var.enable_rotation_auto_redeploy ? 1 : 0

  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-rotation-redeploy-errors"
  alarm_description   = "The secret-rotation auto-redeploy Lambda erred on its last run; a rotation may not have forced the ECS redeploy, risking the stale-DB-credential outage. Check the Lambda logs and run `make ecs-redeploy ENV=${var.environment}` if the app is auth-failing."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 300
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  metric_name = "Errors"
  namespace   = "AWS/Lambda"
  dimensions = {
    FunctionName = "${var.name_prefix}-${var.environment}-rotation-redeploy"
  }

  alarm_actions = [module.sns_alerts.topic_arn]
  ok_actions    = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}

# --- Seed failure alarm ---
#
# The seed runs as a one-off ECS task, so no service metric sees it fail. A
# failed run leaves a partial catalog, and seed-ecs.ts logs "[seed-ecs] Failed"
# before it exits 1; count that line and alert on it.

module "seed_failed_metric" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/log-metric-filter"
  version = "6.0.0"

  name           = "${var.name_prefix}-${var.environment}-seed-failed"
  log_group_name = module.compute.log_group_name
  pattern        = "\"[seed-ecs] Failed\""

  metric_transformation_name          = "SeedFailed"
  metric_transformation_namespace     = "${var.name_prefix}/${var.environment}"
  metric_transformation_value         = "1"
  metric_transformation_default_value = "0"
}

module "alarm_seed_failed" {
  source  = "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm"
  version = "6.0.0"

  alarm_name          = "${var.name_prefix}-${var.environment}-seed-failed"
  alarm_description   = "A seed run failed and left a partial catalog: the files before the failing one are loaded, the rest are not. Read the task's Partial seed log line, fix the cause, and run `make ecs-run-seed ENV=${var.environment}` again; it starts by truncating."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 300
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  metric_name = "SeedFailed"
  namespace   = "${var.name_prefix}/${var.environment}"

  alarm_actions = [module.sns_alerts.topic_arn]

  tags = local.alarm_tags
}
