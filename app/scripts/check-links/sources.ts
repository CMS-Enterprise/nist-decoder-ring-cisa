/**
 * URL source collectors for the link-checker.
 *
 * Three modes, each returning a flat list of `UrlRecord` (url + owning record
 * id + source label) for the validators to consume:
 *
 *   db       — connect to DATABASE_URL via `pg.Client` (mirrors seed-ecs.ts)
 *              and collect every url-bearing column.
 *   seed-sql — OFFLINE. Parse prisma/seed-sql/<catalog>/*.sql for URL literals. No DB.
 *                SEED_CATALOG selects the catalog (default nist-800-53).
 *              This is the CI hard-gate source.
 *   api      — fetch the deployed/served tRPC API at --base and extract the
 *              ztLinks[].url values surfaced to the UI.
 *
 * Side-effectful (DB / fs / network) → coverage-excluded in vitest.config.ts.
 * The pure format validation lives in ./validate.ts and stays covered.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { Client } from "pg";
import type { AppRouter } from "~/server/api/root";
import type { UrlRecord } from "./validate.js";

// ---------------------------------------------------------------------------
// seed-sql (offline)
// ---------------------------------------------------------------------------

const SEED_CATALOG = process.env.SEED_CATALOG?.trim() ?? "nist-800-53";
const SEED_DIR = resolve(process.cwd(), "prisma/seed-sql", SEED_CATALOG);

/**
 * Match single-quoted SQL string literals. We capture every literal so we can
 * track the most-recent deterministic id literal (the first column of each
 * INSERT row, e.g. 'ztl_au-06_01__02') that precedes a URL, then attribute the
 * URL to it — this makes a failure point at the owning record, not just the
 * file. URLs are identified by the `https?://` prefix among these literals.
 *
 * The seed SQL never escapes single quotes inside a URL (URLs don't contain
 * them), so a simple `'...'` capture is safe. Scheme-less values (a bare
 * `example.gov/x`) are out of scope for seed-sql parsing by design.
 */
const SQL_STRING_LITERAL = /'([^']*)'/g;

/** A deterministic seed id literal, e.g. ztl_..., ctrl_..., part_..., param_... */
const SEED_ID_LITERAL = /^[a-z]+_[a-z0-9._-]+$/i;

/**
 * Parse a single SQL file's text for URL literals, attributing each to the
 * nearest preceding id literal. Exposed for completeness; `collectFromSeedSql`
 * walks the directory.
 */
export function extractUrlsFromSql(file: string, text: string): UrlRecord[] {
  const records: UrlRecord[] = [];
  let match: RegExpExecArray | null;
  let lastId: string | null = null;
  // Drop comment lines first. An apostrophe in a `--` comment would otherwise
  // pair with the next literal's opening quote and invert every boundary after
  // it, so a file whose header says "the catalog's" scans as having no URLs.
  const code = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  SQL_STRING_LITERAL.lastIndex = 0;
  while ((match = SQL_STRING_LITERAL.exec(code)) !== null) {
    const literal = match[1]!;
    if (/^https?:\/\//i.test(literal)) {
      records.push({
        id: lastId ?? file,
        source: `seed-sql:${file}`,
        url: literal,
      });
    } else if (SEED_ID_LITERAL.test(literal)) {
      lastId = literal;
    }
  }
  return records;
}

/**
 * The seed files to read: every `.sql` file in the catalog's folder, or only
 * those `SEED_FILES` names (comma-separated), so one hand-maintained file's
 * link list can be probed on its own. A name that is not in the folder is an
 * error rather than an empty scan, since checking nothing must not pass.
 */
export function selectSeedFiles(
  available: readonly string[],
  filter: string | undefined,
): string[] {
  const sqlFiles = available.filter((f) => f.endsWith(".sql")).sort();
  const wanted = (filter ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (wanted.length === 0) return sqlFiles;
  const missing = wanted.filter((name) => !sqlFiles.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `SEED_FILES names ${missing.join(", ")}, not in the seed folder`,
    );
  }
  return sqlFiles.filter((f) => wanted.includes(f));
}

export function collectFromSeedSql(): UrlRecord[] {
  const files = selectSeedFiles(readdirSync(SEED_DIR), process.env.SEED_FILES);

  if (files.length === 0) {
    throw new Error(`No .sql files in ${SEED_DIR}`);
  }

  const records: UrlRecord[] = [];
  for (const file of files) {
    const text = readFileSync(join(SEED_DIR, file), "utf8");
    records.push(...extractUrlsFromSql(file, text));
  }
  return records;
}

// ---------------------------------------------------------------------------
// db (pg.Client on DATABASE_URL — mirrors seed-ecs.ts)
// ---------------------------------------------------------------------------

