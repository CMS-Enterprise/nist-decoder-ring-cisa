locals {
  tags = {
    Project     = "zt-decoder-ring"
    Environment = var.environment
    ManagedBy   = "terraform"
    Team        = "zero-trust"
  }
}

# --- Networking (external VPC lookup) ---

module "networking" {
  source = "../../modules/networking"

  vpc_id             = var.vpc_id
  subnet_name_prefix = var.subnet_name_prefix
  environment        = var.environment
  name_prefix        = var.name_prefix
  tags               = local.tags
}

# --- Security Groups ---

module "security" {
  source = "../../modules/security"

  environment = var.environment
  name_prefix = var.name_prefix
  vpc_id      = module.networking.vpc_id
  tags        = local.tags
}

# --- KMS (CMK for secrets) ---

module "kms" {
  source = "../../modules/kms"

  environment = var.environment
  name_prefix = var.name_prefix
  tags        = local.tags
}

# --- Database ---

module "database" {
  source = "../../modules/database"

  environment          = var.environment
  name_prefix          = var.name_prefix
  db_subnet_group_name = module.networking.database_subnet_group_name
  db_security_group_id = module.security.db_security_group_id

  # CMK-encrypt the RDS-managed master user secret from t=0.
  #
  # AWS limitation: aws_db_instance.master_user_secret_kms_key_id is set at
  # instance creation time and cannot be changed later. Dev keeps the
  # AWS-managed key (alias/aws/secretsmanager); prod sets the CMK from
  # creation.
  master_user_secret_kms_key_arn = module.kms.secrets_kms_key_arn

  # Prod-grade RDS durability: longer backup retention, deletion protection,
  # and a final snapshot on destroy. Multi-AZ is not enabled, so an AZ failure
  # is recovered by restore (docs/runbooks/prod-db-recovery.md).
  deletion_protection     = var.db_deletion_protection
  skip_final_snapshot     = var.db_skip_final_snapshot
  backup_retention_period = var.db_backup_retention_period
  max_allocated_storage   = var.db_max_allocated_storage

  tags = local.tags
}

# --- Secrets ---

module "secrets" {
  source = "../../modules/secrets"

  environment      = var.environment
  name_prefix      = var.name_prefix
  kms_key_arn      = module.kms.secrets_kms_key_arn
  rotation_version = var.auth_secret_rotation_version
  tags             = local.tags

  create_oidc_client_secret = local.oidc_enabled
}

# --- Compute (ECR + ALB + ECS cluster + service + CloudWatch + IAM + optional WAF association) ---

module "compute" {
  source = "../../modules/compute"

  environment = var.environment
  region      = var.region
  tags        = local.tags

  vpc_id             = module.networking.vpc_id
  public_subnet_ids  = module.networking.public_subnet_ids
  private_subnet_ids = module.networking.private_subnet_ids

  alb_security_group_id = module.security.alb_security_group_id
  ecs_security_group_id = module.security.ecs_security_group_id

  master_user_secret_arn = module.database.master_user_secret_arn
  auth_secret_arn        = module.secrets.auth_secret_arn
  kms_key_arn            = module.kms.secrets_kms_key_arn

  # Discrete DB connection pieces the entrypoint consumes.
  db_endpoint_host = module.database.db_address
  db_port          = module.database.db_port
  db_name          = module.database.db_name

  # Rotation trigger passed through to the ECS service's
  # `triggers` map. Bumping this in tfvars forces a new deployment so
  # tasks pick up the new AUTH_SECRET value.
  auth_secret_rotation_version = var.auth_secret_rotation_version

  # Pinned image tag deployed by the ECS service.
  container_image_tag = var.container_image_tag

  # Auto-redeploy the app when the RDS master secret rotates (scheduled
  # early-morning rotation + EventBridge -> Lambda -> ECS force-new-deployment).
  enable_rotation_auto_redeploy = var.enable_rotation_auto_redeploy

  # Protect the prod ALB from accidental deletion (dev leaves it off for
  # cheap teardown; the module default is false).
  enable_alb_deletion_protection = var.enable_alb_deletion_protection

  # WAF: public by default (geolock + rate limit + AWS managed baseline).
  waf_mode                  = var.waf_mode
  waf_allowed_country_codes = var.waf_allowed_country_codes
  waf_rate_limit            = var.waf_rate_limit
  waf_export_rate_limit     = var.waf_export_rate_limit
  waf_count_rate_limit      = var.waf_count_rate_limit
  waf_allow_cidrs           = var.waf_allow_cidrs

  name_prefix            = var.name_prefix
  enable_alb_access_logs = var.enable_alb_access_logs

  oidc_environment       = local.oidc_environment
  oidc_client_secret_arn = module.secrets.oidc_client_secret_arn

  # TLS. The certificate is requested on the first apply; the HTTPS listener
  # and the service follow once it is ISSUED, because AWS rejects attaching a
  # PENDING_VALIDATION certificate to a listener.
  enable_https_listener     = var.enable_https_listener
  app_fqdn                  = trimspace(var.app_fqdn)
  subject_alternative_names = var.subject_alternative_names
}

# ---------------------------------------------------------------------------
# A plan-time warning until HTTPS is served. A check block warns without
# blocking, so the first apply, which requests the certificate, still runs.
# ---------------------------------------------------------------------------

check "https_not_yet_served" {
  assert {
    condition     = var.enable_https_listener
    error_message = "enable_https_listener is false: the ACM certificate is requested, and the app is not served until HTTPS is on. Publish the records in output \"launch\", wait for the certificate to be ISSUED, then set enable_https_listener = true and apply again."
  }
}

# ---------------------------------------------------------------------------
# Sign-in (OIDC). Off unless oidc_issuer is set; the variables' validations mirror the
# app's startup checks, so a configuration the app would refuse fails at plan.
# ---------------------------------------------------------------------------

locals {
  oidc_enabled = var.oidc_issuer != ""
  oidc_environment = local.oidc_enabled ? merge(
    {
      AUTH_OIDC_ISSUER = var.oidc_issuer
      AUTH_OIDC_ID     = var.oidc_client_id
      AUTH_SIGNIN_LINK = tostring(var.oidc_signin_link)
    },
    var.oidc_display_name == "" ? {} : { AUTH_OIDC_NAME = var.oidc_display_name },
    length(var.oidc_allowed_email_domains) == 0 ? {} : {
      AUTH_ALLOWED_EMAIL_DOMAINS = join(",", [for d in var.oidc_allowed_email_domains : trimspace(d)])
    },
    var.oidc_allow_unverified_email ? { AUTH_ALLOW_UNVERIFIED_EMAIL = "true" } : {},
  ) : {}
}
