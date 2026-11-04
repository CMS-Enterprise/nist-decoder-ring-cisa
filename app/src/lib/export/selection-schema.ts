import { z } from "zod";

import { FACET_KEYS } from "~/app/_components/decoder-ring/filterPredicate";
import { EXPORT_DATASETS, EXPORT_FIELDS } from "./record";

/** A base control with its enhancements, without them, or only its enhancements. */
export const EXPORT_ENHANCEMENTS = ["with", "without", "only"] as const;
export const EXPORT_FORMATS = ["xlsx", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

// The procedure's input, apart from the URL parsers so the router stays clear of ~/env.
// The tRPC endpoint is public as well, so the shape is checked again there: strict, so a
// facet the filter bar does not have is refused rather than silently ignored.
// Values a facet does not know simply match nothing. The search text is uncapped, as the
// search box is.
const values = z.array(z.string().max(64)).max(2000);
const facets = Object.fromEntries(FACET_KEYS.map((k) => [k, values])) as Record<
  (typeof FACET_KEYS)[number],
  typeof values
>;
export const exportSelectionSchema = z
  .object({
    ...facets,
    q: z.string(),
    pick: values,
    enhancements: z.enum(EXPORT_ENHANCEMENTS),
    data: z.array(z.enum(EXPORT_DATASETS)),
    fields: z.array(z.enum(EXPORT_FIELDS)),
  })
  .strict();
