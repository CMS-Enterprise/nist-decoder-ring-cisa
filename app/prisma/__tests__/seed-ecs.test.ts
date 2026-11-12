// @vitest-environment node
/**
 * The seed loader every entry point runs, with `pg` replaced by a recorder: each
 * file goes to the database once, in order, and a failure says where it stopped.
 * The integration test runs the same loader against a real Postgres.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => {
  const state = {
    clients: [] as Array<{
      connectionString: string;
      queries: string[];
      ended: boolean;
    }>,
    /** Returns the error a query should fail with, or undefined to succeed. */
    failOn: undefined as ((sql: string) => Error | undefined) | undefined,
    /** When set, connect() rejects with it. */
    connectError: undefined as Error | undefined,
  };
  class Client {
    private readonly record;
    /** The database pg would connect to, as the real Client reads it from the URL. */
    readonly database: string;
    constructor({ connectionString }: { connectionString: string }) {
      this.database = decodeURIComponent(
        new URL(connectionString).pathname.slice(1),
      );
      this.record = { connectionString, queries: [] as string[], ended: false };
      state.clients.push(this.record);
    }
    async connect() {
      if (state.connectError) throw state.connectError;
    }
    async query(sql: string) {
      this.record.queries.push(sql);
      const err = state.failOn?.(sql);
      if (err) throw err;
    }
    async end() {
      this.record.ended = true;
    }
  }
  return { state, Client };
});

vi.mock("pg", () => ({ Client: pg.Client }));

import {
  assertNamesDatabase,
  failedLine,
  isEntryPoint,
  loadSeed,
} from "../seed-ecs";

const URL_WITH_DB = "postgresql://ztdecoder:secret@localhost:5439/scratch";
const SCRIPT = fileURLToPath(new URL("../seed-ecs.ts", import.meta.url));

let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seed-loader-"));
  pg.state.clients.length = 0;
  pg.state.failOn = undefined;
  pg.state.connectError = undefined;
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Three seed files written out of order, plus one the loader must skip. */
function writeSeed(): void {
  writeFileSync(join(dir, "02-b.sql"), "-- second b");
  writeFileSync(join(dir, "00-a.sql"), "-- first a");
  writeFileSync(join(dir, "01-c.sql"), "-- then c");
  writeFileSync(join(dir, "README.md"), "not seed");
}

