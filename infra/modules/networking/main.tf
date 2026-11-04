# Networking module — looks up an externally-managed VPC and its subnets
# by Name-tag pattern (the networking team owns these; we only read).
#
# Expected subnet names (per networking team convention):
#   ${subnet_name_prefix}-public-{a,b}
#   ${subnet_name_prefix}-private-{a,b}
#   ${subnet_name_prefix}-data-{a,b}
#
# Example prefix for dev: "decoder-ring-dev"
#
# We create our own aws_db_subnet_group from the data-tier subnets so we
# can attach RDS without depending on a subnet group the networking team
# may or may not provide.

data "aws_vpc" "this" {
  id = var.vpc_id
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  filter {
    name   = "tag:Name"
    values = ["${var.subnet_name_prefix}-public-*"]
  }

  lifecycle {
    postcondition {
      condition     = length(self.ids) >= 2
      error_message = "Expected at least 2 public subnets matching '${var.subnet_name_prefix}-public-*' in VPC ${var.vpc_id}. Check subnet_name_prefix in terraform.tfvars or confirm the networking team's Name tags."
    }
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  filter {
    name   = "tag:Name"
    values = ["${var.subnet_name_prefix}-private-*"]
  }

  lifecycle {
    postcondition {
      condition     = length(self.ids) >= 2
      error_message = "Expected at least 2 private subnets matching '${var.subnet_name_prefix}-private-*' in VPC ${var.vpc_id}. Check subnet_name_prefix in terraform.tfvars or confirm the networking team's Name tags."
    }
  }
}

data "aws_subnets" "database" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  filter {
    name   = "tag:Name"
    values = ["${var.subnet_name_prefix}-data-*"]
  }

  lifecycle {
    postcondition {
      condition     = length(self.ids) >= 2
      error_message = "Expected at least 2 data-tier subnets matching '${var.subnet_name_prefix}-data-*' in VPC ${var.vpc_id}. Check subnet_name_prefix in terraform.tfvars or confirm the networking team's Name tags."
    }
  }
}

resource "aws_db_subnet_group" "this" {
  name        = "${var.name_prefix}-${var.environment}-db"
  description = "DB subnet group for ZT Decoder Ring ${var.environment}"
  subnet_ids  = data.aws_subnets.database.ids

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${var.environment}-db"
  })

  # Foundational resource — the RDS instance depends on it and destroying it
  # would force RDS replacement. Remove this lifecycle block only when
  # intentionally decommissioning the environment.
  lifecycle {
    prevent_destroy = true
  }
}
