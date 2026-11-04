// Docs: prisma/generators/zt-overlay/README.md
/**
 * The Zero Trust overlay: CISA's control mapping, checked and written as 09, 11
 * and 13.
 *
 * A tuple is (control, pillar, function, maturity). The overlay is the set of
 * tuples CISA maps; sheet rows that repeat a tuple fold into it, and their rows,
 * designations and If Applicable flags are kept on it. A tuple leaves the overlay
 * only through a declared drop with a reason. The reconciliation proves it: every
 * CISA row is in the output or in the drop list, or the run stops.
 *
 * CISA maps controls, not statement items, so 11 covers no item.
 */

import { seedControlId } from "../../shared/control-identifier/canonical.js";
import type { CisaRow } from "./cisa.js";
import { compareText } from "./order.js";
import {
  groupKey,
  type SeedContext,
  SYSTEM_USER_ID,
  VERSION_TOKEN,
} from "./seed.js";
import {
  compareTuples,
  MATURITY_ORDER,
  PILLAR_ORDER,
  type Tuple,
} from "./tuple.js";

export const DROPS_HEADER = [
  "control_id",
  "pillar",
  "function",
  "maturity",
  "reason",
  "decided_by",
  "decided_on",
] as const;

export interface Drop extends Tuple {
  reason: string;
  decidedBy: string;
  decidedOn: string;
}

export interface OverlayTuple extends Tuple {
  /** The CISA sheet rows this tuple comes from. */
  cisaRows: number[];
  designations: string[];
  ifApplicable: boolean[];
}

export interface Mapping {
  controlId: string;
  ctrlId: string;
  ztId: string;
  pillars: string[];
  function: string;
  maturity: string;
  tuples: OverlayTuple[];
}

export interface Overlay {
  mappings: Mapping[];
  dropped: { drop: Drop; was: OverlayTuple }[];
}

const key = (t: Tuple) =>
  JSON.stringify([t.controlId, t.pillar, t.function, t.maturity]);

/** AC-02(01) → ac-2.1; AC-02 → ac-2. The OSCAL spelling part ids are built on. */
export function oscalBase(controlId: string): string {
  const m = /^([A-Z]{2})-(\d+)(?:\((\d+)\))?$/.exec(controlId);
  if (!m)
    throw new Error(
      `Not a canonical control number: ${JSON.stringify(controlId)}`,
    );
  const base = `${m[1]!.toLowerCase()}-${Number(m[2])}`;
  return m[3] === undefined ? base : `${base}.${Number(m[3])}`;
}

export function ztIdOf(controlId: string): string {
  return `zt_${seedControlId(controlId, VERSION_TOKEN).slice("ctrl_".length)}`;
}

export function slugify(fn: string): string {
  return (
    fn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "fn"
  );
}

export function affinityId(t: Tuple): string {
  return `ztaff_${oscalBase(t.controlId)}_${t.pillar.toLowerCase()}_${slugify(t.function)}_${t.maturity.toLowerCase()}_${VERSION_TOKEN}`;
}

/** CISA's designations, strongest first: Key provides the function, Supporting
 *  enhances it, Informative directs how it is implemented. */
export const DESIGNATION_ORDER = ["Key", "Supporting", "Informative"];

/** A tuple's strongest designation, as a rank; a tuple folded from several rows
 *  takes the best of them, and one with none ranks last. */
export function designationRank(t: OverlayTuple): number {
  const ranks = t.designations
    .map((d) => DESIGNATION_ORDER.indexOf(d))
    .filter((r) => r >= 0);
  return ranks.length ? Math.min(...ranks) : DESIGNATION_ORDER.length;
}

/** The designation 13 records for a tuple, as the schema's enum value: the
 *  strongest of its rows', or null for a tuple with none. */
export function tupleDesignation(t: OverlayTuple): string | null {
  return DESIGNATION_ORDER[designationRank(t)]?.toUpperCase() ?? null;
}

/** A tuple is If Applicable only when every row it folds says so. */
export function tupleIfApplicable(t: OverlayTuple): boolean {
  return t.ifApplicable.length > 0 && t.ifApplicable.every(Boolean);
}

