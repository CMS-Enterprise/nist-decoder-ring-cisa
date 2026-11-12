/**
 * The seed loader against a real Postgres: every row the committed seed inserts
 * is in the database afterwards, and every update it makes has landed.
 *
 * Runs the same `loadSeed` that `prisma db seed` and the ECS seed task run, into
 * a database of its own on the harness's server, freshly migrated. It loads
 * twice, as running the seed again does, so the second run has to replace the
 * first rather than add to it or fail on it. The expected counts are read from
 * the seed files themselves, so the test needs no change when the catalog does.
 * A loader that skips a file, stops early or swallows an error leaves a table
 * short or fails the second load; a row that `ON CONFLICT DO NOTHING` drops
 * because another file already wrote its key leaves one short too.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { applyMigrations } from "../../src/test/db/migrate";
import { testDatabaseUrl } from "../../src/test/db/harness";
import { requestedCatalog, resolveCatalogDir, SEED_ROOT } from "../catalog-dir";
import { loadSeed } from "../seed-ecs";

const SEED_DIR = resolveCatalogDir(
  SEED_ROOT,
  requestedCatalog() ?? "nist-800-53",
);

/**
 * The committed seed files, in the order the loader must run them. Listed here
 * rather than through catalog-dir's `seedFilesIn`, which the loader itself uses:
 * a file that function dropped would drop out of the expectation too.
 */
function seedFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// --- Reading what the seed writes -------------------------------------------

type Token =
  | { kind: "string"; text: string }
  | { kind: "ident"; text: string }
  | { kind: "word"; text: string }
  | { kind: "punct"; text: string };

/**
 * Split SQL into tokens, dropping comments. A string literal is one token, so a
 * semicolon, comma or parenthesis inside prose never reads as syntax. Handles
 * `''` inside a literal, backslash escapes in `E'...'`, literals spanning lines,
 * dollar quoting and quoted identifiers.
 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`Unterminated ${what} at offset ${i}`);
  };

  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];

    if (/\s/.test(c)) {
      i++;
    } else if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) fail("block comment");
      i = end + 2;
    } else if (c === "'" || ((c === "E" || c === "e") && next === "'")) {
      const escapes = c !== "'";
      i += escapes ? 2 : 1;
      let text = "";
      for (;;) {
        if (i >= sql.length) fail("string literal");
        const ch = sql[i]!;
        if (escapes && ch === "\\") {
          text += sql.slice(i, i + 2);
          i += 2;
        } else if (ch === "'" && sql[i + 1] === "'") {
          text += "'";
          i += 2;
        } else if (ch === "'") {
          i++;
          break;
        } else {
          text += ch;
          i++;
        }
      }
      tokens.push({ kind: "string", text });
    } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))![0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) fail("dollar-quoted string");
      tokens.push({ kind: "string", text: sql.slice(i + tag.length, end) });
      i = end + tag.length;
    } else if (c === '"') {
      let text = "";
      i++;
      for (;;) {
        if (i >= sql.length) fail("quoted identifier");
        if (sql[i] === '"' && sql[i + 1] === '"') {
          text += '"';
          i += 2;
        } else if (sql[i] === '"') {
          i++;
          break;
        } else {
          text += sql[i++];
        }
      }
      tokens.push({ kind: "ident", text });
    } else if (/[A-Za-z0-9_]/.test(c)) {
      const word = /^[A-Za-z0-9_.$]+/.exec(sql.slice(i))![0];
      tokens.push({ kind: "word", text: word });
      i += word.length;
    } else {
      tokens.push({ kind: "punct", text: c });
      i++;
    }
  }
  return tokens;
}

/** The tokens of each statement, split on the semicolons outside literals. */
function statements(tokens: Token[]): Token[][] {
  const out: Token[][] = [[]];
  for (const t of tokens) {
    if (t.kind === "punct" && t.text === ";") out.push([]);
    else out.at(-1)!.push(t);
  }
  return out.filter((s) => s.length > 0);
}

/** One SQL value as text, e.g. `'IDENTITY'::"ZTPillar"`, for comparing keys. */
function render(tokens: Token[]): string {
  return tokens
    .map((t) =>
      t.kind === "string"
        ? `'${t.text}'`
        : t.kind === "ident"
          ? `"${t.text}"`
          : t.text,
    )
    .join(" ");
}

