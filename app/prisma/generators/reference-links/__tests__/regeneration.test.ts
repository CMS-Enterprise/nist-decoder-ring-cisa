// @vitest-environment node
/**
 * The committed seed and reports are what the build writes from the committed
 * catalog, live results and overrides.
 *
 * Runs the build into scratch directories and compares each file it writes with the
 * committed copy byte for byte. An override or live result changed without
 * rebuilding, or a seed or report edited by hand, fails here.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "../../../..");
const SCRIPT = resolve(HERE, "../build.ts");
const CORPUS = "nist-800-53";
const COMMITTED_SEED = resolve(HERE, "../../../seed-sql", CORPUS);
const COMMITTED_REPORTS = resolve(
  HERE,
  "../../../reports/reference-links",
  CORPUS,
);

const SEED = ["10-reference-links.sql"];
const REPORTS = ["redirects.md", "registry.csv"];

/** Where two files first part, so a failure names a line instead of dumping both. */
function firstDifference(generated: Buffer, committed: Buffer): string | null {
  if (generated.equals(committed)) return null;
  const a = generated.toString("utf8").split("\n");
  const b = committed.toString("utf8").split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const show = (line: string | undefined) =>
        line === undefined ? "(no line)" : JSON.stringify(line.slice(0, 200));
      return `line ${i + 1}: generated ${show(a[i])}, committed ${show(b[i])}`;
    }
  }
  return "the bytes differ but every line matches";
}

describe("reference-links regeneration", () => {
  let scratch: string;
  let seedDir: string;
  let reportsDir: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "reference-links-"));
    seedDir = join(scratch, "seed");
    reportsDir = join(scratch, "reports");
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        SCRIPT,
        "--corpus",
        CORPUS,
        "--out-dir",
        seedDir,
        "--reports-dir",
        reportsDir,
      ],
      { cwd: APP, encoding: "utf8" },
    );
    if (run.status !== 0) {
      throw new Error(
        `build.ts exited ${run.status}:\n${run.stderr}${run.stdout}`,
      );
    }
  }, 60_000);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("writes exactly the seed file and the two reports", () => {
    expect(readdirSync(seedDir).sort()).toEqual(SEED);
    expect(readdirSync(reportsDir).sort()).toEqual(REPORTS);
  });

  it.each([
    ...SEED.map((name) => ({
      name,
      dir: "seed",
      committedDir: COMMITTED_SEED,
    })),
    ...REPORTS.map((name) => ({
      name,
      dir: "reports",
      committedDir: COMMITTED_REPORTS,
    })),
  ])("$name matches the committed copy", ({ name, dir, committedDir }) => {
    const generated = join(scratch, dir, name);
    const committed = join(committedDir, name);
    expect(existsSync(generated), `${name} was not generated`).toBe(true);
    expect(existsSync(committed), `${name} is not committed`).toBe(true);
    const difference = firstDifference(
      readFileSync(generated),
      readFileSync(committed),
    );
    expect(difference, `${name} differs at ${difference}`).toBeNull();
  });
});
