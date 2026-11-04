module "ecs_service" {
  source  = "terraform-aws-modules/ecs/aws//modules/service"
  version = "7.6.1"

  # The service starts with the HTTPS listener: before it, nothing forwards to the target
  # group, and the app is served only over HTTPS. The task definition exists from the
  # first apply, so the migrate and seed tasks can run before HTTPS is on.
  create_service = var.enable_https_listener

  name        = local.ecs_service_name
  cluster_arn = module.ecs_cluster.arn

  cpu           = var.ecs_cpu
  memory        = var.ecs_memory
  desired_count = var.ecs_desired_count

  # Run on Graviton (ARM64). Operators on Apple Silicon build native
  # arm64 images without cross-compile overhead, Fargate ARM64 is ~20%
  # cheaper than x86_64, and it avoids the `exec format error` you
  # get when an arm64 image lands on x86_64 Fargate capacity.
  # Must match the `docker build --platform linux/arm64` used in the
  # runbook and the runtime_platform on the one-off migration/seed
  # task definitions in ecs_migration_tasks.tf.
  runtime_platform = {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  # One task by default (desired_count = 1). The service module's default
  # autoscaling target and CPU/memory policies are off, so scaling is an
  # explicit choice.
  enable_autoscaling = false

  # We own the IAM roles (see iam.tf). Don't let the module create its own.
  create_task_exec_iam_role = false
  task_exec_iam_role_arn    = aws_iam_role.task_exec.arn
  create_tasks_iam_role     = false
  tasks_iam_role_arn        = aws_iam_role.task.arn

  # We own the ECS SG in the security module. Don't let the service module
  # create its own.
  create_security_group = false
  security_group_ids    = [var.ecs_security_group_id]

  subnet_ids       = var.private_subnet_ids
  assign_public_ip = false

  deployment_circuit_breaker = {
    enable   = true
    rollback = true
  }

  # Rotation trigger: when var.auth_secret_rotation_version changes, the
  # module treats it as a cue to force a new deployment. This pairs with
  # the secrets module's secret_string_wo_version bump — Terraform
  # applies both in the same plan, so the new secret value is written and
  # the ECS tasks restart to pick it up without any out-of-band
  # `aws ecs update-service --force-new-deployment` call.
  #
  # The terraform-aws-modules/ecs service module exposes this as a native
  # `triggers` input; we preferred it over a null_resource + local-exec
  # wrapper after terraform-mcp verification showed the in-module path is
  # the current best practice.
  triggers = var.auth_secret_rotation_version == null ? null : {
    auth_secret_rotation_version = var.auth_secret_rotation_version
  }

  load_balancer = {
    service = {
      target_group_arn = local.target_group_arn_after_https_listener
      container_name   = "app"
      container_port   = 3000
    }
  }

  container_definitions = {
    # HEADS UP: terraform-aws-modules/ecs//modules/container-definition
    # proxies the AWS task-definition JSON API, so most container keys
    # are camelCase (portMappings, healthCheck, logConfiguration,
    # readonlyRootFilesystem, environmentFiles). Unknown top-level keys
    # are silently dropped — a snake_case typo here produces a container
    # with the attribute unset and no Terraform warning. snake_case is
    # only valid for module-introduced inputs like
    # `create_cloudwatch_log_group`, `enable_cloudwatch_logging`.
    # See: container-definition/variables.tf in the module cache.
    app = {
      # We already provision aws_cloudwatch_log_group.ecs with our CMK.
      # Don't let the container-definition submodule create a second one.
      create_cloudwatch_log_group = false

      essential = true
      image     = "${module.ecr.repository_url}:${var.container_image_tag}"

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]

      # Discrete pieces the entrypoint needs to compose DATABASE_URL.
      # The entrypoint reads DB_SECRET_ARN via the AWS SDK, so we don't
      # inject the password itself here.
      environment = concat([
        { name = "NODE_ENV", value = "production" },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "PORT", value = "3000" },
        { name = "DB_HOST", value = var.db_endpoint_host },
        { name = "DB_PORT", value = tostring(var.db_port) },
        { name = "DB_NAME", value = var.db_name },
        { name = "DB_SECRET_ARN", value = var.master_user_secret_arn },
        # The URL people reach the app at; Auth.js builds sign-in callbacks from it.
        { name = "AUTH_URL", value = local.app_url },
        ],
        [for name, value in var.oidc_environment : { name = name, value = value }],
      )

      # AUTH_SECRET is injected via ECS secrets mapping — the secretsmanager
      # community module stores the random password as a flat string, so
      # valueFrom is the plain ARN (no JSON selector).
      secrets = concat(
        [{ name = "AUTH_SECRET", valueFrom = var.auth_secret_arn }],
        var.oidc_client_secret_arn == null ? [] : [
          { name = "AUTH_OIDC_SECRET", valueFrom = var.oidc_client_secret_arn },
        ],
      )

      healthCheck = {
        command     = ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 40
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "app"
        }
      }

      readonlyRootFilesystem = false
    }
  }

  tags = var.tags
}

locals {
  # The app's public URL, and its only one. It is fixed from the first apply, so a sign-in
  # redirect URI registered before HTTPS is on still works once it is.
  app_url = "https://${var.app_fqdn}"

  # Known before the service exists, for the alarms and the rotation redeploy, which are
  # created on the first apply.
  ecs_service_name = "${var.name_prefix}-${var.environment}-app"
  ecs_service_arn  = "arn:${data.aws_partition.current.partition}:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:service/${module.ecs_cluster.name}/${local.ecs_service_name}"

  # The target group, read through the HTTPS listener so the service waits for that
  # listener, the only one that forwards to the group. The value is the target group's ARN;
  # the second element exists only for the ordering, so keep it when tidying this up.
  target_group_arn_after_https_listener = element([module.alb.target_groups["ecs"].arn, try(module.alb.listeners["https"].arn, "")], 0)
}
