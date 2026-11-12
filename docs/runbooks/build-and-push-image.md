# Build & Push Container Image to ECR

How to build a new ZT Decoder Ring container image and push it to the dev ECR repository. This is the **first** of three runbooks in the deployment chain:

1. **This runbook** — build and push the image.
2. [`deploy-to-ecs.md`](./deploy-to-ecs.md) — point the ECS task definitions at your new image and roll the service.
3. [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md) — invoke the one-off migration / seed tasks against the running cluster.

## When to use this runbook

- **First deploy into a fresh account** — the ECR repository does not exist until the environment stack's first `terraform apply`. Follow the launch order in [`aws-deployment.md`](../architecture/aws-deployment.md): apply, then this runbook, then [`ecs-migration-and-seed.md`](./ecs-migration-and-seed.md), then publish the DNS records, set `enable_https_listener = true` and apply again, which creates the service. `make ecs-redeploy` only works once the service exists.
- **App code change** — anything under `app/` was edited.
- **Dockerfile change** — base image bump, dep added, layer reordering. The `dhi.io` base images are pinned by digest and only move when re-pinned: run `make refresh-image-digests` before a release build. That is a manual update and needs DHI login credentials (`docker login dhi.io` first); see [`refresh-image-digests.md`](../scripts/refresh-image-digests.md). `make scan-base` scans the pinned bases against `trivy.yaml` in seconds, with no build, so a base that would fail the image scan shows up before step 5; see [`scan-base.md`](../scripts/scan-base.md).
- **Prisma schema change** — schema.prisma was edited (the build does `prisma generate`).
- **Dependency change** — `app/package.json` or `app/yarn.lock` was edited.

If you're only changing Terraform (no app code or Dockerfile change), skip this runbook and go straight to `deploy-to-ecs.md`.

**With make.** `AWS_PROFILE=<env-profile> make release-image VERSION=<x.y.z> ENV=dev` does this whole runbook for a release: it bumps the version, checks the RDS CA bundle pin, then runs `ecr-build-push`, which logs in to ECR (step 3), builds (step 5), checks the image carries its runtime files, scans it with Trivy against `trivy.yaml` and pushes (step 6). Each step below names the target that does that step. The commands under it are the same work by hand: for a one-off image, or to see which step a failed target stopped at.

## Prerequisites

- Docker daemon running locally.
- AWS CLI authenticated to the dev account (`aws sts get-caller-identity` returns the expected account ID).
- `gh auth status` shows an account with access to this repository active.
- Terraform state for `infra/environments/dev/` is readable (the preflight pulls outputs from it).

## 1. Preflight exports (re-run when shell loses env vars)

Every step below uses these env vars. Re-run the whole block when you open a fresh terminal — `$ECR_URI`, `$AWS_REGION`, etc. don't survive across sessions.

```bash
export REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT/infra/environments/dev"
export AWS_REGION=us-east-1
export ECR_URI=$(terraform output -raw ecr_repository_url)
echo "$ECR_URI"
```

The `echo` should print something like `<account_id>.dkr.ecr.us-east-1.amazonaws.com/ztdr-dev`. If it prints nothing, your terminal is in the wrong directory or Terraform state isn't readable — fix that before continuing.

## 2. Verify AWS credentials are valid

With make: `make aws-whoami` prints the account and role the active profile resolves to. By hand:

```bash
aws sts get-caller-identity
```

Expected output: a JSON blob with `Account`, `Arn`, `UserId`. If you get `ExpiredToken`, refresh credentials per your org's auth flow before continuing.

## 3. Refresh ECR Docker auth (separate from AWS STS)

ECR uses its own short-lived (~12 hours) Docker password, **separate from your AWS STS session**. Your AWS creds can be valid while the ECR Docker token has expired.

With make: `make ecr-login`. `ecr-build` and `ecr-push` run it themselves, so you need it on its own only before a `docker push` by hand. By hand:

```bash
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$(echo "$ECR_URI" | cut -d/ -f1)"
```

Expected: `Login Succeeded`. Re-run this whenever you see `authorization token has expired` from `docker push`.

## 4. Pick a unique tag

ECR is set to **IMMUTABLE** in this project (`infra/modules/compute/ecr.tf` sets `repository_image_tag_mutability = var.ecr_image_tag_mutability`, which defaults to `IMMUTABLE`), so you cannot overwrite an existing tag. Use semver-style version tags and bump every push:

```bash
export IMAGE_TAG="v0.1.5"   # bump from whatever's already in ECR
```

Sanity-check the tag isn't already taken:

```bash
aws ecr describe-images --repository-name ztdr-dev --region "$AWS_REGION" --image-ids imageTag="$IMAGE_TAG" --query 'imageDetails[0].imagePushedAt' --output text 2>/dev/null
```

If that returns a date, the tag exists — pick a different one. If it returns `None` or an error, the tag is free.

## 5. Build for ARM64 (required)

All three ECS task definitions (`app`, `migrate`, `seed`) declare `cpu_architecture = ARM64` in their `runtime_platform` block. The image must be built for `linux/arm64` regardless of your local machine's architecture, or Fargate will fail at task start with `exec /usr/local/bin/node: exec format error`.

