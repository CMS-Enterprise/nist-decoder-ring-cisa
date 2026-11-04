resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.name_prefix}-${var.environment}"
  retention_in_days = var.log_retention_days

  # FedRAMP SC-28 (encryption at rest). The CMK policy (see
  # infra/modules/kms/main.tf) grants logs.${region}.amazonaws.com crypto
  # access scoped via kms:EncryptionContext:aws:logs:arn to this exact
  # log group ARN — no other CloudWatch Logs consumers in the account
  # can use this key.
  kms_key_id = var.kms_key_arn

  tags = var.tags
}
