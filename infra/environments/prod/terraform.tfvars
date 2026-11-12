# ZT Decoder Ring — prod baseline variables (COMMITTED)
#
# Values that hold for any account this stack deploys into. Everything that
# belongs to one estate is an input, not a value here:
#   - vpc_id, subnet_name_prefix and app_fqdn have no default, so plan
#     prompts for them. Supply them in a gitignored *.auto.tfvars file, or
#     as TF_VAR_<name> in CI.
#   - app_fqdn is the app's only address, served over HTTPS; nothing is
#     served over plain HTTP.
#   - After the first apply, output "launch" lists the DNS records to publish
#     and the next steps.
# See terraform.tfvars.example for every input with its meaning.

region      = "us-east-1"
environment = "prod"

# Ingress Web ACL: public, US and territories only, per-IP rate limit, AWS
# managed baseline. Other modes: "allowlist" (with waf_allow_cidrs), "none".
waf_mode = "public"

# Pinned image tag, bumped in lockstep with each push.
container_image_tag = "v0.1.16"

# HTTPS listener and the app's service: turn on after the certificate for
# app_fqdn is ISSUED.
enable_https_listener = false

enable_alb_access_logs        = true
enable_rotation_auto_redeploy = true

# Prod protects its data from mistakes.
db_deletion_protection         = true
db_skip_final_snapshot         = false
db_backup_retention_period     = 30
enable_alb_deletion_protection = true

# Alert email subscriptions are not committed and default to none. Supply
# alarm_email_endpoints in a *.auto.tfvars file or as
# TF_VAR_alarm_email_endpoints; it is left unset here so either one reaches it.
