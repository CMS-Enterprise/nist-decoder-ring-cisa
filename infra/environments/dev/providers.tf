provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

# ---------------------------------------------------------------
# PARTIAL BACKEND — the state bucket is per account, so its name lives in a
# backend.hcl that is not committed. Terraform cannot use variables in a
# backend block.
#
#   cp backend.hcl.example backend.hcl   # values: infra/bootstrap's output
#                                        # "environment_backend_config"
#   terraform init -backend-config=backend.hcl
#
# S3-native state locking (use_lockfile) — no DynamoDB.
# ---------------------------------------------------------------
terraform {
  backend "s3" {}
}
