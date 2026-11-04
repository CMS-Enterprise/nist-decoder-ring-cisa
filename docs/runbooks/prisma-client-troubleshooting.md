# Prisma Client Troubleshooting Runbook

## Overview

This runbook covers common Prisma Client issues and their resolutions. Most come down to a generated client that no longer matches the schema the code and the database expect.

**Current Version:** Prisma 7.10.0 at the time of writing. `app/package.json` carries a caret range rather than an exact pin, so `app/yarn.lock` is what decides the installed version — read it, or run `yarn why prisma`, rather than trusting this line, which has gone stale before.

**Key Concept:** `yarn prisma generate` writes the client into `app/generated/prisma/` from `app/prisma/schema.prisma`. Prisma 7 compiles queries in WebAssembly and connects through the `pg` driver adapter, so the client carries no per-platform engine binary: the same generated files run on the host and in a Linux container. What goes wrong is a client generated from a different schema than the one the code and the database expect.

## Related Documentation

- **[Build & push container image to ECR](./build-and-push-image.md)** — Docker login, ECR auth, image build (arm64), tagging, push, build-time troubleshooting
- **[Deploy from ECR to ECS](./deploy-to-ecs.md)** — tfvars bump, terraform apply, service rollout, deploy-time troubleshooting
- **[ECS Migration & Seed](./ecs-migration-and-seed.md)** — invoking one-off `prisma migrate deploy` and seed tasks against the running cluster
- **Technical debt** — tracked in the repository's issues
- **[Docker Environments Guide](../architecture/docker-environments.md)** — local Docker setup and configuration

> When in doubt about which doc covers a given issue: this file is for **Prisma-specific** problems (schema/client mismatches, regeneration timing). Build/push issues live in the build runbook; deploy/runtime issues live in the deploy runbook; migration/seed task invocation lives in the migration runbook.

---

## Quick Diagnosis

### Symptom: a query or a type names a model or field the client does not have

A `PrismaClientValidationError` naming an unknown field or argument at runtime, or a type error saying a model or field does not exist on the client, after a pull, a branch switch or a schema change.

**Root Cause:** the generated client predates the schema. `app/generated/` is not committed, so every checkout keeps whatever client was last generated in it.

**Quick Fix:**
```bash
make db-generate       # regenerate the client, and nothing else
make dev               # restart the dev server so it loads the new client
```

