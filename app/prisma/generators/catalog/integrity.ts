/**
 * Structural invariants over the controls about to be written.
 *
 * The declared counts catch a run that emits too little. These catch a run that
 * emits the wrong *shape*: two rows claiming one control number, an enhancement
 * whose parent is not in the output, or a part id emitted twice. Each would
 * either fail at insert time on a unique or foreign-key constraint or — worse —
 * load cleanly and misreport.
 *
 * They all hold on the pinned catalog today, which is exactly when an assertion
 * is worth writing down: afterwards you are debugging instead.
 */

import type { Expectation } from "./expectations.js";
import type { ParsedControl, ParsedPart } from "./types.js";

export interface IntegrityMeasurement {
  /** Control numbers appearing on more than one control. */
  duplicateControlNumbers: string[];
  /** Enhancements whose parent is not among the controls being written. */
  unresolvedParents: string[];
  /** Part ids appearing more than once across all statement trees. */
  duplicatePartIds: string[];
  /** Controls with no statement tree at all. Informational, not a failure. */
  controlsWithoutStatement: number;
}

export function measureIntegrity(
  controls: ParsedControl[],
): IntegrityMeasurement {
  const numberCounts = new Map<string, number>();
  const oscalIds = new Set<string>();
  for (const c of controls) {
    numberCounts.set(
      c.controlNumber,
      (numberCounts.get(c.controlNumber) ?? 0) + 1,
    );
    oscalIds.add(c.oscalId);
  }

  const partCounts = new Map<string, number>();
  const walk = (parts: ParsedPart[]): void => {
    for (const p of parts) {
      partCounts.set(p.oscalPartId, (partCounts.get(p.oscalPartId) ?? 0) + 1);
      walk(p.children);
    }
  };
  for (const c of controls) walk(c.statementParts);

  return {
    duplicateControlNumbers: [...numberCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([number]) => number)
      .sort(),
    unresolvedParents: controls
      .filter((c) => c.parentOscalId !== null && !oscalIds.has(c.parentOscalId))
      .map((c) => c.controlNumber)
      .sort(),
    duplicatePartIds: [...partCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id)
      .sort(),
    controlsWithoutStatement: controls.filter(
      (c) => c.statementParts.length === 0,
    ).length,
  };
}

/**
 * The invariants as expectations, so a violation reads like every other gate
 * failure rather than as a different kind of error.
 *
 * Each is a ceiling of 0 and names its offenders, because "3 duplicate control
 * numbers" sends you looking and "AC-02, AC-03, MA-04" tells you where.
 */
export function integrityExpectations(m: IntegrityMeasurement): Expectation[] {
  const list = (xs: string[]) =>
    xs.length ? `: ${xs.slice(0, 10).join(", ")}` : "";
  return [
    {
      name: "duplicate control numbers",
      actual: m.duplicateControlNumbers.length,
      floor: 0,
      ceiling: 0,
      because: `two rows for one control number violate the (controlNumber, catalog) unique key${list(m.duplicateControlNumbers)}`,
    },
    {
      name: "enhancements with no parent",
      actual: m.unresolvedParents.length,
      floor: 0,
      ceiling: 0,
      because: `an enhancement whose parent is not written gets a null parent and drops out of the hierarchy${list(m.unresolvedParents)}`,
    },
    {
      name: "duplicate part ids",
      actual: m.duplicatePartIds.length,
      floor: 0,
      ceiling: 0,
      because: `a part id emitted twice violates the ControlPart primary key${list(m.duplicatePartIds)}`,
    },
  ];
}
