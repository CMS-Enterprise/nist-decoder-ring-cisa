import {
  cisaLabels,
  frequencyLabel,
  NO_FREQUENCY,
  NO_PRIORITY,
  type ExportControl,
  type ExportTuple,
} from "./record";

const cisa = (t: ExportTuple | undefined) => {
  const labels = t ? cisaLabels(t) : [];
  return labels.length ? ` (${labels.join(", ")})` : "";
};

/** What Copy and the DOCX say for an SP 800-53A method the publication does not give. */
export const NO_METHOD = "none published for this control";

export interface CopyLabels {
  discussionHeading: string;
  /** Suffix on an enhancement's own reference, e.g. "enhancement-specific". */
  enhancementChip: string;
}

/** The Copy button's text for one control, from the same record the files are written from. */
export function buildCopyText(
  control: ExportControl,
  labels: CopyLabels,
): string {
  const tuples = control.zeroTrust ?? [];
  const sections = [
    `Control: ${control.id} - ${control.name}`,
    ...(control.lineage ?? []),
  ];
  if (control.baselines?.length) {
    sections.push(`Baselines: ${control.baselines.join(", ")}`);
  }
  if (control.priority !== undefined) {
    sections.push(`Priority: ${control.priority ?? NO_PRIORITY}`);
  }
  if (control.frequency?.length) {
    sections.push(
      "Frequency:",
      ...control.frequency.map(
        (f) => `  - ${frequencyLabel(f)}: ${f.value ?? NO_FREQUENCY}`,
      ),
    );
  }
  sections.push(`Description: ${control.statement?.text ?? ""}`);
  if (tuples.length > 1) {
    sections.push(
      "ZT Guidance:",
      ...tuples.map(
        (t) =>
          `  - ${t.pillar} / ${t.function} / ${t.maturity}${cisa(t)}: ${t.guidance}`,
      ),
    );
  } else {
    sections.push(
      `ZT Guidance${cisa(tuples[0])}: ${tuples[0]?.guidance ?? "N/A"}`,
    );
  }
  if (control.statement?.discussion) {
    sections.push(
      `${labels.discussionHeading}: ${control.statement.discussion}`,
    );
  }
  const assessment = control.assessment;
  if (
    assessment &&
    (assessment.objectives.length > 0 || assessment.methods.length > 0)
  ) {
    sections.push(
      "Assessment Procedures:",
      ...assessment.objectives.map((o) => `  ${o.identifier} ${o.text}`),
      ...assessment.methods.map((m) => `  ${m.method}: ${m.text ?? NO_METHOD}`),
    );
  }
  // The record already lists an enhancement's own references before its base's, each URL once.
  const references = control.references ?? [];
  if (references.length > 0) {
    sections.push(
      "References:",
      ...references.map(
        (r) =>
          `  - ${r.label}${r.scope === "enhancement" ? ` (${labels.enhancementChip.toLowerCase()})` : ""}: ${r.url}`,
      ),
    );
  }
  return sections.join("\n");
}
