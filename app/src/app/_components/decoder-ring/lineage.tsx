"use client";

import type { ReactNode } from "react";
import { History } from "lucide-react";
import { controlNumberToOscalId } from "~/lib/control-id";
import {
  controlOrPart,
  KIND_PHRASE,
  partPath,
  type ControlLineage,
} from "./lineage-text";

export {
  controlOrPart,
  lineageLines,
  partPath,
  type ControlLineage,
  type LineageKind,
} from "./lineage-text";

/**
 * A control's place in the catalog's history, as getControlById serves it: where a
 * withdrawn control's content went, which withdrawn controls a live one took in, and the
 * release that added a control new in this one. The vocabulary is the catalog's own, so
 * none of it takes a product slot.
 */

/** Items joined as a sentence lists them: "A", "A and B", "A, B and C". */
function joinAsSentence(items: ReactNode[]): ReactNode[] {
  return items.flatMap((item, i) => {
    if (i === 0) return [item];
    return [i === items.length - 1 ? " and " : ", ", item];
  });
}

/** Opens a control, or lands on one item of its statement. */
export type OpenPart = (controlOscalId: string, part: string) => void;

/** A control number that opens the control when it can, and reads as text when it cannot.
 *  One that names an item lands on that item when the caller can show it. */
export function ControlRef({
  controlNumber,
  part = null,
  onOpenControl,
  onOpenPart,
}: {
  controlNumber: string;
  part?: string | null;
  onOpenControl?: (oscalId: string) => void;
  onOpenPart?: OpenPart;
}) {
  const oscalId = controlNumberToOscalId(controlNumber);
  const text = controlOrPart(controlNumber, part);
  if (!oscalId || !onOpenControl) {
    return <span className="font-medium">{text}</span>;
  }
  return (
    <button
      type="button"
      onClick={() =>
        part && onOpenPart ? onOpenPart(oscalId, part) : onOpenControl(oscalId)
      }
      className="text-accent hover:text-accent-strong font-medium hover:underline"
    >
      {text}
    </button>
  );
}

function refs(
  entries: ControlLineage["incorporates"],
  onOpenControl?: (oscalId: string) => void,
): ReactNode[] {
  return entries.map((e) => (
    <span key={e.controlNumber}>
      <ControlRef
        controlNumber={e.controlNumber}
        onOpenControl={onOpenControl}
      />
      {e.part && (
        <span className="text-ink-muted"> (item {partPath(e.part)})</span>
      )}
    </span>
  ));
}

/** The header chip: "Withdrawn" on a withdrawn control, "New in <release>" on an added one. */
export function LineageChip({
  catalogStatus,
  lineage,
}: {
  catalogStatus?: "live" | "withdrawn";
  lineage?: ControlLineage | null;
}) {
  if (catalogStatus === "withdrawn") {
    return (
      <span className="border-border-strong bg-surface-muted text-ink-muted rounded-full border px-2 py-0.5 text-xs font-semibold">
        Withdrawn
      </span>
    );
  }
  const added = lineage?.addedIn;
  if (!added) return null;
  return (
    <span
      title={
        added.sinceRelease ? `Not in release ${added.sinceRelease}` : undefined
      }
      className="border-success bg-success-subtle text-success rounded-full border px-2 py-0.5 text-xs font-semibold"
    >
      New in {added.release}
    </span>
  );
}

/**
 * What a withdrawn control shows in place of its statement, on one line: that it was
 * withdrawn, and where its content went. Nothing in it is particular to one catalog, so any
 * catalog that marks a control withdrawn lands here, whatever its data says about successors:
 * the successors themselves (a whole family reads as that family, and opens it when the caller can), that
 * the catalog names none, or, when the catalog's data records no lineage at all, that the
 * successors are not recorded. The last two differ the way absent at source differs from
 * never ingested.
 */
export function WithdrawnNotice({
  lineage,
  onOpenControl,
  onOpenPart,
  onOpenFamily,
}: {
  lineage?: ControlLineage | null;
  onOpenControl?: (oscalId: string) => void;
  onOpenPart?: OpenPart;
  /** Ends a chain at a successor that is a whole family: the layer cake, filtered to it. */
  onOpenFamily?: (familyCode: string) => void;
}) {
  const successors = lineage?.successors ?? [];
  const clauses = (["incorporated-into", "moved-to"] as const)
    .map((kind) => successors.filter((s) => s.kind === kind))
    .filter((group) => group.length > 0)
    .map((group, i) => {
      const phrase = KIND_PHRASE[group[0]!.kind];
      return (
        <span key={group[0]!.kind}>
          {i === 0 ? phrase[0]!.toUpperCase() + phrase.slice(1) : `; ${phrase}`}{" "}
          {joinAsSentence(
            group.map((s) =>
              s.family ? (
                <span key={s.controlNumber}>
                  the{" "}
                  {onOpenFamily ? (
                    <button
                      type="button"
                      onClick={() => onOpenFamily(s.controlNumber)}
                      className="text-accent hover:text-accent-strong font-medium hover:underline"
                    >
                      {s.controlNumber}
                    </button>
                  ) : (
                    <span className="font-medium">{s.controlNumber}</span>
                  )}{" "}
                  family
                </span>
              ) : (
                <ControlRef
                  key={s.controlNumber}
                  controlNumber={s.controlNumber}
                  part={s.part}
                  onOpenControl={onOpenControl}
                  onOpenPart={onOpenPart}
                />
              ),
            ),
          )}
        </span>
      );
    });
  return (
    <div
      data-testid="withdrawn-notice"
      className="border-border-strong bg-surface-canvas text-ink flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2 text-sm"
    >
      <span className="text-ink-muted inline-flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
        <History size={14} aria-hidden="true" /> Withdrawn
      </span>{" "}
      <span>
        {clauses.length > 0
          ? [...clauses, "."]
          : lineage
            ? "The catalog names no successor."
            : "Successors not recorded for this catalog."}
      </span>
    </div>
  );
}

/** The withdrawn controls a live control took in, each opening its own record. */
export function IncorporatedControls({
  lineage,
  onOpenControl,
}: {
  lineage?: ControlLineage | null;
  onOpenControl?: (oscalId: string) => void;
}) {
  const taken = lineage?.incorporates ?? [];
  if (taken.length === 0) return null;
  const incorporated = taken.filter((t) => t.kind === "incorporated-into");
  const moved = taken.filter((t) => t.kind === "moved-to");
  return (
    <div className="mt-6" data-testid="incorporated-controls">
      <div className="text-ink-muted mb-2 flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
        <History size={14} aria-hidden="true" /> Withdrawn Controls
      </div>
      <div className="border-border bg-surface text-ink space-y-1 rounded-lg border p-4 text-sm leading-relaxed shadow-sm">
        {incorporated.length > 0 && (
          <p>
            Incorporated here:{" "}
            {joinAsSentence(refs(incorporated, onOpenControl))}
          </p>
        )}
        {moved.length > 0 && (
          <p>Moved here: {joinAsSentence(refs(moved, onOpenControl))}</p>
        )}
      </div>
    </div>
  );
}
