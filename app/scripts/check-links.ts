/**
 * Custom link-checker for the Decoder Ring's URL data.
 *
 * Docs: docs/scripts/check-links.md (usage, the DB->API->UI layer model, flags).
 *
 * Validates the URLs in the seed/DB data AND as served by the tRPC API, using
 * ONLY Node 24's native `fetch` — no external link-check tool (lychee etc.),
 * zero new dependencies. `pg` and `tsx` are already in the tree.
 *
 * Two source modes × two validation layers:
 *
 *   --source=seed-sql   OFFLINE parse of prisma/seed-sql/*.sql (CI hard gate)
 *   --source=db         pg.Client on DATABASE_URL — every url-bearing column
 *   --source=api        fetch the served tRPC API at --base=<url>
 *
 *   STATIC/FORMAT  always runs; HARD GATE — any failure exits non-zero.
 *   LIVE (--live)  one-byte-range GET, redirects followed, outcome classified;
 *                  REPORT-ONLY — exit 0 unless --strict. Dead and unreachable
 *                  links are failures; blocked clients and certificate-chain
 *                  errors are listed for a manual check and never fail the run.
 *
 * Run via tsx (mirrors prisma/seed-ecs.ts):
 *   tsx scripts/check-links.ts --source=seed-sql
 *   DATABASE_URL=... tsx scripts/check-links.ts --source=db --live
 *   tsx scripts/check-links.ts --source=api --base=http://localhost:3000 --live
 */

import {
  collectFromApi,
  collectFromDb,
  collectFromSeedSql,
} from "./check-links/sources.js";
import { dedupeByUrl } from "./check-links/results.js";
import { probeAll, reportFormat, reportLive } from "./check-links/report.js";
import { validateAll } from "./check-links/validate.js";
import type { UrlRecord } from "./check-links/validate.js";

type SourceMode = "db" | "seed-sql" | "api";

interface Args {
  source: SourceMode;
  base: string | null;
  live: boolean;
  strict: boolean;
  content: boolean;
}

function parseArgs(argv: string[]): Args {
  let source: SourceMode | null = null;
  let base: string | null = null;
  let live = false;
  let strict = false;
  let content = false;

  for (const arg of argv) {
    if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value !== "db" && value !== "seed-sql" && value !== "api") {
        throw new Error(
          `Invalid --source=${value} (expected db | seed-sql | api)`,
        );
      }
      source = value;
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
    } else if (arg === "--live") {
      live = true;
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--content") {
      // --content implies --live: the soft-404 body check needs a live fetch.
      content = true;
      live = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!source) {
    throw new Error("Missing required --source=db|seed-sql|api");
  }
  if (source === "api" && !base) {
    throw new Error("--source=api requires --base=<url>");
  }
  return { source, base, live, strict, content };
}

async function collect(args: Args): Promise<UrlRecord[]> {
  switch (args.source) {
    case "seed-sql":
      return collectFromSeedSql();
    case "db":
      return collectFromDb();
    case "api":
      return collectFromApi(args.base!);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  process.stdout.write(
    `[check-links] source=${args.source}${args.base ? ` base=${args.base}` : ""} live=${args.live} content=${args.content} strict=${args.strict}\n`,
  );

  const records = await collect(args);

  // ---- STATIC / FORMAT layer -------------------------------------------
  // Every format failure is a HARD gate.
  const hardFailures = validateAll(records);
  reportFormat(records, hardFailures);

  // ---- LIVE layer (report-only unless --strict) ------------------------
  let liveFailures = 0;
  let manualChecks = 0;
  if (args.live) {
    // Probe everything that is well-formed.
    const failedSet = new Set(hardFailures.map((f) => f.record));
    const probeTargets = records.filter((r) => !failedSet.has(r));
    // One request per distinct URL; every record still gets its result.
    const { distinct, expand } = dedupeByUrl(probeTargets);
    const results = expand(await probeAll(distinct, undefined, args.content));
    const live = reportLive(results);
    liveFailures = live.failures;
    manualChecks = live.manual;
  }

  // ---- Exit code -------------------------------------------------------
  // Hard format failures always fail the run. Live failures fail only under --strict.
  // A run that collected nothing fails too: for the api and db sources an empty
  // result means the source did not answer as expected, and reporting PASS over
  // zero URLs is how the api mode went unnoticed for months.
  const emptyFail =
    records.length === 0 && (args.source === "api" || args.source === "db");
  if (emptyFail) {
    process.stdout.write(
      `[check-links] collected 0 URLs from --source=${args.source}; expected at least one. ` +
        `Treating an empty result as a failure rather than a clean gate.\n` +
        `[check-links] Likeliest cause is an environment with no seed data loaded, ` +
        `not a broken collector — check that the target has been seeded before ` +
        `assuming --source=${args.source} is at fault.\n`,
    );
  }
  const hardFail = hardFailures.length > 0;
  const liveFail = args.strict && liveFailures > 0;

  process.stdout.write(
    `\n[check-links] format failures: ${hardFailures.length}` +
      (args.live ? `, live failures: ${liveFailures}` : "") +
      (args.live && manualChecks ? `, manual checks: ${manualChecks}` : "") +
      `\n`,
  );

  if (hardFail || liveFail || emptyFail) {
    process.stdout.write("[check-links] RESULT: FAIL\n");
    process.exit(1);
  }
  process.stdout.write("[check-links] RESULT: PASS\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[check-links] Failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
