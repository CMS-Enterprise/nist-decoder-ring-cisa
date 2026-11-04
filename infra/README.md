# ZT Decoder Ring — infrastructure

Terraform for ZT Decoder Ring. Reusable `modules/` are called from the per-env stacks in `environments/{dev,prod}/` (never applied directly); `bootstrap/` provisions the S3 state backend once per AWS account.

## Variables & the tfvars convention

Each env stack reads a committed baseline `terraform.tfvars` plus optional local overrides. Precedence, lowest → highest:

1. `default`s in `variables.tf`.
2. `TF_VAR_<name>` environment variables. They lose to every tfvars file, so they only reach an input the committed `terraform.tfvars` leaves unset. Operators supply sensitive values this way (no workflow runs Terraform), which is why those inputs stay out of the baseline.
3. **Committed `terraform.tfvars`** — the shared, PR-reviewed baseline of non/minimally-sensitive values that hold for any account (region, WAF mode, image tag, feature flags). Source of truth for shared config, and the **only** tfvars committed.
4. **`*.auto.tfvars`** (gitignored, auto-loaded) — personal/experimental overrides. Create e.g. `local.auto.tfvars` to try a value without touching the baseline; Terraform auto-loads it and it wins over `terraform.tfvars`.
5. `-var` / `-var-file` on the command line — highest.

### gitignore allowlist
`.gitignore` ignores all `*.tfvars` except the explicit per-env baselines:

```gitignore
*.tfvars
!infra/environments/dev/terraform.tfvars
!infra/environments/prod/terraform.tfvars
```

Order matters — the broad ignore comes first, then the specific re-includes (git applies last-match-wins). A negation cannot re-include a file whose parent directory is ignored (not the case here). Adding a new env: add a matching `!infra/environments/<env>/terraform.tfvars` line. (`.gitkeep` is unrelated — it's only a placeholder convention for empty directories and does not affect ignore rules.)

### What goes where
- **Commit to `terraform.tfvars`:** non-sensitive + minimally-sensitive shared values. Never account IDs (derived at runtime via STS) and never secrets (those come from Secrets Manager / the task role).
- **Personal `*.auto.tfvars`:** experimentation and trying an image tag locally. Cost spin-down is not a tfvars input (`ecs_desired_count` lives only in the compute module): scale the running service with `make ecs-scale ENV=<env> COUNT=0`.
- **Truly-sensitive / per-operator values:** omit from the baseline (no `default`) so manual runs prompt; the operator supplies them as `TF_VAR_<name>` or in a gitignored `*.auto.tfvars`.
