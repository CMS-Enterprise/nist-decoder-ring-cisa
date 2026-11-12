# seed

**Script:** `app/prisma/seed.ts`

## Purpose

Loads one catalog's seed SQL into the database `DATABASE_URL` names. It is the command `prisma db seed` runs (`migrations.seed` in `app/prisma.config.ts`). It reads `SEED_CATALOG` or `--catalog=<name>`, finds `app/prisma/seed-sql/<catalog>/`, and hands both to `loadSeed` in [`seed-ecs.ts`](./seed-ecs.md), the loader the ECS seed task runs. No `psql` or Docker is involved.

## Usage

```bash
make db-seed                       # this line's catalog into this line's dev database
make db-seed CATALOG=<name>        # another catalog under seed-sql/
cd app && SEED_CATALOG=nist-800-53 yarn prisma db seed   # by hand; DATABASE_URL from app/.env
```

`make db-seed` runs `make db-seed-check` first and refuses a `DATABASE_URL` that names another line's database in the shared dev container.

## Notes

- The log lines are tagged `[seed]`: the catalog, the database and the file count, then each file before it runs, then `[seed] Completed <n> file(s)`. The first line names the database `pg` connects to, never the user, the password or the URL.
- A failing file stops the run. The log names what loaded, the file that failed and what never ran, and the command exits 1. See [data-pipeline.md](../architecture/data-pipeline.md#how-a-seed-run-behaves).
- `DATABASE_URL` must name a database. A URL without one is refused, so `pg` never falls back to a database named after the role.
- A URL to anything but the local container needs `sslmode`. `pg` tries TLS only when the URL or `PGSSLMODE` asks for it, so a URL without it connects in plain text. Set `sslmode=verify-full` with the server's CA bundle in `sslrootcert`, as the URL `app/entrypoint.mjs` composes for the ECS task does.
