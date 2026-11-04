# ALB ingress Web ACL, selected by var.waf_mode:
#
#   public    (default) — allow by default. Block requests from outside
#             waf_allowed_country_codes, rate-limit each client IP, and run
#             the AWS managed baseline rule groups over everything else.
#   allowlist — the same rules, then default-block: only waf_allow_cidrs get
#             through. For a deployment that must not be public.
#   none      — no Web ACL on the ALB.
#
# Source IP: the ALB is internet-facing with nothing in front of it, so WAF
# sees the client's own address and the geo, rate and IP-set rules read it
# directly. Behind a CDN or proxy they would need forwarded_ip_config.

locals {
  waf_enabled     = var.waf_mode != "none"
  waf_allowlisted = var.waf_mode == "allowlist"
  waf_allow_cidrs = var.waf_allow_cidrs == null ? [] : var.waf_allow_cidrs

  # A rate rule's block: 429 with Retry-After, which the export page reads as a rate limit.
  waf_rate_limited = {
    block = {
      custom_response = {
        response_code            = 429
        custom_response_body_key = "rate-limited"
        response_headers         = [{ name = "Retry-After", value = "300" }]
      }
    }
  }

  # Lower priority numbers run first. The geolock and rate limit terminate
  # cheaply before the managed groups inspect bodies and headers.
  waf_baseline_rules = {
    block-outside-allowed-countries = {
      priority = 0
      action   = "block"
      statement = {
        not_statement = {
          statement = {
            geo_match_statement = {
              country_codes = var.waf_allowed_country_codes
            }
          }
        }
      }
    }

    rate-limit-per-ip = {
      priority = 1
      action   = "block"
      statement = {
        rate_based_statement = {
          limit                 = var.waf_rate_limit
          aggregate_key_type    = "IP"
          evaluation_window_sec = 300
        }
      }
    }

    # override_action = "none": the group's own rule actions apply (they can
    # block). Set "count" on a group to observe it without blocking.
    aws-common = {
      priority        = 2
      override_action = "none"
      statement = {
        managed_rule_group_statement = {
          name        = "AWSManagedRulesCommonRuleSet"
          vendor_name = "AWS"
        }
      }
    }

    aws-known-bad-inputs = {
      priority        = 3
      override_action = "none"
      statement = {
        managed_rule_group_statement = {
          name        = "AWSManagedRulesKnownBadInputsRuleSet"
          vendor_name = "AWS"
        }
      }
    }

    aws-sqli = {
      priority        = 4
      override_action = "none"
      statement = {
        managed_rule_group_statement = {
          name        = "AWSManagedRulesSQLiRuleSet"
          vendor_name = "AWS"
        }
      }
    }

    aws-ip-reputation = {
      priority        = 5
      override_action = "none"
      statement = {
        managed_rule_group_statement = {
          name        = "AWSManagedRulesAmazonIpReputationList"
          vendor_name = "AWS"
        }
      }
    }

    # Per-IP limits on the export file route and the export page's count, before
    # the allowlist's allow, since a rate rule only counts the requests that reach it.
    rate-limit-export = {
      priority = 6
      action   = local.waf_rate_limited
      statement = {
        rate_based_statement = {
          limit                 = var.waf_export_rate_limit
          aggregate_key_type    = "IP"
          evaluation_window_sec = 300
          scope_down_statement = {
            byte_match_statement = {
              field_to_match        = { uri_path = {} }
              positional_constraint = "STARTS_WITH"
              search_string         = "/api/export"
              text_transformations = [
                { priority = 0, type = "URL_DECODE" },
                { priority = 1, type = "NORMALIZE_PATH" },
              ]
            }
          }
        }
      }
    }

    rate-limit-count = {
      priority = 7
      action   = local.waf_rate_limited
      statement = {
        rate_based_statement = {
          limit                 = var.waf_count_rate_limit
          aggregate_key_type    = "IP"
          evaluation_window_sec = 300
          # tRPC batches procedures into one path, so match the name anywhere in it.
          scope_down_statement = {
            byte_match_statement = {
              field_to_match        = { uri_path = {} }
              positional_constraint = "CONTAINS"
              search_string         = "decoder.countExport"
              text_transformations = [
                { priority = 0, type = "URL_DECODE" },
                { priority = 1, type = "NORMALIZE_PATH" },
              ]
            }
          }
        }
      }
    }
  }

  # Allowlist mode only: the terminating allow after the baseline. Anything it
  # does not match falls through to the default block.
  waf_allowlist_rules = local.waf_allowlisted ? {
    allow-listed-cidrs = {
      priority = 10
      action   = "allow"
      statement = {
        ip_set_reference_statement = {
          arn = module.waf_allowlist[0].arn
        }
      }
    }
  } : {}
}

module "waf_allowlist" {
  source  = "terraform-aws-modules/wafv2/aws//modules/ip-set"
  version = "2.1.0"

  count = local.waf_allowlisted ? 1 : 0

  name               = "${var.name_prefix}-${var.environment}-allow"
  description        = "Ingress allow list for the ${var.name_prefix}-${var.environment} ALB."
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = local.waf_allow_cidrs

  tags = var.tags
}

module "waf" {
  source  = "terraform-aws-modules/wafv2/aws"
  version = "2.1.0"

  count = local.waf_enabled ? 1 : 0

  name        = "${var.name_prefix}-${var.environment}"
  description = "Ingress Web ACL (${var.waf_mode}) for the ${var.name_prefix}-${var.environment} ALB."
  scope       = "REGIONAL"

  default_action = local.waf_allowlisted ? {
    block = {
      custom_response = {
        response_code            = 403
        custom_response_body_key = "forbidden"
      }
    }
  } : { allow = {} }

  custom_response_bodies = {
    forbidden = {
      content      = "<!DOCTYPE html><html><head><title>Forbidden</title></head><body><h1>403 Forbidden</h1><p>Access to this resource is restricted.</p></body></html>"
      content_type = "TEXT_HTML"
    }
    rate-limited = {
      content      = "Too many requests. Try again in a few minutes."
      content_type = "TEXT_PLAIN"
    }
  }

  rules = merge(local.waf_baseline_rules, local.waf_allowlist_rules)

  association_resource_arns = {
    alb = module.alb.arn
  }

  visibility_config = {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-${var.environment}"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}
