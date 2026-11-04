# Change or roll back the ingress WAF

How to move an environment between the ALB's Web ACL modes, and how to stop a lockout fast when the Web ACL blocks legitimate traffic.

The Web ACL is set by `waf_mode` (`infra/modules/compute/waf.tf`). There is one Web ACL per environment (`<name_prefix>-<env>`), associated with the ALB:

- **`public`** (default): allow by default. It blocks requests from outside `waf_allowed_country_codes` (the US and its territories by default). It rate-limits each client IP (`waf_rate_limit` per 5 minutes), and separately its requests to the export file route (`rate-limit-export`, `waf_export_rate_limit`, default 100) and the export page's count (`rate-limit-count`, `waf_count_rate_limit`, default 1,000), which answer 429 with `Retry-After: 300`. It also runs the AWS managed Common, Known Bad Inputs, SQL injection and IP Reputation rule groups.
- **`allowlist`**: the same rules, then default-block. Only `waf_allow_cidrs` get through, and blocked requests get a 403 page.
- **`none`**: no Web ACL.

## When to use this runbook

- **Legitimate users get 403 Forbidden, or 429 from an export.** Their address is outside the allowed countries, behind a reputation-listed range, over the rate limit, or (in allowlist mode) not in `waf_allow_cidrs`.
- **You or CI/automation are locked out of an environment.**
- **AWS Firewall Manager and this Web ACL are fighting over the ALB association** (it flaps).

Find which rule blocked a request before changing anything. Each rule publishes CloudWatch metrics and sampled requests under the Web ACL `<name_prefix>-<env>`.

## Conventions

```bash
export AWS_PROFILE=<profile-for-the-environment>   # a role allowed to manage wafv2 and the ALB
export AWS_REGION=us-east-1
export ENV=dev   # or prod

ALB_ARN=$(cd infra/environments/$ENV && terraform output -raw alb_arn 2>/dev/null) || \
ALB_ARN=$(aws elbv2 describe-load-balancers --names ztdr-$ENV --region us-east-1 --no-cli-pager --query 'LoadBalancers[0].LoadBalancerArn' --output text)
```

## Option 1: Terraform (preferred; state stays consistent)

Set the change in a gitignored `infra/environments/$ENV/*.auto.tfvars`, which takes precedence over the committed `terraform.tfvars`, or change the committed value in a PR:

```hcl
waf_mode = "none"                      # remove the Web ACL entirely
# or adjust the rule that blocks:
# waf_allowed_country_codes = ["US", "PR", "GU", "VI", "AS", "MP", "UM", "CA"]
# waf_rate_limit            = 5000
# waf_export_rate_limit     = 300
# waf_count_rate_limit      = 3000
```

```bash
cd infra/environments/$ENV
terraform plan -out=waf.tfplan   # review: Web ACL updated in place, or destroyed for "none"
terraform apply waf.tfplan
```

## Option 2: emergency disassociate (fastest; out-of-band)

Use this only to stop an active lockout. It removes the Web ACL from the ALB, so the ALB is open with no WAF. Follow with Option 1.

```bash
aws wafv2 disassociate-web-acl --resource-arn "$ALB_ARN" --region us-east-1 --no-cli-pager
```

Then reconcile: either set `waf_mode = "none"` and apply, or fix the rule and apply. The apply re-associates the Web ACL. Do not leave state drifted.

## Verify

```bash
aws wafv2 get-web-acl-for-resource --resource-arn "$ALB_ARN" --region us-east-1 --no-cli-pager \
  --query 'WebACL.Name' --output text      # <name_prefix>-<env>, or "None"
terraform -chdir=infra/environments/$ENV output -json launch | jq -r .url
# Requested directly. Not make smoke: it retries through the proxy, so it would pass while
# the direct path is still blocked.
curl -sS -o /dev/null -w '%{http_code}\n' "$(terraform -chdir=infra/environments/$ENV output -json launch | jq -r .url)/api/health"   # expect 200
```

## Firewall Manager note

An account in an AWS Organization may be in scope of an AWS Firewall Manager policy that manages Web ACLs. With auto remediation on, a Firewall Manager AWS WAF policy overrides a Web ACL associated by hand with its own, and a Shield policy can create one of its own on the resource. If the association flips back minutes after a change, that is a Firewall Manager policy conflict, and it can't be fixed from this repository's Terraform. Coordinate with whoever administers the organization's Firewall Manager policies.

## Related

- `infra/modules/compute/waf.tf`: the modes and their rules.
- [`prod-deploy.md`](./prod-deploy.md): prod apply and rollback.
