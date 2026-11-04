data "aws_caller_identity" "current" {}

# The partition (aws, aws-us-gov) for every ARN this module builds from names.
data "aws_partition" "current" {}

# ECS-in-account ARN pattern used to scope role trust policies. Matches
# AWS's documented ECS task-role trust example exactly
# (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
# #task-iam-roles-trust-relationship). A tighter task-specific pattern
# (arn:<partition>:ecs:region:account:task/cluster/*) didn't match the
# aws:SourceArn AWS actually passes during RunTask — task-id format or
# source value timing caused the condition to fail consistently. The
# `arn:<partition>:ecs:region:account:*` form still scopes to ECS resources in
# this account (paired with aws:SourceAccount for belt-and-suspenders),
# which satisfies the confused-deputy intent without being brittle.
locals {
  ecs_account_arn_pattern = "arn:${data.aws_partition.current.partition}:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:*"
}

# --- Task execution role (used by ECS agent to pull images, write logs, read secrets) ---

# Trust policy scoped to the specific ECS cluster so only tasks launched in
# our cluster can assume the role (confused-deputy mitigation per AWS
# IAM guidance for ECS task roles). aws:SourceAccount is retained as a
# belt-and-suspenders account boundary.
data "aws_iam_policy_document" "task_exec_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.ecs_account_arn_pattern]
    }
  }
}

resource "aws_iam_role" "task_exec" {
  name               = "${var.name_prefix}-${var.environment}-task-exec"
  description        = "ECS task execution role for ZTDR ${var.environment}: ECR pull, CloudWatch write, secret read, CMK decrypt"
  assume_role_policy = data.aws_iam_policy_document.task_exec_trust.json

  tags = var.tags
}

# AWS-managed baseline: ECR pull + base CloudWatch write for ECS tasks.
resource "aws_iam_role_policy_attachment" "task_exec_managed" {
  role       = aws_iam_role.task_exec.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Inline policy: read the app's secrets, decrypt via the CMK (scoped to
# secretsmanager.ViaService), and write to our dedicated log group.
data "aws_iam_policy_document" "task_exec_inline" {
  statement {
    sid    = "SecretsManagerRead"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = compact([
      var.master_user_secret_arn,
      var.auth_secret_arn,
      var.oidc_client_secret_arn,
    ])
  }

  statement {
    sid    = "KmsDecryptForSecrets"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [var.kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid    = "CloudWatchLogsWrite"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
  }
}

resource "aws_iam_role_policy" "task_exec_inline" {
  name   = "${var.name_prefix}-${var.environment}-task-exec-inline"
  role   = aws_iam_role.task_exec.id
  policy = data.aws_iam_policy_document.task_exec_inline.json
}

# --- Task role (used by the application container at runtime) ---
# The entrypoint (app/entrypoint.mjs) calls GetSecretValue on the RDS
# master user secret via the default AWS SDK credential chain, which in
# ECS resolves to this role. It also decrypts the resulting JSON via
# the CMK. Permissions are scoped to the specific secret and CMK —
# AUTH_SECRET is injected via the ECS `secrets` block (handled by the
# task-exec role) so the task role doesn't need it at runtime.
# Separate trust document from task_exec so future permission diffs and
# CloudTrail entries are unambiguous about which role is being assumed.

data "aws_iam_policy_document" "task_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.ecs_account_arn_pattern]
    }
  }
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-${var.environment}-task"
  description        = "ECS task role for ZTDR ${var.environment} app runtime: RDS master user secret read + CMK decrypt via Secrets Manager"
  assume_role_policy = data.aws_iam_policy_document.task_trust.json

  tags = var.tags
}

data "aws_iam_policy_document" "task_inline" {
  statement {
    sid    = "ReadRDSMasterUserSecret"
    effect = "Allow"
    # entrypoint.mjs only calls GetSecretValue. DescribeSecret returns
    # metadata (rotation config, tags) the runtime never reads, so it's
    # omitted per least-privilege.
    actions = ["secretsmanager:GetSecretValue"]
    # Matches both the literal ARN and the suffixed form RDS uses for
    # managed master user secrets (rds!db-<uuid>-<random>).
    resources = [
      var.master_user_secret_arn,
      "${var.master_user_secret_arn}*",
    ]
  }

  statement {
    sid    = "DecryptRDSMasterUserSecretViaSecretsManager"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [var.kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "task_inline" {
  name   = "${var.name_prefix}-${var.environment}-task-inline"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_inline.json
}
