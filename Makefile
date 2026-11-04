# Platform detection for OS-specific install hints
UNAME_S := $(shell uname -s 2>/dev/null || echo Windows)

# GNU make conventions, from the manual's "Makefile Conventions" and special targets, all of them
# available in the GNU make 3.81 macOS ships: a fixed shell rather than whatever the caller has,
# help as the default goal, no built-in suffix rules (nothing here compiles), and a file target
# that a failed recipe changed is deleted rather than left looking up to date. Every target is
# declared .PHONY below, and recursion goes through $(MAKE) so flags and ENV=... pass down.
SHELL := /bin/sh
.DEFAULT_GOAL := help
.SUFFIXES:
.DELETE_ON_ERROR:

# Local port bands. Each way of running the app locally serves from its own band with the same
# layout, so whatever a broken target leaves listening is in a predictable place: the app in
# the band's first slot, debug in the second, auth infrastructure (none yet) in 10-19.
#   dev family (dev, dev-debug)          3XXX: app 3000, debug 3001 (inspector 3002), auth 3010-3019
#   container family (container-*)      13XXX: app 13000, debug 13001, auth 13010-13019
# docker-compose.yml reads the CONTAINER_* names with the same defaults, so plain
# `docker compose` serves on the same ports as `make`.
DEV_APP_PORT ?= 3000
DEV_DEBUG_PORT ?= 3001
DEV_INSPECT_PORT ?= 3002
CONTAINER_APP_PORT ?= 13000
CONTAINER_DEBUG_PORT ?= 13001
export CONTAINER_APP_PORT CONTAINER_DEBUG_PORT

# This checkout's local database. Every checkout shares one Postgres container on 5439 and each
# keeps its own database in it, so no checkout's migrations, seed or app touch another's data.
# docker-compose.yml reads the same name with the same default.
DEV_DB_NAME ?= zt_decoder_ring_standard
export DEV_DB_NAME
DEV_DB_URL = postgresql://ztdecoder:ztdecoder_dev_password@localhost:5439/$(DEV_DB_NAME)

.PHONY: help \
        preflight check-docker check-env aws-whoami aws-profiles-discover dns-check \
        check-proxy require-proxy _proxy-probe check-version check-deploy-safety local-status local-stop \
        ci-install ci-install-python ci-test-js ci-test-python test-integration test-seed-checks test-scripts test-api test-matrix \
        setup env-auth-secret dev dev-debug _check-port app-check app-audit app-release seed-ecs-local \
        db-up db-down db-restart db-clean db-reset db-shell db-migrate db-push db-studio db-seed db-seed-check db-ready db-generate _db-ensure _db-guard \
        _stop-app-profiles _compose-build _compose-up _compose-logs _image-file-check \
        container-build container-up container-down container-clean container-logs container-smoke container-scan container-verify container-debug refresh-image-digests check-rds-bundle \
        ci-check ci-test ci-prisma-validate ci-check-links check-links check-links-api reference-links-retrieve reference-links-build reference-links zt-reference-links-retrieve zt-reference-links-build zt-reference-links zt-overlay-transform zt-overlay \
        set-version ecr-build ecr-login ecr-push ecr-build-push release-image deploy \
        ecs-run-migrate ecs-run-seed _ecs-run-task ecs-image-check image-scan ecs-tasks-list ecs-scale ecs-redeploy smoke \
        db-dr-test db-dr-teardown check-seed-links \
        _require-env _require-version _require-image-tag _require-trivy _require-ecr _require-deploy

# Default target. Lists the commands a person runs: the end-to-end workflows and the
# destructive resets. Every other target is a step inside one of these, or a single tool,
# documented where it is defined.
help:
	@echo "ZT Decoder Ring: the commands to run by hand"
	@echo ""
	@echo "Get started"
	@echo "  preflight             Check the toolchain and AWS credentials; changes nothing"
	@echo "  setup                 First run: database, dependencies, app/.env, migrate and seed"
	@echo ""
	@echo "Run locally"
	@echo "  dev                   The dev server with hot reload (:$(DEV_APP_PORT))"
	@echo "  dev-debug             The same with the Node inspector (:$(DEV_DEBUG_PORT), inspector :$(DEV_INSPECT_PORT))"
	@echo "  container-up          The hardened image that ships, migrated and seeded (:$(CONTAINER_APP_PORT))"
	@echo "  container-debug       A shell image with hot reload, local only and never deployed (:$(CONTAINER_DEBUG_PORT))"
	@echo "  local-status          What this repository is running, in every worktree"
	@echo "  local-stop            Stop every worktree's dev servers and app containers; the database keeps running"
	@echo ""
	@echo "Before you push: what CI runs"
	@echo "  ci-check              Lint, typecheck, the committed image tags and the seed's URL format"
	@echo "  ci-test               The unit and Python tests, with the coverage floor"
	@echo "  test-integration      The integration suite, against a throwaway Postgres"
	@echo "  test-matrix           Every test area in docs/testing.md, each without the coverage floor"
	@echo "  test-seed-checks      The seed checker's tests, then the checks against the committed seed"
	@echo "  test-scripts          The shell scripts' tests, with aws and docker stubbed"
	@echo "  test-api              The tRPC setup, auth wiring, database client and route handlers"
	@echo ""
	@echo "Regenerate seed data"
	@echo "  zt-overlay            The Zero Trust overlay (09, 11, 13) from the committed CISA mapping"
	@echo "  zt-overlay-transform  Re-read CISA's mapping workbook (XLSX=<path>; the workbook is never committed)"
	@echo "  reference-links       The catalog's reference links: retrieve over the network, then build 10"
	@echo "  zt-reference-links    The Zero Trust reference links: retrieve, then build 14"
	@echo ""
	@echo "Release and operate (ENV=dev|prod, with AWS_PROFILE set)"
	@echo "  release-image         Bump to VERSION=X.Y.Z, then build, check, scan and push the image"
	@echo "  deploy                release-image, apply, migrate, seed, redeploy and smoke (CONFIRM=yes)"
	@echo "  check-deploy-safety   Fail if the committed image tag is older than the one running"
	@echo "  smoke                 The deployed health check and the ALB's target health"
	@echo "  ecs-redeploy          Restart the service on its current image, re-reading its secrets"
	@echo "  db-dr-test            Restore the database from a fresh snapshot to a throwaway instance"
	@echo ""
	@echo "Destructive"
	@echo "  db-reset              Drop this checkout's local database and rebuild it from the migrations and seed"
	@echo "  db-clean              Delete the shared database container and its volume: every checkout's local data"
	@echo "  container-clean       Delete the app containers, their volumes and images; the database stays"
	@echo "  db-dr-teardown        Delete the disaster-recovery instance and its snapshots"
	@echo ""
	@echo "First time: make preflight, then make setup, then make dev"

# ============================================
# Docker Check
# ============================================

# Check Docker is installed and running
check-docker:
	@docker --version >/dev/null 2>&1 || { \
		echo "❌ Docker not found or not in PATH"; \
		echo "   Install: https://docs.docker.com/get-docker/"; \
		exit 1; \
	}
	@docker info >/dev/null 2>&1 || { \
		echo "❌ Docker is not running."; \
		echo "   Please start Docker and try again."; \
		exit 1; \
	}

# Stop conflicting app profiles before starting a new one. Only the app containers: the db
# service is in both profiles too, and every worktree shares it, so a profile-wide down
# would take the database away from the others.
_stop-app-profiles:
	@docker compose --profile container --profile debug rm --stop --force app app-debug 2>/dev/null || true

# Internal: stop before starting when PORT is taken, naming what holds it, rather than
# failing half-way through a start. Skipped where lsof is not installed.
_check-port:
	@if [ -z "$(PORT)" ]; then echo "❌ internal _check-port: PORT=<n> required"; exit 1; fi
	@if command -v lsof >/dev/null 2>&1; then \
		holder=$$(lsof -nP -iTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $$1 " (pid " $$2 ")"}'); \
		if [ -n "$$holder" ]; then \
			echo "❌ Port $(PORT) is already in use by $$holder. Stop it, or set $(PORT_VAR) to another port."; \
			exit 1; \
		fi; \
	fi

# ============================================
# Containerize locally (the shipping artifact)
# ============================================
# One container: the hardened `runner` image that ships to AWS ECS, run locally so you
# test exactly what you ship. The dev-shell image is opt-in (container-debug) and is
# NEVER deployed. Shared compose plumbing lives in the _compose-* helpers.

# Internal compose plumbing, parameterized by profile (P=container|debug) + service (S).
_compose-build:
	@if [ -z "$(P)" ]; then echo "❌ internal _compose-build: P=<profile> required"; exit 1; fi
	docker compose --profile $(P) build $(if $(NO_CACHE),--no-cache)