/**
 * The single tuple 09 shows for a control. A tuple that resolves to a guidance
 * group comes first; then the strongest designation (Key, Supporting,
 * Informative), the lowest maturity, the function name, and the model's pillar
 * order. The representative's pillar leads the control's pillar list,
 * because the read path resolves guidance by (first pillar, function).
 */
export function selectRepresentative(
  tuples: OverlayTuple[],
  guidanceGroups: Set<string>,
): { pillars: string[]; function: string; maturity: string } {
  const rank = (t: OverlayTuple) => [
    guidanceGroups.has(groupKey(t.pillar, t.function)) ? 0 : 1,
    designationRank(t),
    MATURITY_ORDER.indexOf(t.maturity),
  ];
  const best = [...tuples].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++)
      if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return (
      compareText(a.function, b.function) ||
      PILLAR_ORDER.indexOf(a.pillar) - PILLAR_ORDER.indexOf(b.pillar)
    );
  })[0]!;
  const others = [...new Set(tuples.map((t) => t.pillar))]
    .filter((p) => p !== best.pillar)
    .sort((a, b) => PILLAR_ORDER.indexOf(a) - PILLAR_ORDER.indexOf(b));
  return {
    pillars: [best.pillar, ...others],
    function: best.function,
    maturity: best.maturity,
  };
}

/** Fold CISA's rows into tuples, apply the declared drops, and check every row lands. */
export function buildOverlay(input: {
  cisa: CisaRow[];
  drops: Drop[];
  seed: SeedContext;
}): Overlay {
  const { cisa, drops, seed } = input;
  const tuples = new Map<string, OverlayTuple>();

  for (const row of cisa) {
    const t: Tuple = {
      controlId: row.controlId,
      pillar: row.pillar,
      function: row.function,
      maturity: row.maturity,
    };
    const existing = tuples.get(key(t));
    if (existing) {
      existing.cisaRows.push(row.sourceRow);
      existing.designations.push(row.designation);
      existing.ifApplicable.push(row.ifApplicable);
    } else {
      tuples.set(key(t), {
        ...t,
        cisaRows: [row.sourceRow],
        designations: [row.designation],
        ifApplicable: [row.ifApplicable],
      });
    }
  }

  const problems: string[] = [];
  const dropped: Overlay["dropped"] = [];
  const seenDrops = new Set<string>();
  for (const d of drops) {
    if (seenDrops.has(key(d))) problems.push(`drop listed twice: ${key(d)}`);
    seenDrops.add(key(d));
    if (!d.reason.trim()) problems.push(`drop without a reason: ${key(d)}`);
    const was = tuples.get(key(d));
    if (!was) {
      problems.push(`drop names a tuple CISA does not map: ${key(d)}`);
      continue;
    }
    dropped.push({ drop: d, was });
    tuples.delete(key(d));
  }

  const byControl = new Map<string, OverlayTuple[]>();
  for (const t of [...tuples.values()].sort(compareTuples)) {
    byControl.set(t.controlId, [...(byControl.get(t.controlId) ?? []), t]);
  }

  const mappings: Mapping[] = [];
  for (const [controlId, controlTuples] of [...byControl].sort((a, b) =>
    compareText(a[0], b[0]),
  )) {
    const ctrlId = seedControlId(controlId, VERSION_TOKEN);
    if (!seed.controlIds.has(ctrlId))
      problems.push(`${controlId} is not in the catalog seed`);
    mappings.push({
      controlId,
      ctrlId,
      ztId: ztIdOf(controlId),
      ...selectRepresentative(controlTuples, seed.guidanceGroups),
      tuples: controlTuples,
    });
  }

  // Ids are content-addressed; two different tuples must never share one.
  const ids = new Map<string, string>();
  for (const m of mappings) {
    for (const t of m.tuples) {
      const id = affinityId(t);
      const prev = ids.get(id);
      if (prev && prev !== key(t))
        problems.push(`affinity id ${id} names both ${prev} and ${key(t)}`);
      ids.set(id, key(t));
    }
  }

  problems.push(...reconcile({ cisa, drops, mappings }));
  if (problems.length) {
    throw new Error(
      `${problems.length} overlay problem(s); nothing was written:\n  ${problems.join("\n  ")}`,
    );
  }
  return { mappings, dropped };
}

