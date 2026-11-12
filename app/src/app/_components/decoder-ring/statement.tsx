"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { formatPartLabel } from "~/lib/part-label";

/**
 * The shared statement renderer.
 *
 * It walks a control's part tree and its parameters and knows nothing about which
 * catalog it is rendering. Everything catalog-specific reaches it through a named slot
 * the composing product fills, which is the boundary that keeps catalogs apart: a
 * product that fills nothing cannot render another product's vocabulary,
 * because nothing was supplied rather than because a condition said no.
 *
 * This module must not import the badge module. `__tests__/statement-imports.test.ts`
 * asserts that, because a comment is not a constraint.
 */

interface ParameterValue {
  baselines: string[]; // Baseline enum values: LOW / MODERATE / HIGH / PRIVACY
  value: string;
}

/** A control parameter with its baseline-grouped values. */
export interface ParameterNode {
  id: string;
  label: string;
  position: number;
  values: ParameterValue[];
}

/** Recursive part tree type matching the tRPC response shape */
export interface PartNode {
  id: string;
  oscalPartId: string;
  label: string | null;
  name: string;
  prose: string | null;
  sortOrder: number;
  ztCovered: boolean;
  parameters: ParameterNode[];
  children: PartNode[];
}

/**
 * Whether a piece of prose carries product-specific decoration the statement renderer must
 * not flatten into a plain span. The renderer cannot answer this itself without knowing the
 * product's markup, so the composing product supplies the answer.
 */
export type ProseDecorationCheck = (text: string) => boolean;

/** A product with no decorated prose supplies no check; nothing is ever decorated. */
const NO_DECORATION: ProseDecorationCheck = () => false;

/**
 * How a product draws one baseline token.
 *
 * `string` rather than the Prisma `Baseline` type on purpose. It serves two surfaces —
 * the enum-typed parameter values and a control's own baseline array, which carries the
 * catalog's own spelling — and a catalog with a different set of levels should need no
 * change here.
 */
export type BaselineBadgeRenderer = (baseline: string) => ReactNode;

/**
 * The default is deliberately not empty.
 *
 * `NO_DECORATION` can be inert because "this prose is not decorated" is a correct
 * answer. "This value has no baseline" is not: the data says which baseline a value
 * belongs to, so a product that fills no slot must still say so. Rendering nothing would
 * put a value on screen with its baseline invisible, which is the same pixels as a
 * rendering bug — the failure decision 3 of the ADR rejects by name. So the fallback is
 * the raw token in a neutral chip, carrying no catalog's vocabulary.
 */
/**
 * One spelling for one concept.
 *
 * The two surfaces that reach this renderer disagree at source: a parameter value carries
 * the Prisma `Baseline` enum (`LOW`, `PRIVACY`), while a control's own array is free text
 * the catalog publishes (`Low`, `Privacy`). Rendered verbatim, a control carrying both
 * shows "Low" beside "LOW" for the same thing — which is the class of inconsistency this
 * whole boundary exists to remove, arriving through the door marked "neutral default".
 *
 * Normalising here rather than at either source keeps both columns as their publishers
 * write them, and keeps the fix in the one place both spellings meet. Unmapped tokens pass
 * through untouched, so a catalog with levels nobody has taught the UI still renders
 * honestly — which is also why dropping a mapping changes no output, only what this file
 * names.
 */
const CANONICAL_BASELINE: Record<string, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  PRIVACY: "Privacy",
};

function canonicalBaseline(baseline: string): string {
  return CANONICAL_BASELINE[baseline] ?? baseline;
}

export const RAW_BASELINE_BADGE: BaselineBadgeRenderer = (baseline) => {
  const label = canonicalBaseline(baseline);
  return (
    <span
      title={label}
      className="bg-surface-muted text-ink inline-flex h-5 shrink-0 cursor-default items-center justify-center rounded px-1 text-[9px] font-bold"
    >
      {label}
    </span>
  );
};

/** How a product names one baseline token in words, wherever a baseline is named. */
export type BaselineLabel = (baseline: string) => string;

/** A product that names nothing shows the token as stored. */
export const RAW_BASELINE_LABEL: BaselineLabel = (baseline) => baseline;

/** The named slots a product fills on the statement renderer. */
export interface StatementSlots {
  isProseDecorated?: ProseDecorationCheck;
  renderBaselineBadge?: BaselineBadgeRenderer;
  /** The same names the badges use, for the surfaces that name a baseline in words. */
  baselineLabel?: BaselineLabel;
}

/** Resolved slots, threaded as one value so prop lists stay two wide as slots are added.
 *  Derived rather than declared: a slot added to `StatementSlots` and forgotten here was
 *  two interfaces to keep in step by hand. */
type Slots = Required<
  Pick<StatementSlots, "isProseDecorated" | "renderBaselineBadge">
>;

/**
 * A row of baselines. Keys are applied here rather than by the renderer, so the slot's
 * signature carries no key obligation a product could forget.
 */
export function BaselineRow({
  baselines,
  render = RAW_BASELINE_BADGE,
}: {
  baselines: string[];
  /** Omitted by a product that fills no badge slot; the neutral default then applies,
   *  so the `?? RAW_BASELINE_BADGE` that call sites used to repeat lives here instead. */
  render?: BaselineBadgeRenderer;
}) {
  return (
    <>
      {baselines.map((b) => (
        <Fragment key={b}>{render(b)}</Fragment>
      ))}
    </>
  );
}

