/**
 * The boundary this generator holds.
 *
 * Standard's Zero Trust overlay is built from a published, NIST-keyed source and
 * shares no code with the generator it replaced or with the other catalog's seed
 * generator. Outside its own directory it may use only the shared modules named
 * below: the control-identifier rule, the CSV codec and the expectations gate.
 * Enforced here rather than by convention, because a convention holds only until
 * someone is in a hurry.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = resolve(HERE, "..");
const PRISMA = resolve(PIPELINE_ROOT, "..");

/** The shared modules this pipeline may import from outside its directory. */
const SHARED = [
  "shared/control-identifier/canonical.ts",
  "reference-links/lib/csv.ts",
  "catalog/expectations.ts",
].map((p) => resolve(PRISMA, p));

function files(dir: string, pick: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") out.push(...files(full, pick));
    } else if (pick(name)) {
      out.push(full);
    }
  }
  return out;
}

const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function specifiersIn(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(SPECIFIER_RE)]
    .map((m) => (m[1] ?? m[2])!)
    .filter(Boolean);
}

describe("zt overlay pipeline boundary", () => {
  const sources = files(PIPELINE_ROOT, (n) => n.endsWith(".ts"));

  it("has source files to check", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it("carries no Python", () => {
    expect(
      files(PIPELINE_ROOT, (n) => n.endsWith(".py")).map((f) =>
        relative(PIPELINE_ROOT, f),
      ),
    ).toEqual([]);
  });

  it("imports only the shared modules from outside its directory", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      for (const spec of specifiersIn(file)) {
        if (!spec.startsWith(".")) continue; // node: builtins and packages
        const target = resolve(dirname(file), spec).replace(/\.js$/, ".ts");
        if (target.startsWith(PIPELINE_ROOT + "/")) continue;
        if (!SHARED.includes(target))
          offenders.push(`${relative(PIPELINE_ROOT, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads no input from the other catalog's generator", () => {
    const banned = /ars-seed-generator|DR_Mapping|csv_to_sql_standardized/;
    const offenders: string[] = [];
    for (const file of sources) {
      if (file === fileURLToPath(import.meta.url)) continue; // this file states the ban
      for (const [i, line] of readFileSync(file, "utf8")
        .split("\n")
        .entries()) {
        if (banned.test(line))
          offenders.push(`${relative(PIPELINE_ROOT, file)}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
