import type { ExportDataset, ExportField } from "./record";
import type { EXPORT_ENHANCEMENTS } from "./selection-schema";

// The export page's names for what a selection includes, shared with the files' About
// sheet and title page so both say it the same way.

export const DATASET_LABELS: Record<ExportDataset, string> = {
  statement: "Statement, parameters and discussion",
  assessment: "Assessment procedures",
  zeroTrust: "Zero Trust guidance",
  references: "References",
};
export const FIELD_LABELS: Record<ExportField, string> = {
  baselines: "Baselines",
  frequency: "Frequency",
  priority: "Priority",
  lineage: "Withdrawn status and lineage",
  related: "Related controls",
};
export const ENHANCEMENT_LABELS: Record<
  (typeof EXPORT_ENHANCEMENTS)[number],
  string
> = {
  with: "Each control with its enhancements",
  without: "Base controls only",
  only: "Only their enhancements",
};
