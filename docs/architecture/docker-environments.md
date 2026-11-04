# Docker Environments Guide

This project runs the app four ways. The key principle: there is **one artifact that ships** — the hardened, no-shell `runner` image — and you run _that_ locally so you test exactly what deploys to AWS. A shell is a deliberate, local-only opt-in and is never deployed.

---

## 1. Local Development (no Docker)

**What:** the Next.js dev server directly on your host (not in Docker).
**When:** daily development — fastest hot reload, local debugging tools.

```bash
make dev          # starts the db (Docker) + next dev on the host
# or: cd app && yarn dev
```

- App: http://localhost:3000
- Database: localhost:5439 (Docker)
- Fastest hot reload; uses your local Node.

`make dev-debug` runs the same dev server with the Node inspector: the app on http://localhost:3001 and the inspector on 127.0.0.1:3002, for an editor or `chrome://inspect` to attach to.

---

## 2. Containerized — the hardened image that ships

**What:** the exact hardened `runner` image deployed to AWS ECS, built and run locally. No shell, production dependencies only (DHI base). Running it locally is "test what you ship" — and `container-build` runs `next build`, so a production-build break fails here, not at deploy time.

**When:** before pushing — verify the real image builds, clears the CVE gate, carries the required runtime files, and serves.

```bash
make container-build   # build the runner image (runs next build)
make container-up      # run it locally (:13000) + migrate/seed the db
make container-smoke   # its health check; by hand: curl http://localhost:13000/api/health
```

Other commands:

```bash
make container-logs    # tail logs (SERVICE=app|db)
make container-smoke   # health-check the local container
make container-scan    # build + trivy HIGH/CRITICAL gate
make container-verify  # build + verify required runtime files
make container-down    # stop
make container-clean   # stop + remove containers, volumes, images
```

- App: http://localhost:13000
- No shell (hardened) — a feature, not a limitation. For a shell, use the debug container below.
- This is the image `make release-image` builds and pushes for each environment; it is built per environment, so the digests in the two ECRs are not guaranteed to match.
- Locally it reads the compose-provided `DATABASE_URL` directly; in AWS (where `DB_SECRET_ARN` is set) the entrypoint instead composes the URL from Secrets Manager + RDS TLS. Same image, environment-driven — see `app/entrypoint.mjs`.

---

## 3. Debug container — LOCAL ONLY, never deployed

**What:** the dev-shell image (DHI dev base): a shell, full devDependencies, hot reload via mounted volumes. Use it only when you need to poke inside a container. **It is never built for or pushed to any environment** — a shelled image must not reach AWS.

```bash
make container-debug   # build/run the dev-shell image (:13001) + migrate/seed
docker compose --profile debug exec app-debug sh   # get a shell
make container-down    # stop (stops either container)
```

- App: http://localhost:13001
- Has a shell + hot reload; larger image; **local debugging only**.

---

## Port bands

Each way of running the app serves from its own band, with the same layout in each, so whatever a broken target leaves listening is in a predictable place:

| Slot                | Dev family (`dev`, `dev-debug`) | Container family (`container-*`) |
| ------------------- | ------------------------------- | -------------------------------- |
| App                 | 3000                            | 13000                            |
| Debug               | 3001 (inspector 3002)           | 13001                            |
| Auth infrastructure | 3010–3019, reserved             | 13010–13019, reserved            |

The ports are Makefile variables (`DEV_APP_PORT`, `DEV_DEBUG_PORT`, `DEV_INSPECT_PORT`, `CONTAINER_APP_PORT`, `CONTAINER_DEBUG_PORT`); `docker-compose.yml` reads the container ones with the same defaults, so plain `docker compose` serves on the same ports as `make`. Each path sets `AUTH_URL` to its own port, so sign-in, when configured, returns to wherever you started the app. With no sign-in configured, every path runs anonymous and needs no auth settings.

## Quick reference

| How you run it               | Start                  | Stop                  | Port                  | Shell?     | Ships?                     |
| ---------------------------- | ---------------------- | --------------------- | --------------------- | ---------- | -------------------------- |
| Local dev (no Docker)        | `make dev`             | Ctrl+C                | 3000                  | n/a (host) | —                          |
| Local dev with the inspector | `make dev-debug`       | Ctrl+C                | 3001 (inspector 3002) | n/a (host) | —                          |
| Containerized (hardened)     | `make container-up`    | `make container-down` | 13000                 | no         | yes — this is the artifact |
| Debug container              | `make container-debug` | `make container-down` | 13001                 | yes        | never                      |

Database: localhost:5439 (shared by the container/debug stacks). `make check-env` reports which is running; `make help` lists the workflows and the destructive resets.

---

## Which one am I in?

```bash
make check-env
```

Or manually:

- `ps aux | grep "next dev"` → local dev (host)
- `docker compose ps` shows `zt-decoder-ring-app` (not `-debug`) → the hardened container
- `docker compose ps` shows `zt-decoder-ring-app-debug` → the debug container

---

## Common issues

**Port already in use** — each start target checks its port first and names what holds it. In the container band (13000, 13001), stop the running container:

```bash
make container-down
```

In the dev band (3000–3002), stop the other dev server, or run on another port with `make dev DEV_APP_PORT=3005`.

**Need a shell but you're on the hardened container** — that's by design (no shell). Switch to the debug container:

```bash
make container-debug
docker compose --profile debug exec app-debug sh
```

**A query or a type names a model or field the client does not have** — regenerate the client for the dev server, and rebuild the image for the container, which generates its own:

```bash
make db-generate                  # by hand: cd app && yarn prisma generate
make container-build NO_CACHE=1   # by hand: docker compose --profile container build --no-cache
```

See the [Prisma Troubleshooting Runbook](../runbooks/prisma-client-troubleshooting.md).

---

## Typical workflows

**Daily development:**

```bash
make dev
```

**Verify what ships, before pushing:**

```bash
make container-build   # runs next build + builds the runner
make container-scan    # CVE gate
make container-up && make container-smoke
make container-down
```

**Debug inside a container:**

```bash
make container-debug
docker compose --profile debug exec app-debug sh
make container-down
```

---

## Summary

- `make dev` — daily development (fastest).
- `make container-up` — run the **exact hardened image that ships** locally (test what you ship).
- `make container-debug` — local-only shell / hot-reload image; **never deployed**.

The hardened container has no shell on purpose. If you need a shell, that's the debug container — and it stays local.
