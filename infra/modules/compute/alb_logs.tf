# ALB access logs: the per-request audit record (client IP, request line,
# status, target, TLS protocol and cipher). CloudWatch and WAF logs do not
# carry it.
#
# Encryption is SSE-S3 because it is the only server-side encryption ALB
# log delivery supports; a customer-managed KMS key would stop delivery.
# us-east-1 predates the log-delivery service principal, so the delivery
# policy grants the regional ELB account (attach_elb_log_delivery_policy);
# attach_lb_log_delivery_policy adds the service-principal form as well.
#
# Bucket names are global across all AWS accounts, so the account ID and
# region follow name_prefix: no other account can hold this name, and
# instances sharing an account tell themselves apart by prefix.

locals {
  alb_logs_bucket_name = "${var.name_prefix}-${var.environment}-alb-logs-${data.aws_caller_identity.current.account_id}-${var.region}"
  alb_logs_bucket_arn  = "arn:${data.aws_partition.current.partition}:s3:::${local.alb_logs_bucket_name}"

  # The ALB writes under <prefix>/AWSLogs/<account id>/; alb.tf passes this prefix.
  alb_logs_prefix = "alb"

  # Both log buckets keep their logs for the same time. A log that is deleted or overwritten
  # keeps its earlier version for that time too, so neither shortens what is kept; the
  # retention Deny below stops anyone removing a version early.
  log_bucket_lifecycle_rules = [
    {
      id     = "expire-access-logs"
      status = "Enabled"
      filter = {}
      expiration = {
        days = var.alb_access_log_retention_days
      }
      noncurrent_version_expiration = {
        noncurrent_days = var.alb_access_log_retention_days
      }
      abort_incomplete_multipart_upload_days = 1
    },
    {
      # Versioning turns each expiry into a delete marker. This rule removes a marker as soon
      # as it is the only version left, instead of once it is alb_access_log_retention_days
      # old. It cannot share a block with `days`.
      id     = "remove-expired-delete-markers"
      status = "Enabled"
      filter = {}
      expiration = {
        expired_object_delete_marker = true
      }
    }
  ]
}

# Both Denies below apply to every principal: administrators and the Terraform roles
# included, not only the log writers. They name the bucket by string, since the module
# cannot read its own ARN here.
#
# The delivery grants allow ELB's writer to put objects anywhere in the bucket, so any
# account's load balancer could write into it. The first Deny keeps every write to this
# account's own log path.
data "aws_iam_policy_document" "alb_logs_write_scope" {
  statement {
    sid    = "DenyWritesOutsideThisAccountsLogPath"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions       = ["s3:PutObject"]
    not_resources = ["${local.alb_logs_bucket_arn}/${local.alb_logs_prefix}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
  }

  source_policy_documents = [for k, d in data.aws_iam_policy_document.log_retention : d.json if k == "alb"]
}

# Versioning keeps a deleted or overwritten log as an earlier version, and this Deny stops
# anyone removing that version before the lifecycle rule expires it, so a log is kept for
# the full retention. Lifecycle expiry is not an API call and a bucket policy does not
# stop it. Anyone allowed to change the bucket policy can still lift this Deny; S3 Object
# Lock would be the step that closes that.
#
# Left out where alb_access_logs_force_destroy is set: a destroy removes every version, and
# this Deny would refuse it.
data "aws_iam_policy_document" "log_retention" {
  for_each = var.alb_access_logs_force_destroy ? {} : {
    alb        = local.alb_logs_bucket_arn
    access_log = "${local.alb_logs_bucket_arn}-logs"
  }

  statement {
    sid    = "DenyRemovingLogVersions"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:DeleteObjectVersion"]
    resources = ["${each.value}/*"]
  }
}

module "alb_logs_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "5.17.0"

  create_bucket = var.enable_alb_access_logs

  bucket        = local.alb_logs_bucket_name
  force_destroy = var.alb_access_logs_force_destroy

  control_object_ownership = true
  object_ownership         = "BucketOwnerEnforced"

  attach_elb_log_delivery_policy        = true
  attach_lb_log_delivery_policy         = true
  attach_deny_insecure_transport_policy = true
  attach_require_latest_tls_policy      = true
  attach_policy                         = true
  policy                                = data.aws_iam_policy_document.alb_logs_write_scope.json

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  versioning = {
    enabled = true
  }

  # Object Lock in governance mode: a log version cannot be deleted or overwritten before
  # its retention runs out unless the caller holds s3:BypassGovernanceRetention and asks to
  # bypass. That holds the retention against someone who can lift the version Deny but
  # cannot bypass the lock. Only this bucket takes it: S3 refuses Object Lock on a server
  # access log destination, which the bucket below and the bootstrap log bucket are.
  # Enabling it on this existing, versioned bucket happens in place; it cannot be turned
  # off again without replacing the bucket.
  # Left off where alb_access_logs_force_destroy is set: a destroy has to remove every
  # version, and a locked one would refuse it.
  object_lock_enabled = !var.alb_access_logs_force_destroy
  object_lock_configuration = var.alb_access_logs_force_destroy ? null : {
    rule = {
      default_retention = {
        mode = "GOVERNANCE"
        days = var.alb_access_log_retention_days
      }
    }
  }

  # Who read or changed these logs: the bucket's own S3 server access logs go to the bucket
  # below. A fresh account has no central trail of S3 data events, so nothing else records
  # it. The target is read through a list that also names its policy, so logging is turned
  # on only once that bucket accepts delivery.
  logging = var.enable_alb_access_logs ? {
    target_bucket = element([module.alb_logs_access_bucket.s3_bucket_id, module.alb_logs_access_bucket.s3_bucket_policy], 0)
    target_prefix = "alb-logs/"
  } : null

  lifecycle_rule = local.log_bucket_lifecycle_rules

  tags = var.tags
}

# The ALB log bucket's server access logs. SSE-S3, since server access log delivery does not
# support SSE-KMS. With ACLs disabled, delivery is granted by bucket policy, and only for the
# ALB log bucket in this account.
module "alb_logs_access_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "5.17.0"

  create_bucket = var.enable_alb_access_logs

  bucket        = "${local.alb_logs_bucket_name}-logs"
  force_destroy = var.alb_access_logs_force_destroy

  control_object_ownership = true
  object_ownership         = "BucketOwnerEnforced"

  attach_access_log_delivery_policy = true
  # Built from the name: reading the ARN from the module above would be a cycle, since that
  # module reads this bucket's name for its logging.
  access_log_delivery_policy_source_buckets  = [local.alb_logs_bucket_arn]
  access_log_delivery_policy_source_accounts = [data.aws_caller_identity.current.account_id]
  attach_deny_insecure_transport_policy      = true
  attach_require_latest_tls_policy           = true
  attach_policy                              = !var.alb_access_logs_force_destroy
  policy                                     = try(data.aws_iam_policy_document.log_retention["access_log"].json, null)

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  versioning = {
    enabled = true
  }

  lifecycle_rule = local.log_bucket_lifecycle_rules

  tags = var.tags
}
