data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

# The partition (aws, aws-us-gov) for the ARN built below.
data "aws_partition" "current" {}

# Deterministic ARN for the ECS log group the CMK is scoped to. Matches
# the resource created in infra/modules/compute/cloudwatch.tf. Computed
# here (rather than via a data source or module dependency) to avoid a
# circular dependency between the KMS module and compute module.
locals {
  ecs_log_group_arn = "arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${var.name_prefix}-${var.environment}"
}

module "secrets_cmk" {
  source  = "terraform-aws-modules/kms/aws"
  version = "4.2.2"

  description             = "CMK for ZT Decoder Ring ${var.environment} secrets (RDS master password, AUTH_SECRET) and CloudWatch logs"
  key_usage               = "ENCRYPT_DECRYPT"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  aliases = ["${var.name_prefix}-${var.environment}-secrets"]

  # Default policy grants account root full kms:* — standard admin path.
  enable_default_policy = true

  # Service-principal statements scoped with the appropriate condition keys:
  #
  #   Secrets Manager — all crypto ops, bound with kms:ViaService so the key
  #   can only be invoked through Secrets Manager API calls (defense in depth
  #   against direct kms:Decrypt calls on raw ciphertext).
  #
  #   RDS — only kms:CreateGrant (gated on kms:GrantIsForAWSResource so grants
  #   can't be issued to arbitrary principals) plus kms:DescribeKey.
  #   RDS obtains its actual crypto permissions at runtime via the grant it
  #   creates; it does not call Encrypt/Decrypt directly against this key.
  #
  #   CloudWatch Logs — crypto access scoped via kms:EncryptionContext:aws:logs:arn
  #   to our specific ECS log group. Prevents other log groups in the account
  #   from using this key. Added for FedRAMP SC-28 (encryption at rest for
  #   audit logs).
  #
  # The ECS task role gets kms:Decrypt via its IAM policy (see
  # infra/modules/compute/iam.tf), not through the key policy.
  key_statements = [
    {
      sid    = "AllowSecretsManagerServiceUse"
      effect = "Allow"
      principals = [
        {
          type        = "Service"
          identifiers = ["secretsmanager.amazonaws.com"]
        }
      ]
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
      ]
      resources = ["*"]
      condition = [
        {
          test     = "StringEquals"
          variable = "kms:ViaService"
          values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
        },
      ]
    },
    {
      sid    = "AllowRDSServiceCreateGrant"
      effect = "Allow"
      principals = [
        {
          type        = "Service"
          identifiers = ["rds.amazonaws.com"]
        }
      ]
      actions = [
        "kms:CreateGrant",
        "kms:DescribeKey",
      ]
      resources = ["*"]
      condition = [
        {
          test     = "Bool"
          variable = "kms:GrantIsForAWSResource"
          values   = ["true"]
        },
      ]
    },
    {
      sid    = "AllowCloudWatchLogsServiceUse"
      effect = "Allow"
      principals = [
        {
          type        = "Service"
          identifiers = ["logs.${data.aws_region.current.region}.amazonaws.com"]
        }
      ]
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
      ]
      resources = ["*"]
      condition = [
        {
          test     = "ArnEquals"
          variable = "kms:EncryptionContext:aws:logs:arn"
          values   = [local.ecs_log_group_arn]
        },
      ]
    },
  ]

  tags = var.tags
}
