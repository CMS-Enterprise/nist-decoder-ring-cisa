/**
 * Prisma CLI config (Prisma 7).
 *
 * DATABASE_URL is read directly from `process.env` so the same config
 * file works uniformly in both environments:
 *
 *   Local dev — `dotenv/config` loads `app/.env`, which sets
 *     DATABASE_URL=postgresql://...@localhost:5439/... for the Makefile
 *     / docker-compose workflow.
 *
 *   ECS prod — `app/entrypoint.mjs` fetches the RDS-managed master user
 *     secret from Secrets Manager, composes the full postgresql:// URL
 *     with sslmode=verify-full (chain + identity verification against the
 *     baked-in RDS CA bundle), and sets process.env.DATABASE_URL before
 *     spawning the Prisma CLI for migrate/seed.
 *
 * We intentionally do NOT use the `env()` helper from `prisma/config`.
 * That helper evaluates in a context that didn't pick up env vars set
 * by a parent Node process via spawn() — the entrypoint's runtime
 * composition didn't reach Prisma's evaluator, so `prisma migrate
 * deploy` failed with "The datasource.url property is required" even
 * though process.env.DATABASE_URL was populated. Reading process.env
 * directly sidesteps that by resolving at config-evaluation time.
 *
 * We deliberately fall back to an empty string when DATABASE_URL is
 * unset rather than throwing. `prisma generate` (run at Docker build
 * time) doesn't need a database URL — only commands that actually
 * connect (`migrate deploy`, `db push`, `db seed`) do. Prisma itself
 * produces a clear error if the URL is empty when it's needed.
 */

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
