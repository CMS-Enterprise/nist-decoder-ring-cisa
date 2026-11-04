# Auto-redeploy the ECS app when the RDS-managed master secret rotates.
#
# Problem: the RDS-managed master-user secret auto-rotates on a schedule.
# app/entrypoint.mjs reads that secret ONCE at container boot and bakes the
# password into DATABASE_URL, so a long-running task keeps the pre-rotation
# password and every new DB connection fails Prisma auth (P1000) until the task
# is replaced. AWS confirms there is no in-task live refresh of a rotated
# secret — the task must be replaced (managed-rotation docs).
#
# Two cooperating pieces, both gated by var.enable_rotation_auto_redeploy:
#
#   Part A — pin the rotation schedule to a low-traffic early-morning UTC window
#            so the unavoidable sub-minute rotation window lands when nobody's
#            using the app, rather than at a time AWS picks, which can fall
#            mid-day.
#   Part B — an EventBridge rule on the Secrets Manager RotationSucceeded event
#            invokes a tiny Lambda that forces an ECS new-deployment, so a fresh
#            task re-reads the rotated password automatically within minutes.
#
# Same force-new-deployment idea as the in-module `triggers` map in
# ecs_service.tf, but driven by the rotation EVENT instead of a tfvars bump —
# no manual `make ecs-redeploy` and no terraform run at rotation time.

locals {
  rotation_rule_name = "${var.name_prefix}-${var.environment}-db-secret-rotation"
}

# --- Part A: scheduled early-morning rotation -------------------------------
#
# Override the RDS-managed secret's rotation schedule to a weekly early-morning
# window. rotate_immediately=false so applying this never triggers an
# out-of-band rotation. No rotation_lambda_arn — RDS manages the rotation
# mechanism itself; we only set the schedule.
#
# RISK (verify at the dev plan gate): this targets an RDS-MANAGED secret. If
# `terraform plan` shows a perpetual diff or a conflict with RDS's own rotation
# configuration, drop this resource and set the schedule once via
# `aws secretsmanager rotate-secret --rotation-rules ...` (documented in the
# runbook). Part B alone still prevents the stale-credential outage, whenever
# rotation fires.
resource "aws_secretsmanager_secret_rotation" "db" {
  count              = var.enable_rotation_auto_redeploy ? 1 : 0
  secret_id          = var.master_user_secret_arn
  rotate_immediately = false

  rotation_rules {
    schedule_expression = var.db_secret_rotation_schedule
    duration            = var.db_secret_rotation_window
  }
}

# --- Part B: event-driven auto-redeploy -------------------------------------

module "rotation_redeploy_lambda" {
  count   = var.enable_rotation_auto_redeploy ? 1 : 0
  source  = "terraform-aws-modules/lambda/aws"
  version = "8.13.0"

  function_name = "${var.name_prefix}-${var.environment}-rotation-redeploy"
  description   = "Forces an ECS new-deployment when the RDS master secret rotates so the app re-reads the new password."

  handler       = "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  timeout       = 60

  # Single-file ESM function; @aws-sdk/client-ecs ships in the Node runtime, so
  # there are no bundled dependencies to install.
  source_path = "${path.module}/../../../backend/lambdas/secret-rotation-redeploy"

  environment_variables = {
    CLUSTER_NAME = module.ecs_cluster.name
    SERVICE_NAME = local.ecs_service_name
  }

  # Least-privilege: only force-deploy THIS service. UpdateService supports
  # resource-level scoping on the long service ARN.
  attach_policy_statements = true
  policy_statements = {
    ecs_force_deploy = {
      effect    = "Allow"
      actions   = ["ecs:UpdateService"]
      resources = [local.ecs_service_arn]
    }
  }

  cloudwatch_logs_retention_in_days = var.log_retention_days

  tags = var.tags
}

module "rotation_redeploy_eventbridge" {
  count   = var.enable_rotation_auto_redeploy ? 1 : 0
  source  = "terraform-aws-modules/eventbridge/aws"
  version = "4.3.3"

  # Rotation events arrive on the account default bus (delivered via CloudTrail
  # — a management-events trail must exist in the account/region; verified at
  # the dev validation gate).
  create_bus = false
  # Lambda targets are invoked via a resource-based policy (the
  # aws_lambda_permission below), not an EventBridge IAM role.
  create_role         = false
  append_rule_postfix = false

  # No EventBridge bus log delivery — a single rule on the default bus doesn't
  # need it, and leaving it off keeps the vended-log-delivery actions out of what
  # a deploy role must be granted.
  create_log_delivery        = false
  create_log_delivery_source = false

  rules = {
    (local.rotation_rule_name) = {
      description = "RDS master-secret rotation for ${var.name_prefix}-${var.environment} -> force ECS redeploy"
      # Match only RotationSucceeded (the terminal managed-rotation event) so we
      # force exactly one redeploy per rotation. Account-scoped: the RDS master
      # secret is the only auto-rotating secret in these accounts, and a
      # redeploy is idempotent, so an ARN filter is unnecessary. The dev
      # validation captures the real event JSON if we later want to tighten it.
      event_pattern = jsonencode({
        source        = ["aws.secretsmanager"]
        "detail-type" = ["AWS Service Event via CloudTrail", "AWS API Call via CloudTrail"]
        detail = {
          eventSource = ["secretsmanager.amazonaws.com"]
          eventName   = ["RotationSucceeded"]
        }
      })
    }
  }

  targets = {
    (local.rotation_rule_name) = [
      {
        name = "${var.name_prefix}-${var.environment}-rotation-redeploy"
        arn  = module.rotation_redeploy_lambda[0].lambda_function_arn
      }
    ]
  }

  tags = var.tags
}

# Allow the rule to invoke the Lambda (resource-based policy). Standalone so the
# dependency graph stays a DAG (eventbridge.targets -> lambda arn; this
# permission -> {lambda name, eventbridge rule arn}) with no module cycle.
resource "aws_lambda_permission" "rotation_redeploy_eventbridge" {
  count         = var.enable_rotation_auto_redeploy ? 1 : 0
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.rotation_redeploy_lambda[0].lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = module.rotation_redeploy_eventbridge[0].eventbridge_rule_arns[local.rotation_rule_name]
}
