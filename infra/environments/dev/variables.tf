variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be \"dev\" or \"prod\"."
  }
}

variable "name_prefix" {
  description = "Leading segment of every resource name (<name_prefix>-<env>-...), so two instances can share an account and region when each has its own prefix. S3 bucket names, global across accounts, also carry the account ID and region. Must match name_prefix in infra/bootstrap."
  type        = string
  default     = "ztdr"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,14}[a-z0-9]$", var.name_prefix)) && !strcontains(var.name_prefix, "--")
    error_message = "name_prefix must be 2 to 16 characters of lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit. RDS identifiers require the leading letter and forbid a double hyphen."
  }
}

variable "vpc_id" {
  description = "VPC ID provided by networking team"
  type        = string
}

variable "subnet_name_prefix" {
  description = "Name-tag prefix the networking team uses for subnets (e.g. 'decoder-ring-dev'). Combined with tier suffix (public/private/data) to discover subnet IDs."
  type        = string
}

variable "auth_secret_rotation_version" {
  description = "Bump this string (e.g. \"1\" -> \"2\") in terraform.tfvars to force regeneration of AUTH_SECRET on the next terraform apply. Leave null to keep the existing value in place (e.g., after a manual put-secret-value)."
  type        = string
  default     = null
}

variable "container_image_tag" {
  description = "ECR image tag to deploy. ECR is IMMUTABLE so every push gets a unique version tag (e.g. v0.1.0, v0.1.1) — update this value in lockstep with the push to roll the ECS service onto the new image. The `:latest` default is a leftover from the pre-IMMUTABLE bootstrap and should not be used going forward."
  type        = string
}

# --- RDS secret-rotation auto-redeploy ---

variable "enable_rotation_auto_redeploy" {
  description = "Provision the RDS-secret-rotation auto-redeploy (scheduled early-morning rotation + EventBridge->Lambda->ECS force-new-deployment) so rotation self-heals without a manual ecs-redeploy or terraform run. Dev enables this first to validate the chain; prod follows once the deploy role carries the lambda and events permissions."
  type        = bool
  default     = false
}

# --- Alarms / SNS ---

variable "alarm_email_endpoints" {
  description = "Email addresses to subscribe to the dev alerts SNS topic. Each subscription requires manual click-confirm by the recipient on first apply (AWS sends a confirmation link). Default empty — topic is still provisioned, just unsubscribed."
  type        = list(string)
  default     = []
}

# --- Ingress WAF ---

variable "waf_mode" {
  description = "Ingress Web ACL on the ALB. \"public\" (default): allow by default, block requests from outside waf_allowed_country_codes, rate-limit each IP, and run the AWS managed baseline rule groups. \"allowlist\": the same rules, then default-block except waf_allow_cidrs. \"none\": no Web ACL."
  type        = string
  default     = "public"

  validation {
    condition     = contains(["public", "allowlist", "none"], var.waf_mode)
    error_message = "waf_mode must be \"public\", \"allowlist\" or \"none\"."
  }
}

variable "waf_allowed_country_codes" {
  description = "ISO 3166-1 alpha-2 codes allowed through the geolock. Default: the United States and its territories."
  type        = list(string)
  default     = ["US", "PR", "GU", "VI", "AS", "MP", "UM"]
}

variable "waf_rate_limit" {
  description = "Requests per IP per 5 minutes before the rate-based rule blocks."
  type        = number
  default     = 2000
}

variable "waf_export_rate_limit" {
  description = "Requests to /api/export per IP per 5 minutes before the Web ACL answers 429."
  type        = number
  default     = 100
}

variable "waf_count_rate_limit" {
  description = "Requests to the export page's count per IP per 5 minutes before the Web ACL answers 429."
  type        = number
  default     = 1000
}

variable "waf_allow_cidrs" {
  description = "IPv4 CIDRs allowed in allowlist mode. Required when waf_mode = \"allowlist\"."
  type        = list(string)
  default     = null
}

variable "enable_alb_access_logs" {
  description = "Deliver ALB access logs to the S3 bucket <name_prefix>-<env>-alb-logs-<account_id>-<region>."
  type        = bool
  default     = true
}

