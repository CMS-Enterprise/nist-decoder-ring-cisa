/**
 * The NIST catalog, read into this pipeline's internal representation.
 *
 * Everything NIST-specific about reading a catalog lives here: three `label`
 * props per control of which the zero-padded one is the display form, `status`
 * props marking 182 controls withdrawn with successor links, and statement trees
 * whose prose carries parameter placeholders.
 */

import {
  renderPlaceholders,
  type ParamIndex,
  type Resolution,
} from "./parameter-resolver.js";
import type {
  OscalCatalog,
  OscalControl,
  OscalGroup,
  OscalPart,
  ParsedControl,
  ParsedFamily,
  ParsedPart,
  Withdrawal,
} from "./types.js";

/** The display control number.
 *
 *  NIST carries three `label` props: plain ("AC-2"), zero-padded ("AC-02"), and
 *  the SP 800-53A form. A last-wins prop lookup would pick whichever the
 *  serializer happened to write last, so the class is selected explicitly. The
 *  zero-padded form is also the canonical control number the Zero Trust overlay
 *  joins on. */
export function zeroPaddedLabel(control: OscalControl): string | undefined {
  return control.props?.find(
    (p) => p.name === "label" && p.class === "zero-padded",
  )?.value;
}

export function isWithdrawn(control: OscalControl): boolean {
  return (control.props ?? []).some(
    (p) => p.name === "status" && p.value === "withdrawn",
  );
}

/** Why a control was withdrawn and where its content went.
 *
 *  Keyed on the status prop rather than on a missing statement or absent links:
 *  two withdrawn controls still carry a statement, and two carry no links at all. */
