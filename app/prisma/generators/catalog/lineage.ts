/**
 * Control lineage: where the catalog says a withdrawn control went, and which controls one
 * release adds or drops relative to the release before it.
 *
 * Both are read from the catalogs themselves. A withdrawn control names its successors with
 * `incorporated-into` or `moved-to` links; the release delta compares two pinned catalogs by
 * OSCAL identifier, which is the approach SOURCE.md records for a changelog.
 */

import { isWithdrawn, zeroPaddedLabel } from "./oscal-parser.js";
import type {
  LineageRow,
  OscalCatalog,
  OscalControl,
  ParsedControl,
  ParsedFamily,
  ParsedPart,
} from "./types.js";

export interface WithdrawalLineage {
  rows: LineageRow[];
  /** "AC-02(10) -> ac-2_smt.k": a target naming a statement part, resolved to its control. */
  viaPart: string[];
  /** "SA-12 -> sr": a target naming a whole family, kept as the family code. */
  viaFamily: string[];
  /** "XX-00 -> id": a target naming nothing in the catalog. Each one fails the generator. */
  unresolved: string[];
  /** "XX-00 -> YY-00": a successor that is itself withdrawn. Each one fails the generator, so
   *  every chain ends one step away, at a live control, a family or nothing. */
  toWithdrawn: string[];
  /** Withdrawn controls the catalog gives no successor. */
  withoutSuccessor: string[];
  /** Withdrawn controls with more than one successor. */
  multiSuccessor: string[];
}

/** Every successor the catalog names for its withdrawn controls, as lineage rows. */
export function withdrawalLineage(
  all: ParsedControl[],
  families: ParsedFamily[],
  release: string,
): WithdrawalLineage {
  const byOscalId = new Map(all.map((c) => [c.oscalId, c.controlNumber]));
  const partOwner = new Map<string, string>();
  const walk = (parts: ParsedPart[], owner: string): void => {
    for (const p of parts) {
      partOwner.set(p.oscalPartId, owner);
      walk(p.children, owner);
    }
  };
  for (const c of all) walk(c.statementParts, c.controlNumber);
  const familyCodes = new Set(families.map((f) => f.id.toLowerCase()));
  const withdrawnNumbers = new Set(
    all.filter((c) => c.withdrawal).map((c) => c.controlNumber),
  );

  const out: WithdrawalLineage = {
    rows: [],
    viaPart: [],
    viaFamily: [],
    unresolved: [],
    toWithdrawn: [],
    withoutSuccessor: [],
    multiSuccessor: [],
  };

  for (const c of all) {
    const w = c.withdrawal;
    if (!w) continue;
    if (w.relation === null || w.targets.length === 0) {
      out.withoutSuccessor.push(c.controlNumber);
      continue;
    }
    if (w.targets.length > 1) out.multiSuccessor.push(c.controlNumber);
    const kind = w.relation === "moved-to" ? "MOVED_TO" : "INCORPORATED_INTO";
    for (const target of w.targets) {
      let related = byOscalId.get(target) ?? null;
      let part: string | null = null;
      if (related === null && partOwner.has(target)) {
        related = partOwner.get(target)!;
        part = target;
        out.viaPart.push(`${c.controlNumber} -> ${target}`);
      }
      if (related === null && familyCodes.has(target)) {
        related = target.toUpperCase();
        out.viaFamily.push(`${c.controlNumber} -> ${target}`);
      }
      if (related === null) {
        out.unresolved.push(`${c.controlNumber} -> ${target}`);
        continue;
      }
      if (withdrawnNumbers.has(related)) {
        out.toWithdrawn.push(`${c.controlNumber} -> ${related}`);
      }
      out.rows.push({
        controlNumber: c.controlNumber,
        kind,
        relatedControlNumber: related,
        relatedPartOscalId: part,
        release,
        sinceRelease: null,
      });
    }
  }
  return out;
}

/** Withdrawn enhancements whose parent the catalog does not carry. Checked with the other
 *  gates, before any file is written, so a run that would fail here writes nothing. */
export function withdrawnWithoutParent(
  withdrawn: ParsedControl[],
  all: ParsedControl[],
): string[] {
  const ids = new Set(all.map((c) => c.oscalId));
  return withdrawn
    .filter((c) => c.parentOscalId !== null && !ids.has(c.parentOscalId))
    .map((c) => `${c.controlNumber} -> ${c.parentOscalId}`);
}

/** A catalog's controls, base and enhancement, as identifier, number and status. */
export interface CatalogEntry {
  oscalId: string;
  controlNumber: string;
  withdrawn: boolean;
}

export function catalogEntries(catalog: OscalCatalog): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const visit = (controls: OscalControl[] | undefined): void => {
    for (const c of controls ?? []) {
      out.push({
        oscalId: c.id,
        controlNumber: zeroPaddedLabel(c) ?? c.id.toUpperCase(),
        withdrawn: isWithdrawn(c),
      });
      visit(c.controls);
    }
  };
  for (const g of catalog.catalog.groups ?? []) visit(g.controls);
  return out;
}

export interface ReleaseDelta {
  rows: LineageRow[];
  /** Live in the current release, absent from the previous one. */
  added: string[];
  /** In the previous release, absent from the current one. */
  dropped: string[];
  /** Live in the previous release, withdrawn in the current one. The withdrawal rows
   *  already carry these; they are counted so the delta's report is complete. */
  newlyWithdrawn: string[];
}

/** What changed between two releases, by OSCAL identifier. */
export function releaseDelta(
  previous: CatalogEntry[],
  current: CatalogEntry[],
  sinceRelease: string,
  release: string,
): ReleaseDelta {
  const before = new Map(previous.map((e) => [e.oscalId, e]));
  const after = new Map(current.map((e) => [e.oscalId, e]));
  const added = current.filter((e) => !e.withdrawn && !before.has(e.oscalId));
  const dropped = previous.filter((e) => !after.has(e.oscalId));
  const newlyWithdrawn = current.filter(
    (e) =>
      e.withdrawn && before.has(e.oscalId) && !before.get(e.oscalId)!.withdrawn,
  );
  const row = (e: CatalogEntry, kind: "ADDED" | "DROPPED"): LineageRow => ({
    controlNumber: e.controlNumber,
    kind,
    relatedControlNumber: null,
    relatedPartOscalId: null,
    release,
    sinceRelease,
  });
  return {
    rows: [
      ...added.map((e) => row(e, "ADDED")),
      ...dropped.map((e) => row(e, "DROPPED")),
    ],
    added: added.map((e) => e.controlNumber),
    dropped: dropped.map((e) => e.controlNumber),
    newlyWithdrawn: newlyWithdrawn.map((e) => e.controlNumber),
  };
}
