"use client";

import { useId, useState, type ReactNode } from "react";
import { useQueryStates } from "nuqs";
import {
  Clipboard,
  X,
  Shield,
  Lock,
  FileText,
  CheckCircle,
  Info,
  ChevronDown,
} from "lucide-react";
import type { NistControl } from "./LayerCakeVisualization";
import { api, type RouterOutputs } from "~/trpc/react";
import { product } from "~/config/product";
import {
  baseControlId,
  controlNumberToOscalId,
  isControlId,
  oscalIdToControlNumber,
  splitControlId,
} from "~/lib/control-id";
import {
  hasAnyCoverage,
  StructuredStatement,
  type PartNode,
  RAW_BASELINE_LABEL,
} from "./statement";
import { STANDARD_SLOTS } from "~/config/product-slots";
import { parseAsEnhancement, parseAsItem } from "./filterParams";
import { partPath } from "./lineage-text";
import { useEscape } from "./useEscape";
import { InfoToggle, type InfoContent } from "./info-toggle";
import {
  ReferenceLinks,
  verifiedLine,
  withBaseLinks,
  type RenderedLink,
} from "./references";
import type { FrequencyInfo } from "~/server/api/frequency";
import {
  ControlRef,
  IncorporatedControls,
  LineageChip,
  WithdrawnNotice,
  type ControlLineage,
  type OpenPart,
} from "./lineage";
import QuickExport from "~/app/_components/export/QuickExport";
import { buildCopyText } from "~/lib/export/copy-text";
import {
  LINE_DATASETS,
  LINE_FIELDS,
  toExportControl,
} from "~/lib/export/from-detail";
import { familyOf, type ExportControl } from "~/lib/export/record";

// Re-exported so one import path still reaches the modal's pieces. Which module a symbol
// comes from is a boundary concern, not something every caller should track. The three
// already imported above are re-exported as bindings rather than named a second time
// against the module, so the list cannot drift from what is actually in scope.
export { hasAnyCoverage, StructuredStatement, type PartNode };
export { partRowClassName } from "./statement";
export { ReferenceLinks, verifiedLine, withBaseLinks, type RenderedLink };
export { InfoToggle, type InfoContent };