/** Render baseline badges from the pre-grouped ControlParameterValue rows. The grouping
 *  ({LOW,MODERATE,HIGH} -> one value) now lives in the data, so this just renders each row;
 *  an undefined baseline simply has no row (no "(Not defined)" placeholder). */
function StructuredParameterBadges({
  parameters,
  render,
}: {
  parameters: ParameterNode[];
  render: BaselineBadgeRenderer;
}) {
  return (
    <div className="mt-1 space-y-0.5">
      {parameters.map((param) => (
        <div key={param.id} className="space-y-0.5">
          {param.values.map((group, i) => (
            <div key={i} className="ml-6 flex items-start gap-1.5 py-0.5">
              <span className="mt-px w-5 shrink-0" />
              <BaselineRow baselines={group.baselines} render={render} />
              <span className="text-ink-muted ml-1">{group.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Renders prose as lines: a leading "N." becomes a hanging number, everything else a
 * paragraph. Structured parameter badges are appended when the part carries parameters.
 */
function ProseBlock({
  text,
  parameters,
  render,
}: {
  text: string;
  parameters?: ParameterNode[];
  render: BaselineBadgeRenderer;
}) {
  const lines = text
    .split("\n")
    .filter((l) => l.trim() && !/^[;:.,]+$/.test(l.trim()));

  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const numMatch = /^(\d+)\.\s+(.*)/s.exec(trimmed);
        if (numMatch) {
          return (
            <div key={i} className="ml-4 flex items-start gap-2 pt-1">
              <span className="text-ink-muted mt-px shrink-0 font-mono text-xs font-semibold">
                {numMatch[1]}.
              </span>
              <span>{numMatch[2]}</span>
            </div>
          );
        }
        return (
          <p key={i} className="pt-0.5">
            {trimmed}
          </p>
        );
      })}
      {parameters && parameters.length > 0 && (
        <StructuredParameterBadges parameters={parameters} render={render} />
      )}
    </div>
  );
}

/** Recursively check if any part in the tree has ZT coverage */
export function hasAnyCoverage(parts: PartNode[]): boolean {
  return parts.some((p) => p.ztCovered || hasAnyCoverage(p.children));
}

/**
 * Classes for a statement part row; the ZT-covered case adds a teal left border.
 * Built here (not as an inline template) so the conditional classes always join with a
 * separating space and can't silently merge with the base into an invalid token like
 * "pt-2border-l-2" on reformat — that merge is exactly the regression its test guards.
 */
export function partRowClassName(
  indent: string,
  ztCovered: boolean,
  focused = false,
): string {
  const base = `${indent} flex items-start gap-2 pt-2`;
  const covered = ztCovered ? `${base} border-l-2 border-zt pl-2` : base;
  return focused
    ? `${covered} rounded bg-highlight ring-2 ring-highlight-ring`
    : covered;
}

const DEPTH_STYLES = ["", "ml-2", "ml-8", "ml-14"] as const;

export function StructuredStatement({
  parts,
  focusPartId = null,
  isProseDecorated = NO_DECORATION,
  renderBaselineBadge = RAW_BASELINE_BADGE,
}: {
  parts: PartNode[];
  /** An item to highlight and scroll to, by OSCAL part id, e.g. the one a withdrawn control's content went into. */
  focusPartId?: string | null;
} & StatementSlots) {
  const slots: Slots = { isProseDecorated, renderBaselineBadge };
  return (
    <div className="space-y-1">
      {parts.map((part) => (
        <PartItem
          key={part.id}
          part={part}
          depth={0}
          slots={slots}
          focusPartId={focusPartId}
        />
      ))}
    </div>
  );
}

function PartItem({
  part,
  depth,
  slots,
  focusPartId,
}: {
  part: PartNode;
  depth: number;
  slots: Slots;
  focusPartId: string | null;
}) {
  const indent = DEPTH_STYLES[Math.min(depth, DEPTH_STYLES.length - 1)] ?? "";
  const hasParams = part.parameters.length > 0;
  const focused = focusPartId !== null && part.oscalPartId === focusPartId;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView?.({ block: "center" });
  }, [focused]);

  if (part.name === "statement") {
    return (
      <>
        {part.prose && (
          <ProseBlock
            text={part.prose}
            parameters={hasParams ? part.parameters : undefined}
            render={slots.renderBaselineBadge}
          />
        )}
        {part.children.map((child) => (
          <PartItem
            key={child.id}
            part={child}
            depth={depth + 1}
            slots={slots}
            focusPartId={focusPartId}
          />
        ))}
      </>
    );
  }

  // Simple prose renders as a bare span: one line, no parameters, no product decoration.
  const isSimpleProse =
    part.prose != null &&
    !hasParams &&
    !part.prose.includes("\n") &&
    !slots.isProseDecorated(part.prose);

  return (
    <div
      ref={row}
      data-focused={focused || undefined}
      className={partRowClassName(indent, part.ztCovered, focused)}
    >
      {part.label ? (
        <span className="bg-surface-strong text-ink mt-px shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-bold">
          {formatPartLabel(part.label)}
        </span>
      ) : null}
      <div className="flex-1">
        {part.prose &&
          (isSimpleProse ? (
            <span>{part.prose}</span>
          ) : (
            <ProseBlock
              text={part.prose}
              parameters={hasParams ? part.parameters : undefined}
              render={slots.renderBaselineBadge}
            />
          ))}
        {part.children.length > 0 && (
          <div className="space-y-1">
            {part.children.map((child) => (
              <PartItem
                key={child.id}
                part={child}
                depth={depth + 1}
                slots={slots}
                focusPartId={focusPartId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