_compose-up:
	@if [ -z "$(P)" ]; then echo "❌ internal _compose-up: P=<profile> required"; exit 1; fi
	@scripts/local-env.sh adopt
	@# The database first, then this checkout's database in it, so the app containers never boot
	@# against a database that doesn't exist yet.
	docker compose --profile $(P) up -d db
	@scripts/local-env.sh ensure
	docker compose --profile $(P) up -d
_compose-logs:
	@if [ -z "$(P)" ]; then echo "❌ internal _compose-logs: P=<profile> required"; exit 1; fi
	docker compose --profile $(P) logs -f $(S)

# Internal: verify an image carries every file the ECS migrate/seed/app tasks need at
# runtime, and none of the seed generators or the sources they read (node's fs; the DHI
# runner has no shell). IMAGE=<docker ref>.
_image-file-check:
	@docker run --rm --platform linux/arm64 --entrypoint node $(IMAGE) \
		-e "const fs=require('fs');['prisma.config.ts','prisma/schema.prisma','entrypoint.mjs','node_modules/.bin/prisma','node_modules/.bin/tsx','prisma/seed-ecs.ts','prisma/catalog-dir.ts','prisma/seed-progress.ts','prisma/seed-sql/nist-800-53/00-cleanup.sql'].forEach(f=>fs.accessSync('/app/'+f));const extra=['prisma/sources','prisma/generators'].filter(f=>fs.existsSync('/app/'+f));if(extra.length){console.error('❌ Build-time inputs in the image: '+extra.join(', '));process.exit(1)}console.log('✅ All required runtime files present, and no build-time inputs')"

# Re-pin the Dockerfile's dhi.io base images to the digest each tag points at
# today. A manual update that needs DHI login credentials (`docker login dhi.io`
# first); these pins move only when this runs, until the placeholder dhi.io
# registry in .github/dependabot.yml is implemented. See
# docs/scripts/refresh-image-digests.md.
refresh-image-digests: check-docker
	@./scripts/refresh-image-digests.sh Dockerfile

# Compare the RDS CA bundle checksum pinned in the Dockerfile with the bundle AWS
# serves now, so a republished bundle shows up before it breaks an image build.
# Needs network, not Docker. The RDS CA bundle pin gate runs it weekly, since AWS republishes the bundle unannounced.
# See docs/scripts/check-rds-bundle.md.
check-rds-bundle:
	@$(RDS_BUNDLE_CHECK)

# Build the hardened runner image (the artifact that ships). Runs `next build`, so a
# production-build break (e.g. a missing Suspense boundary) fails HERE, locally.
# NO_CACHE=1 rebuilds without the layer cache (docs/runbooks/prisma-client-troubleshooting.md).
container-build: check-docker
	@$(MAKE) -s _compose-build P=container
	@echo "✅ Built the hardened runner image (Dockerfile target: runner)"

# Start the hardened container locally + ensure the DB is migrated and seeded.
container-up: check-docker _stop-app-profiles
	@$(MAKE) -s _check-port PORT=$(CONTAINER_APP_PORT) PORT_VAR=CONTAINER_APP_PORT
	@$(MAKE) -s _compose-up P=container
	@$(MAKE) db-ready
	@echo "✅ Container up — the hardened runner (exactly what ships)"
	@echo "🌐 App: http://localhost:$(CONTAINER_APP_PORT)"
	@echo "💾 Database: localhost:5439"

# Stop the local app container (either profile). The shared database keeps running;
# make db-down stops it.
container-down: check-docker
	docker compose --profile container --profile debug rm --stop --force app app-debug

# Stop + remove the app containers, their anonymous volumes (node_modules, .next) and the
# images compose built for them. Only app and app-debug: the db service is in both profiles and
# every worktree shares it, so the database keeps running (make db-down stops it) and its volume
# stays (make db-clean removes it). down gets no -v: even with service names it targets the
# named database volume.
container-clean: check-docker
	docker compose --profile container --profile debug rm --stop --force --volumes app app-debug
	docker compose --profile container --profile debug down --rmi local app app-debug
	@echo "✅ Removed the app containers, their anonymous volumes and images; the shared database keeps running"

# Tail logs (SERVICE overrides the service; defaults to app).
container-logs: check-docker
ifdef SERVICE
	@$(MAKE) -s _compose-logs P=container S=$(SERVICE)
else
	@$(MAKE) -s _compose-logs P=container S=app
endif

# Smoke-test the local hardened container.
container-smoke:
	@echo "🧪 Smoke-testing the local container (:$(CONTAINER_APP_PORT))..."
	@curl -sf http://localhost:$(CONTAINER_APP_PORT)/api/health > /dev/null || { echo "❌ Health check failed"; exit 1; }
	@echo "✅ Local container health check passed"

# Build the runner locally and scan it for HIGH/CRITICAL CVEs (no AWS needed).
container-scan: _require-trivy check-docker
	docker build --target runner --platform linux/arm64 -t ztdr:scan-cve .
	@echo "🔍 Scanning ztdr:scan-cve for HIGH/CRITICAL CVEs (--ignore-unfixed)..."
	$(TRIVY_SCAN) ztdr:scan-cve

# Build the runner locally and verify it carries every required runtime file.
container-verify: check-docker
	docker build --target runner --platform linux/arm64 -t ztdr:scan-files .
	@$(MAKE) -s _image-file-check IMAGE=ztdr:scan-files

# LOCAL DEBUG ONLY — build/run the dev-shell image (hot reload, has a shell). NEVER deployed:
# a shelled image must not reach an environment (AWS ECS runs only the runner).
container-debug: check-docker _stop-app-profiles
	@$(MAKE) -s _check-port PORT=$(CONTAINER_DEBUG_PORT) PORT_VAR=CONTAINER_DEBUG_PORT
	@$(MAKE) -s _compose-up P=debug
	@$(MAKE) db-ready
	@echo "🐚 Debug container up — dev-shell image, LOCAL ONLY (never deployed)"
	@echo "🌐 App: http://localhost:$(CONTAINER_DEBUG_PORT)"
	@echo "   Shell: docker compose --profile debug exec app-debug sh"

AWS_REGION ?= us-east-1

# Commands more than one target runs, named once.
#   TRIVY_SCAN        fails on a HIGH or CRITICAL CVE that has a fix; unfixable base-OS ones don't block
#   RDS_BUNDLE_CHECK  exit 1 when the Dockerfile's RDS CA bundle pin no longer matches, 2 when it can't fetch
TRIVY_SCAN = trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1
RDS_BUNDLE_CHECK = python3 scripts/check-rds-bundle.py Dockerfile

# ENV selects which environments/<env> Terraform stack, cluster, repository, task family and
# hostname a target uses. It defaults to dev; pass ENV=prod with the prod AWS_PROFILE:
#   AWS_PROFILE=<profile> make ecs-redeploy ENV=prod
# Every target that reads it checks the value through _require-env below.
ENV ?= dev
# Which catalog the seed targets load. The runners themselves have NO default and
# fail loudly when unset — this is the developer-convenience layer, not the gate.
#   make db-seed CATALOG=nist-800-53
CATALOG ?= nist-800-53
# Which corpus each reference-link pipeline reads (sources/reference-links/<corpus>/). The catalog
# pipeline reads the NIST catalog, so its corpus is not the CATALOG variable: a
# different CATALOG would otherwise write NIST links into that catalog's seed.
REFERENCE_CORPUS ?= nist-800-53
ZT_CORPUS ?= cisa
# Leading segment of every AWS resource name; match name_prefix in the
# environment stack when it is not the default.
NAME_PREFIX ?= ztdr
ECS_CLUSTER ?= $(NAME_PREFIX)-$(ENV)
ECS_LOG_GROUP ?= /ecs/$(NAME_PREFIX)-$(ENV)

# The $(ENV) ECR repository, in AWS_REGION and the account the active AWS profile belongs to.
# The account comes from STS on first use and is kept for the rest of the run, so AWS_PROFILE
# on the command line applies and a recipe that names the repository several times asks once.
# Without credentials it reads STS_AUTH_FAILED, and every target that builds, logs in or pushes
# stops on _require-ecr before doing any work. Targets that run make again pass the account down
# as _ECR_ACCOUNT=, so a release asks once in all. `make aws-whoami` shows which account you are in.
_ECR_ACCOUNT = $(eval _ECR_ACCOUNT := $(shell aws sts get-caller-identity --query Account --output text --no-cli-pager 2>/dev/null || echo STS_AUTH_FAILED))$(_ECR_ACCOUNT)
ECR_REPO = $(_ECR_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com/$(NAME_PREFIX)-$(ENV)

# Internal guards, each run before the work it protects rather than partway through it.
_require-version:
	@if [ -z "$(VERSION)" ]; then echo "❌ VERSION=X.Y.Z required (bare semver, no leading v)"; exit 1; fi
	@echo "$(VERSION)" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo "❌ VERSION must be bare semver X.Y.Z (no leading v)"; exit 1; }
_require-image-tag:
	@if [ -z "$(IMAGE_TAG)" ]; then echo "❌ IMAGE_TAG=<tag> required"; exit 1; fi
