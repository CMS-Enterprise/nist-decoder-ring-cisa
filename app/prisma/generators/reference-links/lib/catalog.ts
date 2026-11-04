/**
 * What the catalog says about its references.
 *
 * NIST cites its references through `back-matter.resources`, each with a title,
 * a citation and one URL, and every control links to what it cites with
 * `rel="reference"`. This module reads both sides and nothing else; the
 * resolution of a URL to its current location is ./resolve.ts.
 *
 * Reads the catalog through the NIST generator's wire types and its two small
 * control helpers (the zero-padded label and the withdrawn test), so a control
 * number here is the same string the generator used for the control's own row.
 *
 * Pure. Covered by catalog.test.ts.
 */

import { isWithdrawn, zeroPaddedLabel } from "../../catalog/oscal-parser.js";
import type {
  OscalCatalog,
  OscalControl,
  OscalGroup,
} from "../../catalog/types.js";

export interface ReferenceResource {
  uuid: string;
  title: string;
  citation: string | null;
  /** The URL the catalog publishes for the resource. */
  url: string;
}

/** One control citing one resource, in the order the catalog lists the citations. */
export interface ControlReference {
  controlNumber: string;
  resourceUuid: string;
  /** 1-based position among the control's reference links. */
  order: number;
}

/** A URL to probe, attributed to the resource that carries it. */
export interface CatalogUrl {
  id: string;
  source: string;
  url: string;
}

export function parseBackMatter(catalog: OscalCatalog): {
  resources: ReferenceResource[];
  /** Resources with no link at all; they can be cited but never seeded. */
  withoutLink: string[];
} {
  const resources: ReferenceResource[] = [];
  const withoutLink: string[] = [];
  for (const r of catalog.catalog["back-matter"]?.resources ?? []) {
    const href = r.rlinks?.[0]?.href;
    if (!href) {
      withoutLink.push(r.uuid);
      continue;
    }
    resources.push({
      uuid: r.uuid,
      title: r.title,
      citation: r.citation?.text ?? null,
      url: href,
    });
  }
  return { resources, withoutLink };
}

/** Every back-matter URL, one record per resource link, for the live check. */
export function extractCatalogUrls(catalog: OscalCatalog): CatalogUrl[] {
  const records: CatalogUrl[] = [];
  for (const r of catalog.catalog["back-matter"]?.resources ?? []) {
    for (const link of r.rlinks ?? []) {
      records.push({
        id: r.uuid,
        source: `catalog:${r.title}`,
        url: link.href,
      });
    }
  }
  return records;
}

function* walkControls(
  groups: OscalGroup[] | undefined,
  controls: OscalControl[] | undefined,
): Generator<OscalControl> {
  for (const c of controls ?? []) {
    yield c;
    yield* walkControls(undefined, c.controls);
  }
  for (const g of groups ?? []) {
    yield* walkControls(g.groups, g.controls);
  }
}

/**
 * The display number of every live control in the catalog, as the seed labels
 * it ("AC-02", "AC-02(01)"). A corpus authored per control validates its
 * control numbers against this rather than against a seed file, so the join to
 * `ctrl_<number>_<token>` is exact and a withdrawn control is refused.
 */
export function liveControlNumbers(catalog: OscalCatalog): Set<string> {
  const numbers = new Set<string>();
  for (const control of walkControls(
    catalog.catalog.groups,
    catalog.catalog.controls,
  )) {
    if (isWithdrawn(control)) continue;
    const number = zeroPaddedLabel(control);
    if (number) numbers.add(number);
  }
  return numbers;
}

/**
 * Every `rel="reference"` link on a live control, resolved to a resource uuid.
 * Withdrawn controls are skipped (the catalog cites no reference on any of them), and a
 * link whose target is not a known resource is returned as unresolved rather
 * than dropped.
 */
export function collectControlReferences(
  catalog: OscalCatalog,
  resources: ReferenceResource[],
): {
  references: ControlReference[];
  unresolved: { controlNumber: string; href: string }[];
  onWithdrawn: number;
  /** Controls whose label could not be read; they cannot be joined to the seed. */
  unlabeled: string[];
} {
  const known = new Set(resources.map((r) => r.uuid));
  const references: ControlReference[] = [];
  const unresolved: { controlNumber: string; href: string }[] = [];
  const unlabeled: string[] = [];
  let onWithdrawn = 0;
  for (const control of walkControls(
    catalog.catalog.groups,
    catalog.catalog.controls,
  )) {
    const links = (control.links ?? []).filter((l) => l.rel === "reference");
    if (links.length === 0) continue;
    if (isWithdrawn(control)) {
      onWithdrawn += links.length;
      continue;
    }
    const controlNumber = zeroPaddedLabel(control);
    if (!controlNumber) {
      unlabeled.push(control.id);
      continue;
    }
    const seen = new Set<string>();
    let order = 0;
    for (const link of links) {
      const uuid = link.href.startsWith("#") ? link.href.slice(1) : link.href;
      if (!known.has(uuid)) {
        unresolved.push({ controlNumber, href: link.href });
        continue;
      }
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      order += 1;
      references.push({ controlNumber, resourceUuid: uuid, order });
    }
  }
  return { references, unresolved, onWithdrawn, unlabeled };
}