class Cursor {
  constructor(
    private readonly tokens: Token[],
    private readonly where: string,
    public at = 0,
  ) {}
  peek(offset = 0): Token | undefined {
    return this.tokens[this.at + offset];
  }
  isWord(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t?.kind === "word" && t.text.toUpperCase() === text;
  }
  isPunct(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t?.kind === "punct" && t.text === text;
  }
  word(text: string): void {
    if (!this.isWord(text)) this.unsupported(`expected ${text}`);
    this.at++;
  }
  punct(text: string): void {
    if (!this.isPunct(text)) this.unsupported(`expected "${text}"`);
    this.at++;
  }
  name(): string {
    const t = this.peek();
    if (t?.kind !== "ident" && t?.kind !== "word") this.unsupported("name");
    this.at++;
    return t.text;
  }
  /** `( a, b, c )` of plain names. */
  names(): string[] {
    this.punct("(");
    const names = [this.name()];
    while (this.isPunct(",")) {
      this.at++;
      names.push(this.name());
    }
    this.punct(")");
    return names;
  }
  /** `( expr, expr, ... )`, each expression rendered as text. */
  tuple(): string[] {
    this.punct("(");
    const values: string[] = [];
    let current: Token[] = [];
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (!t) this.unsupported("unterminated tuple");
      this.at++;
      if (t.kind === "punct" && t.text === "(") depth++;
      if (t.kind === "punct" && t.text === ")") {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && t.kind === "punct" && t.text === ",") {
        values.push(render(current));
        current = [];
      } else {
        current.push(t);
      }
    }
    values.push(render(current));
    return values;
  }
  /** `(...), (...), ...` */
  tuples(): string[][] {
    const rows = [this.tuple()];
    while (this.isPunct(",")) {
      this.at++;
      rows.push(this.tuple());
    }
    return rows;
  }
  /** Moves to the next `FROM (VALUES` outside parentheses. */
  toFromValues(): void {
    let depth = 0;
    while (this.peek()) {
      if (this.isPunct("(")) depth++;
      if (this.isPunct(")")) depth--;
      if (
        depth === 0 &&
        this.isWord("FROM") &&
        this.isPunct("(", 1) &&
        this.isWord("VALUES", 2)
      ) {
        this.at += 3;
        return;
      }
      this.at++;
    }
    this.unsupported("INSERT ... SELECT without FROM (VALUES ...)");
  }
  done(): boolean {
    return this.at >= this.tokens.length;
  }
  unsupported(why: string): never {
    throw new Error(
      `${this.where}: the row counter does not read this statement (${why}): ${render(
        this.tokens.slice(0, 12),
      )} ...`,
    );
  }
}

interface SeedEffects {
  /** Rows each table should hold: the distinct keys each INSERT writes, summed. */
  rows: Map<string, number>;
  /** For `UPDATE t SET c = <value> WHERE id = <id>`: the ids, per `t.c`. */
  updated: Map<string, { table: string; column: string; ids: Set<string> }>;
  /** Keys an INSERT lists more than once, which ON CONFLICT then drops or overwrites. */
  repeatedKeys: string[];
}

/** What the seed files write, read from their SQL. */
function seedEffects(files: Array<{ name: string; sql: string }>): SeedEffects {
  const effects: SeedEffects = {
    rows: new Map(),
    updated: new Map(),
    repeatedKeys: [],
  };

  for (const { name, sql } of files) {
    for (const stmt of statements(tokenize(sql))) {
      const c = new Cursor(stmt, name);
      if (c.isWord("SET") || c.isWord("TRUNCATE")) continue;

      if (c.isWord("UPDATE")) {
        c.word("UPDATE");
        const table = c.name();
        c.word("SET");
        const column = c.name();
        c.punct("=");
        while (!c.isWord("WHERE")) {
          if (c.done()) c.unsupported("UPDATE without WHERE");
          if (c.isWord("NULL")) c.unsupported("UPDATE to NULL");
          c.at++;
        }
        c.word("WHERE");
        if (c.name() !== "id") c.unsupported('WHERE other than "id"');
        c.punct("=");
        const id = c.peek();
        if (id?.kind !== "string") c.unsupported("id that is not a literal");
        c.at++;
        if (!c.done()) c.unsupported("more after WHERE id = ...");
        const key = `${table}.${column}`;
        const entry = effects.updated.get(key) ?? {
          table,
          column,
          ids: new Set<string>(),
        };
        entry.ids.add(id!.text);
        effects.updated.set(key, entry);
        continue;
      }

      c.word("INSERT");
      c.word("INTO");
      const table = c.name();
      const columns = c.names();
      let rows: string[][];
      const fromSelect = c.isWord("SELECT");
      if (fromSelect) {
        c.toFromValues();
        rows = c.tuples();
        c.punct(")");
        c.word("AS");
        c.name();
        c.names();
      } else {
        c.word("VALUES");
        rows = c.tuples();
      }

      let keyColumns: string[] | null = null;
      if (c.isWord("ON")) {
        c.word("ON");
        c.word("CONFLICT");
        keyColumns = c.names();
        if (fromSelect) {
          c.unsupported(
            "ON CONFLICT on INSERT ... SELECT; its keys are expressions",
          );
        }
        c.at = stmt.length;
      }
      if (!c.done()) c.unsupported("more after the rows");

      let count = rows.length;
      if (keyColumns) {
        const at = keyColumns.map((k) => {
          const i = columns.indexOf(k);
          if (i === -1) c.unsupported(`conflict column ${k} not inserted`);
          return i;
        });
        const keys = rows.map((r) => JSON.stringify(at.map((i) => r[i])));
        const distinct = new Set(keys);
        if (distinct.size !== keys.length) {
          const seen = new Set<string>();
          for (const k of keys) {
            if (seen.has(k)) effects.repeatedKeys.push(`${name} ${table} ${k}`);
            seen.add(k);
          }
        }
        count = distinct.size;
      }
      effects.rows.set(table, (effects.rows.get(table) ?? 0) + count);
    }
  }
  return effects;
}

