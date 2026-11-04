variable "name_prefix" {
  description = "Leading segment of every resource name: <name_prefix>-<env>-... Give each instance sharing an account and region its own prefix."
  type        = string
  default     = "ztdr"
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for security groups"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
