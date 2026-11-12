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

  # master_user_secret_kms_key_arn: intentionally null for dev.
  #
  # AWS limitation: aws_db_instance.master_user_secret_kms_key_id is set at
  # instance creation time and cannot be changed later, so dev keeps the
  # AWS-managed key (alias/aws/secretsmanager) for its master user secret.
  #
  # New environments (prod) should pass `module.kms.secrets_kms_key_arn`
  # here so the master user secret is CMK-encrypted from t=0.
  master_user_secret_kms_key_arn = null

  tags = local.tags
}

# --- The database the app reads ---
#
# The app reads the database module's instance unless db_restored_instance_identifier
# names an instance that scripts/db-recover.sh restored outside Terraform. Terraform
# only reads that instance, and the database module goes on managing the original,
# which a recovery never changes. docs/runbooks/prod-db-recovery.md covers the
# cutover and what to do with the two instances afterwards.
data "aws_db_instance" "restored" {
  count                  = var.db_restored_instance_identifier == null ? 0 : 1
  db_instance_identifier = var.db_restored_instance_identifier

  lifecycle {
    postcondition {
      condition     = try(self.master_user_secret[0].secret_status, "") == "active"
      error_message = "The restored instance has no active RDS-managed master secret for the app to read. The restore phase of scripts/db-recover.sh establishes one."
    }
  }
}

locals {
  app_db = var.db_restored_instance_identifier == null ? {
    address    = module.database.db_address
    port       = module.database.db_port
    name       = module.database.db_name
    secret_arn = module.database.master_user_secret_arn
    } : {
    address    = data.aws_db_instance.restored[0].address
    port       = data.aws_db_instance.restored[0].port
    name       = data.aws_db_instance.restored[0].db_name
    secret_arn = data.aws_db_instance.restored[0].master_user_secret[0].secret_arn
  }
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

  master_user_secret_arn = local.app_db.secret_arn
  auth_secret_arn        = module.secrets.auth_secret_arn
  kms_key_arn            = module.kms.secrets_kms_key_arn

  # The rotation schedule stays on the managed instance's secret while the app
  # reads a restored one (see rotation_redeploy.tf in the compute module).
  rotation_secret_arn = module.database.master_user_secret_arn

  # Discrete DB connection pieces the entrypoint consumes. The migrate and seed
  # task definitions take the same ones.
  db_endpoint_host = local.app_db.address
  db_port          = local.app_db.port
  db_name          = local.app_db.name

  # Rotation trigger passed through to the ECS service's
  # `triggers` map. Bumping this in tfvars forces a new deployment so
  # tasks pick up the new AUTH_SECRET value.
  auth_secret_rotation_version = var.auth_secret_rotation_version

  # Pinned image tag deployed by the ECS service.
  container_image_tag = var.container_image_tag

  # Auto-redeploy on RDS master-secret rotation (scheduled early-morning
  # rotation + EventBridge -> Lambda -> ECS force-new-deployment).
  enable_rotation_auto_redeploy = var.enable_rotation_auto_redeploy

  # WAF: public by default (geolock + rate limit + AWS managed baseline).
  waf_mode                  = var.waf_mode
  waf_allowed_country_codes = var.waf_allowed_country_codes
  waf_rate_limit            = var.waf_rate_limit
  waf_export_rate_limit     = var.waf_export_rate_limit
  waf_count_rate_limit      = var.waf_count_rate_limit
  waf_allow_cidrs           = var.waf_allow_cidrs

  name_prefix            = var.name_prefix
  enable_alb_access_logs = var.enable_alb_access_logs
  # Dev is torn down freely (no ALB deletion protection); let destroy
  # empty the log bucket instead of failing on it.
  alb_access_logs_force_destroy = true

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