_require-trivy:
	@command -v trivy >/dev/null 2>&1 || { echo "❌ trivy not found — install with: brew install trivy"; exit 1; }
_require-ecr:
	@if [ "$(_ECR_ACCOUNT)" = STS_AUTH_FAILED ]; then echo "❌ No AWS credentials for AWS_PROFILE=$${AWS_PROFILE:-default}; check with make aws-whoami"; exit 1; fi
# Every target that reads ENV takes dev or prod and defaults to dev. Any other value, such as a
# typo or a shell's own ENV variable, stops the target before it touches anything.
_require-env:
	@case "$(ENV)" in dev|prod) ;; *) echo "❌ ENV must be dev or prod, not '$(ENV)'"; exit 1;; esac
# Everything deploy needs, before it pushes or applies anything: it ends with make smoke, which
# needs the environment's hostname, and the migrate and seed tasks read Terraform output with jq.
_require-deploy:
	@for tool in terraform jq; do command -v $$tool >/dev/null 2>&1 || { echo "❌ $$tool not found; deploy needs it"; exit 1; }; done
	@if [ -z "$(DNS_FQDN_$(ENV))" ]; then echo "❌ deploy ends with make smoke, which needs DNS_FQDN_$(ENV): set it before deploying"; exit 1; fi

# Set the release version for ONE environment: updates app/package.json (bare
# semver) AND the $(ENV) tfvars container_image_tag (v-prefixed ECR tag) together.
#
# Note the asymmetry: package.json is global while container_image_tag is per
# environment, so bumping one env leaves the other behind. That is legitimate
# mid-rollout and a defect afterwards, which is what `make check-version` and
# `make check-deploy-safety ENV=<env>` exist to tell apart. Run set-version for
# every environment you intend to release. Idempotent, ENV-aware
# (default dev), portable sed. Does NOT build/push or apply — pair it with
# ecr-build-push and a terraform apply. VERSION is bare semver (no leading v).
#
# Usage:  make set-version VERSION=0.1.8            # dev
#         make set-version VERSION=0.1.8 ENV=prod   # prod
set-version: _require-env _require-version
	@test -f infra/environments/$(ENV)/terraform.tfvars || { echo "❌ no tfvars for ENV=$(ENV) (copy terraform.tfvars.example first)"; exit 1; }
	@cur=$$(node -p "require('./app/package.json').version" 2>/dev/null || echo 0.0.0); \
		lowest=$$(printf '%s\n%s\n' "$$cur" "$(VERSION)" | sort -V | head -1); \
		if [ "$(VERSION)" = "$$lowest" ] && [ "$(VERSION)" != "$$cur" ]; then \
			echo "❌ VERSION=$(VERSION) is older than current $$cur — refusing downgrade"; exit 1; fi
	@yv=$$(cd app && yarn --version); case "$$yv" in 4.*) ;; *) echo "❌ set-version uses Yarn 4's version command; detected $$yv. Check that app/.yarnrc.yml's yarnPath resolves."; exit 1;; esac
	@cd app && yarn version $(VERSION) >/dev/null
	@tmp=$$(mktemp); sed 's|^container_image_tag = .*|container_image_tag = "v$(VERSION)"|' infra/environments/$(ENV)/terraform.tfvars > "$$tmp" && mv "$$tmp" infra/environments/$(ENV)/terraform.tfvars
	@grep -q '^container_image_tag = "v$(VERSION)"$$' infra/environments/$(ENV)/terraform.tfvars || { echo "❌ container_image_tag not updated in $(ENV) tfvars — is the line present and unindented?"; exit 1; }
	@echo "✅ version $(VERSION): app/package.json=$(VERSION), infra/environments/$(ENV)/terraform.tfvars container_image_tag=v$(VERSION)"
	@echo "   Next: make ecr-build-push IMAGE_TAG=v$(VERSION) ENV=$(ENV), then make check-deploy-safety ENV=$(ENV) and terraform apply"

# Build the ARM64 runner image for ECS deployment. IMAGE_TAG is required
# (ECR is IMMUTABLE — every push needs a fresh tag). Logs in to ECR first, as ecr-push does,
# so the token is fresh for the push that follows.
#
# Usage:  AWS_PROFILE=<profile> make ecr-build ENV=dev IMAGE_TAG=v0.1.7
# Runbook: docs/runbooks/build-and-push-image.md
ecr-build: _require-env _require-image-tag ecr-login
	docker build --platform linux/arm64 -t $(ECR_REPO):$(IMAGE_TAG) .

# Refresh the ECR Docker token (separate from AWS STS, ~12h lifetime).
# Runbook: docs/runbooks/build-and-push-image.md
ecr-login: _require-env check-docker _require-ecr
	aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $$(echo $(ECR_REPO) | cut -d/ -f1)

# Push a previously-built tag. Re-runs ecr-login first since the token
# rotates more often than people remember.
#
# Usage:  make ecr-push IMAGE_TAG=v0.1.7
# Runbook: docs/runbooks/build-and-push-image.md
ecr-push: _require-env _require-image-tag ecr-login
	docker push $(ECR_REPO):$(IMAGE_TAG)

# Build → check the runner image's files → scan it → push. Stops on a missing file or a
# HIGH/CRITICAL CVE with a fix, so a broken or vulnerable image never reaches ECR.
#
# Usage:  make ecr-build-push IMAGE_TAG=v0.1.7
# Runbook: docs/runbooks/build-and-push-image.md
ecr-build-push: _require-env _require-image-tag _require-trivy ecr-build
	@$(MAKE) ecs-image-check IMAGE_TAG=$(IMAGE_TAG) _ECR_ACCOUNT=$(_ECR_ACCOUNT)
	@echo "🔍 CVE gate: scanning $(ECR_REPO):$(IMAGE_TAG) (local) before push..."
	$(TRIVY_SCAN) $(ECR_REPO):$(IMAGE_TAG)
	@$(MAKE) ecr-push IMAGE_TAG=$(IMAGE_TAG) _ECR_ACCOUNT=$(_ECR_ACCOUNT)

# Workflow: cut a new version and ship its scanned image to the $(ENV) ECR in a
# single command: set-version, then ecr-build-push with the tag derived from VERSION,
# so you pass it once. Every check that needs nothing built runs first, before the
# version bump writes any file. Stops BEFORE terraform apply — the deploy stays a
# deliberate, separate step. VERSION is bare semver (no leading v).
#
# Usage:  make release-image VERSION=0.1.8 ENV=dev
# Runbook: docs/runbooks/build-and-push-image.md
release-image: _require-env _require-version _require-trivy check-docker _require-ecr
	@# A stale RDS CA bundle pin fails here in seconds, not partway through the image build.
	@# Only exit 1, a pin that no longer matches, stops the release. Exit 2 means the check
	@# could not fetch the bundle (behind a proxy, say), and a correct pin must not block.
	@rc=0; $(RDS_BUNDLE_CHECK) || rc=$$?; \
	if [ $$rc -eq 1 ]; then exit 1; fi; \
	if [ $$rc -ne 0 ]; then echo "⚠️  Could not check the RDS CA bundle pin (exit $$rc); continuing. The image build still verifies the bundle against the pin."; fi
	@$(MAKE) set-version VERSION=$(VERSION) ENV=$(ENV)
	@$(MAKE) ecr-build-push IMAGE_TAG=v$(VERSION) ENV=$(ENV) _ECR_ACCOUNT=$(_ECR_ACCOUNT)
	@echo "✅ shipped v$(VERSION) → $(ENV) ECR (version bumped, image checked + scanned + pushed)"
	@echo "   Next (deliberate): make check-deploy-safety ENV=$(ENV), then terraform apply in infra/environments/$(ENV)"

# Orchestrated deploy for one env, in the correct order. Irreversible: pushes an image,
# applies infra, and RE-SEEDS the DB (full wipe). Requires VERSION, ENV, and CONFIRM=yes.
# `terraform apply` runs BEFORE migrate/seed so the migrate/seed task defs pick up the new
# immutable image tag. Set AWS_PROFILE for the env.
# Runbook: docs/architecture/aws-deployment.md
deploy: _require-env _require-version
	@if [ "$(CONFIRM)" != "yes" ]; then \
		echo "⛔ Refusing to deploy v$(VERSION) → $(ENV): this pushes an image, applies infra, and RE-SEEDS the DB (full wipe)."; \
		echo "   Re-run once verified:  AWS_PROFILE=<$(ENV)-profile> make deploy VERSION=$(VERSION) ENV=$(ENV) CONFIRM=yes"; \
		exit 1; \
	fi
	@$(MAKE) -s _require-deploy ENV=$(ENV)
	@echo "🚀 Deploying v$(VERSION) → $(ENV)"
	@$(MAKE) -s check-deploy-safety ENV=$(ENV) VERSION=$(VERSION)
	@$(MAKE) release-image VERSION=$(VERSION) ENV=$(ENV)
	@cd infra/environments/$(ENV) && terraform apply -auto-approve
	@$(MAKE) ecs-run-migrate ENV=$(ENV)
	@$(MAKE) ecs-run-seed ENV=$(ENV)
	@$(MAKE) ecs-redeploy ENV=$(ENV)
	@$(MAKE) smoke ENV=$(ENV)
	@echo "✅ Deployed v$(VERSION) → $(ENV)"

