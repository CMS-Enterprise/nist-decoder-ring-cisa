/**
 * Apply the migration folder to a database by shelling out to the Prisma CLI.
 *
 * Why the CLI and not `prisma db push`: the migrations carry what `schema.prisma`
 * cannot declare. Prisma emits no NOT NULL for a list column, and a migration
 * makes `ZeroTrustMapping.pillars` NOT NULL. `db push` builds from the schema
 * alone, so it would silently give the tests a different database from the one
 * production runs.
 *
 * Why a shell-out: Prisma exposes no programmatic migrate API. The CLI reads
 * the URL from `prisma.config.ts`, which reads `process.env.DATABASE_URL`, so
 * the URL is passed through the child's environment. `prisma.config.ts` also
 * loads `app/.env` via `dotenv/config`, and that file sets a DATABASE_URL
 * pointing at the developer's database on localhost:5439.
 *
 * Normally dotenv leaves an already-set variable alone, so the explicit value
 * here wins, unless override is on. dotenv reads each of its options from the
 * environment, `DOTENV_<OPTION>` first and `DOTENV_CONFIG_<OPTION>` as the
 * fallback, so `DOTENV_OVERRIDE` or `DOTENV_CONFIG_OVERRIDE` set in a developer's
 * shell would let `app/.env` replace DATABASE_URL, and `prisma migrate deploy`
 * would run against the developer's database instead of the container.
 * `DOTENV_PATH` could point it at another file as well.
 *
 * So every `DOTENV_*` key is stripped from the child environment, and dotenv runs
 * on its defaults: override off, `app/.env` only. An option dotenv starts reading
 * from the environment later is covered without a change here.
 *
 * `seed.ts` is not exposed to this — it connects with `pg` directly and never
 * loads dotenv.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PRISMA_BIN = resolve(APP_DIR, "node_modules/.bin/prisma");

export function applyMigrations(databaseUrl: string): void {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("DOTENV_")) delete childEnv[key];
  }

  execFileSync(PRISMA_BIN, ["migrate", "deploy"], {
    cwd: APP_DIR,
    env: { ...childEnv, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
