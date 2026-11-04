/**
 * Baseline membership, from the four SP 800-53B profile files.
 *
 * The catalog does not say which baseline a control belongs to; the profiles do,
 * as plain include lists. At the pin: LOW 149 ids, MODERATE 287, HIGH 370,
 * PRIVACY 96, and LOW ⊂ MODERATE ⊂ HIGH.
 *
 * The load-bearing behaviour here is refusing to read a profile it does not fully
 * understand. NIST's four use `with-ids` and nothing else today, so a reader that
 * quietly skipped `matching`, `exclude-controls` or `include-all` would be correct
 * right now and wrong the moment the pin moves — and wrong *silently*, because an
 * ignored selector contributes no ids, so every "listed equals resolved" check
 * still balances while membership quietly under-counts.
 */

import type {
  OscalImport,
  OscalProfile,
  OscalSelectControlById,
} from "./types.js";

/** The four published baselines, in the order their names are emitted. */
export const BASELINE_NAMES = ["Low", "Moderate", "High", "Privacy"] as const;
export type BaselineName = (typeof BASELINE_NAMES)[number];

export interface BaselineProfile {
  name: BaselineName;
  profile: OscalProfile;
  /** For error messages — which file this came from. */
  source: string;
}

export interface BaselineMembership {
  /** OSCAL control id -> baseline names, in BASELINE_NAMES order. */
  byControl: Map<string, BaselineName[]>;
  /** Total ids listed across all four profiles. 902 at the pin. */
  listed: number;
  /** Listed ids that match no control in the catalog. Expected empty. */
  unresolved: { baseline: BaselineName; id: string }[];
}

/** Selectors this reader implements. Anything else is a hard error. */
const SUPPORTED_IMPORT_KEYS = new Set(["href", "include-controls"]);
const SUPPORTED_SELECTOR_KEYS = new Set(["with-ids"]);

function refuse(source: string, index: number, key: string): never {
  throw new Error(
    `${source}: import[${index}] uses "${key}", which this reader does not implement. ` +
      `Baseline membership would silently under-count. Implement it or move the pin back.`,
  );
}

/** Every control id an import selects, refusing anything it cannot fully read. */
function idsFromImport(
  source: string,
  index: number,
  imp: OscalImport,
): string[] {
  for (const key of Object.keys(imp)) {
    if (!SUPPORTED_IMPORT_KEYS.has(key)) refuse(source, index, key);
  }

  const includes: OscalSelectControlById[] = imp["include-controls"] ?? [];
  if (includes.length === 0) {
    throw new Error(
      `${source}: import[${index}] selects no controls. A baseline that includes nothing is not a baseline.`,
    );
  }

  const ids: string[] = [];
  for (const sel of includes) {
    for (const key of Object.keys(sel)) {
      if (!SUPPORTED_SELECTOR_KEYS.has(key)) refuse(source, index, key);
    }
    const withIds = sel["with-ids"] ?? [];
    if (withIds.length === 0) {
      throw new Error(
        `${source}: import[${index}] has an empty with-ids list.`,
      );
    }
    ids.push(...withIds);
  }
  return ids;
}

/** The control ids a profile selects, across all of its imports. */
export function profileControlIds(
  source: string,
  profile: OscalProfile,
): string[] {
  const imports = profile.profile.imports;
  if (!Array.isArray(imports) || imports.length === 0) {
    throw new Error(`${source}: profile has no imports.`);
  }
  return imports.flatMap((imp, i) => idsFromImport(source, i, imp));
}

/**
 * Baseline membership per control.
 *
 * `knownIds` is the set of control ids the catalog actually defines, so a profile
 * pointing at something absent is surfaced rather than dropped.
 */
export function baselinesFromProfiles(
  profiles: BaselineProfile[],
  knownIds: ReadonlySet<string>,
): BaselineMembership {
  const byControl = new Map<string, BaselineName[]>();
  const unresolved: BaselineMembership["unresolved"] = [];
  let listed = 0;

  // Emit in published order regardless of the order the files were loaded, so the
  // baseline array on a control is deterministic.
  const ordered = [...profiles].sort(
    (a, b) => BASELINE_NAMES.indexOf(a.name) - BASELINE_NAMES.indexOf(b.name),
  );

  for (const { name, profile, source } of ordered) {
    for (const id of profileControlIds(source, profile)) {
      listed++;
      if (!knownIds.has(id)) {
        unresolved.push({ baseline: name, id });
        continue;
      }
      const list = byControl.get(id) ?? [];
      if (!list.includes(name)) list.push(name);
      byControl.set(id, list);
    }
  }

  return { byControl, listed, unresolved };
}

/** Which baseline a profile file is, from its name or its metadata title. */
export function baselineNameFor(
  source: string,
  profile: OscalProfile,
): BaselineName {
  const hay = `${source} ${profile.profile.metadata.title}`.toUpperCase();
  const matches = BASELINE_NAMES.filter((n) => hay.includes(n.toUpperCase()));
  if (matches.length !== 1) {
    throw new Error(
      `Cannot tell which baseline ${source} is (matched: ${matches.join(", ") || "none"}). ` +
        `Expected exactly one of ${BASELINE_NAMES.join(", ")} in the file name or title.`,
    );
  }
  return matches[0]!;
}