describe("loadSeed", () => {
  it("runs each file once, in filename order, as one query per file", async () => {
    writeSeed();
    const files = await loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir });

    expect(files).toEqual(["00-a.sql", "01-c.sql", "02-b.sql"]);
    expect(pg.state.clients).toHaveLength(1);
    expect(pg.state.clients[0]!.connectionString).toBe(URL_WITH_DB);
    expect(pg.state.clients[0]!.queries).toEqual([
      "-- first a",
      "-- then c",
      "-- second b",
    ]);
    expect(out).toEqual([
      `[seed-ecs] catalog=${basename(dir)} database=scratch files=3\n`,
      "[seed-ecs] 00-a.sql\n",
      "[seed-ecs] 01-c.sql\n",
      "[seed-ecs] 02-b.sql\n",
      "[seed-ecs] Completed 3 file(s)\n",
    ]);
    expect(err).toEqual([]);
  });

  it("closes the connection when the run succeeds", async () => {
    writeSeed();
    await loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir });
    expect(pg.state.clients[0]!.ended).toBe(true);
  });

  it("names the database, and never the user, the password or the URL", async () => {
    writeSeed();
    const password = "n0t-in-any-log";
    const databaseUrl = `postgresql://seeder:${password}@db.example.internal:5432/target_db?sslmode=verify-full`;
    await loadSeed({ databaseUrl, seedDir: dir });
    pg.state.failOn = () => new Error("syntax error");
    await expect(loadSeed({ databaseUrl, seedDir: dir })).rejects.toThrow();

    expect(out[0]).toBe(
      `[seed-ecs] catalog=${basename(dir)} database=target_db files=3\n`,
    );
    const logged = [...out, ...err].join("");
    expect(logged).toContain("[seed-ecs] Partial seed:");
    expect(logged).not.toContain(password);
    expect(logged).not.toContain("seeder");
    expect(logged).not.toContain(databaseUrl);
  });

  it("prefixes its log lines with the tag it is given", async () => {
    writeSeed();
    await loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir, tag: "seed" });
    expect(out.every((line) => line.startsWith("[seed] "))).toBe(true);
  });

  it("refuses an empty seed directory before connecting", async () => {
    writeFileSync(join(dir, "README.md"), "not seed");
    await expect(
      loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir }),
    ).rejects.toThrow(`No .sql files in ${dir} — nothing to seed.`);
    expect(pg.state.clients).toHaveLength(0);
  });

  it("stops at the file that fails, says how far it got, and rethrows", async () => {
    writeSeed();
    const failure = new Error('relation "Missing" does not exist');
    pg.state.failOn = (sql) => (sql === "-- then c" ? failure : undefined);

    await expect(
      loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir }),
    ).rejects.toBe(failure);

    expect(pg.state.clients[0]!.queries).toEqual(["-- first a", "-- then c"]);
    expect(err).toEqual([
      "[seed-ecs] Partial seed: loaded 1 of 3 file(s) (00-a.sql); failed at 01-c.sql; " +
        "not run: 02-b.sql. Fix the cause and run the whole seed again; it starts by truncating.\n",
    ]);
    expect(out).not.toContain("[seed-ecs] Completed 3 file(s)\n");
  });

  it("closes the connection when a file fails", async () => {
    writeSeed();
    pg.state.failOn = () => new Error("syntax error");
    await expect(
      loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir }),
    ).rejects.toThrow("syntax error");
    expect(pg.state.clients[0]!.ended).toBe(true);
  });

  it("closes the connection when connecting fails", async () => {
    writeSeed();
    pg.state.connectError = new Error("password authentication failed");
    await expect(
      loadSeed({ databaseUrl: URL_WITH_DB, seedDir: dir }),
    ).rejects.toThrow("password authentication failed");
    expect(pg.state.clients[0]!.queries).toEqual([]);
    expect(pg.state.clients[0]!.ended).toBe(true);
  });

  it("refuses a URL that names no database before connecting", async () => {
    writeSeed();
    await expect(
      loadSeed({
        databaseUrl: "postgresql://ztdecoder:secret@localhost:5439",
        seedDir: dir,
      }),
    ).rejects.toThrow(/names no database/);
    expect(pg.state.clients).toHaveLength(0);
  });
});

describe("assertNamesDatabase", () => {
  it("accepts a URL that names a database", () => {
    expect(() => assertNamesDatabase(URL_WITH_DB)).not.toThrow();
    expect(() =>
      assertNamesDatabase(`${URL_WITH_DB}?sslmode=verify-full`),
    ).not.toThrow();
  });

  // pg would connect to a database named after the role, or to PGDATABASE, and seed it.
  it("refuses a URL with no database, rather than letting pg pick one", () => {
    for (const url of [
      "postgresql://ztdecoder:secret@localhost:5439",
      "postgresql://ztdecoder:secret@localhost:5439/",
      "postgresql://ztdecoder:secret@localhost:5439/?sslmode=disable",
    ]) {
      expect(() => assertNamesDatabase(url)).toThrow(
        "DATABASE_URL names no database; refusing to seed whichever one pg would pick.",
      );
    }
  });

  it("leaves a URL Node cannot parse for pg to accept or reject", () => {
    expect(() => assertNamesDatabase("not a url")).not.toThrow();
  });
});