/** Extract every http(s) URL embedded in a free-text column (referencePolicy). */
const EMBEDDED_URL = /https?:\/\/[^\s"'<>)]+/gi;

function extractEmbeddedUrls(
  id: string,
  source: string,
  text: string | null,
): UrlRecord[] {
  if (!text) return [];
  const records: UrlRecord[] = [];
  let match: RegExpExecArray | null;
  EMBEDDED_URL.lastIndex = 0;
  while ((match = EMBEDDED_URL.exec(text)) !== null) {
    records.push({ id, source, url: match[0] });
  }
  return records;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function collectFromDb(): Promise<UrlRecord[]> {
  const client = new Client({ connectionString: required("DATABASE_URL") });
  await client.connect();
  const records: UrlRecord[] = [];

  try {
    // ReferenceLink.url: each document is stored once, so its URL is unique
    const referenceLinks = await client.query<{ id: string; url: string }>(
      'SELECT "id", "url" FROM "ReferenceLink"',
    );
    for (const row of referenceLinks.rows) {
      records.push({ id: row.id, source: "ReferenceLink.url", url: row.url });
    }

    // NistLink.url
    const nistLinks = await client.query<{ id: string; url: string }>(
      'SELECT "id", "url" FROM "NistLink"',
    );
    for (const row of nistLinks.rows) {
      records.push({ id: row.id, source: "NistLink.url", url: row.url });
    }

    // DataSource.url (nullable)
    const dataSources = await client.query<{ id: string; url: string }>(
      'SELECT "id", "url" FROM "DataSource" WHERE "url" IS NOT NULL',
    );
    for (const row of dataSources.rows) {
      records.push({ id: row.id, source: "DataSource.url", url: row.url });
    }

    // NistControl.referencePolicy — free text; regex-extract embedded http(s) URLs.
    const refs = await client.query<{
      controlNumber: string;
      referencePolicy: string | null;
    }>(
      'SELECT "controlNumber", "referencePolicy" FROM "NistControl" WHERE "referencePolicy" IS NOT NULL',
    );
    for (const row of refs.rows) {
      records.push(
        ...extractEmbeddedUrls(
          row.controlNumber,
          "NistControl.referencePolicy",
          row.referencePolicy,
        ),
      );
    }

    // NistControl.discussion — free text carrying `HYPERLINK "url"` markup;
    // regex-extract the embedded http(s) URLs (same approach as referencePolicy).
    const discussions = await client.query<{
      controlNumber: string;
      discussion: string | null;
    }>(
      'SELECT "controlNumber", "discussion" FROM "NistControl" WHERE "discussion" IS NOT NULL',
    );
    for (const row of discussions.rows) {
      records.push(
        ...extractEmbeddedUrls(
          row.controlNumber,
          "NistControl.discussion",
          row.discussion,
        ),
      );
    }
  } finally {
    await client.end();
  }

  return records;
}

// ---------------------------------------------------------------------------
// api (tRPC over HTTP at --base)
// ---------------------------------------------------------------------------

/**
 * Procedure names and their input types, taken from the router itself through
 * tRPC's own `inferRouterInputs` rather than written here as free strings.
 *
 * Both mistakes this collector actually shipped are now compile errors: a
 * procedure renamed out from under it (`getAllFamilies` → `getBridgeData`), and
 * an input passed to a procedure that accepts none. Either one used to surface
 * as a 404 at request time while the run still exited 0, reporting a clean
 * gate over zero URLs. The imports are type-only, so no server module reaches
 * the script at runtime.
 */
type DecoderInputs = inferRouterInputs<AppRouter>["decoder"];
type DecoderProcedure = keyof DecoderInputs;

/**
 * tRPC v11 batch-GET envelope: a query is fetched as
 *   GET <base>/api/trpc/decoder.<proc>?batch=1&input=<urlencoded JSON>
 * where input is `{"0":{"json":<actualInput>}}` (SuperJSON wrapping). The
 * response is an array of `{ result: { data: { json: <payload> } } }`.
 *
 * For a procedure with no `.input()` schema the value sent here is inert rather
 * than correct: tRPC attaches the middleware that reads raw input only when
 * `.input()` was called, so nothing server-side parses it. That matters if one
 * of the procedures below ever gains an input schema — a real client sends
 * `undefined` as `{json:null,meta:{values:["undefined"]}}`, and without that
 * `meta` the value arrives as `null`, which `z.void()` rejects. Send the real
 * SuperJSON encoding at that point rather than relying on `input ?? null`.
 */
function buildTrpcUrl(
  base: string,
  proc: DecoderProcedure,
  input: unknown,
): string {
  const trimmed = base.replace(/\/+$/, "");
  const payload = encodeURIComponent(
    JSON.stringify({ 0: { json: input ?? null } }),
  );
  return `${trimmed}/api/trpc/decoder.${proc}?batch=1&input=${payload}`;
}

/** Unwrap the SuperJSON batch envelope and return entry 0's payload. */
function unwrapTrpc<T>(body: unknown, proc: DecoderProcedure): T {
  if (!Array.isArray(body) || body.length === 0) {
    throw new Error(`Unexpected tRPC response shape for ${proc}`);
  }
  const entry = body[0] as {
    result?: { data?: { json?: unknown } };
    error?: { json?: { message?: string } };
  };
  if (entry.error) {
    throw new Error(
      `tRPC error on ${proc}: ${entry.error.json?.message ?? "unknown"}`,
    );
  }
  const data = entry.result?.data?.json;
  if (data === undefined) {
    throw new Error(`No data in tRPC response for ${proc}`);
  }
  return data as T;
}

async function fetchTrpc<TOut, TProc extends DecoderProcedure>(
  base: string,
  proc: TProc,
  input: DecoderInputs[TProc],
): Promise<TOut> {
  const url = buildTrpcUrl(base, proc, input);
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`tRPC HTTP ${res.status} on ${proc} (${url})`);
  }
  const body: unknown = await res.json();
  return unwrapTrpc<TOut>(body, proc);
}

