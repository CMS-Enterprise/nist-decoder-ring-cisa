# ZT Decoder Ring - Development Guide

## First-Time Setup (New Clone)

**For new developers cloning the repo for the first time:**

```bash
# From project root
make setup

# That's it! This command will:
# 1. Start PostgreSQL database (port 5439)
# 2. Install all dependencies (yarn install)
# 3. Copy .env.example to .env
# 4. Run Prisma migrations
# 5. Seed the database with the NIST SP 800-53 Rev 5 catalog: 1,014 live controls, 182 withdrawn

# Then start development
make dev
# App available at http://localhost:3000
```

**Manual setup (if you prefer):**

```bash
# From project root
make db-up
cd app
cp .env.example .env
yarn install
yarn prisma migrate deploy
SEED_CATALOG=nist-800-53 yarn prisma db seed
yarn dev
```

## Daily Development (Already Setup)

**For developers who have already run setup:**

```bash
# From project root
make dev

# This starts the database and dev server
# App available at http://localhost:3000

# When done:
# Ctrl+C to stop dev server
make db-down    # Stop database
```

## Containerized — the hardened image that ships

```bash
# From project root
make container-build    # Build the hardened runner image (runs next build)
make container-up       # Run it locally + migrate/seed the db

# Available at http://localhost:13000 — this is exactly what deploys to AWS.
# Need a shell to debug? Use the local-only debug image:  make container-debug  (:13001)
```

## Database Operations

```bash
# Start/stop database only
make db-up              # Start PostgreSQL, or reuse the one another worktree started
make db-down            # Stop PostgreSQL (the data is kept)
make db-restart         # Restart PostgreSQL

# Database management
make db-shell           # Open psql shell
make db-migrate         # Run Prisma migrations
make db-seed            # Seed with 1,014 live controls and 182 withdrawn
make db-studio          # Open Prisma Studio (GUI)

# Schema development (use db-push during development, migrations for production)
make db-push            # Push schema changes (no migration file)

# Cleanup
make db-reset           # Drop and rebuild this checkout's database only
make db-clean           # Remove the container and volume: every checkout's local database
make local-status       # This repo's servers, containers, databases and worktrees
make local-stop         # Stop this repo's dev servers and app containers
```

`local-status` and `local-stop` need git 2.31 or later, `ps`, and `lsof` or `ss` to list the listeners. Both are used where both exist; on Ubuntu under WSL2, `lsof` has been seen to miss the Next.js dev server's listener while `ss` lists it.

**One container, a database per checkout.** Every worktree uses the same Postgres container (`zt-decoder-ring-db`, `localhost:5439`) and the same data volume, whichever worktree started it. Each checkout keeps its own database in it: this one's is `zt_decoder_ring_standard` (`DEV_DB_NAME` in the Makefile, with the same default in `docker-compose.yml` and `.env.example`). `make db-up` creates it when another checkout started the container, and `make dev`, `dev-debug`, `db-migrate`, `db-push`, `db-studio`, `db-seed` and `db-ready` refuse a `DATABASE_URL` that points at the shared container but names a different database.

**Note on Seeding:**

- Seed loads the 1,014 live NIST SP 800-53 Rev 5 controls, the 182 withdrawn with their successors, and the Zero Trust overlay from `prisma/seed-sql/nist-800-53/`
- Includes parent/child relationships between base controls and enhancements
- `prisma/seed.ts` runs each SQL file in order through the `pg` driver, with the same loader as the ECS seed task, so no `psql` is needed; see [data-pipeline.md](../docs/architecture/data-pipeline.md)
- Safe to run multiple times (cleans existing data first)

## Development Workflow

**Typical day-to-day development:**

```bash
# Start development
make dev                # Starts database + Next.js dev server

# During development: Make changes, hot-reload works
# Database operations as needed (in another terminal)
make db-push            # After schema changes
make db-seed            # Re-seed if needed
make db-studio          # Browse data

# End of day: Stop
# Ctrl+C to stop dev server
make db-down            # Stop database
```

**Testing the image that ships (before pushing):**

```bash
# Build + run the exact hardened runner that deploys to AWS
make container-build
make container-up
# Test at http://localhost:13000
make container-smoke
make container-down
```

## Environment Variables

### Minimal Setup (For Initial Development)

```bash
# Copy example file
cp .env.example .env

# Only DATABASE_URL is required - already configured in .env.example
# Sign-in is optional: no route requires it until an OIDC provider is configured
```

**Minimum required:**

```env
# Database (already configured for Docker - port 5439)
DATABASE_URL="postgresql://ztdecoder:ztdecoder_dev_password@localhost:5439/zt_decoder_ring_standard"
```

### Full Setup (When Testing Sign-in)

```bash
# From project root: fill an empty AUTH_SECRET in app/.env (make setup already runs this)
make env-auth-secret
```

No sign-in provider is configured. The NextAuth wiring is in place so an OIDC provider can be added by configuration; the app serves everything anonymously until one is.

**Full configuration:**

```env
# Database
DATABASE_URL="postgresql://ztdecoder:ztdecoder_dev_password@localhost:5439/zt_decoder_ring_standard"

# Auth: none needed while sign-in is off (the default)
AUTH_SECRET="your-generated-secret-here"
AUTH_URL="http://localhost:3000"
```