// --- The test ----------------------------------------------------------------

const scratchName = `seed_loader_${process.pid}_${Date.now()}`;
let admin: Client;
let scratch: Client;
let runs: string[][];
/** Each load's first log line. */
const firstLines: string[] = [];
let effects: SeedEffects;

/** Runs the loader and returns the files its log says it ran, in order. */
async function load(databaseUrl: string): Promise<string[]> {
  const ran: string[] = [];
  let first: string | undefined;
  const log = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      first ??= String(chunk);
      const file = /^\[seed-ecs\] (\S+\.sql)\n$/.exec(String(chunk))?.[1];
      if (file) ran.push(file);
      return true;
    });
  try {
    await loadSeed({ databaseUrl, seedDir: SEED_DIR });
  } finally {
    log.mockRestore();
  }
  firstLines.push(first ?? "");
  return ran;
}

beforeAll(async () => {
  admin = new Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${scratchName}"`);

  const url = new URL(testDatabaseUrl());
  url.pathname = `/${scratchName}`;
  applyMigrations(url.href);
  runs = [await load(url.href), await load(url.href)];

  effects = seedEffects(
    seedFilesIn(SEED_DIR).map((name) => ({
      name,
      sql: readFileSync(join(SEED_DIR, name), "utf8"),
    })),
  );
  scratch = new Client({ connectionString: url.href });
  await scratch.connect();
});

afterAll(async () => {
  await scratch?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await admin?.end();
});

async function count(sql: string): Promise<number> {
  const { rows } = await scratch.query<{ n: string }>(sql);
  return Number(rows[0]!.n);
}

describe("the seed loader against Postgres", () => {
  it("ran every seed file, in order, into a fresh database and again over it", () => {
    const files = seedFilesIn(SEED_DIR);
    expect(runs).toEqual([files, files]);
  });

  it("named the scratch database on the first line of each load", () => {
    expect(firstLines).toHaveLength(2);
    for (const line of firstLines) {
      expect(line).toMatch(
        new RegExp(
          `^\\[seed-ecs\\] catalog=\\S+ database=${scratchName} files=\\d+\\n$`,
        ),
      );
    }
  });

  it("read rows from the seed to compare against", () => {
    expect(effects.rows.size).toBeGreaterThan(0);
    expect(effects.updated.size).toBeGreaterThan(0);
  });

  // ON CONFLICT DO NOTHING keeps the first of two rows with one key and drops the
  // other without a word, so a generator that writes a key twice loses data here.
  it("lists no key twice within one INSERT", () => {
    expect(effects.repeatedKeys).toEqual([]);
  });

  it("left every table holding exactly the rows the seed inserts", async () => {
    const actual: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const [table, n] of effects.rows) {
      expected[table] = n;
      actual[table] = await count(`SELECT count(*) AS n FROM "${table}"`);
    }
    expect(actual).toEqual(expected);
  });

  it("applied every update the seed makes", async () => {
    const actual: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const [key, { table, column, ids }] of effects.updated) {
      expected[key] = ids.size;
      actual[key] = await count(
        `SELECT count(*) AS n FROM "${table}" WHERE "${column}" IS NOT NULL`,
      );
    }
    expect(actual).toEqual(expected);
  });
});

describe("the seed reader", () => {
  it("keeps quotes, escapes, semicolons and newlines inside one literal", () => {
    const tokens = tokenize(
      "-- a comment; with a semicolon\nSELECT 'it''s; (one)', E'a\\'b',\n'two\nlines', $$x;y$$ /* c; */;",
    );
    expect(
      tokens.filter((t) => t.kind === "string").map((t) => t.text),
    ).toEqual(["it's; (one)", "a\\'b", "two\nlines", "x;y"]);
    expect(statements(tokens)).toHaveLength(1);
  });

  it("counts distinct keys and reports a key listed twice", () => {
    const e = seedEffects([
      {
        name: "x.sql",
        sql: `INSERT INTO "T" ("id", "v") VALUES ('a', 'x, y'), ('b', '('), ('a', 'z') ON CONFLICT ("id") DO NOTHING;
              INSERT INTO "L" ("k") SELECT v.k FROM (VALUES ('p'), ('p')) AS v (k);
              UPDATE "T" SET "v" = 'q' WHERE "id" = 'a';`,
      },
    ]);
    expect(Object.fromEntries(e.rows)).toEqual({ T: 2, L: 2 });
    expect(e.repeatedKeys).toEqual([`x.sql T ["'a'"]`]);
    expect(e.updated.get("T.v")?.ids).toEqual(new Set(["a"]));
  });

  it("refuses a statement it cannot read rather than miscounting it", () => {
    expect(() =>
      seedEffects([{ name: "x.sql", sql: `DELETE FROM "T";` }]),
    ).toThrow(/x.sql: the row counter does not read this statement/);
  });
});
