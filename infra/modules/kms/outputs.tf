output "secrets_kms_key_arn" {
  description = "ARN of the CMK used to encrypt the RDS master user secret and AUTH_SECRET"
  value       = module.secrets_cmk.key_arn
  sensitive   = true
}

output "secrets_kms_key_id" {
  description = "ID of the CMK used to encrypt the RDS master user secret and AUTH_SECRET"
  value       = module.secrets_cmk.key_id
  sensitive   = true
}