/**
 * Response shapes taken from the router's own output types rather than declared
 * locally. Local interfaces were cast onto the response, so a renamed field —
 * `families`, say — type-checked fine here and threw a TypeError at request
 * time. Deriving them means a payload change fails `app-check` alongside a
 * renamed procedure.
 *
 * getControlById is the only procedure that serves URL arrays: ztLinks (ReferenceLink,
 * ZT pane) and nistLinks (NistLink, control pane).
 *
 * One limit worth knowing before extending this. These inferred types describe
 * the shape a tRPC *client* sees after SuperJSON deserialization, whereas this
 * collector reads `result.data.json` from a plain fetch and never deserializes.
 * For JSON-native values the two agree, which is why it is sound here: every
 * field read below is a string. A field that SuperJSON transports — a Date, Map
 * or Set — would be typed as the rich type and arrive as its serialized form,
 * and `tsc` could not tell you. Read one of those through this script and it
 * must be deserialized first, or read as its wire type deliberately.
 */
type DecoderOutputs = inferRouterOutputs<AppRouter>["decoder"];
type ApiFamiliesResponse = DecoderOutputs["getBridgeData"];
type ApiControlDetail = DecoderOutputs["getControlById"];
/**
 * The two link arrays are not the same shape — ztLinks carries a `domain`
 * (NIST / FEDERAL / EXTERNAL), nistLinks does not. The previous hand-written
 * interface flattened them into one and hid that. `pushLinks` only ever reads
 * `url`, so it asks for exactly that and accepts both.
 */
type ApiLink = { url: string };

function pushLinks(
  records: UrlRecord[],
  id: string,
  source: string,
  links: ApiLink[] | null | undefined,
): void {
  for (const link of links ?? []) {
    records.push({ id, source, url: link.url });
  }
}

/**
 * Walk the served API: getBridgeData (for the control id list) → per-control
 * getControlById (base + enhancements). getControlById is the only procedure that
 * serves URL arrays — ztLinks (ReferenceLink) and nistLinks (NistLink) — so we validate the
 * links exactly as served to the UI. (getBridgeData and getCombinedView serve only
 * the ztMapping summary + guidance, no link arrays.)
 *
 * getBridgeData returns the full, filter-ready dataset and takes no input —
 * filtering is a client concern — so no input is passed here.
 */
export async function collectFromApi(base: string): Promise<UrlRecord[]> {
  const records: UrlRecord[] = [];

  const families = await fetchTrpc<ApiFamiliesResponse, "getBridgeData">(
    base,
    "getBridgeData",
    undefined,
  );

  const controlIds: string[] = [];
  for (const family of families.families) {
    for (const control of family.controls) {
      controlIds.push(control.id);
    }
  }

  // Per-control detail (base + enhancements). Sequential to stay gentle on the
  // deployed env; the live HTTP prober (validate side) is the concurrent path.
  for (const id of controlIds) {
    const detail = await fetchTrpc<ApiControlDetail, "getControlById">(
      base,
      "getControlById",
      { controlId: id },
    );
    pushLinks(records, detail.id, "api:getControlById.ztLinks", detail.ztLinks);
    pushLinks(
      records,
      detail.id,
      "api:getControlById.nistLinks",
      detail.nistLinks,
    );
    for (const enh of detail.enhancements ?? []) {
      pushLinks(
        records,
        enh.id,
        "api:getControlById.enhancement.ztLinks",
        enh.ztLinks,
      );
      pushLinks(
        records,
        enh.id,
        "api:getControlById.enhancement.nistLinks",
        enh.nistLinks,
      );
    }
  }

  return records;
}