# Run the one-off ECS migrate task and print logs. Pulls cluster /
# subnet / SG from the $(ENV) terraform state automatically.
# Override env: make ecs-run-migrate ENV=prod (also set AWS_PROFILE accordingly).
# Runbook: docs/runbooks/ecs-migration-and-seed.md
ecs-run-migrate: _require-env
	@$(MAKE) -s _ecs-run-task FAMILY=$(NAME_PREFIX)-$(ENV)-migrate STREAM_PREFIX=migrate

# Run the one-off ECS seed task and print logs.
# Runbook: docs/runbooks/ecs-migration-and-seed.md
ecs-run-seed: _require-env
	@$(MAKE) -s _ecs-run-task FAMILY=$(NAME_PREFIX)-$(ENV)-seed STREAM_PREFIX=seed

# Internal: shared task-run + poll-to-stopped + log-pull recipe. A task that never started has no
# log stream, so a failed log fetch is noted and the exit-code check still runs and names the task.
_ecs-run-task:
	@cd infra/environments/$(ENV) && \
		PRIVATE_SUBNETS=$$(terraform output -json private_subnet_ids | jq -r '[.[] | tostring] | join(",")') && \
		ECS_SG=$$(terraform output -raw ecs_security_group_id) && \
		echo "🚀 Starting $(FAMILY)..." && \
		TASK_ARN=$$(aws ecs run-task --cluster $(ECS_CLUSTER) --task-definition $(FAMILY) \
			--launch-type FARGATE \
			--network-configuration "awsvpcConfiguration={subnets=[$$PRIVATE_SUBNETS],securityGroups=[$$ECS_SG],assignPublicIp=DISABLED}" \
			--region $(AWS_REGION) --query 'tasks[0].taskArn' --output text) && \
		echo "📋 TASK_ARN=$$TASK_ARN" && \
		until s=$$(aws ecs describe-tasks --cluster $(ECS_CLUSTER) --tasks "$$TASK_ARN" --region $(AWS_REGION) --query 'tasks[0].lastStatus' --output text 2>/dev/null); [ "$$s" = "STOPPED" ]; do printf "."; sleep 10; done && \
		echo "" && \
		aws ecs describe-tasks --cluster $(ECS_CLUSTER) --tasks "$$TASK_ARN" --region $(AWS_REGION) --query 'tasks[0].{Status:lastStatus,ExitCode:containers[0].exitCode,StopCode:stopCode,Reason:stoppedReason}' --output json && \
		TID=$$(echo "$$TASK_ARN" | awk -F/ '{print $$NF}') && \
		echo "📜 Logs (task/$(STREAM_PREFIX)/$$TID):" && \
		{ aws logs get-log-events --log-group-name "$(ECS_LOG_GROUP)" --log-stream-name "task/$(STREAM_PREFIX)/$$TID" --region $(AWS_REGION) --start-from-head --query 'events[].message' --output text \
			|| echo "   (could not fetch the log stream; a task that never started has none)"; } && \
		EC=$$(aws ecs describe-tasks --cluster $(ECS_CLUSTER) --tasks "$$TASK_ARN" --region $(AWS_REGION) --query 'tasks[0].containers[0].exitCode' --output text) && \
		if [ "$$EC" != "0" ]; then echo "❌ $(FAMILY) exited $$EC: the task did not complete. Read the logs and the stop reason above, fix the cause, and run it again."; exit 1; fi && \
		echo "✅ $(FAMILY) exited 0"

# Verify the ECS-bound runner image has every file the migrate / seed
# tasks need at runtime. Catches regressions like a missing
# prisma.config.ts COPY in the runner stage *before* we burn an ECR
# push + terraform apply + ECS task run cycle to discover it. Uses
# node's accessSync because the DHI runner has no shell.
#
# Usage:  make ecs-image-check IMAGE_TAG=v0.1.7
# Runbook: docs/runbooks/build-and-push-image.md
ecs-image-check: _require-env _require-image-tag check-docker _require-ecr
	@echo "🔍 ECR_REPO=$(ECR_REPO) (derived from active AWS profile)"
	@echo "🔍 Checking $(IMAGE_TAG) for required runtime files..."
	@$(MAKE) -s _image-file-check IMAGE=$(ECR_REPO):$(IMAGE_TAG)

# Scan a published runner image for HIGH/CRITICAL CVEs. Local only — NOT a CI
# gate (yet). Scans the ECR image for $(ENV) (default dev) at $(IMAGE_TAG) — the
# already-published artifact — so it doesn't rebuild from the DHI base. Trivy
# runs with --ignore-unfixed so unfixable base-OS CVEs don't block, and fails
# (exit 1) on any remaining HIGH/CRITICAL. Requires trivy (brew install trivy)
# and AWS auth for the env (ecr-login refreshes the registry token).
# Usage:  AWS_PROFILE=<env-profile> make image-scan ENV=dev IMAGE_TAG=v0.1.7
# Runbook: docs/runbooks/build-and-push-image.md
image-scan: _require-env _require-image-tag _require-trivy ecr-login
	@echo "🔍 Scanning $(ECR_REPO):$(IMAGE_TAG) (ENV=$(ENV)) for HIGH/CRITICAL CVEs (--ignore-unfixed)..."
	$(TRIVY_SCAN) $(ECR_REPO):$(IMAGE_TAG)

# Print the STS identity (account + assumed-role ARN) for whatever
# AWS_PROFILE is currently active. Use this before any prod-bound
# `make ecs-run-*` / `terraform apply` / `aws ecs update-service` to
# confirm you're pointing at the right account.
#
# Usage:  AWS_PROFILE=<prod-deploy-profile> make aws-whoami
# Runbook: docs/runbooks/build-and-push-image.md
aws-whoami:
	@aws sts get-caller-identity --region $(AWS_REGION) --no-cli-pager

# Every profile the AWS CLI knows, from ~/.aws/config and ~/.aws/credentials (or the files
# AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE name), with the account STS returns for each.
# Profiles that get credentials through credential_process live only in the config file,
# which the old loop over the credentials file never read. Use when you have several profiles
# and aren't sure which one maps to which env.
aws-profiles-discover:
	@aws configure list-profiles 2>/dev/null | while read p; do \
		acct=$$(AWS_PROFILE=$$p aws sts get-caller-identity --query Account --output text --no-cli-pager 2>/dev/null || echo "(auth failed)"); \
		printf "%-40s %s\n" "$$p" "$$acct"; \
	done

# ---- Image-tag version guard -----------------------------------------------
# `container_image_tag` is per environment while app/package.json is global, so
# bumping the version for one environment desynchronizes the other by
# construction. Unchecked, the committed tag drifts behind what is running, and
# then an apply from main moves that environment BACKWARDS. Rolling an image back
# across a migration boundary is the dangerous case: new schema under old code
# fails at query time, not at deploy.
#
# check-version        offline, CI-safe: no environment may pin a version this
#                      repo has never cut. Warns on a lagging tag (a rollout in
#                      progress) rather than failing.
# check-deploy-safety  online: compares the committed tag against the tag
#                      actually running, and FAILS on a downgrade. Run before any
#                      apply. ALLOW_DOWNGRADE=1 permits a deliberate rollback.
check-version:
	@cd app && yarn tsx scripts/version-guard/index.ts --mode=repo

# Usage:  AWS_PROFILE=<env-profile> make check-deploy-safety ENV=prod
#
# Three outcomes, deliberately distinguished. A service that is running gets
# compared. A service (or cluster) that does not exist yet is a FIRST deploy and
# passes: there is no deployed version to move backwards from, and failing here
# would block standing up a new environment while blaming AWS_PROFILE. Anything
# else — expired credentials, a denied call, the wrong region — fails, because an
# unreadable environment is not the same as an empty one.
#
# VERSION is read via $$(origin) rather than the shell so that an exported
# VERSION left over from an earlier step cannot silently change what is compared;
# only VERSION= on the make command line counts.
# Runbook: docs/runbooks/prod-deploy.md
check-deploy-safety: _require-env
	@err=$$(aws ecs describe-services --cluster $(ECS_CLUSTER) --services $(NAME_PREFIX)-$(ENV)-app \
		--region $(AWS_REGION) --no-cli-pager \
		--query 'services[0].taskDefinition' --output text 2>&1); \
	rc=$$?; \
	if [ $$rc -ne 0 ]; then \
		case "$$err" in \
			*ClusterNotFound*) \
				echo "🆕 no cluster $(ECS_CLUSTER) yet — treating this as the first deploy to $(ENV); nothing to downgrade"; \
				exit 0;; \
			*) \
				echo "❌ could not read the running task definition for $(NAME_PREFIX)-$(ENV)-app — check AWS_PROFILE=$${AWS_PROFILE:-unset}"; \
				echo "   $$err"; exit 1;; \
		esac; \
	fi; \
	td="$$err"; \
	if [ -z "$$td" ] || [ "$$td" = "None" ]; then \
		echo "🆕 no service $(NAME_PREFIX)-$(ENV)-app yet — treating this as the first deploy to $(ENV); nothing to downgrade"; \
		exit 0; \
	fi; \
	img=$$(aws ecs describe-task-definition --task-definition "$$td" \
		--region $(AWS_REGION) --no-cli-pager \
		--query "taskDefinition.containerDefinitions[?name=='app'].image | [0]" --output text 2>/dev/null); \
	if [ -z "$$img" ] || [ "$$img" = "None" ]; then \
		echo "❌ no container named 'app' in $$td"; exit 1; \
	fi; \
	cd app && yarn tsx scripts/version-guard/index.ts --mode=deploy --env=$(ENV) --deployed="$$img" $(if $(filter command line,$(origin VERSION)),--committed=$(VERSION),)

