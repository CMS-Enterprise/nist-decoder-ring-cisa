/**
 * The pipeline reads the catalog through the catalog generator, resolves and
 * writes through the catalog pipeline's library, and probes through the link
 * checker, and nothing else. It must never reach into the other product's
 * generators or the Zero Trust overlay generator, and it must carry none of the
 * vocabulary those carry, because it ships in the product other federal
 * agencies build on.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ALLOWED_OUTSIDE = [
  "../catalog/",
  "../../catalog/",
  "../reference-links/lib/",
  "../../reference-links/lib/",
  "../../../scripts/check-links/",
  "../../../../scripts/check-links/",
];
const BANNED =
  /system_cms_gov|Acceptable Risk Safeguards|hva-overcapture|\bHVA\b|DR_Mapping|CMS Discussion|ars-seed-generator|zt-seed-generator|zt-overlay/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "data" && name !== "reports") out.push(...tsFiles(p));
    } else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("zt-reference-links pipeline boundary", () => {
  const files = tsFiles(ROOT).filter((f) => !f.endsWith("boundary.test.ts"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports only itself, the catalog generator, the catalog pipeline's library and the link checker", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1]!;
        if (!spec.startsWith(".")) continue;
        const inside =
          spec.startsWith("./") ||
          spec.startsWith("../lib/") ||
          spec.startsWith("../../lib/");
        const allowed =
          inside || ALLOWED_OUTSIDE.some((a) => spec.startsWith(a));
        expect(allowed, `${relative(ROOT, file)} imports ${spec}`).toBe(true);
      }
    }
  });

  it("carries none of the other product's tokens", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(
        BANNED.test(text),
        `${relative(ROOT, file)} matches the banned list`,
      ).toBe(false);
    }
  });
});
