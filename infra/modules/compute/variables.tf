variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "region" {
  description = "AWS region (used for CloudWatch log config)"
  type        = string
  default     = "us-east-1"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# --- ECR ---

variable "ecr_image_tag_mutability" {
  description = "Tag mutability for ECR repository (MUTABLE or IMMUTABLE)"
  type        = string
  default     = "IMMUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.ecr_image_tag_mutability)
    error_message = "Must be \"MUTABLE\" or \"IMMUTABLE\"."
  }
}

# --- Networking (from networking module outputs) ---

variable "vpc_id" {
  description = "VPC ID for ALB + ECS placement"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Fargate tasks"
  type        = list(string)
}

# --- Security groups (from security module outputs) ---

variable "alb_security_group_id" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "ecs_security_group_id" {
  description = "Security group ID for ECS tasks"
  type        = string
}

# --- Secrets the task-exec role needs to read ---

variable "master_user_secret_arn" {
  description = "ARN of the RDS-managed master user secret (for ECS task-exec GetSecretValue)"
  type        = string
}

variable "auth_secret_arn" {
  description = "ARN of the AUTH_SECRET Secrets Manager secret"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the CMK encrypting the secrets above (task-exec needs kms:Decrypt)"
  type        = string
}

# --- CloudWatch Logs ---

variable "log_retention_days" {
  description = "CloudWatch log group retention in days"
  type        = number
  default     = 30
}

# --- WAF ---

variable "waf_mode" {
  description = "Ingress Web ACL: \"public\" (allow by default; geolock, per-IP rate limit, AWS managed baseline), \"allowlist\" (the same rules, then default-block except waf_allow_cidrs) or \"none\". See waf.tf."
  type        = string
  default     = "public"

  validation {
    condition     = contains(["public", "allowlist", "none"], var.waf_mode)
    error_message = "waf_mode must be \"public\", \"allowlist\" or \"none\"."
  }
}

variable "waf_allowed_country_codes" {
  description = "ISO 3166-1 alpha-2 codes the geolock allows. Default: the United States and its territories (PR, GU, VI, AS, MP, UM)."
  type        = list(string)
  default     = ["US", "PR", "GU", "VI", "AS", "MP", "UM"]

  validation {
    condition     = length(var.waf_allowed_country_codes) > 0 && alltrue([for c in var.waf_allowed_country_codes : can(regex("^[A-Z]{2}$", c))])
    error_message = "waf_allowed_country_codes must be a non-empty list of two-letter upper-case ISO 3166-1 codes."
  }
}

variable "waf_rate_limit" {
  description = "Requests per client IP per 5-minute window before the rate-based rule blocks. AWS accepts 10 to 2,000,000,000."
  type        = number
  default     = 2000

  validation {
    condition     = var.waf_rate_limit >= 10 && var.waf_rate_limit <= 2000000000
    error_message = "waf_rate_limit must be between 10 and 2000000000."
  }
}

variable "waf_export_rate_limit" {
  description = "Requests to /api/export per client IP per 5-minute window before the Web ACL answers 429. AWS accepts 10 to 2,000,000,000."
  type        = number
  default     = 100

  validation {
    condition     = var.waf_export_rate_limit >= 10 && var.waf_export_rate_limit <= 2000000000
    error_message = "waf_export_rate_limit must be between 10 and 2000000000."
  }
}

variable "waf_count_rate_limit" {
  description = "Requests to the export page's count (decoder.countExport) per client IP per 5-minute window before the Web ACL answers 429. AWS accepts 10 to 2,000,000,000."
  type        = number
  default     = 1000

  validation {
    condition     = var.waf_count_rate_limit >= 10 && var.waf_count_rate_limit <= 2000000000
    error_message = "waf_count_rate_limit must be between 10 and 2000000000."
  }
}

variable "waf_allow_cidrs" {
  description = "IPv4 CIDRs allowed through in allowlist mode. Required when waf_mode = \"allowlist\"; ignored otherwise."
  type        = list(string)
  default     = null

  validation {
    condition     = var.waf_mode != "allowlist" || try(length(var.waf_allow_cidrs), 0) > 0
    error_message = "waf_allow_cidrs must list at least one CIDR when waf_mode = \"allowlist\"."
  }
}

# --- Database connection inputs (for the task definition to pass to entrypoint.mjs) ---

variable "db_endpoint_host" {
  description = "RDS hostname (no port). Passed to the container as DB_HOST."
  type        = string
}

variable "db_port" {
  description = "RDS port. Passed to the container as DB_PORT."
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "Initial database name. Passed to the container as DB_NAME."
  type        = string
}

# --- ECS sizing ---

variable "ecs_cpu" {
  description = "Fargate task CPU (vCPU units). 256 = 0.25 vCPU."
  type        = number
  default     = 256
}

variable "ecs_memory" {
  description = "Fargate task memory in MB."
  type        = number
  default     = 512
}

variable "ecs_desired_count" {
  description = "Desired running count for the ECS service. 0 scales down for cost savings."
  type        = number
  default     = 1
}

variable "container_image_tag" {
  description = "ECR image tag to deploy (e.g. a semver or commit SHA). Required — no default. ECR repos in this project are IMMUTABLE, so a `latest` default would deploy whichever (frozen) digest happened to land on that tag and silently mask new pushes."
  type        = string

  validation {
    condition     = length(var.container_image_tag) > 0
    error_message = "container_image_tag must be a non-empty tag string."
  }
}

# --- Rotation trigger ---

variable "auth_secret_rotation_version" {
  description = "Rotation trigger passed through from the dev env. Included in the ECS service `triggers` map so bumping it in tfvars redeploys the service and picks up the new AUTH_SECRET value on the next task start. Null = no trigger."
  type        = string
  default     = null
}

