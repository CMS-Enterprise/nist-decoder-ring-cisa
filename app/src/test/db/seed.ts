/**
 * Load `prisma/seed-sql/*.sql` into a database, in filename order.
 *
 * This is the loop from `prisma/seed-ecs.ts`, copied rather than imported. That
 * file now exports it as `loadSeed`, which `prisma/seed.ts` and the ECS seed task
 * both run, and this harness could import it too. If the two drift, this comment
 * is the pointer back.
 *
 * Why `pg` directly and not `prisma db seed`: `prisma db seed` reads
 * `DATABASE_URL` through `prisma.config.ts`, which loads `app/.env`. Calling a
 * loader with the container's URL keeps a test database independent of that file.
 *
 * Why one `query()` per file: each file is one multi-statement string — the
 * largest, `06-control-parts.sql`, is 2,136 rows in a single INSERT — and
 * `pg`'s simple query protocol accepts that in one round-trip. Splitting on
 * `;` would corrupt prose literals that contain semicolons.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Client } from "pg";
import {
  requestedCatalog,
  resolveCatalogDir,
  seedFilesIn,
} from "../../../prisma/catalog-dir.js";

const SEED_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../prisma/seed-sql",
);

/** The harness seeds whichever catalog the run selects, defaulting to the one
 *  catalog this product ships so a bare `vitest` exercises what users see. */
export async function loadSeed(databaseUrl: string): Promise<string[]> {
  const catalog = requestedCatalog() ?? "nist-800-53";
  const SEED_DIR = resolveCatalogDir(SEED_ROOT, catalog);
  const files = seedFilesIn(SEED_DIR);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(readFileSync(join(SEED_DIR, file), "utf8"));
    }
  } finally {
    await client.end();
  }
  return files;
}
