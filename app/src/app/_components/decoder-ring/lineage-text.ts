/**
 * A control's lineage as plain text, for Copy and the export: the server builds files from
 * it, so it lives apart from the modal's components.
 */

export type LineageKind = "incorporated-into" | "moved-to";

export interface ControlLineage {
  /** A withdrawn control's successors. `family` marks a successor that is a whole family. */
  successors: Array<{
    controlNumber: string;
    kind: LineageKind;
    family: boolean;
    /** The item of the successor's statement the catalog names, e.g. "ac-2_smt.k"; null for the whole control. */
    part?: string | null;
    /** The successor's Zero Trust pillars; null when it carries no mapping. */
    ztPillars?: string[] | null;
  }>;
  /** The withdrawn controls whose content this control took, and the item that took it when the catalog names one. */
  incorporates: Array<{
    controlNumber: string;
    kind: LineageKind;
    part?: string | null;
  }>;
  /** Set on a control the catalog added in this release. */
  addedIn: { release: string; sinceRelease: string | null } | null;
}

export const KIND_PHRASE: Record<LineageKind, string> = {
  "incorporated-into": "incorporated into",
  "moved-to": "moved to",
};

/** An item's letter path within its control, from its OSCAL part id: "ac-2_smt.k" → "k". */
export function partPath(part: string): string {
  return part.split("_smt.")[1] ?? part;
}

/** A control, or one item of its statement, as the catalog writes it: "AC-02", "AC-02k". */
export function controlOrPart(controlNumber: string, part?: string | null) {
  return part ? `${controlNumber}${partPath(part)}` : controlNumber;
}

/** The same facts as lines of the copied text. */
export function lineageLines(
  catalogStatus: "live" | "withdrawn" | undefined,
  lineage: ControlLineage | null | undefined,
): string[] {
  const lines: string[] = [];
  if (catalogStatus === "withdrawn") {
    const successors = lineage?.successors ?? [];
    const named = successors.map((s) =>
      s.family
        ? `the ${s.controlNumber} family`
        : controlOrPart(s.controlNumber, s.part),
    );
    const kinds = new Set(successors.map((s) => KIND_PHRASE[s.kind]));
    lines.push(
      named.length > 0
        ? `Status: Withdrawn, ${[...kinds].join(" and ")} ${named.join(", ")}`
        : "Status: Withdrawn",
    );
  }
  if (lineage?.addedIn) lines.push(`New in ${lineage.addedIn.release}`);
  if (lineage && lineage.incorporates.length > 0) {
    lines.push(
      `Incorporates withdrawn: ${lineage.incorporates.map((t) => (t.part ? `${t.controlNumber} (item ${partPath(t.part)})` : t.controlNumber)).join(", ")}`,
    );
  }
  return lines;
}
