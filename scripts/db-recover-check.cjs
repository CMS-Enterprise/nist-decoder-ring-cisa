// The row-count check that scripts/db-recover.sh runs after a database recovery.
//
// The recovery script sends this file, with these comment lines removed, to node -e as
// the command of a one-off ECS task on the seed task definition. The image's entrypoint
// has already composed DATABASE_URL for the database that task definition names, so the
// check reads the database the way the app does, from inside the VPC. It is sent rather
// than built into the image so that it runs on whatever image is deployed: it needs only
// node, the pg driver the seed loader uses, and the seed SQL and migrations the image
// carries.
//
// It counts the rows each INSERT in the image's seed writes and the rows each of those
// tables holds, checks every migration the image carries is applied, and prints one line,
// "db-recover-check <json>". It exits 0 when everything matches and 1 when it does not. When
// it cannot run at all, the line is "db-recover-check {"error": "<why>"}" and it exits 2.
// "User" is the one table that may hold more rows than the seed writes, since sign-in adds
// users beside the seed's system user.
//
// The seed is the catalog the seed task loads: SEED_CATALOG, which the seed task definition
// sets and the overridden command inherits, names its directory under prisma/seed-sql/. The
// check refuses to guess one, as the seed loader does (prisma/catalog-dir.ts).
//
// Without DATABASE_URL it prints only what the seed writes, which is how the shell-script
// tests run it against the committed seed.
//
// Docs: docs/scripts/db-recover.md
"use strict";
const fs = require("fs");
const path = require("path");

const migrationsDir = process.env.DB_RECOVER_CHECK_MIGRATIONS_DIR || "prisma/migrations";

function seedDir() {
  if (process.env.DB_RECOVER_CHECK_SEED_DIR) return process.env.DB_RECOVER_CHECK_SEED_DIR;
  const catalog = (process.env.SEED_CATALOG || "").trim();
  if (!catalog) throw new Error("SEED_CATALOG is not set, so there is no seed to compare with");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(catalog) || catalog.includes("..")) {
    throw new Error(`SEED_CATALOG ${JSON.stringify(catalog)} is not a catalog directory name`);
  }
  return path.join("prisma", "seed-sql", catalog);
}

// Adds to `rows` the rows each INSERT INTO in `sql` writes: one per parenthesised tuple at
// the depth of its VALUES keyword, which also reads INSERT ... SELECT ... FROM (VALUES ...).
// Literals, quoted identifiers and comments are skipped whole, so prose holding a
// parenthesis, comma or semicolon never counts.
function seedRows(sql, rows) {
  let i = 0;
  let depth = 0;
  let table = null;
  let valuesAt = -1;
  let expect = "";
  let first = true;
  const fail = (what) => {
    throw new Error(`unterminated ${what} at offset ${i}`);
  };
  const skipString = (escapes) => {
    for (i++; ; i++) {
      if (i >= sql.length) fail("string literal");
      if (escapes && sql[i] === "\\") i++;
      else if (sql[i] === "'" && sql[i + 1] === "'") i++;
      else if (sql[i] === "'") break;
    }
    i++;
  };
  const word = (text) => {
    const upper = text.toUpperCase();
    if (first) {
      first = false;
      if (upper === "INSERT") expect = "INTO";
      return;
    }
    if (expect === "INTO") {
      expect = upper === "INTO" ? "TABLE" : "";
      return;
    }
    if (expect === "TABLE") {
      table = text;
      expect = "";
      return;
    }
    if (table !== null && upper === "VALUES" && valuesAt < 0) valuesAt = depth;
    else if (depth === valuesAt) valuesAt = -1;
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) fail("block comment");
      i = end + 2;
    } else if (c === "'") {
      skipString(false);
    } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) fail("dollar-quoted string");
      i = end + tag.length;
    } else if (c === '"') {
      let text = "";
      for (i++; ; i++) {
        if (i >= sql.length) fail("quoted identifier");
        if (sql[i] === '"' && sql[i + 1] === '"') {
          text += '"';
          i++;
        } else if (sql[i] === '"') break;
        else text += sql[i];
      }
      i++;
      word(text);
    } else if (/[A-Za-z0-9_]/.test(c)) {
      const text = /^[A-Za-z0-9_.$]+/.exec(sql.slice(i))[0];
      i += text.length;
      if ((text === "E" || text === "e") && sql[i] === "'") skipString(true);
      else word(text);
    } else {
      i++;
      if (c === "(") {
        if (table !== null && valuesAt === depth) rows[table] = (rows[table] || 0) + 1;
        depth++;
      } else if (c === ")") {
        depth--;
        if (valuesAt > depth) valuesAt = -1;
      } else if (c === ";") {
        depth = 0;
        table = null;
        valuesAt = -1;
        expect = "";
        first = true;
      }
    }
  }
  return rows;
}

function seedCounts() {
  const rows = {};
  const dir = seedDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no seed files in ${dir}`);
  for (const f of files) seedRows(fs.readFileSync(path.join(dir, f), "utf8"), rows);
  return rows;
}

function migrationNames() {
  return fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.existsSync(path.join(migrationsDir, d, "migration.sql")))
    .sort();
}

async function main() {
  const seed = seedCounts();
  const migrations = migrationNames();
  if (!process.env.DATABASE_URL) {
    console.log("db-recover-check " + JSON.stringify({ seed, migrations: migrations.length }));
    return 0;
  }
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    let ok = true;
    const tables = {};
    for (const [table, expected] of Object.entries(seed)) {
      const result = await client.query(`SELECT count(*)::int AS n FROM "${table.replace(/"/g, '""')}"`);
      const actual = result.rows[0].n;
      if (table === "User" ? actual < expected : actual !== expected) ok = false;
      tables[table] = { expected, actual };
    }
    const applied = await client.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    const names = new Set(applied.rows.map((r) => r.migration_name));
    const missing = migrations.filter((m) => !names.has(m));
    if (missing.length > 0) ok = false;
    const host = new URL(process.env.DATABASE_URL).hostname;
    console.log(
      "db-recover-check " +
        JSON.stringify({ host, ok, tables, migrations: { expected: migrations.length, missing } }),
    );
    return ok ? 0 : 1;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    // A failure is a result too, in the same one-line JSON shape, so the recovery script
    // reports the reason rather than a line it cannot read.
    const error = err && err.message ? err.message : String(err);
    console.log("db-recover-check " + JSON.stringify({ error }));
    process.exitCode = 2;
  },
);
