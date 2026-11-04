provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "zt-decoder-ring"
      Environment = var.environment
      ManagedBy   = "terraform"
      Team        = "zero-trust"
    }
  }
}

# ---------------------------------------------------------------
# PARTIAL BACKEND — env-specific config lives in backend-<env>.hcl, which is
# not committed: write it from output "backend_config" (see backend.hcl.example).
#
# Each AWS account bootstraps independently. S3-native state
# locking via use_lockfile — no DynamoDB locking, ever, on new
# environments.
#
# Day-to-day (env already bootstrapped):
#   terraform init -reconfigure -backend-config=backend-<env>.hcl
#
# First-time bootstrap of a new AWS account (2-step):
#   1. Local-state-first apply (no -backend-config = local state):
#        rm -rf .terraform terraform.tfstate*
#        terraform init
#        terraform apply -var environment=<env> [-var name_prefix=<prefix>]
#      → creates the S3 state bucket and access logging bucket, named
#        <name_prefix>-<env>-tfstate-<account_id>-<region>[-logs].
#      Save output "backend_config" as backend-<env>.hcl and output
#      "environment_backend_config" as ../environments/<env>/backend.hcl.
#   2. Migrate local state into the new bucket:
#        terraform init -migrate-state -backend-config=backend-<env>.hcl
#        rm terraform.tfstate terraform.tfstate.backup
# ---------------------------------------------------------------
terraform {
  backend "s3" {}
}