# ---- Proxy (allowlisted egress) --------------------------------------------
# A deployed environment can sit behind a WAF that default-blocks and allows an IP
# list, so a request from an unlisted address gets HTTP 403 — which reads like an
# outage but is the WAF working. Going out through a proxy whose egress is on the
# allowlist presents an allowlisted address and the same request succeeds.
#
# PROXY defaults to a local tunnel listener. Override to point elsewhere.
PROXY ?= http://127.0.0.1:3128

# Internal: report on the proxy listener for the callers below. Never exits
# non-zero; the callers decide whether an unusable proxy is fatal.
#
# Keys on curl's num_connects rather than its exit code. For a telnet:// probe
# rc=28 is ambiguous — a working proxy accepts the connection and then times out
# waiting for data, and a blackholed address times out without connecting at all.
# num_connects is 1 in the first case and 0 in the second, which is the
# distinction that matters.
_proxy-probe:
	@echo "🔎 Proxy — $(PROXY)"
	@if [ -n "$$HTTPS_PROXY$$https_proxy" ]; then \
		echo "  ✅ env: https_proxy=$${https_proxy:-$$HTTPS_PROXY}"; \
	else \
		echo "  ℹ️  env: no https_proxy set (curl/aws will go direct unless told otherwise)"; \
	fi
	@if [ -n "$$NO_PROXY$$no_proxy" ]; then echo "  ℹ️  no_proxy=$${no_proxy:-$$NO_PROXY}"; fi
	@hostport=$$(echo "$(PROXY)" | sed -E 's|^[a-z]+://||; s|/.*$$||'); \
	host=$$(echo "$$hostport" | cut -d: -f1); \
	port=$$(echo "$$hostport" | cut -s -d: -f2); \
	port=$${port:-3128}; \
	conns=$$(curl -s -o /dev/null --max-time 3 -w '%{num_connects}' "telnet://$$host:$$port" 2>/dev/null); \
	rc=$$?; \
	if [ "$${conns:-0}" -ge 1 ] 2>/dev/null; then \
		echo "  ✅ listener: $$host:$$port accepted a connection"; \
	else \
		case "$$rc" in \
			7)  echo "  ❌ listener: connection refused on $$host:$$port — is the tunnel/VPN up?";; \
			6)  echo "  ❌ listener: cannot resolve $$host — check the PROXY host";; \
			28) echo "  ❌ listener: $$host:$$port timed out without connecting — blackholed or firewalled";; \
			*)  echo "  ❌ listener: $$host:$$port did not connect (curl rc=$$rc) — require-proxy is the authority";; \
		esac; \
	fi

# Report proxy state, and prove it end to end against an environment's health
# endpoint by comparing direct vs proxied. Informational: always exits 0, so it
# is safe to run anywhere and safe to chain ahead of another target.
#
# Usage:  make check-proxy            (proxy state + dev reachability)
#         make check-proxy ENV=prod   (compare against prod instead of dev)
check-proxy: _require-env _proxy-probe
	@FQDN=$(DNS_FQDN_$(ENV)); \
	if [ -z "$$FQDN" ]; then \
		echo "  ℹ️  pass ENV=dev|prod and set DNS_FQDN_<env> to also test reachability of a deployed environment"; \
		exit 0; \
	fi; \
	echo "🔎 Reachability — https://$$FQDN/api/health"; \
	direct=$$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 10 "https://$$FQDN/api/health" 2>/dev/null); \
	proxied=$$(curl -s -o /dev/null -w '%{http_code}' -x "$(PROXY)" --max-time 15 "https://$$FQDN/api/health" 2>/dev/null); \
	echo "  direct : HTTP $$direct"; \
	echo "  proxied: HTTP $$proxied"; \
	if [ "$$proxied" = "200" ] && [ "$$direct" != "200" ]; then \
		echo "  ✅ the proxy is what makes $(ENV) reachable — export https_proxy=$(PROXY) for curl-based checks"; \
	elif [ "$$proxied" = "200" ] && [ "$$direct" = "200" ]; then \
		echo "  ✅ reachable both ways (this address is already allowlisted)"; \
	elif [ "$$direct" = "403" ] && [ "$$proxied" = "403" ]; then \
		echo "  ⚠️  403 both ways — the WAF is blocking the proxy's address too, not just yours"; \
	else \
		echo "  ⚠️  neither path returned 200 — check the tunnel, then the service itself (make smoke ENV=$(ENV))"; \
	fi

# Strict variant for scripting and for use as a prerequisite: exits non-zero when
# the proxy is unusable, so a chained target stops instead of reporting a
# misleading 403. Use `check-proxy` when you want information, this when you want
# a gate: e.g. `make require-proxy check-links-api BASE=https://$(DNS_FQDN_prod)`.
require-proxy: _require-env _proxy-probe
	@FQDN=$(DNS_FQDN_$(ENV)); \
	if [ -z "$$FQDN" ]; then echo "❌ require-proxy needs ENV=dev|prod and DNS_FQDN_<env> to have something to reach"; exit 1; fi; \
	code=$$(curl -s -o /dev/null -w '%{http_code}' -x "$(PROXY)" --max-time 15 "https://$$FQDN/api/health" 2>/dev/null); \
	if [ "$$code" = "000" ] || [ -z "$$code" ]; then \
		echo "❌ proxy $(PROXY) is not usable — no HTTP response for https://$$FQDN through it."; \
		echo "   A refused, unresolvable or blackholed proxy all land here; a reachable one returns a status even if it is 403."; \
		exit 1; \
	fi
	@echo "✅ proxy usable (HTTP response received through $(PROXY))"

# Each environment's public hostname belongs to the estate it is deployed into, so
# none is committed: set DNS_FQDN_dev / DNS_FQDN_prod in the environment or on the
# command line (e.g. `make smoke ENV=dev DNS_FQDN_dev=dev.app.example.gov`).
DNS_FQDN_dev  ?=
DNS_FQDN_prod ?=

# Resolve the env's public FQDN via dig. Useful when "site can't be
# reached" reports come in — confirms whether DNS resolution is the
# bottleneck before chasing TLS / ECS / target-group issues.
#
# Usage:  make dns-check ENV=dev  (or ENV=prod)
dns-check: _require-env
	@FQDN=$(DNS_FQDN_$(ENV)); \
	if [ -z "$$FQDN" ]; then echo "❌ No FQDN known for ENV=$(ENV): set DNS_FQDN_$(ENV)"; exit 1; fi; \
	echo "🔍 dig $$FQDN +short"; \
	dig "$$FQDN" +short; \
	echo "🔍 dig $$FQDN CNAME +short"; \
	dig "$$FQDN" CNAME +short

