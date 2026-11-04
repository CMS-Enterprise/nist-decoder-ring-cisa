module "ecs_cluster" {
  source  = "terraform-aws-modules/ecs/aws//modules/cluster"
  version = "7.6.1"

  name = "${var.name_prefix}-${var.environment}"

  # Fargate-only cluster; rely on AWS's built-in FARGATE capacity provider.
  # Container Insights is on by default via the module's `setting` default.
  cluster_capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy = {
    FARGATE = {
      weight = 100
    }
  }

  tags = var.tags
}
