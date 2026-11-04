/**
 * What a seed run loaded before it stopped.
 *
 * Seed files commit one at a time, so a failure leaves the files before it
 * loaded and the files after it unrun. This states that split in one line, so
 * the log of a failed run says how far it got instead of leaving it to be
 * counted from the per-file lines.
 */
export function seedProgress(files: string[], failedAt: number): string {
  const loaded = files.slice(0, failedAt);
  const notRun = files.slice(failedAt + 1);
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  return (
    `Partial seed: loaded ${loaded.length} of ${files.length} file(s) (${list(loaded)}); ` +
    `failed at ${files[failedAt]}; not run: ${list(notRun)}. ` +
    `Fix the cause and run the whole seed again; it starts by truncating.`
  );
}
