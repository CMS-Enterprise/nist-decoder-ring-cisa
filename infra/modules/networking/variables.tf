variable "name_prefix" {
  description = "Leading segment of every resource name: <name_prefix>-<env>-... Give each instance sharing an account and region its own prefix."
  type        = string
  default     = "ztdr"
}

variable "vpc_id" {
  description = "ID of the externally-managed VPC (from networking team)"
  type        = string
}

variable "subnet_name_prefix" {
  description = "Name-tag prefix for subnets, e.g. 'decoder-ring-dev'. Combined with tier suffix (public/private/data) and AZ to match subnet Name tags set by the networking team."
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod) — used to name the DB subnet group"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources owned by this module (DB subnet group)"
  type        = map(string)
  default     = {}
}
