import { afterEach, describe, expect, it, vi } from "vitest";

// Every client and adapter the module builds, recorded in plain arrays: mock call
// history is cleared before each test, and these modules are loaded inside them.
const built = vi.hoisted(() => {
  const env: { DATABASE_URL?: string; NODE_ENV?: string } = {};
  const adapters: unknown[] = [];
  const clients: unknown[] = [];
  return { env, adapters, clients };
});
vi.mock("~/env", () => ({ env: built.env }));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(public options: unknown) {
      built.adapters.push(options);
    }
  },
}));
vi.mock("../../../generated/prisma", () => ({
  PrismaClient: class {
    constructor(public options: { adapter: unknown; log: string[] }) {
      built.clients.push(options);
    }
  },
}));

const URL = "postgresql://u:p@localhost:5439/zt_standard";
const globalForPrisma = globalThis as { prisma?: unknown };

// db.ts builds or reuses its client when it is first imported, so each load
// starts from a fresh module registry, as a hot reload or a new process does.
async function load(nodeEnv: string) {
  Object.assign(built.env, { DATABASE_URL: URL, NODE_ENV: nodeEnv });
  vi.resetModules();
  return (await import("../db")).db as unknown as {
    options: { adapter: { options: unknown }; log: string[] };
  };
}

afterEach(() => {
  delete globalForPrisma.prisma;
  built.adapters.length = 0;
  built.clients.length = 0;
});

describe("the database client", () => {
  it("connects through the pg adapter to DATABASE_URL", async () => {
    const db = await load("production");
    expect(built.adapters).toEqual([{ connectionString: URL }]);
    expect(db.options.adapter.options).toEqual({ connectionString: URL });
  });

  it("logs queries, errors and warnings in development", async () => {
    const db = await load("development");
    expect(db.options.log).toEqual(["query", "error", "warn"]);
  });

  it.each(["test", "production"])(
    "logs only errors when NODE_ENV is %s",
    async (env) => {
      const db = await load(env);
      expect(db.options.log).toEqual(["error"]);
    },
  );

  it.each(["development", "test"])(
    "keeps one client across reloads when NODE_ENV is %s",
    async (env) => {
      const first = await load(env);
      const second = await load(env);
      expect(second).toBe(first);
      expect(globalForPrisma.prisma).toBe(first);
      expect(built.clients).toHaveLength(1);
    },
  );

  it("builds a fresh client on every load in production", async () => {
    const first = await load("production");
    const second = await load("production");
    expect(second).not.toBe(first);
    expect(globalForPrisma.prisma).toBeUndefined();
    expect(built.clients).toHaveLength(2);
  });
});
