output "state_bucket_name" {
  description = "S3 bucket for Terraform state"
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  description = "ARN of the S3 state bucket"
  value       = aws_s3_bucket.state.arn
}

output "logging_bucket_name" {
  description = "S3 bucket for state access logs"
  value       = aws_s3_bucket.logging.id
}

output "backend_config" {
  description = "Contents for backend-<env>.hcl in infra/bootstrap/, the bootstrap's own state"
  value       = <<-EOT
    bucket       = "${aws_s3_bucket.state.id}"
    key          = "bootstrap/terraform.tfstate"
    region       = "${var.region}"
    use_lockfile = true
    encrypt      = true
  EOT
}

output "environment_backend_config" {
  description = "Contents for backend.hcl in infra/environments/<env>/"
  value       = <<-EOT
    bucket       = "${aws_s3_bucket.state.id}"
    key          = "environments/${var.environment}/terraform.tfstate"
    region       = "${var.region}"
    use_lockfile = true
    encrypt      = true
  EOT
}

output "migrate_state_command" {
  description = "Run after the local-state-first apply, once backend_config is saved as backend-<env>.hcl, to migrate state into the new bucket"
  value       = "terraform init -migrate-state -backend-config=backend-${var.environment}.hcl"
}
