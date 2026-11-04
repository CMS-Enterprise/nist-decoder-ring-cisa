locals {
  # HTTP:80 only ever redirects to HTTPS; nothing is served over plain HTTP. Until the
  # HTTPS listener exists the redirect leads nowhere, which is the point: AWS rejects a
  # PENDING_VALIDATION certificate on a listener, so enable_https_listener stays false
  # until the certificate is ISSUED, and the app is not served before then.
  alb_http_listener = {
    port     = 80
    protocol = "HTTP"
    redirect = {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  alb_https_listeners = var.enable_https_listener ? {
    https = {
      port            = 443
      protocol        = "HTTPS"
      ssl_policy      = var.tls_security_policy
      certificate_arn = module.acm.acm_certificate_arn
      forward = {
        target_group_key = "ecs"
      }
    }
  } : {}

  alb_listeners = merge(
    { http = local.alb_http_listener },
    local.alb_https_listeners,
  )
}

module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "10.5.1"

  name               = "${var.name_prefix}-${var.environment}"
  load_balancer_type = "application"
  vpc_id             = var.vpc_id
  subnets            = var.public_subnet_ids
  security_groups    = [var.alb_security_group_id]

  internal                         = false
  enable_deletion_protection       = var.enable_alb_deletion_protection
  enable_cross_zone_load_balancing = true

  # Enabling access logs makes AWS write a test object to the bucket, which fails until the
  # bucket policy grants the log-delivery service access. s3_bucket_id resolves as soon as the
  # bucket exists, before the policy, so the bucket is read through a list that also names
  # s3_bucket_policy: the value is still the bucket name, but the ALB now waits for the policy.
  # The depends_on below holds the whole module to the same order.
  access_logs = var.enable_alb_access_logs ? {
    bucket  = element([module.alb_logs_bucket.s3_bucket_id, module.alb_logs_bucket.s3_bucket_policy], 0)
    enabled = true
    prefix  = local.alb_logs_prefix
  } : null

  # We already own the ALB security group (infra/modules/security/main.tf).
  # Don't let the ALB module create another one.
  create_security_group = false

  # Listener config:
  #   HTTP:80 always 301-redirects to HTTPS.
  #   enable_https_listener = true adds HTTPS:443, forwarding to ECS. It only comes on
  #   after the certificate is ISSUED; AWS rejects PENDING_VALIDATION certificates at
  #   listener-create time.
  listeners = local.alb_listeners

  # Target group the Fargate service registers itself with.
  # target_type=ip is required for Fargate awsvpc networking.
  target_groups = {
    ecs = {
      name              = "${var.name_prefix}-${var.environment}-ecs"
      protocol          = "HTTP"
      port              = 3000
      target_type       = "ip"
      vpc_id            = var.vpc_id
      create_attachment = false

      health_check = {
        enabled             = true
        path                = "/api/health"
        port                = "3000"
        protocol            = "HTTP"
        healthy_threshold   = 2
        unhealthy_threshold = 3
        interval            = 30
        timeout             = 5
        matcher             = "200"
      }
    }
  }

  tags = var.tags

  depends_on = [module.alb_logs_bucket]
}