With make: `make ecr-build ENV=dev IMAGE_TAG="$IMAGE_TAG"` logs in to ECR, then runs this build. By hand:

```bash
cd "$REPO_ROOT"
docker build --platform linux/arm64 -t "$ECR_URI:$IMAGE_TAG" .
```

> **Why ARM64?** Graviton Fargate is ~20% cheaper than x86_64, Apple Silicon builds it natively (no cross-compile cost), and dev/prod stay on the same architecture. The trade-off: any custom base image or binary the Dockerfile pulls must have an arm64 variant — DHI `node:24-alpine3.22` does.

## 6. Push

With make: `make ecr-push ENV=dev IMAGE_TAG="$IMAGE_TAG"` logs in again, then pushes. `make ecr-build-push ENV=dev IMAGE_TAG="$IMAGE_TAG"` does steps 5 and 6 together, with the runtime-file check and the Trivy scan between them. By hand:

```bash
docker push "$ECR_URI:$IMAGE_TAG"
```

Expected: a series of layer pushes, ending with `<digest> size: <N>`. If you get `authorization token has expired`, jump back to step 3.

## 7. Verify the manifest is in ECR

With make, two further checks on the pushed image: `make ecs-image-check ENV=dev IMAGE_TAG="$IMAGE_TAG"` confirms it carries every file the migrate, seed and app tasks need, and `make image-scan ENV=dev IMAGE_TAG="$IMAGE_TAG"` scans it for HIGH and CRITICAL CVEs. By hand, the manifest:

```bash
aws ecr describe-images --repository-name ztdr-dev --region "$AWS_REGION" --image-ids imageTag="$IMAGE_TAG" --query 'imageDetails[0].{Pushed:imagePushedAt,Tags:imageTags,Size:imageSizeInBytes,Manifest:imageManifestMediaType}'
```

Expected: a JSON blob showing your tag, a recent timestamp, and a non-zero size. If `imageTags` doesn't include the tag you just pushed, the push silently went somewhere else (most likely the tag string differed from what you typed — see troubleshooting).

## Next step

The image is in ECR but no ECS task is using it yet. Continue with [`deploy-to-ecs.md`](./deploy-to-ecs.md) to point the task definitions at the new tag.

---

## Troubleshooting FAQ

- **`invalid tag ":<tag>"` / `invalid reference format`** during `docker build` — `$ECR_URI` is unset or empty in your shell. Re-run the preflight exports (step 1).

- **`authorization token has expired` / `no basic auth credentials`** during `docker push` — the ECR Docker token (separate from AWS STS) has expired. Re-run step 3 (`make ecr-login`, or by hand `aws ecr get-login-password | docker login ...`). `aws sts get-caller-identity` succeeding is unrelated; STS and ECR auth are independent.

- **`failed to read dockerfile: open Dockerfile: no such file or directory`** — you're not in the repo root. The Dockerfile lives at `$REPO_ROOT/Dockerfile`, but the preflight `cd`s into `infra/environments/dev/` so be sure to `cd "$REPO_ROOT"` before `docker build`.

- **`ImageTagAlreadyExistsException`** during push — ECR is IMMUTABLE; that tag is taken. Bump `IMAGE_TAG` to a fresh value (step 4) and rebuild + push.

- **`Failed to load config file "/app" as a TypeScript/JavaScript module ... DATABASE_URL is not set`** during `RUN yarn prisma generate` — only happens if `app/prisma.config.ts` regresses to a top-level `throw`. The config should read `process.env.DATABASE_URL ?? ""` so generate (which doesn't need a real URL) succeeds. See `app/prisma.config.ts` for the canonical form.

- **Push appears to succeed, but `aws ecs run-task` later fails with `pull image manifest ... not found`** — tag mismatch. The pushed tag and the `container_image_tag` in `terraform.tfvars` (or the task def directly) are different. Run `aws ecr describe-images --repository-name ztdr-dev --region us-east-1 --query 'imageDetails[].imageTags' --output text` to see what tags actually exist.

- **`exec /usr/local/bin/node: exec format error`** later in CloudWatch (during runtime, not during build) — image was built for the wrong CPU architecture. You forgot `--platform linux/arm64` (step 5). Rebuild with the flag and push under a new tag.

- **`Cannot find module '@aws/<something>'`** or `@aws-crypto/<something>` or `@smithy/<something>` later in CloudWatch — a transitive runtime dep is missing from the runner stage. The Dockerfile copies the full `node_modules` from the builder; if you changed it to cherry-pick scopes, restore the full copy. See `Dockerfile` runner stage.

- **`Can't write to /app/node_modules/@prisma/engines`** later in CloudWatch — the Dockerfile COPY is missing `--chown=node:node`. The runner runs as `USER node` and can't write to root-owned files. All COPYs in the runner stage should carry `--chown=node:node`.

- **Build succeeds, push succeeds, but the deploy step doesn't pick up the new image** — you forgot to bump `container_image_tag` in `terraform.tfvars`. The task definitions are pinned to whatever tag is in tfvars. See [`deploy-to-ecs.md`](./deploy-to-ecs.md) step 2.
