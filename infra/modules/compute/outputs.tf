# --- ECR ---

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = module.ecr.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = module.ecr.repository_arn
}

# --- ALB ---

output "alb_arn" {
  description = "ALB ARN"
  value       = module.alb.arn
}

output "alb_dns_name" {
  description = "ALB DNS name (hand this to the R53 team for the CNAME/alias)"
  value       = module.alb.dns_name
}

output "alb_zone_id" {
  description = "ALB canonical hosted zone ID (for Route53 alias records)"
  value       = module.alb.zone_id
}

output "alb_target_group_ecs_arn" {
  description = "ARN of the ECS target group on the ALB (the ECS service attaches to this)"
  value       = module.alb.target_groups["ecs"].arn
}

# --- ECS cluster ---

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs_cluster.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = module.ecs_cluster.arn
}

# --- IAM roles (for the ECS service to reference) ---

output "task_exec_role_arn" {
  description = "ARN of the ECS task execution role"
  value       = aws_iam_role.task_exec.arn
}

output "task_role_arn" {
  description = "ARN of the ECS task role"
  value       = aws_iam_role.task.arn
}

# --- CloudWatch ---

output "log_group_name" {
  description = "Name of the CloudWatch log group for ECS tasks"
  value       = aws_cloudwatch_log_group.ecs.name
}

output "log_group_arn" {
  description = "ARN of the CloudWatch log group for ECS tasks"
  value       = aws_cloudwatch_log_group.ecs.arn
}

# --- ECS service + one-off task definitions ---

output "ecs_service_name" {
  description = "Name of the ECS service (use with aws ecs describe-services / update-service). The service itself is created with the HTTPS listener."
  value       = local.ecs_service_name
}

output "ecs_service_arn" {
  description = "ARN of the ECS service, which is created with the HTTPS listener."
  value       = local.ecs_service_arn
}

output "ecs_migrate_task_family" {
  description = "Task definition family for the one-off Prisma migration task"
  value       = aws_ecs_task_definition.migrate.family
}

output "ecs_seed_task_family" {
  description = "Task definition family for the one-off Prisma-client seed task"
  value       = aws_ecs_task_definition.seed.family
}

# --- WAF ---

output "waf_web_acl_arn" {
  description = "ARN of the ingress Web ACL. Null when waf_mode = \"none\"."
  value       = local.waf_enabled ? module.waf[0].web_acl_arn : null
}

output "waf_allowlist_ip_set_arn" {
  description = "ARN of the allowlist IP set. Null unless waf_mode = \"allowlist\"."
  value       = local.waf_allowlisted ? module.waf_allowlist[0].arn : null
}

output "app_url" {
  description = "The URL the app is reached at, as the task's AUTH_URL carries it."
  value       = local.app_url
}

output "tls_security_policy" {
  description = "SSL policy on the HTTPS listener."
  value       = var.tls_security_policy
}

output "alb_access_logs_bucket" {
  description = "S3 bucket receiving ALB access logs. Null when disabled."
  value       = var.enable_alb_access_logs ? module.alb_logs_bucket.s3_bucket_id : null
}

output "alb_access_logs_access_bucket" {
  description = "S3 bucket receiving the ALB log bucket's own server access logs. Null when disabled."
  value       = var.enable_alb_access_logs ? module.alb_logs_access_bucket.s3_bucket_id : null
}

# --- TLS / ACM ---

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate for app_fqdn."
  value       = module.acm.acm_certificate_arn
}

output "acm_certificate_status" {
  description = "Status of the ACM certificate (PENDING_VALIDATION → ISSUED once networking publishes the validation CNAMEs)."
  value       = module.acm.acm_certificate_status
}

output "acm_validation_records" {
  description = "DNS validation records to hand to the networking team. Each entry has domain_name, name, type, and value — they create these CNAMEs in the parent hosted zone, ACM polls until they resolve, then flips the cert to ISSUED."
  value = [
    for option in module.acm.acm_certificate_domain_validation_options : {
      domain_name = option.domain_name
      name        = option.resource_record_name
      type        = option.resource_record_type
      value       = option.resource_record_value
    }
  ]
}
