/**
 * The seed loader, and the ECS seed task's entry point.
 * Docs: docs/scripts/seed-ecs.md
 *
 * `loadSeed` iterates over one catalog's numbered SQL files in
 * app/prisma/seed-sql/<catalog>/ and runs each via the `pg` driver's simple
 * query protocol, which accepts multi-statement SQL strings as a single
 * round-trip. It is the only seed loop: `prisma db seed` runs `seed.ts`, which
 * imports it, and the ECS seed task runs this file.
 *
 * Why not Prisma's `$executeRawUnsafe`?
 *   `$executeRawUnsafe` rejects multi-statement strings, so the naive
 *   `.split(";")` workaround corrupts SQL strings containing semicolons
 *   inside string literals (e.g. `'Statute: Privacy Act of 1974 (P.L.
 *   93-579);'` in 04-controls.sql). Implementing a proper
 *   SQL-aware splitter is more code than just using pg directly. pg is
 *   already in node_modules as a transitive dep of @prisma/adapter-pg.
 *
 * Why not psql?
 *   DHI minimal images don't ship psql or a shell, and one loop everywhere
 *   means a local seed exercises the code the ECS task runs.
 *
 * Invoked from the ECS seed task (see
 * infra/modules/compute/ecs_migration_tasks.tf), which overrides the
 * container command to `["node", "--import", "tsx", "prisma/seed-ecs.ts"]`.
 * The entrypoint composes DATABASE_URL from the RDS master user secret
 * (sslmode=verify-full&sslrootcert=<bundle>&uselibpqcompat=true, so
 * node-postgres verifies the RDS cert chain + identity via libpq SSL
 * semantics) before this file runs. Importing this file runs nothing; the
 * task's work starts only when it is the script node was given.
 */

import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requestedCatalog,
  resolveCatalogDir,
  SEED_ROOT,
  seedFilesIn,
} from "./catalog-dir.js";
import { Client } from "pg";
import { seedProgress } from "./seed-progress.js";

/**
 * Refuses a URL that names no database. pg would then connect to a database
 * named after the role, or whatever PGDATABASE says, and seed that instead. A
 * URL Node cannot parse is left for pg to accept or reject.
 */
export function assertNamesDatabase(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return;
  }
  if (url.pathname.replace(/^\//, "") === "") {
    throw new Error(
      "DATABASE_URL names no database; refusing to seed whichever one pg would pick.",
    );
  }
}

/**
 * Run every `.sql` file in `seedDir` against `databaseUrl`, in filename order,
 * one query per file. Each file is sent as one multi-statement string, which
 * Postgres runs as one transaction, so a failing file leaves nothing of itself
 * behind. Logs each file before it runs; on a failure logs how far the run got
 * and rethrows. Returns the files it ran.
 */
export async function loadSeed({
  databaseUrl,
  seedDir,
  tag = "seed-ecs",
}: {
  databaseUrl: string;
  seedDir: string;
  /** Prefixes every log line, e.g. `[seed-ecs]`. */
  tag?: string;
}): Promise<string[]> {
  assertNamesDatabase(databaseUrl);
  const files = seedFilesIn(seedDir);
  const client = new Client({ connectionString: databaseUrl });
  process.stdout.write(
    `[${tag}] catalog=${basename(seedDir)} database=${client.database} files=${files.length}\n`,
  );

  try {
    await client.connect();
    for (const [i, file] of files.entries()) {
      const sql = readFileSync(join(seedDir, file), "utf8");

      process.stdout.write(`[${tag}] ${file}\n`);
      try {
        await client.query(sql);
      } catch (err) {
        process.stderr.write(`[${tag}] ${seedProgress(files, i)}\n`);
        throw err;
      }
    }

    process.stdout.write(`[${tag}] Completed ${files.length} file(s)\n`);
  } finally {
    await client.end();
  }
  return files;
}

/**
 * The ECS task's `Failed:` line: the error's stack, then Postgres's DETAIL when
 * the error carries one. `pg` keeps DETAIL on `err.detail`, and the stack leaves
 * it out, though it is often what names the row or key at fault.
 */
export function failedLine(err: unknown): string {
  if (!(err instanceof Error)) return `Failed: ${String(err)}`;
  const failed = `Failed: ${err.stack ?? err.message}`;
  const detail = (err as { detail?: unknown }).detail;
  return typeof detail === "string" && detail !== ""
    ? `${failed}\nDETAIL: ${detail}`
    : failed;
}

/** Whether the module at `moduleUrl` is the script node was started with. */
export function isEntryPoint(
  moduleUrl: string,
  argv: readonly string[] = process.argv,
): boolean {
  const script = argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const seedDir = resolveCatalogDir(SEED_ROOT, requestedCatalog());
  await loadSeed({ databaseUrl: required("DATABASE_URL"), seedDir });
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err: unknown) => {
    process.stderr.write(`[seed-ecs] ${failedLine(err)}\n`);
    process.exit(1);
  });
}
