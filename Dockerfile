# syntax=docker/dockerfile:1

# ============================================
# Base stage - shared dependencies
# ============================================
# Using Docker Hardened Images (DHI) for improved security
# - Near-zero CVEs
# - SLSA Level 3 provenance
# - Apache 2.0 license (free for open source)
# Reference: https://docs.docker.com/dhi/migration/examples/node/
FROM dhi.io/node:24-alpine3.22-dev@sha256:32f8fcc3d042c3d017bc1e4b9a6089ddad5f85a25236468d30242d95eb1d1186 AS base

# Install libc6-compat for Prisma's Rust query engine binaries.
# schema.prisma pins explicit linux-musl-openssl-3.0.x and
# linux-musl-arm64-openssl-3.0.x targets — no OpenSSL detection path.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy package files. .yarnrc.yml points yarnPath at the Yarn 4 release
# committed under .yarn/releases, and the image's own yarn hands off to it.
COPY app/package.json app/yarn.lock app/.yarnrc.yml ./
COPY app/.yarn/releases ./.yarn/releases

# ============================================
# Dependencies stage - install all deps
# ============================================
FROM base AS deps

# Copy Prisma schema (needed for postinstall hook). Only the schema: the
# postinstall hook runs `prisma generate`, which reads schema.prisma and
# nothing else. Copying the directory wholesale would put the seed generators'
# pinned input corpora into this layer's cache key, so editing a catalog input
# would reinstall every dependency.
COPY app/prisma/schema.prisma ./prisma/schema.prisma

# Install all dependencies (including dev). The cache mount keeps Yarn's
# package cache out of the layer, and prod-deps reads the same cache.
RUN --mount=type=cache,id=yarn-berry,target=/root/.yarn/berry \
    yarn install --immutable

# ============================================
# Builder stage - build the application
# ============================================
FROM base AS builder

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Fetch the AWS RDS global CA bundle for TLS chain verification
# (sslmode=verify-full). The global bundle covers all commercial Regions
# (incl. us-east-1) and contains only root CAs, so trusting the whole file is
# safe and survives RDS server-cert rotation. ADD is the Docker-recommended
# primitive for remote build artifacts (precise build cache + built-in checksum
# support); it is placed before the app COPY so routine source changes don't
# re-fetch it. --checksum pins the content for supply-chain integrity. AWS
# republishes the bundle when a Region adds roots, which breaks this step until
# the pin moves; `make check-rds-bundle` (meant to run weekly in CI) compares the pin
# with the live bundle and prints the new hash. Review the new bundle before
# moving the pin. See docs/scripts/check-rds-bundle.md.
# https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /rds-global-bundle.pem

# Copy application source
COPY app/ .

# Set environment for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1

# Generate Prisma Client
RUN yarn prisma generate

# Build Next.js application with standalone output
RUN yarn build

# ============================================
# Production dependencies stage - prod-only node_modules for the slim runner
# ============================================
# Start from builder (full node_modules with Prisma engines already fetched and
# the generated client present), then prune devDependencies: `workspaces focus
# --production` re-links node_modules with `dependencies` only. It has no
# --ignore-scripts, so Prisma's allowed install scripts and the app's
# postinstall run again. `prisma generate` and the engine fetch repeat what
# builder already did. The postinstall's husky step is guarded with `|| true`,
# because husky is a devDependency and the prune has just removed it. This
# drops the dev toolchain
# (eslint, vitest, typescript, tailwind, prettier, testing-library, @types/*, …)
# while keeping every runtime dependency the three task paths need — all
# declared in `dependencies`:
#   - app server:   next runtime, @prisma/client, @prisma/adapter-pg, pg
#   - migrate task: prisma CLI (node_modules/.bin/prisma)
#   - seed task:    tsx (node_modules/.bin/tsx), pg
#   - entrypoint:   @aws-sdk/client-secrets-manager
FROM builder AS prod-deps
RUN --mount=type=cache,id=yarn-berry,target=/root/.yarn/berry \
    yarn workspaces focus --all --production

# ============================================
# Development stage - full dev environment with shell
# ============================================
FROM base AS development

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY app/ .

# Generate Prisma Client for development
RUN yarn prisma generate