# In-environment smoke test: hit the deployed /api/health and report ALB target health.
# ENV=dev|prod; set AWS_PROFILE for the matching account. (The public URL may not be
# reachable depending on WAF/exposure — the ALB target health is the authoritative signal.)
# Runbook: docs/runbooks/deploy-to-ecs.md
smoke: _require-env
	@FQDN=$(DNS_FQDN_$(ENV)); \
	if [ -z "$$FQDN" ]; then echo "❌ No FQDN known for ENV=$(ENV): set DNS_FQDN_$(ENV)"; exit 1; fi; \
	echo "🔍 $(ENV): https://$$FQDN/api/health"; \
	code=$$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 10 "https://$$FQDN/api/health" 2>/dev/null); \
	if [ "$$code" != "200" ]; then \
		pcode=$$(curl -s -o /dev/null -w '%{http_code}' -x "$(PROXY)" --max-time 15 "https://$$FQDN/api/health" 2>/dev/null); \
		echo "   HTTP $$code direct, HTTP $$pcode via $(PROXY)"; \
		if [ "$$pcode" = "200" ]; then \
			echo "   ℹ️  403/000 direct is the WAF default-block, not an outage — this address is not on the allowlist. Details: make check-proxy ENV=$(ENV)"; \
		fi; \
	else \
		echo "   HTTP $$code"; \
	fi; \
	echo "🔍 ALB target health ($(NAME_PREFIX)-$(ENV)) — the authoritative gate:"; \
	TG=$$(aws elbv2 describe-target-groups --region $(AWS_REGION) --no-cli-pager --query "TargetGroups[?contains(TargetGroupName,'$(NAME_PREFIX)-$(ENV)')].TargetGroupArn | [0]" --output text 2>/dev/null); \
	if [ -z "$$TG" ] || [ "$$TG" = "None" ]; then echo "❌ target group not found / no AWS access for $(ENV) — cannot verify health"; exit 1; fi; \
	HEALTH=$$(aws elbv2 describe-target-health --target-group-arn "$$TG" --region $(AWS_REGION) --no-cli-pager --query 'TargetHealthDescriptions[].[Target.Id,Target.Port,TargetHealth.State]' --output text 2>/dev/null); \
	echo "$$HEALTH"; \
	if [ -z "$$HEALTH" ]; then echo "❌ no registered targets — cannot verify health"; exit 1; fi; \
	healthy=$$(echo "$$HEALTH" | awk '$$3=="healthy"' | wc -l | tr -d ' '); \
	draining=$$(echo "$$HEALTH" | awk '$$3=="draining"' | wc -l | tr -d ' '); \
	bad=$$(echo "$$HEALTH" | awk '$$3!="healthy" && $$3!="draining"' | wc -l | tr -d ' '); \
	if [ "$$bad" != "0" ]; then echo "❌ $$bad target(s) in a failed state"; exit 1; fi; \
	if [ "$$healthy" = "0" ]; then echo "❌ no healthy targets"; exit 1; fi; \
	if [ "$$draining" != "0" ]; then \
		echo "✅ $$healthy healthy ($$draining still draining — normal while a rolling deploy finishes)"; \
	else \
		echo "✅ all $$healthy target(s) healthy"; \
	fi

# List the most recent stopped tasks for an ECS family. Use when a
# one-off task (migrate / seed) reportedly ran but you can't find logs,
# or when you need to confirm whether a task ever ran at all.
#
# Usage:  AWS_PROFILE=<prod-deploy-profile> make ecs-tasks-list ENV=prod FAMILY=ztdr-prod-seed
# Runbook: docs/runbooks/ecs-migration-and-seed.md
ecs-tasks-list: _require-env
	@if [ -z "$(FAMILY)" ]; then \
		echo "❌ FAMILY=<task-family> required (e.g. $(NAME_PREFIX)-$(ENV)-seed)"; exit 1; \
	fi
	@aws ecs list-tasks --cluster $(ECS_CLUSTER) --family $(FAMILY) \
		--desired-status STOPPED --region $(AWS_REGION) --no-cli-pager \
		--query 'taskArns[]' --output text | tr '\t' '\n' | sed '/^$$/d' | head -5

# Scale an ECS service up or down. Wraps `aws ecs update-service` so the
# common dev cost spin-down pattern (scale to 0 when not in active use,
# back to 1 before verifying a change) has a short canonical command.
#
# SERVICE defaults to the app service, as ecs-redeploy's does.
#
# Usage:  AWS_PROFILE=<profile> make ecs-scale ENV=dev COUNT=0
# Runbook: docs/runbooks/deploy-to-ecs.md
ecs-scale: _require-env
	@if [ -z "$(COUNT)" ]; then echo "❌ COUNT=<desired-count> required"; exit 1; fi
	@SVC=$${SERVICE:-$(NAME_PREFIX)-$(ENV)-app}; \
	aws ecs update-service --cluster $(ECS_CLUSTER) --service "$$SVC" \
		--desired-count $(COUNT) --region $(AWS_REGION) --no-cli-pager \
		--query 'service.{Status:status,DesiredCount:desiredCount,RunningCount:runningCount}' --output json

# Force a fresh ECS deployment so the task re-reads Secrets Manager at startup.
# Use after an RDS-managed secret rotation leaves a long-running task with stale
# DB credentials (auth-failure on every query while the DB itself is healthy) —
# see docs/runbooks/ecs-migration-and-seed.md. Zero-downtime rolling deploy;
# waits for the service to stabilize. SERVICE defaults to the app service.
#
# Usage:  AWS_PROFILE=<prod-deploy-profile> make ecs-redeploy ENV=prod
ecs-redeploy: _require-env
	@SVC=$${SERVICE:-$(NAME_PREFIX)-$(ENV)-app}; \
	echo "🔄 Forcing new deployment of $$SVC on $(ECS_CLUSTER)..."; \
	aws ecs update-service --cluster $(ECS_CLUSTER) --service "$$SVC" \
		--force-new-deployment --region $(AWS_REGION) --no-cli-pager \
		--query 'service.{Status:status,DesiredCount:desiredCount,RunningCount:runningCount}' --output json; \
	echo "⏳ Waiting for $$SVC to stabilize..."; \
	aws ecs wait services-stable --cluster $(ECS_CLUSTER) --services "$$SVC" --region $(AWS_REGION); \
	echo "✅ $$SVC stable on the new deployment"

# Run seed-ecs.ts against the local docker-compose dev DB. Catches
# bugs in seed-ecs itself (e.g. SQL split corruption, missing deps,
# pg/Prisma adapter regressions) without an ECR push cycle. Requires
# `make db-up` first so port 5439 is reachable.
seed-ecs-local:
	@echo "🧪 Running seed-ecs.ts against local dev DB (localhost:5439)..."
	@cd app && DATABASE_URL="$(DEV_DB_URL)?sslmode=disable" \
		SEED_CATALOG=$(CATALOG) yarn tsx prisma/seed-ecs.ts
	@echo "✅ seed-ecs.ts completed against local dev DB"

# ============================================
# App tests + release (local, no Docker)
# ============================================

# Integration tests against a real Postgres in a throwaway container. Needs
# Docker. Deliberately NOT part of ci-test, which stays fast and Docker-free
# with `--project unit`; this selects the other project. Migrates with
# `prisma migrate deploy`, as production does, and seeds through the pg driver
# with the harness's own loader, so a test database never depends on how
# seed.ts routes a seed.
test-integration: check-docker
	cd app && yarn test:integration

# Create release
app-release:
	@echo "Creating release..."
	@echo "💡 Running from project root, will update:"
	@echo "  - app/package.json (version)"
	@echo "  - CHANGELOG.md (root)"
	@echo ""
	cd app && yarn release
	@echo ""
	@echo "✅ Release created!"
	@echo "📝 Review CHANGELOG.md and run: git push --follow-tags"

# ============================================
# Database Only Commands (for local dev)
# ============================================

# Start only the database
db-up: check-docker
	@scripts/local-env.sh up
	@echo "✅ Database started on localhost:5439"
	@echo "📝 Connection string: $(DEV_DB_URL)"

# Internal: create this checkout's database in the shared container when another checkout created it.
_db-ensure:
	@echo "⏳ Waiting for database..."
	@scripts/local-env.sh ensure

# Internal: refuse a DATABASE_URL that points at the shared container but names another checkout's
# database, so this checkout's app, migrations and seed never run against that data.
_db-guard:
	@scripts/local-env.sh guard

# Stop only the database
db-down: check-docker
	@scripts/local-env.sh down

# Restart only the database
db-restart: db-down db-up

# Remove database container and volumes
db-clean: check-docker
	@scripts/local-env.sh wipe

# Drop the local database and rebuild it for the branch you are currently on. A database created under a different migration history is not one this branch can migrate onto — it has to go and be built again.
# DESTRUCTIVE: every local row is discarded, including anything edited by hand in Prisma Studio.
db-reset: check-docker
	@echo "♻️  Rebuilding $(DEV_DB_NAME) from scratch..."
	@scripts/local-env.sh reset
	@$(MAKE) db-ready
	@echo "✅ Database rebuilt and the Prisma client regenerated"

# ============================================
# Database Operations
# ============================================

# Open PostgreSQL shell
db-shell: check-docker
	docker exec -it zt-decoder-ring-db psql -U ztdecoder -d $(DEV_DB_NAME)

# Run database migrations (from local host)
db-migrate: _db-guard
	@echo "Running migrations from app directory..."
	cd app && yarn prisma migrate deploy
	@$(MAKE) --no-print-directory db-generate

# Regenerate the Prisma client and nothing else. Every other target that regenerates it also mutates the database — db-migrate and db-push write schema, db-ready reseeds — so checking out a branch just to typecheck it had no make target and meant reaching for yarn directly.
# Runbook: docs/runbooks/prisma-client-troubleshooting.md
db-generate:
	@echo "Regenerating Prisma client..."
	cd app && yarn prisma generate