# --- RDS master-secret rotation auto-redeploy ---
#
# When true, provisions (see rotation_redeploy.tf):
#   Part A — pins the RDS-managed master secret's rotation to an early-morning
#            UTC window so the unavoidable sub-minute rotation window lands at
#            low traffic instead of AWS's randomly-chosen time.
#   Part B — an EventBridge rule on the Secrets Manager RotationSucceeded event
#            invokes a Lambda that forces an ECS new-deployment, so a fresh task
#            re-reads the rotated password automatically (no manual ecs-redeploy,
#            no terraform run at rotation time).
#
# Default false so the resources only exist where deliberately enabled. The
# deploy role needs lambda/events/iam/secretsmanager-rotation permissions
# before flipping true.
variable "enable_rotation_auto_redeploy" {
  description = "Provision the RDS-secret-rotation auto-redeploy (scheduled rotation + EventBridge->Lambda->ECS force-new-deployment), so the app re-reads a rotated password without a manual redeploy. Default false. Requires lambda/events/iam/secretsmanager-rotation permissions on the deploy role before enabling."
  type        = bool
  default     = false
}

variable "db_secret_rotation_schedule" {
  description = "Secrets Manager rotation schedule for the RDS master secret (UTC; minutes must be 0, year must be *). Only used when enable_rotation_auto_redeploy=true. Default cron(0 10 ? * SUN *) = ~06:00 ET Sunday (05:00 EST / 06:00 EDT)."
  type        = string
  default     = "cron(0 10 ? * SUN *)"
}

variable "db_secret_rotation_window" {
  description = "Secrets Manager rotation window duration (e.g. \"2h\"). Must not extend into the next rotation window. Only used when enable_rotation_auto_redeploy=true."
  type        = string
  default     = "2h"
}

# --- ALB ---

variable "enable_alb_deletion_protection" {
  description = "Protect the ALB from accidental deletion (the API/console refuse to delete it). Default false for dev (cheap teardown); set true for prod."
  type        = bool
  default     = false
}

# --- TLS / public DNS ---

variable "enable_https_listener" {
  description = "Create the HTTPS:443 listener and the ECS service. Turn on only once the ACM certificate for app_fqdn is ISSUED: AWS rejects a PENDING_VALIDATION certificate on a listener. Until then nothing serves the app, and HTTP:80 only redirects to HTTPS."
  type        = bool
  default     = false
}

variable "app_fqdn" {
  description = "Public FQDN for the app (e.g. 'app.example.gov' or 'dev.app.example.gov'), its only address: the ACM certificate is requested for it and the app is served over HTTPS on it. Whoever owns the parent zone publishes the FQDN's alias or CNAME plus the validation CNAMEs."
  type        = string
  nullable    = false
}

variable "subject_alternative_names" {
  description = "Optional SAN list for the ACM cert (e.g. ['www.<fqdn>']). Defaults to no SANs."
  type        = list(string)
  default     = []
}

variable "tls_security_policy" {
  description = "ALB HTTPS listener SSL policy, always a FIPS one. ELBSecurityPolicy-TLS13-1-2-Res-FIPS-PQ-2025-09: TLS 1.3 and 1.2 with GCM-mode ECDHE ciphers only, hybrid post-quantum (ML-KEM) key exchange for clients that offer it, on a FIPS 140-validated cryptographic module. It is the non-FIPS Res-PQ policy without ChaCha20-Poly1305. Changing it updates the listener in place."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-Res-FIPS-PQ-2025-09"

  validation {
    # FIPS, TLS 1.2 or later, and GCM ciphers only: the TLS 1.3-only FIPS policies and the
    # restricted TLS 1.2 ones. The other FIPS policies allow TLS 1.0 or 1.1, or CBC suites.
    condition     = can(regex("^ELBSecurityPolicy-TLS13-1-(3|2-Res)-FIPS-", var.tls_security_policy))
    error_message = "Must be an ELBSecurityPolicy-TLS13-1-3-FIPS-* or ELBSecurityPolicy-TLS13-1-2-Res-FIPS-* policy: FIPS, TLS 1.2 or later, GCM ciphers only. The listener never uses a non-FIPS policy."
  }
}

variable "seed_catalog" {
  description = "Which catalog directory under app/prisma/seed-sql/ the seed task loads. One deployment holds one catalog."
  type        = string
  default     = "nist-800-53"
}

variable "name_prefix" {
  description = "Leading segment of every resource name: <name_prefix>-<env>-... S3 bucket names add the account ID and region after it, since they are global across accounts."
  type        = string
  default     = "ztdr"
}

variable "enable_alb_access_logs" {
  description = "Deliver ALB access logs to an S3 bucket <name_prefix>-<env>-alb-logs-<account_id>-<region> (SSE-S3, versioned, public access blocked, TLS-only)."
  type        = bool
  default     = false
}

variable "alb_access_logs_force_destroy" {
  description = "Let terraform destroy delete the ALB log bucket with its objects. For environments that are torn down freely."
  type        = bool
  default     = false
}

variable "alb_access_log_retention_days" {
  description = "Days an ALB access log object is kept before it expires."
  type        = number
  default     = 90
}

# --- Sign-in (OIDC) ---

variable "oidc_environment" {
  description = "Sign-in settings for the task (AUTH_OIDC_ISSUER, AUTH_OIDC_ID and the optional ones), already validated by the environment stack. Empty means sign-in is off and the app is anonymous."
  type        = map(string)
  default     = {}
}

variable "oidc_client_secret_arn" {
  description = "ARN of the OIDC client secret, injected as AUTH_OIDC_SECRET. Null when sign-in is off."
  type        = string
  default     = null
}
