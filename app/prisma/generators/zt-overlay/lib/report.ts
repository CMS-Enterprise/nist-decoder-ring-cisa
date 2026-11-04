// Docs: prisma/generators/zt-overlay/README.md
/**
 * The tuple report: every tuple CISA maps, where it went, and what it carries.
 *
 * Written on every run, so the overlay is a file a person can sort and filter
 * rather than a number in a log. It is also the worklist for a decision: a row
 * here is copied into sources/zt-mapping/intentional-drops.csv with a reason.
 */

import { compareText } from "./order.js";
import type { Overlay, OverlayTuple } from "./overlay.js";
import { groupKey } from "./seed.js";

export const TUPLES_HEADER = [
  "control_id",
  "pillar",
  "function",
  "maturity",
  "outcome",
  "representative",
  "guidance",
  "cisa_rows",
  "designations",
  "if_applicable",
  "drop_reason",
] as const;

export interface TupleRow {
  tuple: OverlayTuple;
  outcome: "kept" | "dropped";
  representative: boolean;
  resolves: boolean;
  dropReason: string;
}

export function tupleTable(
  overlay: Overlay,
  guidanceGroups: Set<string>,
): TupleRow[] {
  const rows: TupleRow[] = [];
  for (const m of overlay.mappings) {
    for (const t of m.tuples) {
      rows.push({
        tuple: t,
        outcome: "kept",
        representative:
          t.pillar === m.pillars[0] &&
          t.function === m.function &&
          t.maturity === m.maturity,
        resolves: guidanceGroups.has(groupKey(t.pillar, t.function)),
        dropReason: "",
      });
    }
  }
  for (const { drop, was } of overlay.dropped) {
    rows.push({
      tuple: was,
      outcome: "dropped",
      representative: false,
      resolves: guidanceGroups.has(groupKey(was.pillar, was.function)),
      dropReason: drop.reason,
    });
  }
  return rows.sort((a, b) => compareText(a.tuple.controlId, b.tuple.controlId));
}

export function tupleRows(
  overlay: Overlay,
  guidanceGroups: Set<string>,
): (string | number)[][] {
  return tupleTable(overlay, guidanceGroups).map((r) => [
    r.tuple.controlId,
    r.tuple.pillar,
    r.tuple.function,
    r.tuple.maturity,
    r.outcome,
    r.representative ? "yes" : "",
    r.resolves ? "resolves" : "no guidance group",
    r.tuple.cisaRows.join(";"),
    r.tuple.designations.join(";"),
    r.tuple.ifApplicable.map((v) => (v ? "yes" : "no")).join(";"),
    r.dropReason,
  ]);
}

function count<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) m.set(key(item), (m.get(key(item)) ?? 0) + 1);
  return m;
}

/** The run's summary, printed every time. */
export function summary(
  overlay: Overlay,
  guidanceGroups: Set<string>,
  counts: { cisaRows: number; findings: number },
): string[] {
  const rows = tupleTable(overlay, guidanceGroups);
  const kept = rows.filter((r) => r.outcome === "kept");
  const byPillar = count(kept, (r) => r.tuple.pillar);
  const unresolved = kept.filter((r) => !r.resolves);
  const lines = [
    "Overlay:",
    `  inputs: ${counts.cisaRows} CISA rows`,
    `  controls: ${overlay.mappings.length}`,
    `  tuples kept: ${kept.length}; dropped by decision: ${overlay.dropped.length}`,
    `  CISA rows folded into a tuple they repeat: ${counts.cisaRows - rows.length}`,
    "  per pillar (kept tuples):",
    ...[...byPillar]
      .sort((a, b) => compareText(a[0], b[0]))
      .map(([p, n]) => `    ${p.padEnd(14)} ${n}`),
    `  tuples with no guidance group: ${unresolved.length}`,
    ...unresolved.map(
      (r) =>
        `    ${r.tuple.controlId} ${r.tuple.pillar} "${r.tuple.function}" ${r.tuple.maturity}`,
    ),
    `  findings in the CISA source: ${counts.findings} (reports/zt-overlay/cisa-findings.csv)`,
  ];
  return lines;
}