describe("failedLine", () => {
  it("prints the stack alone when there is no DETAIL", () => {
    const e = new Error("syntax error");
    expect(failedLine(e)).toBe(`Failed: ${e.stack}`);
    expect(failedLine(Object.assign(e, { detail: "" }))).toBe(
      `Failed: ${e.stack}`,
    );
  });

  it("prints Postgres's DETAIL after the stack", () => {
    const e = Object.assign(
      new Error("insert or update violates foreign key"),
      {
        detail: 'Key (x)=(y) is not present in table "U".',
      },
    );
    expect(failedLine(e)).toBe(
      `Failed: ${e.stack}\nDETAIL: Key (x)=(y) is not present in table "U".`,
    );
  });

  it("prints the message when the error has no stack", () => {
    const e = Object.assign(new Error("syntax error"), { detail: "near x" });
    e.stack = undefined;
    expect(failedLine(e)).toBe("Failed: syntax error\nDETAIL: near x");
  });

  it("prints anything else thrown as text", () => {
    expect(failedLine("plain")).toBe("Failed: plain");
  });
});

describe("isEntryPoint", () => {
  const moduleUrl = new URL("../seed-ecs.ts", import.meta.url).href;

  it("is true when node was started with this file", () => {
    expect(isEntryPoint(moduleUrl, ["node", SCRIPT])).toBe(true);
  });

  it("is true when node was started through a link to this file", () => {
    const link = join(dir, "seed-ecs.ts");
    symlinkSync(SCRIPT, link);
    expect(isEntryPoint(moduleUrl, ["node", link])).toBe(true);
  });

  it("is false when another script imports it", () => {
    const seed = fileURLToPath(new URL("../seed.ts", import.meta.url));
    expect(isEntryPoint(moduleUrl, ["node", seed])).toBe(false);
  });

  it("is false with no script, or one that does not exist", () => {
    expect(isEntryPoint(moduleUrl, ["node"])).toBe(false);
    expect(isEntryPoint(moduleUrl, ["node", join(dir, "missing.ts")])).toBe(
      false,
    );
  });
});

describe("the ECS seed task", () => {
  /** Load seed-ecs.ts fresh, as the script node was started with. */
  async function runAsTask(): Promise<void> {
    const argv = process.argv;
    process.argv = [argv[0]!, SCRIPT];
    vi.resetModules();
    try {
      await import("../seed-ecs");
    } finally {
      process.argv = argv;
    }
  }

  it("loads the catalog SEED_CATALOG names into DATABASE_URL", async () => {
    vi.stubEnv("SEED_CATALOG", "nist-800-53");
    vi.stubEnv("DATABASE_URL", URL_WITH_DB);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    await runAsTask();
    await vi.waitFor(() => expect(pg.state.clients[0]?.ended).toBe(true));

    expect(out[0]).toMatch(
      /^\[seed-ecs\] catalog=nist-800-53 database=scratch files=\d+\n$/,
    );
    expect(out.at(-1)).toMatch(/^\[seed-ecs\] Completed \d+ file\(s\)\n$/);
    expect(pg.state.clients[0]!.queries.length).toBe(out.length - 2);
    expect(exit).not.toHaveBeenCalled();
  });

  it("logs the Failed line the seed-failed alarm matches, and exits 1", async () => {
    vi.stubEnv("SEED_CATALOG", "nist-800-53");
    vi.stubEnv("DATABASE_URL", "");
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    await runAsTask();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(err.join("")).toMatch(
      /^\[seed-ecs\] Failed: Error: Missing required env var: DATABASE_URL\n/,
    );
    expect(pg.state.clients).toHaveLength(0);
  });

  it("prints Postgres's DETAIL after the Failed line's stack, and never the password", async () => {
    const password = "n0t-in-any-log";
    vi.stubEnv("SEED_CATALOG", "nist-800-53");
    vi.stubEnv(
      "DATABASE_URL",
      `postgresql://seeder:${password}@localhost:5439/scratch`,
    );
    pg.state.failOn = () =>
      Object.assign(new Error("duplicate key value"), {
        detail: "Key (id)=(ac-01) already exists.",
      });
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    await runAsTask();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(err.join("")).toMatch(
      /\[seed-ecs\] Failed: Error: duplicate key value\n[^]*\nDETAIL: Key \(id\)=\(ac-01\) already exists\.\n$/,
    );
    expect([...out, ...err].join("")).not.toContain(password);
  });

  it("does nothing when another script imports it", async () => {
    vi.resetModules();
    await import("../seed-ecs");
    expect(out).toEqual([]);
    expect(pg.state.clients).toHaveLength(0);
  });
});