/** Account for every CISA row in the output. Returns what is missing. */
export function reconcile(x: {
  cisa: CisaRow[];
  drops: Drop[];
  mappings: Mapping[];
}): string[] {
  const out = new Set(x.mappings.flatMap((m) => m.tuples.map(key)));
  const dropped = new Set(x.drops.map(key));
  const missing: string[] = [];
  for (const r of x.cisa) {
    const t = {
      controlId: r.controlId,
      pillar: r.pillar,
      function: r.function,
      maturity: r.maturity,
    };
    if (!out.has(key(t)) && !dropped.has(key(t)))
      missing.push(`CISA row ${r.sourceRow} lost: ${key(t)}`);
  }
  return missing;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function mappingsSql(mappings: Mapping[], provenance: string[]): string {
  const rows = mappings.map(
    (m) => `  (
    '${m.ztId}',
    '${m.ctrlId}',
    ARRAY[${m.pillars.map((p) => `'${p}'`).join(", ")}]::"ZTPillar"[],
    ${sqlString(m.function)},
    '${m.maturity}'::"ZTMaturityLevel",
    '${SYSTEM_USER_ID}',
    NOW(),
    NOW()
  )`,
  );
  return [
    "-- 09-zt-mappings.sql",
    "-- Zero Trust mappings: one row per mapped control, with a representative (pillar, function,",
    "-- maturity) chosen to resolve against a guidance group. Every tuple is in 13.",
    ...provenance.map((l) => `-- ${l}`),
    "",
    'INSERT INTO "ZeroTrustMapping" (\n  "id",\n  "nistControlId",\n  "pillars",\n  "function",\n  "maturityLevel",\n  "createdById",\n  "createdAt",\n  "updatedAt"\n)\nVALUES',
    rows.join(",\n"),
    'ON CONFLICT ("nistControlId") DO NOTHING;',
    "",
  ].join("\n");
}

/** 11 carries no rows: CISA maps controls, and names no statement item. The file
 *  stays so every catalog seeds the same set of files; an INSERT with no VALUES
 *  is a syntax error, and an empty file is a valid one. */
export function coverageSql(): string {
  return [
    "-- 11-zt-part-coverage.sql",
    "-- ZT Part Coverage: links ZeroTrustMapping rows to the statement items they cover.",
    "-- Source: sources/zt-mapping/cisa-ztmm-mapping.csv, which maps whole controls and names no",
    "--   statement item. Generated by prisma/generators/zt-overlay/generate.ts.",
    "",
    "-- No covered items.",
    "",
  ].join("\n");
}

function designationSql(t: OverlayTuple): string {
  const d = tupleDesignation(t);
  return d ? `'${d}'::"ZTDesignation"` : "NULL";
}

export function affinitySql(mappings: Mapping[], provenance: string[]): string {
  const rows = mappings.flatMap((m) =>
    m.tuples.map(
      (t) => `  (
    '${affinityId(t)}',
    '${m.ztId}',
    '${t.pillar}'::"ZTPillar",
    ${sqlString(t.function)},
    '${t.maturity}'::"ZTMaturityLevel",
    ${designationSql(t)},
    ${tupleIfApplicable(t)}
  )`,
    ),
  );
  return [
    "-- 13-zt-mapping-affinity.sql",
    "-- ZT Mapping Affinity: one row per (pillar, function, maturity) tuple a ZeroTrustMapping",
    "-- carries; these rows drive the per-tuple guidance. Runs after 09 (ztMappingId -> ZeroTrustMapping.id).",
    "-- designation and ifApplicable are CISA's for the tuple: the strongest designation of the",
    "-- rows it folds, and If Applicable only when every one of them is.",
    ...provenance.map((l) => `-- ${l}`),
    "",
    'INSERT INTO "ZTMappingAffinity" ("id", "ztMappingId", "pillar", "function", "maturity", "designation", "ifApplicable")',
    "VALUES",
    rows.join(",\n"),
    'ON CONFLICT ("ztMappingId", "pillar", "function", "maturity") DO NOTHING;',
    "",
  ].join("\n");
}
