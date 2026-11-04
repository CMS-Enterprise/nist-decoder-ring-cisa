# --- ACM Certificate (DNS-validated, external DNS publication) ---
#
# Cert is provisioned in PENDING_VALIDATION on creation. Hand the
# `acm_validation_records` output to the networking team for them to
# publish CNAMEs in the parent hosted zone. Once those records exist,
# ACM auto-validates and the cert flips to ISSUED, at which point the
# HTTPS listener (alb.tf) starts serving with a valid chain.
#
# We don't create the Route53 records ourselves (networking team owns
# the parent zone) and we don't wait for validation in terraform — the
# validation can take days harmlessly.
#
# Uses terraform-aws-modules/acm/aws to match the project's
# community-module-first convention (see modules: alb, ecr, ecs,
# secrets-manager, kms, etc.).

module "acm" {
  source  = "terraform-aws-modules/acm/aws"
  version = "6.3.1"

  domain_name               = var.app_fqdn
  subject_alternative_names = var.subject_alternative_names
  validation_method         = "DNS"

  # Networking team owns the parent zone; they publish the validation
  # CNAMEs externally from this terraform run. We just emit the records.
  create_route53_records = false
  validate_certificate   = false
  wait_for_validation    = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${var.environment}"
  })
}

# State from before the certificate was always requested holds it as module.acm[0]; this
# moves it in place rather than replacing it.
moved {
  from = module.acm[0]
  to   = module.acm
}
