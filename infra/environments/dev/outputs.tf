# --- Networking ---

output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.networking.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.networking.private_subnet_ids
}

output "database_subnet_ids" {
  description = "Database subnet IDs"
  value       = module.networking.database_subnet_ids
}

# --- Security Groups ---

output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = module.security.alb_security_group_id
}

output "ecs_security_group_id" {
  description = "ECS security group ID"
  value       = module.security.ecs_security_group_id
}

output "db_security_group_id" {
  description = "Database security group ID"
  value       = module.security.db_security_group_id
}

# --- ECR ---

output "ecr_repository_url" {
  description = "ECR repository URL for docker push"
  value       = module.compute.ecr_repository_url
}

# --- Database ---

output "db_endpoint" {
  description = "RDS endpoint (host:port)"
  value       = module.database.db_endpoint
}

output "db_address" {
  description = "RDS hostname"
  value       = module.database.db_address
}

output "db_port" {
  description = "RDS port"
  value       = module.database.db_port
}

output "db_name" {
  description = "Initial database name"
  value       = module.database.db_name
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed master user secret (JSON {username,password}). Injected into the ECS tasks."
  value       = module.database.master_user_secret_arn
}

# --- Secrets ---

output "auth_secret_arn" {
  description = "ARN of the AUTH_SECRET Secrets Manager secret"
  value       = module.secrets.auth_secret_arn
}

output "auth_secret_name" {
  description = "Name of the AUTH_SECRET Secrets Manager secret"
  value       = module.secrets.auth_secret_name
}

# --- KMS ---

output "secrets_kms_key_arn" {
  description = "ARN of the CMK encrypting the RDS master user secret and AUTH_SECRET"
  value       = module.kms.secrets_kms_key_arn
  sensitive   = true
}

# --- ALB + ECS ---

output "alb_arn" {
  description = "ALB ARN"
  value       = module.compute.alb_arn
}

output "alb_dns_name" {
  description = "ALB DNS name (hand to R53 team for CNAME/alias)"
  value       = module.compute.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB canonical hosted zone ID (for Route53 alias records)"
  value       = module.compute.alb_zone_id
}

output "ecs_cluster_name" {
  description = "ECS cluster name (for `aws ecs ...` commands)"
  value       = module.compute.ecs_cluster_name
}

output "ecs_task_exec_role_arn" {
  description = "ARN of the ECS task execution role (the task definitions consume this)"
  value       = module.compute.task_exec_role_arn
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task role"
  value       = module.compute.task_role_arn
}

output "ecs_log_group_name" {
  description = "CloudWatch log group name used by ECS tasks"
  value       = module.compute.log_group_name
}

# --- ECS service + one-off tasks ---

output "ecs_service_name" {
  description = "Name of the ECS service (used by the migration runbook)"
  value       = module.compute.ecs_service_name
}

output "ecs_migrate_task_family" {
  description = "Task definition family for prisma migrate deploy"
  value       = module.compute.ecs_migrate_task_family
}

output "ecs_seed_task_family" {
  description = "Task definition family for the Prisma-client seed executor"
  value       = module.compute.ecs_seed_task_family
}

# --- TLS / ACM (populated when app_fqdn is set) ---

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate fronting the ALB."
  value       = module.compute.acm_certificate_arn
}

output "acm_certificate_status" {
  description = "ACM certificate status (PENDING_VALIDATION → ISSUED once the validation CNAMEs are published in the hostname's DNS zone)."
  value       = module.compute.acm_certificate_status
}

output "acm_validation_records" {
  description = "DNS CNAME records to publish in the hostname's DNS zone for certificate validation."
  value       = module.compute.acm_validation_records
}

# --- Alerts ---

output "alerts_topic_arn" {
  description = "ARN of the SNS topic receiving CloudWatch alarm notifications."
  value       = module.sns_alerts.topic_arn
}

output "alerts_topic_name" {
  description = "Name of the SNS topic receiving CloudWatch alarm notifications."
  value       = module.sns_alerts.topic_name
}

# --- Launch: what this deployment needs from whoever runs it ---

output "launch" {
  description = "How to reach this deployment and what to configure next: the URL, the hostname format expected, the DNS records to publish, and the remaining steps."
  value = {
    url = module.compute.app_url

    hostname        = trimspace(var.app_fqdn)
    hostname_format = "A fully qualified name in a DNS zone you control, e.g. decoderring.example.gov. Pass it as app_fqdn (prompted by plan, or TF_VAR_app_fqdn)."

    dns_records = concat(
      [{
        purpose = "Point the hostname at the load balancer (Route 53 alias, or CNAME elsewhere)"
        name    = trimspace(var.app_fqdn)
        type    = "A (alias) or CNAME"
        value   = module.compute.alb_dns_name
        zone_id = module.compute.alb_zone_id
      }],
      [for r in module.compute.acm_validation_records : {
        purpose = "ACM certificate validation"
        name    = r.name
        type    = r.type
        value   = r.value
        zone_id = null
      }]
    )

    next_steps = !var.enable_https_listener ? [
      "Publish the dns_records above.",
      "Wait until the ACM certificate is ISSUED (aws acm describe-certificate).",
      "Set enable_https_listener = true and apply again. That creates the HTTPS listener and starts the app; until then HTTP only redirects to HTTPS.",
      ] : [
      "Serving HTTPS at https://${trimspace(var.app_fqdn)} with ${module.compute.tls_security_policy}.",
    ]

    sign_in = local.oidc_enabled ? {
      mode         = "oidc"
      issuer       = var.oidc_issuer
      redirect_uri = "${module.compute.app_url}/api/auth/callback/oidc"
      client_secret = {
        name = module.secrets.oidc_client_secret_name
        # read -rs takes the value without echoing it, so it never reaches shell history.
        set_it_with = "read -rs OIDC_CLIENT_SECRET && aws secretsmanager put-secret-value --secret-id ${module.secrets.oidc_client_secret_name} --secret-string \"$OIDC_CLIENT_SECRET\" && unset OIDC_CLIENT_SECRET && make ecs-redeploy ENV=${var.environment}"
      }
      } : {
      mode          = "anonymous"
      issuer        = null
      redirect_uri  = null
      client_secret = null
    }

    waf = {
      mode              = var.waf_mode
      allowed_countries = var.waf_mode == "none" ? [] : var.waf_allowed_country_codes
      rate_limit_per_ip = var.waf_mode == "none" ? null : "${var.waf_rate_limit} requests per 5 minutes"
      export_rate_limit = var.waf_mode == "none" ? null : "${var.waf_export_rate_limit} export requests per 5 minutes"
      count_rate_limit  = var.waf_mode == "none" ? null : "${var.waf_count_rate_limit} export counts per 5 minutes"
    }
  }
}