For the container, rebuild the image instead: it generates its own client during the build (see [Containerized](#containerized--the-hardened-image-that-ships-port-13000)).

---

## Binary Targets

`schema.prisma` still lists `binaryTargets` (`native` and the two `linux-musl` OpenSSL 3 targets). They date from Prisma 6, when each platform needed its own query engine binary; under Prisma 7's query compiler they produce no files.

### Verify the Generated Client

The app connects through the `pg` driver adapter (`src/server/db.ts`), so there are no per-platform `libquery_engine*` binaries to check.

```bash
cd app
ls -lh generated/prisma/query_compiler_fast_bg.wasm

# You should see the query compiler beside client.js and index.js, with a recent timestamp.
```

---

## When to Regenerate Prisma Client

### Scenario 1: After Schema Changes

**When:** You modify `app/prisma/schema.prisma`

**Commands:**
```bash
make db-generate   # regenerate the client
# If the schema changed, write the migration (no make target creates one):
cd app && yarn prisma migrate dev --name describe_your_changes
```

**Note:** `make setup` handles this automatically during first-time setup.

### Scenario 2: After Switching Branches

**When:** You switch branches, or pull schema changes on the branch you are already on. These are two different problems and only one of them is a migration.

**Each checkout keeps its own database.** Branches with different migration directories cannot share one database: switching would hand `migrate deploy` entries it records as unapplied whose changes are already present under another name. Each checkout therefore names its own database in the shared container (`DEV_DB_NAME`, `zt_decoder_ring_standard` by default), and moving between checkouts leaves each intact. What a switch does need is a client generated for the branch you are on:

**Commands:**
```bash
make db-generate      # after a switch: regenerate the client for this branch
make db-reset         # only when this checkout's own database needs rebuilding
```

`db-reset` drops and recreates this checkout's database, then runs `db-ready`; other databases in the container are untouched. It is still destructive for this checkout — every local row goes, including anything edited by hand in Prisma Studio. `db-ready` waits for the database, runs `migrate deploy`, then `prisma generate`, then `db-seed`, so the client is rebuilt against the branch you are actually on. That regeneration is the load-bearing step: a client generated on another branch can name the models differently, and then reports unknown fields on models that do exist. The failure surfaces as type errors on valid field names and as integration tests failing against a correct schema — it reads as a code bug, which is what makes it expensive to diagnose.

`make setup` reaches `db-ready` and so does regenerate, but it never cleans, so it is not a substitute for `make db-reset`.

**If you only pulled schema changes on the same branch**, no rebuild is needed:

```bash
make db-migrate
```

That runs `migrate deploy` followed by `prisma generate`. Running `yarn prisma migrate deploy` by hand skips the regeneration and leaves the stale client in place.

### Scenario 3: After npm/yarn Install

**When:** Installing dependencies on a new machine or after `node_modules` cleanup

**Commands:**
```bash
cd app
yarn install  # Includes postinstall hook that runs prisma generate
```

**Note:** This happens automatically! Prisma's postinstall hook regenerates the client.

### Scenario 4: Docker Build Failures

**When:** the container's queries fail where the dev server's succeed, or a rebuilt image still behaves like an older schema

**Commands:**
```bash
# The image generates its own client from schema.prisma; rebuild without the layer cache
make container-build NO_CACHE=1   # by hand: docker compose --profile container build --no-cache
make container-up
```

---

## Environment-Specific Workflows

### Local Development (Port 3000)

**Normal workflow (no manual regeneration needed):**
```bash
make dev  # uses the client already in app/generated/prisma
```

**If you encounter Prisma errors:**
```bash
# Stop dev server (Ctrl+C)
make db-generate   # by hand: cd app && yarn prisma generate
make dev
```

**Verify it's working:**
```bash
curl http://localhost:3000/api/health
# Should return: {"status":"ok"}

curl http://localhost:3000/api/trpc/decoder.getBridgeData | jq '.result.data.json.families | length'
# Should return: 20 (number of control families)
```

---

### Containerized — the hardened image that ships (Port 13000)

This is the exact `runner` image that deploys to AWS. It has **no shell**. It generates its own Prisma client from `schema.prisma` during the build: `app/generated` is in `app/.dockerignore`, so the host's client is never copied in.

**Normal workflow:**
```bash
make container-build   # includes prisma generate in the deps stage
make container-up
make container-smoke   # by hand: curl http://localhost:13000/api/health
```

**If you hit Prisma errors in the container:**
```bash
# 1. Stop it
make container-down

# 2. Rebuild without the layer cache (the build regenerates the client) + restart
make container-build NO_CACHE=1   # by hand: docker compose --profile container build --no-cache
make container-up

# 3. Verify via logs (the runner has no shell) + health
make container-logs
make container-smoke
```

**Need to poke inside a container?** The hardened image has no shell. Use the local-only debug image instead (never deployed):
```bash
make container-debug
docker compose --profile debug exec app-debug sh

# Inside the container:
ls -lh /app/generated/prisma/
node -e "const { PrismaClient } = require('./generated/prisma'); new PrismaClient().\$connect().then(() => console.log('Connected!')).catch(e => console.error(e));"
```

---

## Common Error Messages

### Error: "@prisma/client did not initialize yet"

**Full Error:**
```
Error: @prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.
```

**Diagnosis:** Prisma Client not generated on this machine.

**Solution:**
```bash
make db-generate   # by hand: cd app && yarn prisma generate
```

**Note:** This usually happens after:
- Fresh git clone
- Switching to a branch with schema changes
- Deleting `node_modules` or `generated/` directories

---

### Error: "Environment variable not found: DATABASE_URL"

**Full Error:**
```
Error: Environment variable not found: DATABASE_URL
```

**Diagnosis:** Missing or misconfigured `.env` file.

**Solution:**
```bash
# Copy example environment file
cd app
cp .env.example .env

# Verify DATABASE_URL is set
grep DATABASE_URL .env
# Should show: DATABASE_URL="postgresql://ztdecoder:ztdecoder_dev_password@localhost:5439/zt_decoder_ring_standard"
```

---

### Error: "Can't reach database server"

**Full Error:**
```
Error: P1001: Can't reach database server at `localhost:5439`
```

**Diagnosis:** Database container not running.

**Solution:**
```bash
# Start database
make db-up

# Verify it's running, and which databases it holds
make local-status

# Test connection: a psql shell on this checkout's database (\q to quit)
make db-shell
# By hand: psql "postgresql://ztdecoder:ztdecoder_dev_password@localhost:5439/zt_decoder_ring_standard" -c "SELECT 1;"
```

---

## Make Commands Reference

### Commands That Automatically Handle Prisma

These commands include Prisma generation as part of their workflow:

| Command | What It Does | Prisma Handling |
|---------|--------------|-----------------|
| `make setup` | First-time setup | ✅ `yarn install` (postinstall hook), then `db-ready` |
| `make db-reset` | Drop and rebuild this checkout's database | ✅ By way of `db-ready` |
| `make db-generate` | Regenerate the client only | ✅ That is all it does — no database contact |
| `make db-ready` | Migrate, generate, seed | ✅ Runs `prisma generate` between the two |
| `make db-migrate` | Run migrations | ✅ Runs `prisma generate` after `migrate deploy` |
| `make db-push` | Push schema without a migration | ✅ Runs `prisma generate` after the push |
| `make container-build` | Build the hardened runner image | ✅ Runs `prisma generate` in the build |
| `yarn install` | Install dependencies | ✅ Postinstall hook runs `prisma generate` |

### Commands That DON'T Regenerate Prisma

These commands assume Prisma Client is already generated:

| Command | What It Does | Prisma Requirement |
|---------|--------------|-------------------|
| `make dev` | Start local dev | ⚠️ Requires the client already generated |
| `make container-up` | Start containers | ⚠️ Requires the image already built |
| `make db-seed` | Seed database | ⚠️ Requires Prisma Client already generated |

---

## Advanced Troubleshooting

### DHI Hardened Image Considerations

Prisma 6 misdetected OpenSSL on the hardened Alpine images and asked for a `linux-musl-arm64-openssl-1.1.x` engine, which needed an extra binary target as a workaround. Prisma 7 (from 7.3.0) has no engine binary to select, so both the problem and the workaround are gone.

---

### Verify Prisma Client Version

```bash
cd app
yarn prisma --version

# Reports the installed pair and the host platform, e.g.:
# prisma               : 7.10.0
# @prisma/client       : 7.10.0
# Operating System     : darwin
#
# The two Prisma lines must agree with each other. For what is actually pinned,
# read app/yarn.lock (or run `yarn why prisma`) — app/package.json carries a
# caret range, so a newer 7.x is a legitimate install, not a mismatch.
```

### Check Generated Client Location

```bash
cd app
cat prisma/schema.prisma | grep output
# Should show: output = "../generated/prisma"

ls -la generated/prisma/
# Should show client.js, index.js and query_compiler_fast_bg.wasm
```

### Force Clean Regeneration

```bash
# Nuclear option: Remove everything and regenerate
cd app
rm -rf generated/ node_modules/.prisma/ node_modules/@prisma/
yarn install  # Reinstalls @prisma packages + regenerates client
yarn prisma generate  # Extra confirmation

# Verify
ls -lh generated/prisma/query_compiler_fast_bg.wasm
```

### Debugging Client Loading

Add Prisma debug logging:

```bash
# In your terminal before starting dev
export DEBUG="prisma:*"
make dev

# Look for lines like:
# prisma:client lines naming the query compiler and the pg adapter (there is no engine binary to select)
```

---

## Prevention Checklist

✅ **Always run `yarn install` after pulling changes**
- The postinstall hook regenerates Prisma Client automatically

✅ **Rebuild Docker images after schema changes**
```bash
make container-build          # Containerized dev
```

✅ **Check for .gitignore patterns**
```bash
# These should be in .gitignore:
app/generated/
app/node_modules/
```

✅ **Use Make commands instead of manual steps**
- `make setup` handles first-time setup
- `make dev` manages local development
- `make container-build` and `make container-up` handle containerized dev

---

## Quick Reference Card

### I need to regenerate Prisma Client

```bash
make db-generate   # by hand: cd app && yarn prisma generate
```

### After regenerating, rebuild Docker

```bash
make container-build          # Containerized dev
```

### Verify the client exists

```bash
ls -lh app/generated/prisma/query_compiler_fast_bg.wasm
# Should show the query compiler with a recent timestamp
```

### Test database connection

```bash
# Local dev
curl http://localhost:3000/api/health

# Containerized dev
make container-smoke   # by hand: curl http://localhost:13000/api/health

# A deployed environment (needs DNS_FQDN_<env>)
make smoke ENV=dev
```

---

## Related Documentation

- [Docker Environments Guide](../architecture/docker-environments.md) - Environment setup and workflows
- [Prisma Schema](../../app/prisma/schema.prisma) - Database schema and generator config
- [Makefile](../../Makefile) - All available make commands
- [Dockerfile](../../Dockerfile) - Multi-stage Docker build process

---

## Support

If you encounter issues not covered in this runbook:

1. Check `make container-logs` or `docker compose logs app`
2. Review the [Prisma documentation](https://www.prisma.io/docs)
3. Verify your Node.js version matches requirements (24+)
4. Confirm Docker is running and up to date

For persistent issues, include the following in your report:
- Error message (full stack trace)
- Output of `yarn prisma --version`
- Output of `ls -lh app/generated/prisma/`
- Which environment (local, containerized dev, production)
- Steps to reproduce
