# Security groups for ALB, ECS, and Database.
# Cross-references between SGs are added as standalone rules
# to avoid circular dependencies between module blocks.
#
# v6 of terraform-aws-modules/security-group changed the rule shape to
# map(object(...)) and flipped two defaults that matter here:
#   - use_name_prefix defaults to true  -> set false to keep stable SG names
#     (a changed create-only name forces SG replacement).
#   - enable_exclusive_rules defaults to true -> set false so the module does
#     not revert the standalone cross-reference rules defined below.

# --- ALB Security Group ---

module "alb_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "6.0.0"

  name                   = "${var.name_prefix}-${var.environment}-alb"
  use_name_prefix        = false
  description            = "ALB - public HTTP/HTTPS ingress"
  vpc_id                 = var.vpc_id
  enable_exclusive_rules = false

  ingress_rules = {
    http = {
      from_port   = 80
      to_port     = 80
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
      description = "HTTP from anywhere"
    }
    https = {
      from_port   = 443
      to_port     = 443
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
      description = "HTTPS from anywhere"
    }
  }

  # Egress to ECS added as standalone rule below
  egress_rules = {}

  tags = var.tags
}

# --- ECS Security Group ---

module "ecs_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "6.0.0"

  name                   = "${var.name_prefix}-${var.environment}-ecs"
  use_name_prefix        = false
  description            = "ECS Fargate tasks"
  vpc_id                 = var.vpc_id
  enable_exclusive_rules = false

  # Ingress from ALB added as standalone rule below
  ingress_rules = {}

  # HTTPS out for external calls (Okta JWKS, etc.)
  egress_rules = {
    https = {
      from_port   = 443
      to_port     = 443
      ip_protocol = "tcp"
      cidr_ipv4   = "0.0.0.0/0"
      description = "HTTPS out for external calls (Okta JWKS, etc.)"
    }
  }

  tags = var.tags
}

# --- Database Security Group ---

module "db_sg" {
  source  = "terraform-aws-modules/security-group/aws"
  version = "6.0.0"

  name                   = "${var.name_prefix}-${var.environment}-db"
  use_name_prefix        = false
  description            = "Database - ECS ingress only"
  vpc_id                 = var.vpc_id
  enable_exclusive_rules = false

  # All rules added as standalone below
  ingress_rules = {}
  egress_rules  = {}

  tags = var.tags
}

# --- Cross-Reference Rules ---

# ALB → ECS (egress on 3000)
resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  security_group_id            = module.alb_sg.id
  referenced_security_group_id = module.ecs_sg.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  description                  = "ALB to ECS on port 3000"
  tags                         = var.tags
}

# ECS ← ALB (ingress on 3000)
resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = module.ecs_sg.id
  referenced_security_group_id = module.alb_sg.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  description                  = "ECS from ALB on port 3000"
  tags                         = var.tags
}

# ECS → DB (egress on 5432)
resource "aws_vpc_security_group_egress_rule" "ecs_to_db" {
  security_group_id            = module.ecs_sg.id
  referenced_security_group_id = module.db_sg.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "ECS to database on port 5432"
  tags                         = var.tags
}

# DB ← ECS (ingress on 5432)
resource "aws_vpc_security_group_ingress_rule" "db_from_ecs" {
  security_group_id            = module.db_sg.id
  referenced_security_group_id = module.ecs_sg.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Database from ECS on port 5432"
  tags                         = var.tags
}
