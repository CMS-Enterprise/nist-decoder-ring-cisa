output "vpc_id" {
  description = "VPC ID"
  value       = data.aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = data.aws_subnets.public.ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = data.aws_subnets.private.ids
}

output "database_subnet_ids" {
  description = "Database subnet IDs"
  value       = data.aws_subnets.database.ids
}

output "database_subnet_group_name" {
  description = "RDS DB subnet group name (created by this module from discovered data subnets)"
  value       = aws_db_subnet_group.this.name
}

output "vpc_cidr_block" {
  description = "VPC CIDR block"
  value       = data.aws_vpc.this.cidr_block
}
