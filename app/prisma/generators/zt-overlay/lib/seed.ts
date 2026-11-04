// Docs: prisma/generators/zt-overlay/README.md
/**
 * What the overlay is checked against: the catalog seed it attaches to.
 *
 * The overlay's rows are foreign keys into controls (04), and its functions
 * resolve at read time against the guidance groups (12). Reading those two files,
 * rather than trusting the inputs, is what lets a run fail on a row the database
 * would reject or render without guidance.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The catalog revision every overlay id is scoped to. */
export const VERSION_TOKEN = "r520";
/** The catalog's system user, which the seed's createdById references. */
export const SYSTEM_USER_ID = "system_nist_gov";

export interface SeedContext {
  controlIds: Set<string>;
  /** "PILLAR|functionGroup" keys. */
  guidanceGroups: Set<string>;
}

// The same row shape scripts/check-seed-sql.py reads from 12: id, pillar,
// function, functionGroup, base.
const GUIDANCE_RE =
  /'((?:[^']|'')*)',\s*'([A-Z_]+)'::"ZTPillar",\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',/g;

export function guidanceGroupsOf(sql: string): Set<string> {
  const groups = new Set<string>();
  for (const m of sql.matchAll(GUIDANCE_RE)) {
    groups.add(groupKey(m[2]!, m[4]!.replace(/''/g, "'")));
  }
  return groups;
}

export function groupKey(pillar: string, functionGroup: string): string {
  return `${pillar}|${functionGroup}`;
}

export function loadSeedContext(seedDir: string): SeedContext {
  const read = (f: string) => readFileSync(join(seedDir, f), "utf8");
  const controlIds = new Set(
    [...read("04-controls.sql").matchAll(/'(ctrl_[^']+)'/g)].map((m) => m[1]!),
  );
  const guidanceGroups = guidanceGroupsOf(read("12-ztmm-guidance-updated.sql"));
  for (const [name, set] of [
    ["04-controls.sql", controlIds],
    ["12-ztmm-guidance-updated.sql", guidanceGroups],
  ] as const) {
    if (set.size === 0)
      throw new Error(`${name} in ${seedDir} yielded no rows.`);
  }
  return { controlIds, guidanceGroups };
}
