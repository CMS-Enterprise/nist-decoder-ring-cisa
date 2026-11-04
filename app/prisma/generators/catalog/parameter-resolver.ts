/**
 * Parameter placeholders in prose.
 *
 * NIST does not assign parameter values — it declares 1,600 organization-defined
 * parameters and leaves `{{ insert: param, <id> }}` markers in the prose where a
 * value belongs. There are 3,023 of them at the pin.
 *
 * Rendering them in the publication's own bracket convention keeps the prose
 * readable without inventing values the catalog does not state. The original
 * parameter id stays recoverable from the run's report rather than from the
 * prose, which is a deliberate trade: the rendered text is for a reader, the
 * report is for a machine.
 */

import type {
  OscalCatalog,
  OscalControl,
  OscalGroup,
  OscalParam,
} from "./types.js";

export interface ParamIndexEntry {
  param: OscalParam;
  /** The control or group that declares it. */
  ownerId: string;
}

export type ParamIndex = ReadonlyMap<string, ParamIndexEntry>;

/**
 * Every parameter declared anywhere in the catalog, keyed by id.
 *
 * Catalog-wide rather than per-control because a control's prose may reference a
 * parameter declared on its parent or on the family's policy control. Parameter
 * ids are globally unique in OSCAL, so one flat index is safe; a duplicate id
 * would mean the catalog is malformed and is reported rather than last-wins.
 */
export function buildParamIndex(catalog: OscalCatalog): ParamIndex {
  const index = new Map<string, ParamIndexEntry>();
  const duplicates: string[] = [];

  const add = (param: OscalParam, ownerId: string): void => {
    if (index.has(param.id)) duplicates.push(param.id);
    index.set(param.id, { param, ownerId });
  };
  const visitControl = (control: OscalControl): void => {
    for (const p of control.params ?? []) add(p, control.id);
    for (const child of control.controls ?? []) visitControl(child);
  };
  const visitGroup = (group: OscalGroup): void => {
    for (const p of group.params ?? []) add(p, group.id);
    for (const c of group.controls ?? []) visitControl(c);
    for (const g of group.groups ?? []) visitGroup(g);
  };

  for (const g of catalog.catalog.groups ?? []) visitGroup(g);
  for (const c of catalog.catalog.controls ?? []) visitControl(c);

  if (duplicates.length > 0) {
    throw new Error(
      `Catalog declares ${duplicates.length} duplicate parameter id(s): ${[...new Set(duplicates)].sort().join(", ")}. ` +
        `Parameter ids are globally unique in OSCAL, so resolution would be order-dependent.`,
    );
  }
  return index;
}

/** Where a placeholder was, and what it became. */
export interface Resolution {
  controlId: string;
  /** The part the prose belongs to; null for control-level guidance. */
  partId: string | null;
  paramId: string;
  /** Set when the parameter is declared somewhere other than this control. */
  resolvedFrom: string | null;
  /** Null when the id matched no parameter and the marker was left in place. */
  rendered: string | null;
}

const PLACEHOLDER_RE = /\{\{\s*insert:\s*param,\s*([^\s}]+)\s*\}\}/g;

/** Depth cap for choices that themselves contain placeholders — 71 do at the pin,
 *  and the longest real chain is two nodes. The cap is a termination guarantee
 *  against a self-referential catalog, not a limit real data approaches. */
const MAX_DEPTH = 4;

function renderParam(
  entry: ParamIndexEntry,
  index: ParamIndex,
  depth: number,
): string {
  const { param } = entry;

  if (param.select) {
    const many =
      param.select["how-many"] === "one-or-more" ? " (one or more)" : "";
    const choices = (param.select.choice ?? [])
      .map((c) => substitute(c, index, depth + 1))
      .join("; ");
    return `[Selection${many}: ${choices}]`;
  }

  // Some labels already begin "organization-defined"; the publication is not
  // consistent about it, and doubling the phrase reads as a bug in our prose.
  const label = param.label ?? param.id;
  return /^organization-defined\b/i.test(label)
    ? `[Assignment: ${label}]`
    : `[Assignment: organization-defined ${label}]`;
}

/** Substitute within a nested choice. Nested substitutions are not logged; only
 *  the top-level placeholder that contained them is. */
function substitute(text: string, index: ParamIndex, depth: number): string {
  if (depth >= MAX_DEPTH) return text;
  return text.replace(PLACEHOLDER_RE, (whole, id: string) => {
    const entry = index.get(id);
    return entry ? renderParam(entry, index, depth) : whole;
  });
}

/**
 * Render every placeholder in one prose string, recording each substitution.
 *
 * Returns the prose unchanged when it carries none, so this is a cheap no-op on
 * the majority of parts.
 */
export function renderPlaceholders(
  prose: string | null,
  index: ParamIndex,
  where: { controlId: string; partId: string | null },
  log: Resolution[],
): string | null {
  if (!prose?.includes("{{")) return prose;

  return prose.replace(PLACEHOLDER_RE, (whole, id: string) => {
    const entry = index.get(id);
    const rendered = entry ? renderParam(entry, index, 0) : null;
    log.push({
      controlId: where.controlId,
      partId: where.partId,
      paramId: id,
      resolvedFrom:
        entry && entry.ownerId !== where.controlId ? entry.ownerId : null,
      rendered,
    });
    return rendered ?? whole;
  });
}