/** Shape returned by getControlById for the base control and each enhancement */
export interface ControlDetail {
  id: string;
  name: string;
  description: string;
  /** Baselines the control itself belongs to, as the catalog spells them. */
  baselines: string[];
  discussion: string | null;
  reviewFrequency: string | null;
  assessmentFrequency: string | null;
  /** The frequencies the control asks for, each organization-defined in this catalog. Absent on the layer-cake pre-load. */
  frequency?: FrequencyInfo | null;
  status:
    | "compliance"
    | "zero-trust-aligned"
    | "zt-aligned-with-enhancements"
    | "zt-via-enhancements";
  parts: PartNode[];
  /** Whether the catalog still carries the control. Absent on the layer-cake pre-load, which holds live controls only. */
  catalogStatus?: "live" | "withdrawn";
  /** Where a withdrawn control went, what a live one took in, and the release that added it.
   *  Null when the catalog's data records no lineage; absent on the layer-cake pre-load. */
  lineage?: ControlLineage | null;
  // Zero Trust reference links (ReferenceLink via NistControlLink), domain-tagged — render
  // in the right pane, grouped by domain, each with what it leads to and its citation.
  // The catalog's own reference links (NistLink) render in the left pane.
  ztLinks: Array<{
    label: string;
    url: string;
    domain: string;
    descriptor?: string | null;
    citation?: string | null;
  }>;
  // The catalog's own references. `descriptor` says what the link leads to
  // ("PDF · nvlpubs.nist.gov · via doi.org"); `citation` is the catalog's text.
  nistLinks: Array<{
    label: string;
    url: string;
    descriptor?: string | null;
    citation?: string | null;
  }>;
  // SP 800-53A assessment procedures for this control. Absent on the layer-cake pre-load fallback; empty arrays when the seeded publication does not cover it.
  assessment?: {
    objectives: Array<{
      id: string;
      identifier: string;
      text: string;
      partId: string | null;
    }>;
    /** All three kinds, with a null text where the publication provides none.
     *  Empty entirely when the catalog carries no assessment content at all. */
    methods: Array<{
      method: "EXAMINE" | "INTERVIEW" | "TEST";
      text: string | null;
    }>;
  };
  ztMapping?: {
    pillar: string;
    function: string;
    maturity: string;
    guidance: string;
    // Per-tuple breakout (Option B). Present from getControlById; absent on the layer-cake
    // pre-load fallback (which carries only the representative). >1 entry => multi pillar/function.
    affinities?: Array<{
      pillar: string;
      function: string;
      maturity: string;
      guidance: string;
      designation?: string | null;
      ifApplicable?: boolean;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Statement content switcher
// ---------------------------------------------------------------------------

function StatementContent({
  detail,
  focusPartId = null,
}: {
  detail: ControlDetail;
  focusPartId?: string | null;
}) {
  if (detail.parts.length > 0) {
    // Whatever this product fills. Standard fills nothing, so a baseline renders as
    // its own token rather than in another catalog's abbreviations.
    return (
      <StructuredStatement
        parts={detail.parts}
        focusPartId={focusPartId}
        {...STANDARD_SLOTS}
      />
    );
  }
  return (
    <p className="text-ink-muted text-sm italic">No statement available.</p>
  );
}

// The catalog's discussion prose carries two kinds of link. Cross-references to other
// controls are markdown anchors whose target is the control's OSCAL id — `[AU-02](#au-2)`,
// `[AC-17(1)](#ac-17.1)` — which the seed keeps as published; they open that control in
// this modal. Anchors to the catalog's bibliography (`#<uuid>`) or to a family (`#pe`)
// have nowhere in the app to go and render as their label. A bare http(s) URL becomes an
// outward link; nothing else is ever a live href.
const DISCUSSION_LINK_RE =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s"<>]+)/g;

const HTTP_URL_RE = /^https?:\/\//i;

// Trim trailing punctuation and any unbalanced closing parens off a captured bare URL. A ")"
// is kept only while the URL still has an unmatched "(" to its left (balanced), so a URL like
// ".../foo_(bar)" survives but a sentence's closing ") ." does not leak into the href.
function trimTrailingUrlPunctuation(url: string): string {
  let result = url;
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    const punct = /[.,;]+$/.exec(result);
    if (punct) {
      result = result.slice(0, punct.index);
      trimmed = true;
    }
    if (result.endsWith(")")) {
      const opens = (result.match(/\(/g) ?? []).length;
      const closes = (result.match(/\)/g) ?? []).length;
      if (closes > opens) {
        result = result.slice(0, -1);
        trimmed = true;
      }
    }
  }
  return result;
}

function externalLink(key: number, href: string, label: string): ReactNode {
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:text-accent-strong font-medium break-all hover:underline"
    >
      {label}
    </a>
  );
}

/**
 * Render discussion prose with its links live: control cross-references open the
 * control (through `onOpenControl`, keyed by OSCAL id), outward URLs open in a new
 * tab, and anchors the app cannot follow render as plain text.
 */
export function renderDiscussion(
  text: string,
  onOpenControl?: (oscalId: string) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  DISCUSSION_LINK_RE.lastIndex = 0;
  while ((m = DISCUSSION_LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const label = m[1];
      const target = m[2] ?? "";
      if (target.startsWith("#")) {
        const id = target.slice(1);
        if (isControlId(id) && onOpenControl) {
          out.push(
            <button
              key={key++}
              type="button"
              // A hook for the accessibility scan, which finds elements by CSS only.
              data-control-ref={id}
              onClick={() => onOpenControl(id)}
              className="text-accent hover:text-accent-strong font-medium hover:underline"
            >
              {label}
            </button>,
          );
        } else {
          out.push(label);
        }
      } else if (HTTP_URL_RE.test(target)) {
        out.push(externalLink(key++, target, label));
      } else {
        out.push(label);
      }
      continue;
    }
    const url = trimTrailingUrlPunctuation(m[3] ?? "");
    const href = /%[0-9A-Fa-f]{2}/.test(url) ? url : encodeURI(url);
    out.push(externalLink(key++, href, url));
    // The trim may have given back characters the regex swallowed.
    last = m.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Discussion: the catalog's own commentary on a control, rendered in the left pane
 * under the statement. Distinct from Zero Trust guidance, which lives in the right
 * pane — so the two are never shown as the same block.
 */
export function Discussion({
  text,
  onOpenControl,
}: {
  text: string | null;
  onOpenControl?: (oscalId: string) => void;
}) {
  if (!text) return null;
  return (
    <div className="mt-6">
      <div className="text-warning mb-2 flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
        <Info size={14} /> {product.discussionHeading}
      </div>
      <div className="border-warning-subtle bg-surface-statement-raised text-ink rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-line shadow-sm">
        {renderDiscussion(text, onOpenControl)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assessment procedures (NIST SP 800-53A)
// ---------------------------------------------------------------------------

const METHOD_LABEL: Record<"EXAMINE" | "INTERVIEW" | "TEST", string> = {
  EXAMINE: "Examine",
  INTERVIEW: "Interview",
  TEST: "Test",
};

/** Strip the publication's "[SELECT FROM: ...]" wrapper and split the list, so
 *  the items read as a list rather than as one bracketed sentence. Text in any
 *  other shape is shown as is. */
function methodItems(text: string): string[] {
  const m = /^\[SELECT FROM:\s*(.*)\]\.?$/s.exec(text.trim());
  const body = m ? m[1]! : text;
  return body
    .split(";")
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s.length > 0);
}

/**
 * SP 800-53A assessment procedures, rendered under the statement: the determination statements an assessor answers for this control, followed by what to examine, whom to interview and what to test.
 *
 * The empty state is per method kind, never a blanket one. NIST's data is uneven in a specific shape — 108 controls carry no test, two carry no interview, one carries no examine, and none carry nothing — so a single "no assessment information provided" would never render, and would be wrong about the two thirds of the pane that is populated. Each kind names itself when the publication provides none.
 *
 * A control whose catalog carries no assessment content at all sends an empty `methods` list and renders nothing, which is the distinction the API shape exists to preserve: absent at source is not the same as never ingested.
 *
 * Self-guards on a control with no procedures, so no call-site conditional is needed. The vocabulary is NIST's own, so it takes no product slot.
 */
export function AssessmentProcedures({
  assessment,
}: {
  assessment: ControlDetail["assessment"];
}) {
  if (
    !assessment ||
    (assessment.objectives.length === 0 && assessment.methods.length === 0)
  ) {
    return null;
  }
  return (
    <div className="mt-6" data-testid="assessment-procedures">
      <div className="text-zt mb-2 flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
        <Info size={14} /> Assessment Procedures
      </div>
      <div className="border-zt-muted bg-surface-statement-raised text-ink rounded-lg border p-4 text-sm leading-relaxed shadow-sm">
        {assessment.objectives.length > 0 && (
          <>
            <div className="text-ink-muted mb-2 text-xs font-semibold uppercase">
              Determination Statements
            </div>
            <ol className="mb-4 space-y-1">
              {assessment.objectives.map((o) => (
                <li key={o.id} className="flex gap-2">
                  <span className="text-ink-muted mt-px shrink-0 font-mono text-xs">
                    {o.identifier.replace(/^DS-/, "")}
                  </span>
                  <span>{o.text}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {assessment.methods.map((m) => (
          <div key={m.method} className="mb-3 last:mb-0">
            <div className="text-ink-muted text-xs font-semibold uppercase">
              {METHOD_LABEL[m.method]}
            </div>
            {m.text === null ? (
              <p className="text-ink-muted italic">
                No {METHOD_LABEL[m.method].toLowerCase()} method is available
                for this control.
              </p>
            ) : (
              <ul className="ml-4 list-disc">
                {methodItems(m.text).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZT Pane content (reusable for base + enhancements)
// ---------------------------------------------------------------------------

/** Display form of a pillar enum value (matches the layer-cake/legend wording). */
function formatPillar(p: string): string {
  return p === "APPLICATIONS"
    ? "APPLICATIONS AND WORKLOADS"
    : p.replace(/_/g, "-");
}

type Affinity = {
  pillar: string;
  function: string;
  maturity: string;
  guidance: string;
  /** CISA's designation for the tuple (KEY, SUPPORTING, INFORMATIVE). Null or any other
   *  value reads as Unassigned; absent (the layer-cake pre-load) shows nothing. */
  designation?: string | null;
  /** CISA marks the tuple If Applicable: it holds only where relevant to the system's scope. */
  ifApplicable?: boolean;
};

/** CISA's designations, as its control mapping defines them. The chip shows the label;
 *  the definition is its title and, for a screen reader, follows it once. */
const DESIGNATIONS: Record<string, { label: string; definition: string }> = {
  KEY: {
    label: "Key",
    definition:
      "directly provides the function or mechanism to meet this maturity level.",
  },
  SUPPORTING: {
    label: "Supporting",
    definition: "enhances the function; enables or assists with meeting it.",
  },
  INFORMATIVE: {
    label: "Informative",
    definition: "defines or directs how the function should be implemented.",
  },
};

const UNASSIGNED = {
  label: "Unassigned",
  definition:
    "this tuple carries none of CISA's designations (Key, Supporting, Informative).",
};

const IF_APPLICABLE = {
  label: "If applicable",
  definition:
    "applies only when the control is relevant to the system's scope (the capability does not exist in the system, or the control is managed by another party or inherited).",
};

/** The designation and If Applicable chips CISA's mapping gives a tuple. A loaded tuple
 *  always shows a designation, Unassigned when it is not one of CISA's three. */
function CisaDesignation({ block }: { block: Affinity }) {
  const designation =
    block.designation === undefined
      ? undefined
      : ((block.designation ? DESIGNATIONS[block.designation] : undefined) ??
        UNASSIGNED);
  return (
    <>
      {designation && (
        <>
          <span
            title={`${designation.label}: ${designation.definition}`}
            className="border-accent bg-surface text-accent-strong inline-block rounded-full border px-2 py-0.5 text-xs font-medium"
          >
            {designation.label}
          </span>
          <span className="sr-only">
            , CISA designation: {designation.definition}
          </span>
        </>
      )}
      {block.ifApplicable && (
        <>
          <span
            title={`${IF_APPLICABLE.label}: ${IF_APPLICABLE.definition}`}
            className="border-border-strong bg-surface text-ink inline-block rounded-full border border-dashed px-2 py-0.5 text-xs font-medium"
          >
            {IF_APPLICABLE.label}
          </span>
          <span className="sr-only">, {IF_APPLICABLE.definition}</span>
        </>
      )}
    </>
  );
}

/** Group affinity tuples by pillar (order-preserving), collecting distinct functions. */
function groupAffinitiesByPillar(
  affinities: Affinity[],
): Array<{ pillar: string; functions: string[] }> {
  const groups: Array<{ pillar: string; functions: string[] }> = [];
  for (const a of affinities) {
    let g = groups.find((x) => x.pillar === a.pillar);
    if (!g) {
      g = { pillar: a.pillar, functions: [] };
      groups.push(g);
    }
    if (!g.functions.includes(a.function)) g.functions.push(a.function);
  }
  return groups;
}

/** Grouped pillar→function summary, shown only when a control spans more than one tuple. */
function ZTCoverageSummary({ affinities }: { affinities: Affinity[] }) {
  const groups = groupAffinitiesByPillar(affinities);
  return (
    <div className="border-accent-muted bg-surface-zt-raised rounded-xl border p-4 shadow-sm">
      <span className="text-ink-muted mb-2 block text-[10px] font-bold tracking-wider uppercase">
        ZT Coverage
      </span>
      <ul className="space-y-1.5">
        {groups.map((g) => (
          <li
            key={g.pillar}
            className="flex flex-wrap items-baseline gap-x-2 text-sm"
          >
            <span className="text-accent-strong font-bold">
              {formatPillar(g.pillar)}
            </span>
            <span className="text-ink-muted">—</span>
            <span className="text-ink">{g.functions.join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Mirrors the server's ZT_GUIDANCE_PENDING sentinel (decoder.ts). A block carrying it has no
// resolved guidance yet, so it must NOT render the emerald maturity + CheckCircle "aligned"
// affordance above a "guidance is pending" body — that reads as a contradiction.
const ZT_GUIDANCE_PENDING = "Zero Trust guidance for this function is pending.";

/** One ZT guidance block: a compact pillar · function · maturity header + its guidance.
 *  Used for BOTH single- and multi-tuple controls so the two render identically. A block whose
 *  guidance is still the pending sentinel renders in a muted/neutral style (no emerald, no
 *  CheckCircle), so the maturity isn't shown as "aligned" next to pending guidance. */
function ZTGuidanceBlock({ block }: { block: Affinity }) {
  const isPending = block.guidance === ZT_GUIDANCE_PENDING;
  return (
    <div className="border-accent-muted bg-surface-zt-raised overflow-hidden rounded-xl border shadow-sm">
      <div className="border-accent-muted bg-accent-subtle flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2.5">
        <span className="text-accent-strong text-sm font-bold">
          {formatPillar(block.pillar)}
        </span>
        <span className="bg-accent-muted text-accent-strong inline-block rounded-full px-2 py-0.5 text-xs font-medium">
          {block.function}
        </span>
        <CisaDesignation block={block} />
        {isPending ? (
          <span className="text-ink-muted ml-auto inline-flex items-center text-xs font-medium">
            {block.maturity}
          </span>
        ) : (
          <span className="text-success ml-auto inline-flex items-center gap-1 text-xs font-bold">
            {block.maturity}
            <CheckCircle size={13} />
          </span>
        )}
      </div>
      <div className="p-5">
        <p
          className={`text-sm leading-relaxed whitespace-pre-line ${
            isPending ? "text-ink-muted italic" : "text-ink"
          }`}
        >
          {block.guidance}
        </p>
      </div>
    </div>
  );
}

/** A chip in a source column: strong when it applies, light but visible when it does not. */
function SourceChip({
  label,
  applies,
  title,
}: {
  label: string;
  applies: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      data-applies={applies}
      className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] ${
        applies
          ? "bg-ink-muted text-on-accent font-bold"
          : "border-border-strong bg-surface text-ink-muted border border-dashed font-medium"
      }`}
    >
      {label}
    </span>
  );
}

/** One source's column in a row: its name, then its chips. */
function SourceColumn({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-ink text-[10px] font-bold tracking-wide uppercase">
        {name}
      </span>
      {children}
    </span>
  );
}

/** Which of the catalog's baselines include this control: all of them shown, the applicable ones strong. */
export function BaselinesRow({ baselines }: { baselines: string[] }) {
  const has = new Set(baselines.map((b) => b.toLowerCase()));
  return (
    <div className="text-ink-muted mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-ink-muted font-semibold">
        {product.baselinesLabel}:
      </span>
      <SourceColumn name={product.catalogColumnLabel}>
        {product.catalogBaselines.map((b) => (
          <SourceChip
            key={b}
            label={(STANDARD_SLOTS.baselineLabel ?? RAW_BASELINE_LABEL)(b)}
            applies={has.has(b.toLowerCase())}
          />
        ))}
      </SourceColumn>
      <InfoToggle
        info={{
          toggleLabel: product.baselinesInfoLabel,
          title: product.baselinesInfoTitle,
          paragraphs: [
            product.baselinesInfoBody.applies,
            product.baselinesInfoBody.doesNotApply,
            product.baselinesInfoBody.privacy,
          ],
        }}
      />
    </div>
  );
}

/** Frequencies per source: organization-defined, none, or on an enhancement the base's. */
export function FrequencyRow({
  frequency,
  inheritedFrom,
}: {
  frequency: FrequencyInfo;
  /** On an enhancement with no frequency of its own: the base's id and frequencies. */
  inheritedFrom?: { id: string; frequency: FrequencyInfo } | null;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const own = frequency.nist;
  const shown = own.length > 0 ? own : (inheritedFrom?.frequency.nist ?? []);
  const inherits = own.length === 0 && shown.length > 0;
  const chip =
    own.length > 0
      ? product.frequencyOrgDefinedChip
      : inherits && inheritedFrom
        ? `${product.frequencyInheritsChip} ${inheritedFrom.id}`
        : product.frequencyNoneChip;
  return (
    <div className="text-ink-muted mb-4 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-ink-muted font-semibold">
          {product.frequencyLabel}:
        </span>
        <SourceColumn name={product.catalogColumnLabel}>
          {shown.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              onClick={() => setOpen((v) => !v)}
              className="bg-ink-muted text-on-accent hover:bg-ink inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-bold"
            >
              {chip}
              <ChevronDown
                size={10}
                aria-hidden="true"
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          ) : (
            <SourceChip label={chip} applies={false} />
          )}
        </SourceColumn>
        <InfoToggle
          info={{
            toggleLabel: product.frequencyInfoLabel,
            title: product.frequencyInfoTitle,
            paragraphs: [
              product.frequencyInfoBody.organizationDefined,
              product.frequencyInfoBody.none,
              product.frequencyInfoBody.inherits,
            ],
          }}
        />
      </div>
      {open && shown.length > 0 && (
        <ul
          id={listId}
          className="border-border bg-surface-canvas mt-2 space-y-1 rounded-md border px-3 py-2"
        >
          {inherits && inheritedFrom && (
            <li className="text-ink-muted text-[11px]">
              {product.frequencyInheritedLead}{" "}
              <strong className="text-ink">{inheritedFrom.id}</strong>
            </li>
          )}
          {shown.map((f, i) => (
            <li key={i} className="text-ink">
              {(f.part ?? inherits) && (
                <span className="text-ink-muted mr-1 font-mono">
                  {inherits && inheritedFrom
                    ? `${inheritedFrom.id}${f.part ?? ""}`
                    : f.part}
                </span>
              )}
              {f.before && <span>{f.before} </span>}
              <em className="font-semibold">{f.parameter}</em>
              {/* Text that opens with punctuation follows the frequency with no space. */}
              {f.after && (
                <span>
                  {/^[,.;:]/.test(f.after) ? "" : " "}
                  {f.after}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ZTPane({
  detail,
  provenance,
  base = null,
}: {
  detail: ControlDetail;
  /** On an enhancement's tab, its base control's Zero Trust references; null on the base tab. */
  base?: RenderedLink[] | null;
  /** The Zero Trust references' retrieval, for the explainer's verified line.
   *  Absent on the layer-cake pre-load, which carries no links either. */
  provenance?: { checkedOn: Date | string | null } | null;
}) {
  const zt = detail.ztMapping;
  // Unify single + multi: always render per-tuple blocks. When affinities aren't loaded
  // (the layer-cake pre-load fallback carries only the representative), synthesize one block.
  const blocks: Affinity[] = !zt
    ? []
    : zt.affinities && zt.affinities.length > 0
      ? zt.affinities
      : [
          {
            pillar: zt.pillar,
            function: zt.function,
            maturity: zt.maturity,
            guidance: zt.guidance,
          },
        ];
  return (
    <div className="flex-grow space-y-5">
      {zt ? (
        <>
          {blocks.length > 1 && <ZTCoverageSummary affinities={blocks} />}
          <div className="space-y-4">
            {blocks.map((b, i) => (
              <ZTGuidanceBlock
                key={`${b.pillar}-${b.function}-${b.maturity}-${i}`}
                block={b}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="border-border bg-surface-canvas rounded-xl border-2 border-dashed p-6 text-center">
          <Lock className="text-ink-muted mx-auto mb-3 h-10 w-10" />
          <p className="text-ink-muted font-medium">No Zero Trust Mapping</p>
          <p className="text-ink-muted mt-1 text-sm">
            {product.ztUnmappedMessage}
          </p>
        </div>
      )}
      {/* Zero Trust reference links (ReferenceLink), grouped by domain — always shown.
          The "i" explains the source and when they were verified, as the left pane's does. */}
      <ReferenceLinks
        // Keyed on the control shown, so a container's open state starts fresh on each tab.
        key={`zt-refs-${detail.id}`}
        links={detail.ztLinks}
        base={base}
        emptyMessage={product.noZtLinksMessage}
        info={{
          toggleLabel: product.ztReferencesInfoLabel,
          title: product.ztReferencesInfoTitle,
          paragraphs: [
            product.ztReferencesInfoBody.source,
            product.ztReferencesInfoBody.structure,
            product.ztReferencesInfoBody.resolution,
          ],
          enhancement: product.ztReferencesInfoBody.enhancement,
          closing: [verifiedLine(provenance?.checkedOn)],
        }}
      />
    </div>
  );
}

/**
 * The Zero Trust pane of a withdrawn control, which carries no mapping. It names the
 * successors that do, with their pillars, so the pane leads somewhere instead of ending.
 */
export function WithdrawnZTPane({
  lineage,
  onOpenControl,
  onOpenPart,
}: {
  lineage?: ControlLineage | null;
  onOpenControl?: (oscalId: string) => void;
  onOpenPart?: OpenPart;
}) {
  const successors = (lineage?.successors ?? []).filter((s) => !s.family);
  const mapped = successors.filter((s) => (s.ztPillars ?? []).length > 0);
  return (
    <div
      data-testid="withdrawn-zt-pane"
      className="border-border bg-surface-canvas rounded-xl border-2 border-dashed p-6 text-center"
    >
      <Lock className="text-ink-muted mx-auto mb-3 h-10 w-10" />
      <p className="text-ink-muted font-medium">No Zero Trust Mapping</p>
      <p className="text-ink-muted mt-1 text-sm">
        {mapped.length > 0
          ? "A withdrawn control carries none. Its Zero Trust guidance is on:"
          : successors.length > 0
            ? "A withdrawn control carries none, and neither do the controls that took its content."
            : "A withdrawn control carries none."}
      </p>
      {mapped.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {mapped.map((s) => (
            <li key={s.controlNumber}>
              <ControlRef
                controlNumber={s.controlNumber}
                part={s.part}
                onOpenControl={onOpenControl}
                onOpenPart={onOpenPart}
              />{" "}
              <span className="text-ink-muted text-xs">
                {(s.ztPillars ?? []).map(formatPillar).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enhancement tabs
// ---------------------------------------------------------------------------

/** Extract the short enhancement label, e.g. "AC-02(01)" → "(01)" */
function enhancementLabel(id: string): string {
  const match = /\((\d+)\)$/.exec(id);
  return match ? `(${match[1]})` : id;
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

/** The fields of a control the modal reads; `status` reaches the Zero Trust pane it draws
 *  before the detail loads. A control the cake doesn't list, such as a withdrawn one,
 *  needs only these, so nothing has to stand in for the rest. */
export type ModalControl = Pick<
  NistControl,
  "id" | "oscalId" | "name" | "status" | "ztMapping"
>;

interface ControlModalProps {
  control: ModalControl;
  nistVersion?: string;
  onClose: () => void;
  /** Open another control from a cross-reference in the prose, by its control number
   *  (an enhancement by its own, `AC-17(01)`); the route navigates to its address. A
   *  successor named down to one item of its statement passes that item's path too. */
  onOpenControl?: (controlNumber: string, item?: string) => void;
  /** Show a whole family on the layer cake: where a withdrawn control's successor is a family. */
  onOpenFamily?: (familyCode: string) => void;
  /** The detail the server already fetched for this control, so the modal opens without asking for it again. */
  initialDetail?: RouterOutputs["decoder"]["getControlById"];
}

export default function ControlModal({
  control,
  nistVersion,
  onClose,
  onOpenControl,
  onOpenFamily,
  initialDetail,
}: ControlModalProps) {
  const [copied, setCopied] = useState(false);
  useEscape(onClose);
  // The open tab is the address's `?enh`, so Back and Forward walk the tabs a reader
  // picked and a link can open on one. null is the base tab. `?item` is the statement
  // item a successor link highlighted, by its path (`k`). The two are written together,
  // so a successor that lands on a tab and an item is one history entry.
  const [{ enh: tab, item }, setView] = useQueryStates(
    { enh: parseAsEnhancement, item: parseAsItem },
    { history: "push" },
  );
  // Withdrawn enhancement tabs sit behind a toggle, so the live ones lead the strip.
  const [showWithdrawn, setShowWithdrawn] = useState(false);

  const { data: detailData, isLoading: detailLoading } =
    api.decoder.getControlById.useQuery(
      { controlId: control.id },
      { initialData: initialDetail },
    );

  const enhancements = detailData?.enhancements ?? [];

  const hasEnhancements = enhancements.length > 0;

  // The tab `?enh` names, if this control has it. One it doesn't have shows the base tab.
  // The server redirects those away, so this is a fallback; it also covers the moment
  // before the detail loads. Withdrawn enhancements are tabs too, so `?enh` can name one.
  const activeEnhancement =
    tab === null
      ? null
      : (enhancements.find((e) => e.id === `${control.id}(${tab})`) ?? null);

  // A cross-reference to this same control, or to one of its enhancements, is a tab
  // change: a push of `?enh`, so Back returns to the tab the reader left. A reference to
  // another control goes up to the route, which navigates to its address. `item`, when a
  // successor names one, is highlighted on the tab or control it lands on.
  const openCrossReference = (
    oscalId: string,
    nextItem: string | null = null,
  ) => {
    const number = oscalIdToControlNumber(oscalId);
    const self = control.oscalId;
    if (self && baseControlId(oscalId) === self) {
      if (oscalId === self) {
        selectTab(null, nextItem);
        return;
      }
      if (number && enhancements.some((e) => e.id === number)) {
        selectTab(splitControlId(number).enhancement, nextItem);
        return;
      }
    }
    if (number) {
      if (nextItem) onOpenControl?.(number, nextItem);
      else onOpenControl?.(number);
    }
  };

  // A successor named down to one item of its statement: open its control and highlight
  // that item, in one navigation whether it is this control or another.
  const openPart: OpenPart = (oscalId, part) =>
    openCrossReference(oscalId, partPath(part));

  const activeDetail: ControlDetail | null =
    activeEnhancement ?? detailData ?? null;

  // The highlighted item, as the statement names its parts: the address carries only the
  // path, and the tab on screen supplies the control.
  const activeOscalId = activeEnhancement
    ? controlNumberToOscalId(activeEnhancement.id)
    : control.oscalId;
  const focusPart =
    item && activeOscalId ? `${activeOscalId}_smt.${item}` : null;

  // Picking the tab already shown, with nothing to highlight, adds no history entry. That
  // is compared with the tab shown, not the address: under an `?enh` the control doesn't
  // have, Base is showing. Choosing a tab clears any item a successor link highlighted.
  const selectTab = (next: string | null, nextItem: string | null = null) => {
    const shown = activeEnhancement === null ? null : tab;
    if (next !== shown || nextItem !== item)
      void setView({ enh: next, item: nextItem });
  };

  // On an enhancement's tab each pane also lists its base control's references; on the base
  // tab there is no base list. The copied text inherits through the same rule, in the record.
  const onEnhancement = activeEnhancement !== null;
  const withdrawn = activeDetail?.catalogStatus === "withdrawn";
  const withdrawnCount = enhancements.filter(
    (e) => e.catalogStatus === "withdrawn",
  ).length;
  // Shown when the reader opens them, or when the tab on screen is one of them.
  const withdrawnShown = showWithdrawn || (onEnhancement && withdrawn);
  const baseCatalogLinks = onEnhancement ? (detailData?.nistLinks ?? []) : null;
  const baseZtLinks = onEnhancement ? (detailData?.ztLinks ?? []) : null;

  const handleCopy = async () => {
    const base = onEnhancement && detailData ? detailData : null;
    const record: ExportControl = activeDetail
      ? toExportControl(activeDetail, base, LINE_DATASETS, LINE_FIELDS)
      : {
          id: control.id,
          oscalId: null,
          name: control.name,
          family: familyOf(control.id),
          baseId: null,
        };
    const textToCopy = buildCopyText(record, {
      discussionHeading: product.discussionHeading,
      enhancementChip: product.enhancementSpecificChip,
      relatedHeading: product.relatedHeading,
      relatedOutsideMarker: product.relatedOutsideMarker,
    });

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Fallback copy failed", err);
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div
      // Which control is showing, for the accessibility scan to wait on after a
      // cross-reference, when the previous control's content is still on screen.
      data-control-id={control.id}
      className="animate-in fade-in bg-scrim/70 fixed inset-0 z-50 flex items-stretch p-4 backdrop-blur-sm duration-200 md:p-6"
    >
      <div className="border-border bg-surface relative flex w-full flex-col overflow-hidden rounded-xl border shadow-2xl md:flex-row">
        {/* LEFT PANE: the control */}
        <div className="border-highlight-edge bg-surface-statement relative w-full overflow-y-auto border-r p-6 md:w-3/5 md:p-8">
          <div className="from-highlight-edge to-highlight absolute top-0 left-0 h-1 w-full bg-gradient-to-r"></div>

          <div className="mb-6 flex items-center gap-2">
            <div className="bg-warning-subtle text-warning rounded-lg p-2">
              <FileText size={24} />
            </div>
            <span className="text-warning text-xs font-bold tracking-widest uppercase">
              {product.controlPaneHeading}
            </span>
          </div>

          <div className="mb-1 flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="text-ink text-4xl font-extrabold">
                {activeDetail?.id ?? control.id}
              </h2>
              <LineageChip
                catalogStatus={activeDetail?.catalogStatus}
                lineage={activeDetail?.lineage}
              />
            </div>
            {activeDetail && hasAnyCoverage(activeDetail.parts) && (
              <span className="border-zt text-zt border-l-2 pl-2 text-xs font-medium">
                ZT enriched subcontrol
              </span>
            )}
          </div>
          <h4 className="text-ink mb-4 text-xl leading-tight font-bold">
            {activeDetail?.name ?? control.name}
          </h4>

          {/* Enhancement tabs — wrapping rows */}
          {hasEnhancements && (
            <>
              {!detailData?.ztMapping &&
                !onEnhancement &&
                enhancements.some((e) => e.ztMapping) && (
                  <div className="border-zt-muted bg-zt-subtle text-zt mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="font-semibold">
                      ZT alignment available in enhancements
                    </span>
                    <span className="text-zt">
                      — select a tab marked ZT below
                    </span>
                  </div>
                )}
              <div className="mb-4 flex flex-wrap gap-1.5">
                <button
                  onClick={() => selectTab(null)}
                  aria-pressed={!onEnhancement}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    !onEnhancement
                      ? "bg-ink text-on-accent shadow-[inset_0_-3px_0_var(--color-on-accent)]"
                      : detailData?.ztMapping
                        ? "bg-accent text-on-accent hover:bg-accent-strong shadow-sm"
                        : "bg-surface text-warning ring-highlight-edge hover:bg-highlight ring-1 ring-inset"
                  }`}
                  aria-label={
                    detailData?.ztMapping
                      ? "Base ZT, Zero Trust mapped"
                      : undefined
                  }
                >
                  Base
                  {/* A space, not a margin, so the visible text reads "Base ZT" as the name does. */}
                  {detailData?.ztMapping && (
                    <>
                      {" "}
                      <span aria-hidden="true" className="text-[10px]">
                        ZT
                      </span>
                    </>
                  )}
                </button>
                {enhancements.map((enh) => {
                  const label = enhancementLabel(enh.id);
                  const enhWithdrawn = enh.catalogStatus === "withdrawn";
                  const added = enh.lineage?.addedIn;
                  if (enhWithdrawn && !withdrawnShown) return null;
                  return (
                    <button
                      key={enh.id}
                      onClick={() =>
                        selectTab(splitControlId(enh.id).enhancement)
                      }
                      title={enhWithdrawn ? "Withdrawn" : undefined}
                      aria-pressed={activeEnhancement?.id === enh.id}
                      // Named in full rather than through a visually hidden suffix, whose
                      // spacing the name computation does not keep. The name starts with
                      // the visible text, marks included, so it meets Label in Name (2.5.3).
                      aria-label={
                        enhWithdrawn
                          ? `${label}, withdrawn`
                          : [
                              [label, enh.ztMapping && "ZT", added && "new"]
                                .filter(Boolean)
                                .join(" "),
                              enh.ztMapping && "Zero Trust mapped",
                              added && `new in ${added.release}`,
                            ]
                              .filter(Boolean)
                              .join(", ")
                      }
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        enhWithdrawn ? "line-through" : ""
                      } ${
                        activeEnhancement?.id === enh.id
                          ? "bg-ink text-on-accent shadow-[inset_0_-3px_0_var(--color-on-accent)]"
                          : enhWithdrawn
                            ? "border-border-strong bg-surface-canvas text-ink-muted hover:bg-surface-muted border border-dashed"
                            : enh.ztMapping
                              ? "bg-zt text-on-accent hover:bg-zt-strong shadow-sm"
                              : "bg-surface text-warning ring-highlight-edge hover:bg-highlight ring-1 ring-inset"
                      }`}
                    >
                      {label}
                      {/* The mapped tabs' mark, so mapping is not shown by color alone. */}
                      {enh.ztMapping && !enhWithdrawn && (
                        <>
                          {" "}
                          <span aria-hidden="true" className="text-[10px]">
                            ZT
                          </span>
                        </>
                      )}
                      {added && (
                        <>
                          {" "}
                          <span
                            aria-hidden="true"
                            className="text-[10px] uppercase"
                          >
                            new
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
                {withdrawnCount > 0 && (
                  <button
                    type="button"
                    aria-expanded={withdrawnShown}
                    onClick={() => {
                      if (!withdrawnShown) {
                        setShowWithdrawn(true);
                        return;
                      }
                      setShowWithdrawn(false);
                      // Hiding them from a withdrawn tab returns to the base.
                      if (onEnhancement && withdrawn) selectTab(null);
                    }}
                    className="border-border-strong text-ink-muted hover:bg-surface-muted rounded-md border border-dashed px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    {withdrawnShown
                      ? "Hide withdrawn"
                      : `${withdrawnCount} withdrawn`}
                  </button>
                )}
              </div>
              {withdrawnShown && (
                <p className="text-ink-muted -mt-2 mb-4 text-xs">
                  <span className="line-through">Struck-through</span> tabs are
                  withdrawn enhancements; each says where its content went.
                </p>
              )}
            </>
          )}

          {/* NIST baselines for the control shown; all four always, the applicable ones solid. */}
          {activeDetail && !withdrawn ? (
            <BaselinesRow baselines={activeDetail.baselines ?? []} />
          ) : null}

          {/* Frequency metadata */}
          {activeDetail &&
            [
              activeDetail.reviewFrequency,
              activeDetail.assessmentFrequency,
            ].some(Boolean) && (
              <div className="text-ink-muted mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                {activeDetail.reviewFrequency && (
                  <span>
                    <span className="text-ink-muted font-semibold">
                      Review:
                    </span>{" "}
                    {activeDetail.reviewFrequency}
                  </span>
                )}
                {activeDetail.assessmentFrequency && (
                  <span>
                    <span className="text-ink-muted font-semibold">
                      Assessment:
                    </span>{" "}
                    {activeDetail.assessmentFrequency}
                  </span>
                )}
              </div>
            )}

          {/* Frequency, as this catalog states it: each one the organization's to set. */}
          {activeDetail?.frequency ? (
            // Keyed on the control shown, so a list opened on one tab starts closed on the next.
            <FrequencyRow
              key={activeDetail.id}
              frequency={activeDetail.frequency}
              inheritedFrom={
                onEnhancement && detailData?.frequency
                  ? { id: detailData.id, frequency: detailData.frequency }
                  : null
              }
            />
          ) : null}

          {/* Statement content. A withdrawn control has none; it says where its content went. */}
          {withdrawn ? (
            <WithdrawnNotice
              lineage={activeDetail.lineage}
              onOpenControl={onOpenControl ? openCrossReference : undefined}
              onOpenPart={onOpenControl ? openPart : undefined}
              onOpenFamily={onOpenFamily}
            />
          ) : (
            <div className="border-warning-subtle bg-surface-statement-raised text-ink rounded-lg border p-4 text-sm leading-relaxed shadow-sm">
              {detailLoading ? (
                <div className="space-y-3">
                  <div className="bg-surface-strong h-4 w-3/4 animate-pulse rounded" />
                  <div className="bg-surface-strong h-4 w-full animate-pulse rounded" />
                  <div className="bg-surface-strong h-4 w-5/6 animate-pulse rounded" />
                  <div className="bg-surface-strong h-4 w-2/3 animate-pulse rounded" />
                </div>
              ) : activeDetail ? (
                <StatementContent
                  detail={activeDetail}
                  focusPartId={focusPart}
                />
              ) : (
                <p className="text-ink-muted">Loading control details...</p>
              )}
            </div>
          )}

          {/* Discussion — the catalog's own commentary, under the statement.
              Discussion self-guards on empty/null, so no call-site conditional needed. */}
          <Discussion
            text={activeDetail?.discussion ?? null}
            onOpenControl={onOpenControl ? openCrossReference : undefined}
          />
          {/* The withdrawn controls this one took in. Self-guards on none. */}
          <IncorporatedControls
            lineage={activeDetail?.lineage}
            onOpenControl={onOpenControl ? openCrossReference : undefined}
          />
          {/* SP 800-53A assessment procedures, under the discussion. Self-guards on none. */}
          <AssessmentProcedures assessment={activeDetail?.assessment} />
          {/* The catalog's own reference links (NistLink) — left pane. Each entry says
              what it leads to; the "i" explains the source and when they were verified.
              A withdrawn control carries none, and its base's would read as its own. */}
          {!withdrawn && (
            <ReferenceLinks
              // Keyed on the control shown, so a container closed on one tab cannot hide the
              // next tab's chipped references, nor one opened there stay open elsewhere.
              key={`refs-${activeDetail?.id ?? control.id}`}
              links={activeDetail?.nistLinks ?? []}
              base={baseCatalogLinks}
              emptyMessage={product.noControlLinksMessage}
              info={{
                toggleLabel: product.referencesInfoLabel,
                title: product.referencesInfoTitle,
                paragraphs: [
                  product.referencesInfoBody.source,
                  product.referencesInfoBody.structure,
                  product.referencesInfoBody.resolution,
                ],
                enhancement: product.referencesInfoBody.enhancement,
                closing: [
                  verifiedLine(detailData?.referenceProvenance?.checkedOn),
                ],
              }}
            />
          )}

          <div className="mt-8 flex flex-col gap-2">
            <div className="text-warning flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
              <Shield size={14} /> Source Framework
            </div>
            <span className="border-highlight-edge bg-warning-subtle text-warning inline-flex items-center self-start rounded-md border px-3 py-1 text-sm font-medium">
              {nistVersion ?? product.catalogFallbackLabel}
            </span>
          </div>

          {activeDetail && !activeDetail.ztMapping && !withdrawn && (
            <div className="border-highlight-edge bg-warning-subtle text-warning mt-8 flex items-center gap-2 rounded border px-4 py-3 text-sm">
              <Info size={16} className="shrink-0" />
              <span>{product.ztUnmappedMessage}</span>
            </div>
          )}
        </div>

        {/* RIGHT PANE: Zero Trust Guidance */}
        <div className="bg-surface-zt relative flex w-full flex-col overflow-y-auto p-6 md:w-2/5 md:p-8">
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:bg-surface-muted hover:text-ink absolute top-6 right-6 z-50 rounded-full p-1 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="from-accent to-zt-muted absolute top-0 left-0 h-1 w-full bg-gradient-to-r"></div>

          <div className="mb-6 flex items-center gap-2">
            <div className="bg-accent-muted text-accent rounded-lg p-2">
              <Lock size={24} />
            </div>
            <h3 className="text-accent-strong text-sm font-bold tracking-widest uppercase">
              Zero Trust Security Function
            </h3>
          </div>

          {withdrawn ? (
            <WithdrawnZTPane
              lineage={activeDetail.lineage}
              onOpenControl={onOpenControl ? openCrossReference : undefined}
              onOpenPart={onOpenControl ? openPart : undefined}
            />
          ) : activeDetail ? (
            <ZTPane
              detail={activeDetail}
              provenance={detailData?.ztReferenceProvenance}
              base={baseZtLinks}
            />
          ) : control.ztMapping ? (
            <ZTPane
              detail={{
                ...control,
                description: "",
                // The layer-cake pre-load carries no baselines; this pane renders the ZT
                // mapping only, so an empty array is the honest value rather than a gap.
                baselines: [],
                discussion: null,
                reviewFrequency: null,
                assessmentFrequency: null,
                parts: [],
                ztLinks: [],
                nistLinks: [],
                ztMapping: control.ztMapping,
              }}
            />
          ) : (
            <div className="border-border bg-surface-canvas text-ink-muted flex h-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-8">
              <Lock className="mb-4 h-12 w-12 opacity-20" />
              <p className="text-ink-muted text-lg font-medium">
                No Zero Trust Mapping
              </p>
              <p className="mt-2 max-w-xs text-center text-sm">
                {product.ztUnmappedMessage}
              </p>
            </div>
          )}

          {/* EXPORT + COPY ACTIONS */}
          <div className="border-accent-muted mt-8 flex flex-wrap items-center justify-end gap-3 border-t pt-6">
            {/* The tab shown is what is exported; a base may bring its enhancements. */}
            <QuickExport
              // Per tab, so one tab's busy or failed download does not show on another.
              key={activeDetail?.id ?? control.id}
              controlId={activeDetail?.id ?? control.id}
              // Expansion brings live enhancements only, as the diagram counts them.
              hasEnhancements={
                !onEnhancement &&
                enhancements.some((e) => e.catalogStatus !== "withdrawn")
              }
            />
            <button
              onClick={handleCopy}
              className={`flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-bold shadow-md transition-all active:scale-95 ${
                copied
                  ? "bg-success text-on-accent shadow-success/30"
                  : "bg-ink text-on-accent shadow-ink/20 hover:bg-ink/85"
              }`}
            >
              {copied ? (
                <>
                  <CheckCircle className="h-5 w-5" />
                  <span>Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Clipboard className="h-5 w-5" />
                  <span>Copy Guidance Text</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
