// @vitest-environment node
/**
 * The committed seed is what this generator writes from the committed sources.
 *
 * Runs the generator offline into a scratch directory and compares each file it
 * writes with the copy under seed-sql/ byte for byte. A seed edited by hand, or a
 * source or writer changed without regenerating, fails here rather than at load.
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
const SCRIPT = resolve(HERE, "../generate-seed.ts");
const COMMITTED = resolve(HERE, "../../../seed-sql/nist-800-53");

/** Every file the generator owns; the other seed files come from other generators. */
const WRITTEN = [
  "00-cleanup.sql",
  "01-system-user.sql",
  "02-catalog-version.sql",
  "03-control-families.sql",
  "04-controls.sql",
  "05-parent-refs.sql",
  "06-control-parts.sql",
  "07-control-parameters.sql",
  "08-assessment-procedures.sql",
  "15-withdrawn-controls.sql",
  "16-control-lineage.sql",
];

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

describe("catalog seed regeneration", () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "catalog-seed-"));
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", SCRIPT, "--offline", "--out-dir", outDir],
      { cwd: APP, encoding: "utf8" },
    );
    if (run.status !== 0) {
      throw new Error(
        `generate-seed.ts exited ${run.status}:\n${run.stderr}${run.stdout}`,
      );
    }
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes exactly the files it owns", () => {
    expect(readdirSync(outDir).sort()).toEqual(WRITTEN);
  });

  it.each(WRITTEN)("%s matches the committed copy", (name) => {
    const generated = join(outDir, name);
    const committed = join(COMMITTED, name);
    expect(existsSync(generated), `${name} was not generated`).toBe(true);
    expect(existsSync(committed), `${name} is not committed`).toBe(true);
    const difference = firstDifference(
      readFileSync(generated),
      readFileSync(committed),
    );
    expect(difference, `${name} differs at ${difference}`).toBeNull();
  });
});
