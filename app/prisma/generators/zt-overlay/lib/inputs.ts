// Docs: prisma/generators/zt-overlay/README.md
/**
 * The generator's two input tables, read with their headers checked. A
 * renamed or reordered column would otherwise read as empty on every row.
 */

import { parseCsv } from "../../reference-links/lib/csv.js";
import {
  CSV_HEADER,
  type CisaRow,
  type Maturity,
  type Pillar,
} from "./cisa.js";
import { DROPS_HEADER, type Drop } from "./overlay.js";

/** The table's rows, its header checked. With `allowExtra`, columns after the
 *  known ones are accepted: a later edition of the source may add some. */
function records(
  name: string,
  text: string,
  header: readonly string[],
  allowExtra = false,
): string[][] {
  const rows = parseCsv(text);
  const found = rows[0] ?? [];
  const known = allowExtra ? found.slice(0, header.length) : found;
  if (known.join(",") !== header.join(",")) {
    throw new Error(
      `${name} must start with the header ${header.join(",")}; found ${found.join(",")}`,
    );
  }
  return rows.slice(1).map((r, i) => {
    if (r.length !== found.length) {
      throw new Error(
        `${name} line ${i + 2} has ${r.length} fields; the header has ${found.length}.`,
      );
    }
    return r;
  });
}

export function parseCisaCsv(text: string): CisaRow[] {
  const extraNames = (parseCsv(text)[0] ?? []).slice(CSV_HEADER.length);
  return records("cisa-ztmm-mapping.csv", text, CSV_HEADER, true).map((r) => ({
    sourceRow: Number(r[0]),
    controlId: r[1]!,
    pillar: r[2] as Pillar,
    function: r[3]!,
    maturity: r[4] as Maturity,
    designation: r[5]!,
    ifApplicable: r[6] === "yes",
    functionTransform: r[7]!,
    cisa: {
      controlId: r[8]!,
      pillar: r[9]!,
      function: r[10]!,
      maturity: r[11]!,
      functionCode: r[12]!,
      multiplePillars: r[13]!,
      pillarDuplicateId: r[14]!,
      multipleFunctions: r[15]!,
      functionDuplicateId: r[16]!,
      controlName: r[17]!,
      controlText: r[18]!,
      extra: Object.fromEntries(
        extraNames.map((name, i) => [name, r[CSV_HEADER.length + i] ?? ""]),
      ),
    },
  }));
}

export function parseDropsCsv(text: string): Drop[] {
  return records("intentional-drops.csv", text, DROPS_HEADER).map((r) => ({
    controlId: r[0]!,
    pillar: r[1]!,
    function: r[2]!,
    maturity: r[3]!,
    reason: r[4]!,
    decidedBy: r[5]!,
    decidedOn: r[6]!,
  }));
}
