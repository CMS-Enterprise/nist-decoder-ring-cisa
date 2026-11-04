variable "name_prefix" {
  description = "Leading segment of every resource name: <name_prefix>-<env>-... Give each instance sharing an account and region its own prefix."
  type        = string
  default     = "ztdr"
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "db_subnet_group_name" {
  description = "Name of the externally-managed DB subnet group (from networking team)"
  type        = string
}

variable "db_security_group_id" {
  description = "ID of the database security group (from security module)"
  type        = string
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GiB"
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB (set equal to allocated_storage to disable)"
  type        = number
  default     = 100
}

variable "backup_retention_period" {
  description = "Days to retain automated backups"
  type        = number
  default     = 7
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot on destroy (true for dev, false for prod)"
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Prevent accidental deletion (false for dev, true for prod)"
  type        = bool
  default     = false
}

variable "apply_immediately" {
  description = "Apply changes immediately instead of during the next maintenance window"
  type        = bool
  default     = false
}

variable "master_user_secret_kms_key_arn" {
  description = "ARN of the KMS CMK to encrypt the RDS-managed master user secret. If null, the AWS-managed aws/secretsmanager key is used."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
