// @vitest-environment node
/**
 * `prisma db seed` runs seed.ts, which hands the selected catalog and DATABASE_URL
 * to the shared loader. `pg` is replaced by a recorder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => {
  const clients: Array<{ connectionString: string; queries: number }> = [];
  class Client {
    private readonly record;
    /** The database pg would connect to, as the real Client reads it from the URL. */
    readonly database: string;
    constructor({ connectionString }: { connectionString: string }) {
      this.database = decodeURIComponent(
        new URL(connectionString).pathname.slice(1),
      );
      this.record = { connectionString, queries: 0 };
      clients.push(this.record);
    }
    connect() {
      return Promise.resolve();
    }
    async query() {
      this.record.queries++;
    }
    end() {
      return Promise.resolve();
    }
  }
  return { clients, Client };
});

vi.mock("pg", () => ({ Client: pg.Client }));

const URL_WITH_DB = "postgresql://ztdecoder:secret@localhost:5439/scratch";

let out: string[];

beforeEach(() => {
  pg.clients.length = 0;
  out = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("prisma db seed", () => {
  it("loads the selected catalog into the database DATABASE_URL names", async () => {
    vi.stubEnv("SEED_CATALOG", "nist-800-53");
    vi.stubEnv("DATABASE_URL", URL_WITH_DB);

    await import("../seed");

    expect(pg.clients).toHaveLength(1);
    expect(pg.clients[0]!.connectionString).toBe(URL_WITH_DB);
    expect(out[0]).toMatch(
      /^\[seed\] catalog=nist-800-53 database=scratch files=\d+\n$/,
    );
    expect(out.at(-1)).toMatch(/^\[seed\] Completed \d+ file\(s\)\n$/);
    expect(pg.clients[0]!.queries).toBe(out.length - 2);
  });

  it("refuses to start without DATABASE_URL", async () => {
    vi.stubEnv("SEED_CATALOG", "nist-800-53");
    vi.stubEnv("DATABASE_URL", "");

    await expect(import("../seed")).rejects.toThrow(
      "DATABASE_URL environment variable is required",
    );
    expect(pg.clients).toHaveLength(0);
  });

  it("refuses to choose a catalog", async () => {
    vi.stubEnv("SEED_CATALOG", "");
    vi.stubEnv("DATABASE_URL", URL_WITH_DB);

    await expect(import("../seed")).rejects.toThrow(/^No catalog selected/);
    expect(pg.clients).toHaveLength(0);
  });
});
