/**
 * Vitest globalSetup for the `integration` project.
 *
 * Starts one real Postgres in a throwaway container, applies the migration
 * folder, loads the full seed, and publishes the connection string to every
 * test file through vitest's provide/inject channel. This is the only way a
 * container can be shared across files: vitest workers are separate processes,
 * so a container started inside one test file is invisible to the next, and a
 * 1.4 MB seed per file would make the suite unusable.
 *
 * The image matches production RDS (16.13, `infra/modules/database/main.tf`)
 * rather than the local compose file (16.2). The harness exists to catch what
 * breaks in production, and a second alpine pull is not a meaningful cost.
 *
 * Teardown stops the container. Testcontainers also runs a sidecar ("ryuk")
 * that reaps anything left behind if the process dies mid-run, so a crashed
 * suite does not leak containers either.
 */

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

import { applyMigrations } from "./migrate";
import { loadSeed } from "./seed";

export const POSTGRES_IMAGE = "postgres:16.13-alpine";

export default async function setup(project: TestProject) {
  const started = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const databaseUrl = started.getConnectionUri();

  try {
    applyMigrations(databaseUrl);
    await loadSeed(databaseUrl);
  } catch (err) {
    // A half-prepared database is worse than no database, so stop the container
    // before rethrowing. The stop is itself guarded: if Docker rejects it, that
    // secondary error must not replace the migrate/seed failure that actually
    // explains the run — it gets reported and the original is rethrown.
    try {
      await started.stop();
    } catch (stopErr) {
      process.stderr.write(
        `[integration-db] Failed to stop the test container; ryuk should reap it: ${
          stopErr instanceof Error
            ? (stopErr.stack ?? stopErr.message)
            : String(stopErr)
        }\n`,
      );
    }
    throw err;
  }

  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await started.stop();
  };
}
