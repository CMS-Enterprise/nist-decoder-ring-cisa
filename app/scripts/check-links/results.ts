/**
 * Probe each distinct URL once. A seed cites the same document from many
 * records (836 rows over 158 URLs in the NIST catalog at its pin), and probing
 * every row both multiplies the run and trips rate limits that read as blocks.
 * Returns the distinct records in first-seen order and a way to expand results
 * back to every record so reporting and exit semantics see the full list.
 *
 * Pure. Covered by results.test.ts.
 */
export function dedupeByUrl<T extends { url: string }>(
  records: T[],
): {
  distinct: T[];
  expand: <R extends { record: T }>(results: R[]) => R[];
} {
  const firstByUrl = new Map<string, T>();
  for (const r of records) if (!firstByUrl.has(r.url)) firstByUrl.set(r.url, r);
  const distinct = [...firstByUrl.values()];
  return {
    distinct,
    expand: <R extends { record: T }>(results: R[]): R[] => {
      const byUrl = new Map(results.map((res) => [res.record.url, res]));
      return records.flatMap((record) => {
        const res = byUrl.get(record.url);
        return res ? [{ ...res, record }] : [];
      });
    },
  };
}