# Set development environment
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user (Alpine syntax)
RUN addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S -G nodejs nextjs && \
    chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Default to dev server (can be overridden)
CMD ["yarn", "dev"]

# ============================================
# Runner stage - production runtime
# ============================================
# Using minimal DHI runtime image (no dev tools, NO SHELL for security)
FROM dhi.io/node:24-alpine3.22@sha256:86e13921692fa7bac4c7da41a2832aa9c90c082913d33f88dd3b4ffc0b8cb13d AS runner

# Note: Cannot RUN commands here - no shell in hardened image!
# DHI minimal image includes necessary runtime libraries for Node.js and Prisma.
# HEALTHCHECK uses the exec (array) form below so it runs without a shell.

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built application from builder. We set --chown=node:node on every
# COPY so the runtime node user owns the files — Prisma's CLI
# (invoked by the migration task) re-verifies its engine binaries under
# node_modules/@prisma/engines and tries to write checksum/metadata
# files at runtime. Without the chown, USER node can't write and the
# CLI fails with "Can't write to /app/node_modules/@prisma/engines".
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone/app ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Copy Prisma schema, runtime config, and generated client.
# prisma.config.ts is required at runtime: schema.prisma's datasource has
# no `url = env(...)`, so Prisma reads the URL exclusively from the config
# file's `datasource.url`. The config reads `process.env.DATABASE_URL`
# directly (set by entrypoint.mjs from Secrets Manager). Without this
# copy, `prisma migrate deploy` exits with "The datasource.url property
# is required in your Prisma config file" because the file is missing
# and there's nothing to fall back to.
#
# Enumerated rather than copied wholesale. prisma/ also holds three seed
# generators and their pinned input corpora — build-time tooling with no
# runtime path, and the larger part of the directory. The runtime needs the
# schema and migrations for `migrate deploy`, and the seed executor with its
# SQL for the seed task. A new runtime file under prisma/ needs a line here.
COPY --from=builder --chown=node:node /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=node:node /app/prisma/migrations ./prisma/migrations
COPY --from=builder --chown=node:node /app/prisma/seed-sql ./prisma/seed-sql
COPY --from=builder --chown=node:node /app/prisma/catalog-dir.ts ./prisma/catalog-dir.ts
COPY --from=builder --chown=node:node /app/prisma/seed.ts ./prisma/seed.ts
COPY --from=builder --chown=node:node /app/prisma/seed-ecs.ts ./prisma/seed-ecs.ts
COPY --from=builder --chown=node:node /app/prisma/seed-progress.ts ./prisma/seed-progress.ts
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/generated/prisma ./generated/prisma

# AWS RDS global CA bundle — enables sslmode=verify-full chain + hostname
# verification for the app (pg), seed (pg), and migrate (Prisma Rust engine)
# DB paths. entrypoint.mjs points sslrootcert / PGSSLROOTCERT here. SC-8/SC-13.
COPY --from=builder --chown=node:node /rds-global-bundle.pem /etc/ssl/rds-global-bundle.pem

# Copy the production-pruned node_modules from the prod-deps stage (devDeps
# removed; every runtime dep for the app, migrate, and seed paths retained —
# see that stage). We copy the whole prod tree rather than cherry-picking
# scopes because cherry-picking produced iterative MODULE_NOT_FOUND failures as
# transitive dep graphs shifted between upgrades; pruning devDeps gets the size
# win without that fragility.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Entrypoint source (the aws-sdk / prisma / tsx deps come in via the
# node_modules copy above).
COPY --from=builder --chown=node:node /app/entrypoint.mjs ./entrypoint.mjs

# DHI images include a 'node' user - use it for security
# Cannot create users (no shell), so we use the pre-existing node user
USER node

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check — array (exec) form so it runs without a shell, which
# DHI minimal images don't ship.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]

# Entrypoint composes DATABASE_URL from the RDS master user secret, then
# execs the Next.js standalone server. ECS overrides this with `command`
# for one-off migration and seed tasks.
ENTRYPOINT ["node", "/app/entrypoint.mjs"]
# Users can run migrations separately: docker compose exec app-prod node node_modules/.bin/prisma migrate deploy

# Start the application
CMD ["node", "server.js"]
