output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = module.alb_sg.id
}

output "ecs_security_group_id" {
  description = "ECS security group ID"
  value       = module.ecs_sg.id
}

output "db_security_group_id" {
  description = "Database security group ID"
  value       = module.db_sg.id
}
