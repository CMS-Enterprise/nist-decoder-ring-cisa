variable "name_prefix" {
  description = "Leading segment of every resource name: <name_prefix>-<env>-... Give each instance sharing an account and region its own prefix."
  type        = string
  default     = "ztdr"
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the KMS CMK to encrypt secrets. If null, the AWS-managed aws/secretsmanager key is used."
  type        = string
  default     = null
}

variable "rotation_version" {
  description = "Rotation trigger for AUTH_SECRET. Bumping this value (e.g. \"1\" -> \"2\") regenerates the random password via the community module's ephemeral random_password and writes a new Secrets Manager version. Leave null to keep the existing value."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "create_oidc_client_secret" {
  description = "Create the <name_prefix>/<env>/AUTH_OIDC_SECRET entry for an OIDC client secret. True when the environment configures an issuer."
  type        = bool
  default     = false
}
