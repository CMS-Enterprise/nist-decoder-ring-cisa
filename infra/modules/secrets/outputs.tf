output "auth_secret_arn" {
  description = "ARN of the AUTH_SECRET Secrets Manager secret"
  value       = module.auth_secret.secret_arn
}

output "auth_secret_name" {
  description = "Name of the AUTH_SECRET Secrets Manager secret"
  value       = module.auth_secret.secret_name
}

output "oidc_client_secret_arn" {
  description = "ARN of the OIDC client secret entry. Null when sign-in is not configured."
  value       = var.create_oidc_client_secret ? module.oidc_client_secret.secret_arn : null
}

output "oidc_client_secret_name" {
  description = "Name of the OIDC client secret entry. Null when sign-in is not configured."
  value       = var.create_oidc_client_secret ? module.oidc_client_secret.secret_name : null
}
