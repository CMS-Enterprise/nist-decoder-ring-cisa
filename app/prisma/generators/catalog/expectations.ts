/**
 * What this run must produce, declared before it produces anything.
 *
 * The failure this guards against is not a crash — it is a run that completes,
 * writes a thin or empty seed, and exits 0. Every bound below is measured against
 * the pinned catalog rather than set to 1: a floor of 1 is a non-empty check
 * wearing a floor's clothing, and it passes 2 controls out of 1,014 as readily as
 * it passes 1,014.
 *
 * This pipeline imports nothing from outside its own directory, and its
 * boundary test holds that. The Zero Trust overlay and reference-link pipelines
 * import this module rather than keeping copies of the same gate.
 */

export interface Expectation {
  name: string;
  actual: number;
  /** Minimum acceptable. */
  floor: number;
  /** Maximum acceptable, for counts whose failure mode is growth rather than loss. */
  ceiling?: number;
  /** Why this bound is where it is. Required when floor is 0, because "zero is
   *  fine here" is exactly the claim that needs a reason on the record. */
  because?: string;
}

export class ExpectationError extends Error {
  constructor(
    message: string,
    readonly failures: Expectation[],
  ) {
    super(message);
    this.name = "ExpectationError";
  }
}

function describe(e: Expectation): string {
  const bound =
    e.ceiling === undefined
      ? `at least ${e.floor}`
      : `between ${e.floor} and ${e.ceiling}`;
  return `${e.name}: got ${e.actual}, expected ${bound}${e.because ? ` — ${e.because}` : ""}`;
}

/** Render the whole set for the run log, passing and failing alike, so a reader
 *  sees what was checked rather than only what broke. */
export function formatExpectations(
  label: string,
  expectations: Expectation[],
): string {
  const lines = expectations.map((e) => {
    const bound =
      e.ceiling === undefined
        ? `(floor ${e.floor})`
        : `(floor ${e.floor}, ceiling ${e.ceiling})`;
    return `  ${e.name.padEnd(30)} ${String(e.actual).padStart(6)}  ${bound}`;
  });
  return [`Declared expectations [${label}]:`, ...lines].join("\n");
}

/** Throw unless every expectation holds. Reports all failures, never just the
 *  first — one wrong number usually means several, and fixing them one run at a
 *  time wastes the information the run already had. */
export function assertExpectations(
  label: string,
  expectations: Expectation[],
): void {
  const failures: Expectation[] = [];

  for (const e of expectations) {
    if (!Number.isFinite(e.actual)) {
      failures.push(e);
      continue;
    }
    if (e.floor === 0 && !e.because?.trim()) {
      throw new Error(
        `Expectation "${e.name}" declares a floor of 0 with no reason. ` +
          `A zero floor accepts an empty result, so it has to say why that is correct.`,
      );
    }
    if (e.ceiling !== undefined && e.ceiling < e.floor) {
      throw new Error(
        `Expectation "${e.name}" is unsatisfiable: ceiling ${e.ceiling} is below floor ${e.floor}.`,
      );
    }
    if (e.actual < e.floor) failures.push(e);
    else if (e.ceiling !== undefined && e.actual > e.ceiling) failures.push(e);
  }

  if (failures.length === 0) return;

  throw new ExpectationError(
    [
      `${failures.length} expectation(s) failed [${label}]:`,
      ...failures.map((f) => `  ${describe(f)}`),
      "",
      "Nothing was written. Fix the input or the parser, or amend the declared bound if the change is intended.",
    ].join("\n"),
    failures,
  );
}
