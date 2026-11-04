/**
 * Canonical control identifiers.
 *
 * The rule is held to the cases in fixtures.json, which the test suite runs, so
 * a change to it shows up as a changed fixture rather than as a quiet drift.
 * See README.md.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Thrown rather than returning a guess. A guessed id lands in generated SQL. */
export class ControlIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlIdentifierError";
  }
}

export interface CanonicalControl {
  /** Zero-padded display form, e.g. "AC-02(01)". Raw text for a declared malformed id. */
  controlNumber: string;
  family: string | null;
  base: number | null;
  enhancement: number | null;
  /** Names a lettered part, not a control. Carried so callers need not re-parse. */
  letter: string | null;
  /** True when the id is known-malformed at source and declared in overrides.json. */
  declaredMalformed: boolean;
}

interface MalformedEntry {
  raw: string;
  catalog: string;
  reason: string;
}
interface CollisionEntry {
  /** Canonical control number plus its statement letter — `AC-01a`, not `AC-01`. A
   *  control and its own lettered items share a control number and are not the same
   *  thing, so keying on the number alone declares far more than was intended. */
  identity: string;
  raws: string[];
  reason: string;
}
interface Overrides {
  malformed: MalformedEntry[];
  collisions: CollisionEntry[];
}

let cached: Overrides | null = null;

/** The declared-exception registry. Read once; the file is small and static. */
export function loadOverrides(): Overrides {
  if (!cached) {
    const raw = readFileSync(join(HERE, "overrides.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<Overrides>;
    cached = {
      malformed: parsed.malformed ?? [],
      collisions: parsed.collisions ?? [],
    };
  }
  return cached;
}

/** Test seam. Callers in the generators never need this. */
export function resetOverridesCache(): void {
  cached = null;
}

/**
 * Test seam. The registry is empty whenever every known defect has been fixed at
 * source, which is the desired state — so the declared-malformed path has no
 * live data to exercise and would go untested exactly when it is next needed.
 */
export function setOverridesForTest(o: Overrides): void {
  cached = o;
}

// Family is exactly two letters; base and enhancement are digits with optional
// leading zeros; a single trailing letter names a part rather than a control.
const CONTROL_RE = /^([A-Za-z]{2})-(\d{1,3})(?:\((\d{1,3})\))?([A-Za-z])?$/;

/**
 * Parse an identifier into its canonical parts, or throw.
 *
 * Accepts the padded and unpadded spellings of the same control — `AC-2(3)` and
 * `AC-02(03)` both canonicalise to `AC-02(03)`, which is what makes a join
 * between two catalogs that spell it differently actually meet.
 */
export function canonicalize(raw: string): CanonicalControl {
  const trimmed = (raw ?? "").trim();

  const declared = loadOverrides().malformed.find((m) => m.raw === trimmed);
  if (declared) {
    // Returned verbatim, never repaired. Repairing here would silently merge
    // this row with the well-formed control it duplicates, which is a data
    // decision belonging to the catalog rather than to the generator.
    process.stderr.write(
      `[control-identifier] declared malformed: ${trimmed} (${declared.catalog})\n`,
    );
    return {
      controlNumber: trimmed,
      family: null,
      base: null,
      enhancement: null,
      letter: null,
      declaredMalformed: true,
    };
  }

  const m = CONTROL_RE.exec(trimmed);
  if (!m) {
    throw new ControlIdentifierError(
      `Unrecognised control identifier: ${JSON.stringify(raw)}. ` +
        `Expected a form like AC-02 or AC-02(01), optionally with a part letter. ` +
        `If the source is known to be wrong, declare it in overrides.json.`,
    );
  }

  const [, fam, baseDigits, enhDigits, letterRaw] = m;
  const family = fam!.toUpperCase();
  const base = Number(baseDigits);
  const enhancement = enhDigits === undefined ? null : Number(enhDigits);
  const letter = letterRaw ? letterRaw.toLowerCase() : null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const controlNumber =
    enhancement === null
      ? `${family}-${pad(base)}`
      : `${family}-${pad(base)}(${pad(enhancement)})`;

  return {
    controlNumber,
    family,
    base,
    enhancement,
    letter,
    declaredMalformed: false,
  };
}

/**
 * The deterministic seed row id for a canonical control number.
 *
 * `token` scopes the id to a catalog revision — "r520" for NIST SP 800-53
 * Rev 5.2.0 — so two catalogs in one repository cannot collide.
 */
export function seedControlId(controlNumber: string, token: string): string {
  const normalized = controlNumber
    .toLowerCase()
    .replace(/[()]/g, "_")
    .replace(/\s+/g, "_");
  return `ctrl_${normalized}_${token}`;
}

/** The full identity a raw identifier denotes: the canonical control number plus
 *  its statement letter, if any — `AC-01`, `AC-01a`, `AC-02(03)a`.
 *
 *  Collisions key on this rather than on the control number alone. A control and
 *  its own lettered statement items share a control number and are not the same
 *  thing; grouping them reports every control that has lettered items as a false
 *  collision (`AC-01 <- AC-01, AC-01a, AC-01b, AC-01c`), which would keep the gate
 *  from being switched on. Declared overrides use this same spelling, so
 *  a reported collision can be pasted straight into overrides.json. */
export function controlIdentity(parsed: CanonicalControl): string {
  return `${parsed.controlNumber}${parsed.letter ?? ""}`;
}

/**
 * Fail when two different raw identifiers mean the same control.
 *
 * Silent last-wins here would drop a row and leave the count looking right, so
 * an undeclared collision stops the run. A collision that is genuinely expected
 * goes in overrides.json with its reason.
 */
export function assertNoCollisions(raws: readonly string[]): void {
  const byCanonical = new Map<string, Set<string>>();
  for (const raw of raws) {
    let canonical: string;
    try {
      canonical = controlIdentity(canonicalize(raw));
    } catch {
      continue; // canonicalize() already refuses these; not a collision question.
    }
    const set = byCanonical.get(canonical) ?? new Set<string>();
    set.add(raw.trim());
    byCanonical.set(canonical, set);
  }

  const declared = new Set(loadOverrides().collisions.map((c) => c.identity));
  const undeclared: string[] = [];
  for (const [canonical, set] of byCanonical) {
    if (set.size > 1 && !declared.has(canonical)) {
      undeclared.push(`${canonical} <- ${[...set].sort().join(", ")}`);
    }
  }

  if (undeclared.length > 0) {
    throw new ControlIdentifierError(
      `Undeclared control-identifier collisions (${undeclared.length}):\n  ` +
        undeclared.sort().join("\n  ") +
        `\nDeclare each in overrides.json with a reason, or fix the source.`,
    );
  }
}