# Push schema to database (from local host)
db-push: _db-guard
	@echo "Pushing schema from app directory..."
	cd app && yarn prisma db push
	@$(MAKE) --no-print-directory db-generate

# Open Prisma Studio (from local host)
db-studio: _db-guard
	@echo "Opening Prisma Studio..."
	cd app && yarn prisma studio

# Ensure database is migrated and seeded (idempotent, safe to run repeatedly)
db-ready: _db-guard _db-ensure
	@$(MAKE) --no-print-directory db-migrate
	@$(MAKE) --no-print-directory db-seed

# Validate seed SQL for enum/NULL issues before seeding
db-seed-check:
	@python3 scripts/check-seed-sql.py --catalog=$(CATALOG)

# Seed the database with CATALOG's controls, nist-800-53 by default (validates the generated SQL first via db-seed-check)
db-seed: _db-guard db-seed-check
	@echo "Seeding database from catalog $(CATALOG)..."
	cd app && SEED_CATALOG=$(CATALOG) yarn prisma db seed
	@echo "✅ Database seeded successfully"

# ============================================
# Disaster recovery (cloud RDS — see docs/runbooks/rds-snapshot-restore.md)
# ============================================

# DR dry-run: restore the ENV RDS DB from a fresh snapshot to a throwaway instance and
# mint a managed secret on it. ADDITIVE — the live DB is untouched. App cutover is a
# manual step (runbook). Tear down with db-dr-teardown.
# Usage:  AWS_PROFILE=<env-profile> make db-dr-test ENV=dev
# Runbook: docs/runbooks/rds-snapshot-restore.md
db-dr-test: _require-env
	@ENV=$(ENV) NAME_PREFIX=$(NAME_PREFIX) scripts/dr-restore-test.sh restore

# Delete the DR dry-run instance (no final snapshot) + its drtest snapshots.
# Usage:  AWS_PROFILE=<env-profile> make db-dr-teardown ENV=dev
# Runbook: docs/runbooks/rds-snapshot-restore.md
db-dr-teardown: _require-env
	@ENV=$(ENV) NAME_PREFIX=$(NAME_PREFIX) scripts/dr-restore-test.sh teardown

# ============================================
# Development Workflow
# ============================================

# Fill an empty AUTH_SECRET in app/.env (written as AUTH_SECRET=, "" or '') with a
# random local value. The app runs without one while sign-in is off; Auth.js needs
# one once an issuer is configured, and .env.example ships it empty so no secret is
# ever committed. A secret that is already set is left alone.
env-auth-secret:
	@if grep -qE "^AUTH_SECRET=(\"\"|'')?\$$" app/.env 2>/dev/null; then \
		secret=$$(openssl rand -base64 32) && \
		sed -i.bak -E "s#^AUTH_SECRET=(\"\"|'')?\$$#AUTH_SECRET=\"$$secret\"#" app/.env && rm -f app/.env.bak && \
		echo "✅ Generated a local AUTH_SECRET in app/.env"; \
	fi

# First-time setup for new developers
setup: db-up
	@echo "🚀 Starting first-time setup..."
	@echo ""
	@echo "Step 1/3: Installing dependencies..."
	cd app && yarn install
	@echo ""
	@echo "Step 2/3: Copying environment file..."
	@if [ ! -f app/.env ]; then \
		cp app/.env.example app/.env && echo "✅ Created app/.env from .env.example"; \
	else \
		echo "ℹ️  app/.env already exists - skipping"; \
	fi
	@$(MAKE) --no-print-directory env-auth-secret
	@echo ""
	@echo "Step 3/3: Preparing database (migrate + seed)..."
	@$(MAKE) db-ready
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "✅ Setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  make dev              # Start development server"
	@echo "  make db-studio        # View database in Prisma Studio"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Start database and run local dev server
dev: _db-guard db-up
	@$(MAKE) -s _check-port PORT=$(DEV_APP_PORT) PORT_VAR=DEV_APP_PORT
	@echo "Starting Next.js dev server on http://localhost:$(DEV_APP_PORT)..."
	cd app && yarn dev -p $(DEV_APP_PORT)

# The dev server with the Node inspector, in the dev band's debug slot. AUTH_URL follows the
# port so sign-in callbacks, when sign-in is configured, return here rather than to the app
# slot; it overrides app/.env because Next.js does not replace a variable already set.
dev-debug: _db-guard db-up
	@$(MAKE) -s _check-port PORT=$(DEV_DEBUG_PORT) PORT_VAR=DEV_DEBUG_PORT
	@$(MAKE) -s _check-port PORT=$(DEV_INSPECT_PORT) PORT_VAR=DEV_INSPECT_PORT
	@echo "Starting Next.js dev server on http://localhost:$(DEV_DEBUG_PORT), inspector on 127.0.0.1:$(DEV_INSPECT_PORT)..."
	cd app && AUTH_URL=http://localhost:$(DEV_DEBUG_PORT) yarn dev -p $(DEV_DEBUG_PORT) --inspect 127.0.0.1:$(DEV_INSPECT_PORT)

# ============================================
# App Local Commands (no Docker)
# ============================================

# Lint, then typecheck: yarn check runs eslint and then tsc --noEmit, so there is no separate
# lint target. The unit tests are ci-test.
app-check:
	cd app && yarn run check

# Run security audit
app-audit:
	cd app && yarn npm audit --recursive --severity high --no-deprecations

# ============================================
# CI (used by GitHub Actions — also runnable locally)
# ============================================

# Lint + typecheck (app-check, the definition lives there, once), the committed image tags
# (check-version) and the URL format of the committed seed (ci-check-links). All offline.
ci-check: app-check check-version ci-check-links

# Dependency installs for CI, so every workflow step is a make target and the
# raw package-manager invocation lives in exactly one place.
ci-install:
	cd app && yarn install --immutable

ci-install-python:
	python3 -m pip install --require-hashes -r requirements-ci.txt

# Run tests with coverage (single run, no watch)
ci-test: ci-test-js ci-test-python

ci-test-js:
	cd app && yarn test:coverage

# The seed checker (scripts/check-seed-sql.py) carries a pytest suite, which CI
# runs beside the JavaScript one. The control-identifier rule,
# app/prisma/generators/shared/control-identifier/canonical.ts, is tested by
# __tests__/canonical.test.ts against fixtures.json, and the Zero Trust overlay
# generator by app/prisma/generators/zt-overlay/__tests__/; both run in ci-test-js.
# Resolve an interpreter that actually has pytest, rather than demanding the
# developer arrange one. Prefer whatever is on PATH: that is CI's case, where
# ci-install-python has already installed pytest, so CI pays nothing for the
# venv path. Failing that, provision a gitignored project venv once and use it.
#
# Why not just tell the developer to pip install pytest: Homebrew's python is
# PEP 668 externally-managed, so both `pip install` and `--user` refuse, and
# --break-system-packages writes into Homebrew's own site-packages where a
# `brew upgrade python@3.13` can remove it again. A project venv is the only
# option that works on a fresh clone without touching a managed interpreter.
#
# Absolute paths via CURDIR because the test commands cd into subdirectories.
PYTEST_VENV    := $(CURDIR)/.venv
PYTEST_VENV_PY := $(PYTEST_VENV)/bin/python
# Every pytest suite under scripts/. A test area narrows it to its own file.
PYTEST_FILES   ?= test_check_seed_sql.py test_check_rds_bundle.py test_shell_scripts.py

ci-test-python:
	@command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }
	@set -e; \
	if python3 -m pytest --version >/dev/null 2>&1; then \
		PY=python3; \
	else \
		if [ ! -x "$(PYTEST_VENV_PY)" ]; then \
			echo "[pytest] not on PATH — provisioning $(PYTEST_VENV)"; \
			python3 -m venv "$(PYTEST_VENV)"; \
			"$(PYTEST_VENV_PY)" -m pip install -q --upgrade pip pytest; \
		fi; \
		PY="$(PYTEST_VENV_PY)"; \
	fi; \
	echo "[pytest] $$("$$PY" -m pytest --version) via $$PY"; \
	( cd scripts && "$$PY" -m pytest -q $(PYTEST_FILES) )

# Test areas, one target each, listed in docs/testing.md. An area runs without the
# coverage floor: the floor is measured over the whole unit suite in ci-test-js, and
# one area alone cannot meet it. CI runs the same pieces through ci-test and
# db-seed-check, so these are for running one area by hand.
test-seed-checks:
	@$(MAKE) --no-print-directory ci-test-python PYTEST_FILES=test_check_seed_sql.py
	@$(MAKE) --no-print-directory db-seed-check

# The shell scripts under scripts/, with aws, docker and ps stubbed: nothing reaches AWS,
# the network or a container.
test-scripts:
	@$(MAKE) --no-print-directory ci-test-python PYTEST_FILES=test_shell_scripts.py

