variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Leading segment of every bucket name. Bucket names are global across all AWS accounts, so the account ID and region follow it; give each instance sharing an account and region its own prefix. Must match name_prefix in the environment stacks."
  type        = string
  default     = "ztdr"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,14}[a-z0-9]$", var.name_prefix)) && !strcontains(var.name_prefix, "--")
    error_message = "name_prefix must be 2 to 16 characters of lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit, so the longest bucket name stays within S3's 63. RDS identifiers require the leading letter and forbid a double hyphen."
  }
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be \"dev\" or \"prod\"."
  }
}
