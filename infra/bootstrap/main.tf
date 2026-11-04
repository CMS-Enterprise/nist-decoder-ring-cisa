# Terraform state backend — S3 bucket with native state locking.
# This is a standalone bootstrap configuration. Apply once per environment,
# then migrate local state to S3 (see providers.tf).

# Bucket names are global across all AWS accounts. The account ID and region
# make the name unique to this account; name_prefix tells apart instances
# that share one.
locals {
  bucket_name = "${var.name_prefix}-${var.environment}-tfstate-${data.aws_caller_identity.current.account_id}-${var.region}"
}

data "aws_caller_identity" "current" {}

# --- S3 State Bucket ---

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- S3 Access Logging ---

resource "aws_s3_bucket" "logging" {
  bucket = "${local.bucket_name}-logs"

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = length("${local.bucket_name}-logs") <= 63
      error_message = "Bucket name ${local.bucket_name}-logs is over S3's 63 characters; shorten name_prefix."
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logging" {
  bucket = aws_s3_bucket.logging.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3, since server access log delivery does not support SSE-KMS: with a KMS default on
# this bucket, the state bucket's access logs are not delivered in a form anyone can read.
resource "aws_s3_bucket_server_side_encryption_configuration" "logging" {
  bucket = aws_s3_bucket.logging.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioned, so a deleted or overwritten access log keeps its earlier version until the
# lifecycle rule below expires it.
resource "aws_s3_bucket_versioning" "logging" {
  bucket = aws_s3_bucket.logging.id

  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_iam_policy_document" "logging" {
  statement {
    sid    = "S3ServerAccessLogsPolicy"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }

    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logging.arn}/state-access-logs/*"]

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.state.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # TLS only, as the ALB log buckets require.
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:*"]
    resources = [aws_s3_bucket.logging.arn, "${aws_s3_bucket.logging.arn}/*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Nobody, administrators and the Terraform roles included, removes a log version before the
  # lifecycle rule expires it. Lifecycle expiry is not an API call and a bucket policy does
  # not stop it. Anyone allowed to change this policy can still lift the Deny.
  statement {
    sid    = "DenyRemovingLogVersions"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:DeleteObjectVersion"]
    resources = ["${aws_s3_bucket.logging.arn}/*"]
  }
}

resource "aws_s3_bucket_policy" "logging" {
  bucket = aws_s3_bucket.logging.id
  policy = data.aws_iam_policy_document.logging.json
}

resource "aws_s3_bucket_lifecycle_configuration" "logging" {
  bucket = aws_s3_bucket.logging.id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    filter {
      prefix = "state-access-logs/"
    }

    expiration {
      days = 90
    }

    # A deleted or overwritten log keeps its earlier version as long.
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  # Versioning turns each expiry into a delete marker. This removes a marker once it is the
  # only version left. It cannot share a block with `days`.
  rule {
    id     = "remove-expired-delete-markers"
    status = "Enabled"

    filter {
      prefix = "state-access-logs/"
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  # The noncurrent rule needs versioning in place first.
  depends_on = [aws_s3_bucket_versioning.logging]
}

resource "aws_s3_bucket_logging" "state" {
  bucket        = aws_s3_bucket.state.id
  target_bucket = aws_s3_bucket.logging.id
  target_prefix = "state-access-logs/"

  # Ensure the target bucket's resource-based policy (granting
  # logging.s3.amazonaws.com PutObject) is in place before AWS validates
  # the PutBucketLogging call. Implicit dependency on aws_s3_bucket.logging
  # exists via target_bucket; this adds the bucket-policy ordering.
  depends_on = [aws_s3_bucket_policy.logging]
}