# --- Hostname and TLS ---
#
# app_fqdn has no default, so plan asks for it. It gets an ACM certificate
# and, once enable_https_listener is on, HTTPS with the FIPS post-quantum
# hybrid policy. It is the app's only address: nothing is served over plain
# HTTP. Output "launch" lists the DNS records and what to configure.

variable "app_fqdn" {
  description = "Public hostname for the app, in a DNS zone you control (e.g. decoderring.example.gov). The app is served only over HTTPS on this name."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", lower(trimspace(var.app_fqdn))))
    error_message = "app_fqdn must be a fully qualified hostname such as decoderring.example.gov. The app is served only over HTTPS, and ACM cannot issue a certificate for the ALB's own DNS name."
  }
}

variable "enable_https_listener" {
  description = "Serve HTTPS:443 and start the app's ECS service. Turn on only after the ACM certificate for app_fqdn is ISSUED; AWS rejects a pending certificate on a listener. HTTP:80 only ever redirects to HTTPS."
  type        = bool
  default     = false
}

variable "subject_alternative_names" {
  description = "Optional extra names on the ACM certificate."
  type        = list(string)
  default     = []
}

# --- Sign-in (OIDC), off unless oidc_issuer is set ---
# Each input becomes the app variable it is named for; see auth-strategy.md. The client
# secret is not an input: Terraform creates its Secrets Manager entry and output
# launch.sign_in gives the command that stores it.

variable "oidc_issuer" {
  description = "OIDC issuer URL (https://, without /.well-known/...). Empty means sign-in is off and the app is anonymous."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition     = var.oidc_issuer == "" || can(regex("^https://", var.oidc_issuer))
    error_message = "oidc_issuer must be an https:// URL, or empty to leave sign-in off."
  }
}

variable "oidc_client_id" {
  description = "Client id registered at the issuer. Required with oidc_issuer."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition     = (var.oidc_issuer == "") == (var.oidc_client_id == "")
    error_message = "oidc_issuer and oidc_client_id are set together, or neither."
  }
}

variable "oidc_display_name" {
  description = "The provider's name on the sign-in button (\"Sign in with <name>\"). Optional."
  type        = string
  default     = ""
  nullable    = false
}

variable "oidc_signin_link" {
  description = "Put a sign-in control in the header that goes straight to the issuer. Needs oidc_issuer."
  type        = bool
  default     = false

  validation {
    condition     = !var.oidc_signin_link || var.oidc_issuer != ""
    error_message = "oidc_signin_link needs oidc_issuer."
  }
}

variable "oidc_allowed_email_domains" {
  description = "Only these email domains may sign in, matched exactly. Empty means the issuer alone decides. Needs oidc_issuer."
  type        = list(string)
  default     = []
  nullable    = false

  validation {
    condition     = length(var.oidc_allowed_email_domains) == 0 || var.oidc_issuer != ""
    error_message = "oidc_allowed_email_domains needs oidc_issuer."
  }

  validation {
    condition     = alltrue([for d in var.oidc_allowed_email_domains : can(regex("^@?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$", trimspace(d)))])
    error_message = "Each oidc_allowed_email_domains entry must be a domain, such as agency.gov."
  }
}

variable "oidc_allow_unverified_email" {
  description = "With a domain list, accept addresses the issuer did not mark verified (email_verified). Prefer mapping the claim at the issuer."
  type        = bool
  default     = false

  validation {
    condition     = !var.oidc_allow_unverified_email || length(var.oidc_allowed_email_domains) > 0
    error_message = "oidc_allow_unverified_email needs oidc_allowed_email_domains."
  }
}

# --- Database recovery ---

variable "db_restored_instance_identifier" {
  description = "Identifier of an RDS instance that scripts/db-recover.sh restored outside Terraform, for the app to read in place of the database module's instance. Null, the default, keeps the app on the module's instance. Terraform reads the named instance and never changes it. See docs/runbooks/prod-db-recovery.md."
  type        = string
  default     = null

  validation {
    condition     = var.db_restored_instance_identifier == null || can(regex("^${var.name_prefix}-${var.environment}-[a-z0-9]+(-[a-z0-9]+)*$", var.db_restored_instance_identifier))
    error_message = "db_restored_instance_identifier names a restored instance, <name_prefix>-<environment>-<suffix>, never the database module's own <name_prefix>-<environment>."
  }
}
