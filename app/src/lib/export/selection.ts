import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
  type inferParserType,
} from "nuqs/server";

import { FILTER_PARSERS } from "~/app/_components/decoder-ring/queryParsers";
import { EXPORT_DATASETS, EXPORT_FIELDS } from "./record";
import { EXPORT_ENHANCEMENTS } from "./selection-schema";

/**
 * What to export, as a URL, so an export can be linked and reproduced.
 *
 * - No picks: every base control the filter bar's facets and search match; none active
 *   is the whole catalog. The facets are the diagram's own parsers and predicate.
 * - Picks: exactly those controls, base or enhancement. The facets narrowed what the
 *   reader picked from and are not applied again.
 *
 * `enhancements` says what a base control brings: `with` (the default) its enhancements
 * too, `without` none, `only` its enhancements and not itself. A picked enhancement is
 * always itself alone.
 *
 * `data` picks the datasets and `fields` the per-control details. Either left out of the
 * URL means all of them, so an export matches the modal unless the reader unticks some.
 */

export {
  EXPORT_FORMATS,
  EXPORT_ENHANCEMENTS,
  exportSelectionSchema,
  type ExportFormat,
} from "./selection-schema";

export const EXPORT_PARSERS = {
  ...FILTER_PARSERS,
  pick: parseAsArrayOf(parseAsString).withDefault([]),
  enhancements: parseAsStringEnum([...EXPORT_ENHANCEMENTS]).withDefault("with"),
  data: parseAsArrayOf(parseAsStringEnum([...EXPORT_DATASETS])).withDefault([
    ...EXPORT_DATASETS,
  ]),
  fields: parseAsArrayOf(parseAsStringEnum([...EXPORT_FIELDS])).withDefault([
    ...EXPORT_FIELDS,
  ]),
};

export type ExportSelection = inferParserType<typeof EXPORT_PARSERS>;
export const loadExportSelection = createLoader(EXPORT_PARSERS);
export const serializeExportSelection = createSerializer(EXPORT_PARSERS);

/**
 * The array parameters whose URL value lost an item to parsing. The parsers drop a value
 * they do not know, so `data=statment` would otherwise export no datasets at all.
 */
export function droppedExportValues(
  params: URLSearchParams,
  selection: ExportSelection,
): string[] {
  return Object.keys(EXPORT_PARSERS).filter((key) => {
    const raw = params.get(key);
    const parsed = selection[key as keyof ExportSelection];
    if (raw === null || !Array.isArray(parsed)) return false;
    return (raw === "" ? 0 : raw.split(",").length) !== parsed.length;
  });
}
