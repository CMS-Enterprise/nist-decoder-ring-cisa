module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "7.2.2"

  identifier = "${var.name_prefix}-${var.environment}"

  engine         = "postgres"
  engine_version = "16.13"
  family         = "postgres16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "zt_decoder_ring"
  username = "ztdecoder"

  manage_master_user_password   = true
  master_user_secret_kms_key_id = var.master_user_secret_kms_key_arn

  create_db_subnet_group = false
  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [var.db_security_group_id]
  publicly_accessible    = false

  backup_retention_period = var.backup_retention_period
  skip_final_snapshot     = var.skip_final_snapshot
  deletion_protection     = var.deletion_protection

  enabled_cloudwatch_logs_exports = ["postgresql"]

  auto_minor_version_upgrade = true
  apply_immediately          = var.apply_immediately

  # Parameter group: enforce SSL for all connections (SC-8 defense in depth).
  # apply_method = pending-reboot: RDS reports rds.force_ssl with
  # apply_method=pending-reboot, so leaving the module default ("immediate")
  # produced a perpetual no-op plan diff. force_ssl is set once and
  # never changed, so pending-reboot has no operational effect.
  create_db_parameter_group = true
  parameters = [
    {
      name         = "rds.force_ssl"
      value        = "1"
      apply_method = "pending-reboot"
    }
  ]

  create_db_option_group = false

  tags = var.tags
}
