# seed-ecs

**Script:** `app/prisma/seed-ecs.ts`

## Purpose

Holds `loadSeed`, the one seed loop, and is the ECS seed task's entry point. `loadSeed` runs every `.sql` file in a catalog's directory, in filename order, as one `pg` query per file. Postgres runs each file as one transaction, so a failing file leaves nothing of itself behind. [`seed.ts`](./seed.md) imports the same function for `prisma db seed`.

Importing the file runs nothing. The task's work starts only when the file is the script node was started with, which holds under `tsx` and under `node --import tsx`.

## Usage

```bash
AWS_PROFILE=<env-profile> make ecs-run-seed ENV=dev   # the ECS task
make seed-ecs-local                                    # the same entry point against the local dev database
```

The ECS task runs `node --import tsx prisma/seed-ecs.ts`; `app/entrypoint.mjs` composes `DATABASE_URL` before it starts. The catalog comes from `SEED_CATALOG` or `--catalog=<name>`. Runbook: [ecs-migration-and-seed.md](../runbooks/ecs-migration-and-seed.md).

## Notes

- The log lines are tagged `[seed-ecs]`. The first names the catalog, the database `pg` connects to and the file count, never the user, the password or the URL. A failure logs a `[seed-ecs] Partial seed:` line, then `[seed-ecs] Failed: <error>`, followed by Postgres's `DETAIL:` when the error carries one, and exits 1. The seed-failed alarm in `infra/environments/<env>/alarms.tf` matches the `[seed-ecs] Failed` text, so keep it.
- `DATABASE_URL` must name a database. A URL without one is refused before connecting.
- Unit tests with `pg` mocked are in `app/prisma/__tests__/`. `seed-loader.integration.test.ts` runs the loader into a real Postgres under `make test-integration` and checks every row the seed inserts arrived.
