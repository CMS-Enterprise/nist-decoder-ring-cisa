# One-off Fargate task definitions for Prisma migrations and seed loading.
# Neither is attached to an ECS service — they run on demand via
# `aws ecs run-task`. See docs/runbooks/ecs-migration-and-seed.md.
#
# Both share the same container image, IAM roles, networking, and log group
# as the long-running app service. The only differences are the `command`
# override (consumed by entrypoint.mjs) and the task definition family
# name so operators can target each one explicitly.

locals {
  common_log_config = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
      "awslogs-region"        = var.region
      "awslogs-stream-prefix" = "task"
    }
  }

  common_container_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "DB_HOST", value = var.db_endpoint_host },
    { name = "DB_PORT", value = tostring(var.db_port) },
    { name = "DB_NAME", value = var.db_name },
    { name = "DB_SECRET_ARN", value = var.master_user_secret_arn },
  ]
}

# --- Migration task: `prisma migrate deploy` ---

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-${var.environment}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512

  # Match the app service's ARM64 runtime (see ecs_service.tf). All three
  # task defs (app, migrate, seed) share the same image; all three must
  # declare the same cpu_architecture or Fargate produces `exec format error`.
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  execution_role_arn = aws_iam_role.task_exec.arn
  task_role_arn      = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${module.ecr.repository_url}:${var.container_image_tag}"
      essential = true

      command = [
        "node",
        "node_modules/.bin/prisma",
        "migrate",
        "deploy",
      ]

      environment      = local.common_container_env
      logConfiguration = local.common_log_config
    }
  ])

  tags = var.tags
}

# --- Seed task: Prisma-client-based loader (app/prisma/seed-ecs.ts) ---

resource "aws_ecs_task_definition" "seed" {
  family                   = "${var.name_prefix}-${var.environment}-seed"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  execution_role_arn = aws_iam_role.task_exec.arn
  task_role_arn      = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "seed"
      image     = "${module.ecr.repository_url}:${var.container_image_tag}"
      essential = true

      # Invokes app/prisma/seed-ecs.ts via the node tsx loader (tsx is a
      # dev dependency; the seed task image must include it — see the
      # runner stage of the Dockerfile).
      command = [
        "node",
        "--import",
        "tsx",
        "prisma/seed-ecs.ts",
      ]

      # The seed runner has no default catalog and fails loudly when unset, so this
      # must be supplied or `ecs-run-seed` aborts AFTER migrate has already run.
      environment = concat(
        local.common_container_env,
        [{ name = "SEED_CATALOG", value = var.seed_catalog }],
      )
      logConfiguration = local.common_log_config
    }
  ])

  tags = var.tags
}