**Note:** The app is anonymous unless an OIDC issuer is configured, and runs with no auth settings at all. `AUTH_SECRET` and `AUTH_URL` matter only once sign-in is turned on; see `docs/runbooks/auth-setup.md`.

## Useful Commands

```bash
# From app/ directory
yarn dev                # Development server with hot-reload
yarn build              # Production build
yarn start              # Start production server
yarn lint               # Run linter
yarn typecheck          # TypeScript type checking
yarn format:write       # Format code with Prettier

# Prisma commands
yarn prisma studio      # Visual database browser
yarn prisma generate    # Generate Prisma Client
yarn db:push            # Push schema without migration
yarn db:generate        # Create and apply migration

# Versioning and releases
yarn release            # Auto-bump version and generate CHANGELOG
yarn release:patch      # Force patch bump (0.1.0 → 0.1.1)
yarn release:minor      # Force minor bump (0.1.0 → 0.2.0)
yarn release:major      # Force major bump (0.1.0 → 1.0.0)
yarn release:dry-run    # Preview what would happen
```

## Troubleshooting

**Port already in use:**

```bash
# Check what's using port 5439 or 3000
lsof -i :5439
lsof -i :3000

# Stop the database
make db-down
```

**Prisma Client out of sync:**

```bash
cd app
yarn prisma generate  # Regenerates the client (make db-generate from the project root)
```

**Note:** `app/generated/` is not committed, so the client is whatever was last generated in this checkout. If a query or a type names a model or field the client does not have, regenerate it. This typically happens when:

- Switching branches
- Pulling schema changes from git
- After cloning, before the first `yarn install`

📖 **[Complete Prisma Troubleshooting Guide](../docs/runbooks/prisma-client-troubleshooting.md)** - Detailed runbook for all Prisma issues

**Database connection issues:**

```bash
# Ensure database is running
docker ps | grep zt-decoder-ring-db

# Check database logs
make container-logs SERVICE=db

# Restart database
make db-restart
```

**Clean slate:**

```bash
# Rebuild this checkout's database from scratch: drop it, migrate, seed (other databases are untouched)
make db-reset

# Also remove the app containers; the database is kept
make container-clean

# Remove the database container and every checkout's local data with it
make db-clean
```

## Release Workflow

### Creating a Release

The project uses **commit-and-tag-version** for automated semantic versioning based on conventional commits; it reads `.versionrc.json` at the repository root.

**IMPORTANT:** CHANGELOG.md belongs at the project root (not in app/), to track changes across the entire repository (app, infra, backend); the first release creates it.

A release lands as a reviewed pull request, like any other change. Where the default branch requires review, a local `make app-release` followed by `git push --follow-tags` cannot reach it, so:

1. Branch from the default branch.
2. Run `make scan-base`. A fixed HIGH or CRITICAL CVE in a pinned base fails here in seconds; in the runner's base it would also fail the release image's scan later, after a full build. If it fails, run `make refresh-image-digests` and commit the new pins with the release, or record a finding assessed as not reachable in `security/vex.openvex.json` (see `docs/testing.md`).
3. Set the version in `app/package.json` and in both environments' `container_image_tag`. `make set-version VERSION=<x.y.z> ENV=<env>` does both for one environment, and `make release-image` runs it when it builds the image.
4. Add the release's entry to `CHANGELOG.md`, each line linked to its pull request. `yarn release:dry-run` drafts one from the conventional commits, as a starting point.
5. Open the pull request, listing the pull requests the release carries.
6. Once it merges, tag its merge commit `v<x.y.z>`.

The version lives in `app/package.json` and the image tags. The sections below describe what `commit-and-tag-version` itself does.

### How It Works

**Conventional commits determine version bump:**

- `fix:` commits → **patch** bump (0.1.0 → 0.1.1)
- `feat:` commits → **minor** bump (0.1.0 → 0.2.0)
- `BREAKING CHANGE:` → **major** bump (0.1.0 → 1.0.0)

**Version Strategy (Pre-1.0):**

- **Keep all versions < 1.0.0** during MVP development
- Current phase: `0.x.x` for all releases
- **First production release = 1.0.0**
- Do NOT use `yarn release:major` until production launch
- Use `yarn release` (auto) or `yarn release:minor` for MVP features

**What happens automatically:**

1. Analyzes commits since last version tag
2. Determines semantic version bump
3. Updates `package.json` version
4. Generates/updates `CHANGELOG.md`
5. Creates git commit: `chore(release): 0.2.0 [no ci]`
6. Creates git tag: `v0.2.0`

### Force Specific Version

```bash
yarn release:patch      # Bug fixes release
yarn release:minor      # New features release
yarn release:major      # Breaking changes release
```

### Preview Before Release

```bash
yarn release:dry-run    # Shows what would happen without committing
```

### First Release

```bash
yarn release --first-release    # Creates v0.1.0 without bumping
```

## Architecture

- **Frontend**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS 4
- **API**: tRPC for type-safe APIs
- **Database**: PostgreSQL 16 (via Prisma ORM)
- **Auth**: NextAuth.js v5
- **Language**: TypeScript (strict mode)
- **Versioning**: commit-and-tag-version with conventional commits

## Project Structure

```
app/
├── src/
│   ├── app/          # Next.js App Router pages
│   ├── server/       # tRPC server code
│   ├── trpc/         # tRPC client setup
│   └── styles/       # Global styles
├── prisma/
│   └── schema.prisma # Database schema
├── public/           # Static assets
└── package.json      # Dependencies
```
