/**
 * What integration tests import to reach the seeded database.
 *
 * Builds a PrismaClient directly against the connection string the globalSetup
 * published, bypassing `~/server/db`. That module imports `~/env`, whose
 * `DATABASE_URL: z.string().url()` validates at import time — so importing it
 * would demand a DATABASE_URL in the environment before any test could run,
 * and would point at the dev database if one were set. Constructing the client
 * here keeps the test database the only one in play.
 *
 * Mirrors `src/server/db.ts` (same generated client, same pg adapter) so the
 * tests exercise the same driver path production does.
 */

import { inject } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../generated/prisma";

export function testDatabaseUrl(): string {
  return inject("databaseUrl");
}

export function createTestDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: testDatabaseUrl() });
  return new PrismaClient({ adapter, log: ["error"] });
}