# The API surface: the tRPC setup and its client wiring, the auth wiring, the database
# client and the route handlers. Unit tests, with every module outside the app mocked.
# Vitest takes these as filters and runs whatever matches, so a renamed path would drop
# out of the run without an error. Each one must exist.
API_TEST_PATHS := src/server/api/__tests__/trpc.test.ts src/server/__tests__ src/server/auth src/app/api src/trpc
test-api:
	@cd app && for p in $(API_TEST_PATHS); do \
		[ -e "$$p" ] || { echo "test-api: app/$$p does not exist; update API_TEST_PATHS"; exit 1; }; \
	done
	cd app && yarn test:run $(API_TEST_PATHS)

# Every area above, in turn. Each new area adds its target here. CI does not run this
# target: it runs ci-test and db-seed-check, so a new area's tests must also run through
# one of those, or through a CI step of their own, or nothing gates them.
test-matrix: test-seed-checks test-scripts test-api

# Validate Prisma schema
ci-prisma-validate:
	cd app && yarn prisma validate

# Reference links: the retrieval and the seed live in app/prisma/generators/reference-links/
# (README there, with the diagram). Retrieve is the only network step; it writes
# sources/reference-links/<corpus>/live.csv (one row per distinct URL: status, final URL, media type,
# class, date). Build is offline and deterministic: catalog + live.csv +
# overrides.csv -> seed-sql/<corpus>/10-reference-links.sql with its provenance
# row, plus reports/reference-links/<corpus>/registry.csv and redirects.md. Commit data, seed and
# reports together; re-run before publishing so the seed carries that date.
reference-links-retrieve:
	@echo "🔗 Retrieving the catalog's reference URLs (throttled live check)..."
	cd app && yarn tsx prisma/generators/reference-links/retrieve.ts --corpus $(REFERENCE_CORPUS)

reference-links-build:
	cd app && yarn tsx prisma/generators/reference-links/build.ts --corpus $(REFERENCE_CORPUS)

reference-links: reference-links-retrieve reference-links-build

# Zero Trust reference links: the sibling pipeline in app/prisma/generators/zt-reference-links/
# (README there, with the diagram). Same two halves over a per-control sources
# table instead of the catalog: retrieve probes every authored URL and writes
# sources/reference-links/<corpus>/live.csv; build is offline and deterministic: sources + live +
# overrides + catalog -> seed-sql/<catalog>/14-zt-reference-links.sql with its
# provenance row, plus reports/reference-links/<corpus>/registry.csv and redirects.md.
zt-reference-links-retrieve:
	@echo "🔗 Retrieving the Zero Trust reference URLs (throttled live check)..."
	cd app && yarn tsx prisma/generators/zt-reference-links/retrieve.ts --corpus $(ZT_CORPUS)

zt-reference-links-build:
	cd app && yarn tsx prisma/generators/zt-reference-links/build.ts --corpus $(ZT_CORPUS) --catalog $(CATALOG)

zt-reference-links: zt-reference-links-retrieve zt-reference-links-build

# Zero Trust overlay: app/prisma/generators/zt-overlay/ (README there). The
# transform reads CISA's control mapping workbook where it sits and writes the
# CSV the generator reads; the workbook itself never enters the repository. The
# generator folds that CSV into tuples, checks that every row lands, and writes
# 09/11/13 into seed-sql/nist-800-53/ plus reports/zt-overlay/tuples.csv.
zt-overlay-transform:
	@test -n "$(XLSX)" || { echo "Usage: make zt-overlay-transform XLSX=<path to the CISA workbook>"; exit 1; }
	@case "$(XLSX)" in /*) P="$(XLSX)" ;; *) P="$(CURDIR)/$(XLSX)" ;; esac; \
	cd app && yarn tsx prisma/generators/zt-overlay/transform.ts "$$P"

zt-overlay:
	cd app && yarn tsx prisma/generators/zt-overlay/generate.ts --write

# CI hard gate for URL hygiene. OFFLINE — parses the committed seed SQL
# (no DB, no network) and runs the STATIC format validators only. Exits non-zero
# on any malformed URL (double-scheme, unencoded whitespace, non-http(s),
# empty/malformed). Runs in ci-check. The live HTTP layer is deliberately NOT run
# here: it is report-only, and make check-seed-links runs it.
ci-check-links:
	cd app && SEED_CATALOG=$(CATALOG) yarn tsx scripts/check-links.ts --source=seed-sql

# ============================================
# Link Checking
# ============================================

# Local full check against the database: static format gate (hard) + live HTTP
# probe (report-only). Collects every url-bearing column (ReferenceLink, NistLink,
# DataSource, and URLs embedded in NistControl.referencePolicy + discussion). Requires the dev
# DB to be up (make db-up) and DATABASE_URL set; defaults to the local dev DSN.
DATABASE_URL ?= $(DEV_DB_URL)?sslmode=disable
# Live link check of the seed URLs straight from the committed SQL (no DB needed):
# the static format gate + a THROTTLED live HTTP probe with soft-404 content
# detection. Gentle on origins by design — low concurrency + a per-request delay
# (tune via LINKCHECK_CONCURRENCY / LINKCHECK_DELAY_MS) so a routine check never
# looks like a burst. Run this after `make reference-links` regenerates the seed.
# The offline-only gate (CI / pre-commit) is `make ci-check-links`. SEED_FILES
# narrows the check to the named files, e.g. the hand-maintained reference files.
#   Usage:  make check-seed-links
#           make check-seed-links SEED_FILES=17-zt-references-nist.sql,18-zt-references-cisa.sql
check-seed-links:
	@echo "🔗 Checking seed URLs (static + throttled live + content)..."
	cd app && SEED_CATALOG=$(CATALOG) SEED_FILES="$(SEED_FILES)" yarn tsx scripts/check-links.ts --source=seed-sql --live --content

check-links:
	@echo "🔗 Checking DB URLs (static format gate + live HTTP report)..."
	cd app && DATABASE_URL="$(DATABASE_URL)" yarn tsx scripts/check-links.ts --source=db --live

# Validate the URLs the tRPC API actually serves, against a running base URL.
# Report-only (live HTTP failures don't fail the command). Point BASE at local
# (default) or a deployed env.
#   Usage:  make check-links-api BASE=http://localhost:3000
#           make check-links-api BASE=https://dev.app.example.gov
BASE ?= http://localhost:3000
check-links-api:
	@echo "🔗 Checking API-served URLs at $(BASE) (live, report-only)..."
	@# NODE_USE_ENV_PROXY makes Node's global fetch honour HTTP(S)_PROXY/NO_PROXY,
	@# in either case. Without it the request goes direct and the WAF answers 403,
	@# which reads as a broken environment rather than an unset variable. fetch()
	@# has honoured this since Node 24.0.0; 24.5.0 only extended the same variable
	@# to node:http/node:https, which nothing here uses.
	cd app && HTTPS_PROXY=$${HTTPS_PROXY:-$(PROXY)} NODE_USE_ENV_PROXY=1 yarn tsx scripts/check-links.ts --source=api --base="$(BASE)" --live

# ============================================
# Utilities
# ============================================

# This repository's local footprint: servers in the dev (3000-3019) and container (13000-13019)
# bands, its containers and the databases in the shared one, and every worktree. Read-only.
local-status:
	@scripts/local-env.sh status

# Stop the dev servers and app containers started from any of this repository's worktrees.
# Leaves everything else alone, and leaves the database running.
local-stop:
	@scripts/local-env.sh stop

# Check which environment is running
check-env:
	@./scripts/check-environment.sh

# Preflight: verify the toolchain + AWS creds in one shot. Reports per-tool status and
# never fails the shell, so it's safe on a fresh machine to see what's missing. The AWS
# check uses the active AWS_PROFILE.
preflight:
	@echo "🔎 Preflight — toolchain + environment"
	@node --version >/dev/null 2>&1 && echo "  ✅ node $$(node --version)" || echo "  ❌ node missing"
	@test -f .nvmrc && echo "  ℹ️  .nvmrc pins node $$(cat .nvmrc)" || true
	@yv=$$(cd app && yarn --version 2>/dev/null); case "$$yv" in 4.*) echo "  ✅ yarn $$yv";; "") echo "  ❌ yarn missing (any yarn on PATH runs the release app/.yarnrc.yml names)";; *) echo "  ⚠️  yarn $$yv (expected 4.x from app/.yarnrc.yml)";; esac
	@docker info >/dev/null 2>&1 && echo "  ✅ docker running" || echo "  ❌ docker not running"
	@command -v trivy >/dev/null 2>&1 && echo "  ✅ trivy present" || echo "  ⚠️  trivy missing (needed for image scans)"
	@command -v terraform >/dev/null 2>&1 && echo "  ✅ terraform present" || echo "  ⚠️  terraform missing (needed for deploy/infra)"
	@acct=$$(aws sts get-caller-identity --query Account --output text --no-cli-pager 2>/dev/null) && echo "  ✅ AWS creds OK (account $$acct, profile $${AWS_PROFILE:-default})" || echo "  ⚠️  no AWS creds for profile $${AWS_PROFILE:-default}"
