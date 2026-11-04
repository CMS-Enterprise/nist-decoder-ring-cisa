/**
 * ECS-runnable seed executor.
 * Docs: docs/scripts/seed-ecs.md
 *
 * Iterates over one catalog's numbered SQL files in app/prisma/seed-sql/<catalog>/ and runs
 * each via the `pg` driver's simple query protocol, which accepts
 * multi-statement SQL strings as a single round-trip.
 *
 * Why not Prisma's `$executeRawUnsafe`?
 *   `$executeRawUnsafe` rejects multi-statement strings, so the naive
 *   `.split(";")` workaround corrupts SQL strings containing semicolons
 *   inside string literals (e.g. `'Statute: Privacy Act of 1974 (P.L.
 *   93-579);'` in 04-controls.sql). Implementing a proper
 *   SQL-aware splitter is more code than just using pg directly. pg is
 *   already in node_modules as a transitive dep of @prisma/adapter-pg.
 *
 * Why not psql via shell-out (like `app/prisma/seed.ts`)?
 *   DHI minimal images don't ship psql or a shell.
 *
 * Invoked from the ECS seed task (see
 * infra/modules/compute/ecs_migration_tasks.tf), which overrides the
 * container command to `["node", "--import", "tsx", "prisma/seed-ecs.ts"]`.
 * The entrypoint composes DATABASE_URL from the RDS master user secret
 * (sslmode=verify-full&sslrootcert=<bundle>&uselibpqcompat=true, so
 * node-postgres verifies the RDS cert chain + identity via libpq SSL
 * semantics) before this file runs.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  requestedCatalog,
  resolveCatalogDir,
  seedFilesIn,
} from "./catalog-dir.js";
import { Client } from "pg";
import { seedProgress } from "./seed-progress.js";

const SEED_ROOT = resolve(process.cwd(), "prisma/seed-sql");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const catalog = requestedCatalog();
  const seedDir = resolveCatalogDir(SEED_ROOT, catalog);
  const files = seedFilesIn(seedDir);
  process.stdout.write(`[seed-ecs] catalog=${catalog} files=${files.length}\n`);

  const connectionString = required("DATABASE_URL");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const [i, file] of files.entries()) {
      const path = join(seedDir, file);
      const sql = readFileSync(path, "utf8");

      process.stdout.write(`[seed-ecs] ${file}\n`);
      try {
        await client.query(sql);
      } catch (err) {
        process.stderr.write(`[seed-ecs] ${seedProgress(files, i)}\n`);
        throw err;
      }
    }

    process.stdout.write(`[seed-ecs] Completed ${files.length} file(s)\n`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[seed-ecs] Failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
