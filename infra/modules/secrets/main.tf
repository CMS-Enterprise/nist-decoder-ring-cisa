module "auth_secret" {
  source  = "terraform-aws-modules/secrets-manager/aws"
  version = "2.2.0"

  name                    = "${var.name_prefix}/${var.environment}/AUTH_SECRET"
  description             = "NextAuth session signing key for ZT Decoder Ring ${var.environment}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 7

  kms_key_id = var.kms_key_arn

  create_random_password = true
  random_password_length = 32

  # AUTH_SECRET is consumed by NextAuth/Auth.js as an HMAC key and is injected
  # into ECS via env var. Override the module's default special-character set
  # so the value survives shell, JSON, and URL-encoded contexts without
  # escaping issues. Alphanumeric-only is sufficient entropy at 32 chars
  # (~190 bits) and matches the `openssl rand -base64 32` reference format.
  random_password_override_special = ""

  # Rotation trigger: when var.rotation_version changes, the upstream module
  # treats it as a cue to write a new secret version. The ephemeral
  # random_password regenerates on apply, so the new version holds a fresh
  # alphanumeric value encrypted with whatever KMS key is currently on the
  # secret (the CMK). Null (default) means no rotation attempted.
  secret_string_wo_version = var.rotation_version

  tags = var.tags
}

# The OIDC client secret, created only when sign-in is configured. Terraform creates the
# entry with a placeholder and never manages its value afterwards (ignore_secret_changes):
# the operator stores the real secret with the command in output launch.sign_in, so it
# never enters Terraform state. Until then the app runs, and sign-in fails at the issuer.
module "oidc_client_secret" {
  source  = "terraform-aws-modules/secrets-manager/aws"
  version = "2.2.0"

  create = var.create_oidc_client_secret

  name                    = "${var.name_prefix}/${var.environment}/AUTH_OIDC_SECRET"
  description             = "OIDC client secret for ZT Decoder Ring ${var.environment} sign-in; set outside Terraform"
  recovery_window_in_days = var.environment == "prod" ? 30 : 7

  kms_key_id = var.kms_key_arn

  secret_string         = "set-outside-terraform"
  ignore_secret_changes = true

  tags = var.tags
}