export function withdrawalOf(control: OscalControl): Withdrawal | undefined {
  if (!isWithdrawn(control)) return undefined;
  const links = control.links ?? [];
  const incorporated = links.filter((l) => l.rel === "incorporated-into");
  const moved = links.filter((l) => l.rel === "moved-to");
  const chosen = incorporated.length > 0 ? incorporated : moved;
  return {
    relation:
      incorporated.length > 0
        ? "incorporated-into"
        : moved.length > 0
          ? "moved-to"
          : null,
    targets: chosen.map((l) => l.href.replace(/^#/, "")),
  };
}

/** Families, from the catalog's top-level groups. */
export function parseFamilies(catalog: OscalCatalog): ParsedFamily[] {
  const groups = catalog.catalog.groups ?? [];
  if (groups.length === 0) {
    throw new Error("Catalog has no groups; nothing to read families from.");
  }
  return groups.map((g) => ({ id: g.id.toUpperCase(), name: g.title }));
}

function propValue(control: OscalControl, name: string): string | undefined {
  return control.props?.find((p) => p.name === name && p.class === undefined)
    ?.value;
}

/** Reduce a markdown link with an EXTERNAL target to its label text.
 *
 * NIST prose cites regulations as `[32 CFR 2002.14h](https://www.govinfo.gov/...)`.
 * Nothing in the rendering path parses markdown, so the whole construct reaches the
 * page as literal text; and an outward link belongs in the control's reference-links
 * section rather than buried mid-sentence, where it cannot be listed, counted or
 * checked. Keeping the label preserves what the sentence is naming.
 *
 * Internal `(#uuid)` anchors are deliberately left alone. They are intra-document
 * references rather than outward links, there are over five hundred of them, and
 * flattening those is a separate decision about how cross-references render.
 */
export function flattenExternalMarkdownLinks(
  prose: string | null,
): string | null {
  if (prose === null) return null;
  return prose.replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, "$1");
}

/** Prose of a named direct child part, e.g. "guidance". */
function partProse(
  parts: OscalPart[] | undefined,
  name: string,
): string | null {
  return parts?.find((p) => p.name === name)?.prose ?? null;
}

function buildPartTree(
  part: OscalPart,
  sortOrder: number,
  controlId: string,
  index: ParamIndex,
  log: Resolution[],
): ParsedPart | null {
  // A part with no id cannot be addressed by a foreign key, so it cannot be a row.
  if (!part.id) return null;

  const children = (part.parts ?? [])
    .map((child, i) => buildPartTree(child, i, controlId, index, log))
    .filter((c): c is ParsedPart => c !== null);

  return {
    oscalPartId: part.id,
    name: part.name,
    // Verbatim. NIST publishes "a." at the first level, "1." at the second and
    // "(a)" at the third, and those markers carry the nesting depth. Reducing them
    // to a bare letter is lossy — it maps "a." and "(a)" onto the same label. The renderer supplies no separator of its own.
    label: part.props?.find((p) => p.name === "label")?.value ?? null,
    prose: flattenExternalMarkdownLinks(
      renderPlaceholders(
        part.prose ?? null,
        index,
        { controlId, partId: part.id },
        log,
      ),
    ),
    sortOrder,
    children,
  };
}

/** The statement tree, or an empty list when the control has no statement. */
function statementParts(
  control: OscalControl,
  index: ParamIndex,
  log: Resolution[],
): ParsedPart[] {
  const statement = control.parts?.find((p) => p.name === "statement");
  if (!statement) return [];
  const root = buildPartTree(statement, 0, control.id, index, log);
  return root ? [root] : [];
}

function parseOne(
  control: OscalControl,
  group: OscalGroup,
  parentOscalId: string | null,
  baselines: ReadonlyMap<string, string[]>,
  index: ParamIndex,
  log: Resolution[],
): ParsedControl {
  const controlNumber = zeroPaddedLabel(control);
  if (!controlNumber) {
    throw new Error(
      `Control ${control.id} has no zero-padded label prop; the display number would be a guess.`,
    );
  }

  const parsed: ParsedControl = {
    controlNumber,
    controlName: control.title,
    oscalId: control.id,
    sortId: propValue(control, "sort-id") ?? control.id,
    guidance: flattenExternalMarkdownLinks(
      renderPlaceholders(
        partProse(control.parts, "guidance"),
        index,
        { controlId: control.id, partId: null },
        log,
      ),
    ),
    parentOscalId,
    familyId: group.id.toUpperCase(),
    baselineLabels: baselines.get(control.id) ?? [],
    // NIST hrefs are lower-case OSCAL ids ("#ac-3"); upper-case them so the
    // column reads the same whichever catalog filled it.
    relatedControls: (control.links ?? [])
      .filter((l) => l.rel === "related")
      .map((l) => l.href.replace(/^#/, "").toUpperCase()),
    statementParts: statementParts(control, index, log),
  };

  const withdrawal = withdrawalOf(control);
  if (withdrawal) parsed.withdrawal = withdrawal;
  return parsed;
}

/**
 * Every control in the catalog, base and enhancement, withdrawn included.
 *
 * Withdrawn controls are parsed rather than skipped so the counts reconcile
 * against the published figures and the report can list them. Which ones get
 * written is the caller's decision.
 *
 * Recurses to arbitrary depth. Rev 5 nests enhancements exactly one level under
 * their base control, but a reader that hardcoded two levels would silently drop
 * a third if a future revision introduced one.
 */
export function parseControls(
  catalog: OscalCatalog,
  baselines: ReadonlyMap<string, string[]>,
  index: ParamIndex,
): { controls: ParsedControl[]; resolutions: Resolution[] } {
  const controls: ParsedControl[] = [];
  const resolutions: Resolution[] = [];

  const visit = (
    control: OscalControl,
    group: OscalGroup,
    parentOscalId: string | null,
  ): void => {
    controls.push(
      parseOne(control, group, parentOscalId, baselines, index, resolutions),
    );
    for (const child of control.controls ?? []) visit(child, group, control.id);
  };

  for (const group of catalog.catalog.groups ?? []) {
    for (const control of group.controls ?? []) visit(control, group, null);
  }

  return { controls, resolutions };
}

/** Control ids the catalog defines, for checking profile references before parsing. */
export function catalogControlIds(catalog: OscalCatalog): Set<string> {
  const ids = new Set<string>();
  const visit = (c: OscalControl): void => {
    ids.add(c.id);
    for (const child of c.controls ?? []) visit(child);
  };
  for (const g of catalog.catalog.groups ?? []) {
    for (const c of g.controls ?? []) visit(c);
  }
  return ids;
}
