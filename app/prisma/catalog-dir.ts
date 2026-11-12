/**
 * Docs: docs/scripts/seed.md
 * Which catalog a seed run loads, and where that catalog's SQL lives.
 *
 * One deployment holds one catalog, so a seed run must be told which. The choice
 * is declared, never inferred from what happens to be on disk — the same position
 * the generators already take for the catalog they parse. Inferring it would load
 * the wrong product's data and report success.
 *
 * Directory names are catalog keys WITHOUT a version ("nist-800-53", not "nist-800-53-r5").
 * Versions move; the source tree should not churn when Rev 5.2 becomes 5.3. That
 * deliberately differs from the versioned `catalogKey` on the catalog row, which
 * identifies a loaded catalog rather than a directory.
 */

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The committed seed, one directory per catalog. Resolved from this file rather
 *  than the working directory, so a loader finds it wherever it is started. */
export const SEED_ROOT = fileURLToPath(new URL("seed-sql", import.meta.url));

/** Catalog directories present under a seed root, sorted. */
export function availableCatalogs(seedRoot: string): string[] {
  try {
    return readdirSync(seedRoot)
      .filter((name) => {
        try {
          return statSync(join(seedRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/** The catalog name a run was told to load: `--catalog=<name>` wins over
 *  SEED_CATALOG, because the flag is typed at the moment of the run while the
 *  env var may be inherited from a shell or a task definition. */
export function requestedCatalog(
  argv: string[] = process.argv,
): string | undefined {
  // An empty value is treated as absent rather than as a catalog named "", so
  // `SEED_CATALOG=` fails the same way as not setting it at all.
  const flag = argv.find((a) => a.startsWith("--catalog="));
  if (flag) {
    const value = flag.slice("--catalog=".length).trim();
    return value === "" ? undefined : value;
  }
  const fromEnv = process.env.SEED_CATALOG?.trim();
  return fromEnv === undefined || fromEnv === "" ? undefined : fromEnv;
}

/**
 * Resolve a catalog name to its directory, or throw naming what is actually
 * available. A name containing a path separator or `..` is rejected before it
 * reaches the filesystem: this value becomes part of the path the loader reads
 * SQL from, and it became input the moment the selector existed.
 */
export function resolveCatalogDir(
  seedRoot: string,
  requested?: string,
): string {
  const found = availableCatalogs(seedRoot);
  const listing = found.length ? found.join(", ") : "(none found)";

  if (!requested) {
    throw new Error(
      `No catalog selected. Set SEED_CATALOG or pass --catalog=<name>. Available: ${listing}`,
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(requested)) {
    throw new Error(
      `Invalid catalog name ${JSON.stringify(requested)}. Expected a single directory name. Available: ${listing}`,
    );
  }

  const dir = resolve(seedRoot, requested);
  if (dir !== join(seedRoot, requested)) {
    throw new Error(
      `Catalog ${JSON.stringify(requested)} resolves outside ${seedRoot}.`,
    );
  }
  if (!found.includes(requested)) {
    throw new Error(
      `Unknown catalog ${JSON.stringify(requested)}. Available: ${listing}`,
    );
  }
  return dir;
}

/**
 * The `.sql` files for a catalog, in execution order.
 *
 * Throws when there are none. A seed that finds nothing to run must not report
 * success: before the catalog selector existed the directory was a constant and
 * could not be empty, but a mistyped or half-populated catalog now can be, and
 * "Executing 0 SQL seed files... Seed completed successfully" is exactly the
 * silent pass this pipeline's expectation gates exist to prevent.
 */
export function seedFilesIn(dir: string): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .sql files in ${dir} — nothing to seed.`);
  }
  return files;
}
