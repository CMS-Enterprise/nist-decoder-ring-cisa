output "db_endpoint" {
  description = "RDS instance endpoint (host:port)"
  value       = module.rds.db_instance_endpoint
}

output "db_address" {
  description = "RDS instance hostname (no port)"
  value       = module.rds.db_instance_address
}

output "db_port" {
  description = "RDS instance port"
  value       = module.rds.db_instance_port
}

output "db_name" {
  description = "Initial database name"
  value       = module.rds.db_instance_name
}

output "db_username" {
  description = "Master database username"
  value       = module.rds.db_instance_username
  sensitive   = true
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed Secrets Manager secret containing master credentials"
  value       = module.rds.db_instance_master_user_secret_arn
}
