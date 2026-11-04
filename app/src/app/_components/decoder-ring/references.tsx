"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import { product } from "~/config/product";
import { InfoToggle, type InfoContent } from "./info-toggle";
import { linkHost, uniqueByUrl, urlKey, withBaseLinks } from "./link-identity";

/**
 * The References block both panes render: the header and its "i" explainer, then the links
 * grouped by the site they open on, one collapsible container per site showing how many it
 * holds, and each entry with what it leads to and its citation.
 *
 * A pane hands over its own references and, on an enhancement's tab, its base control's.
 * Everything that depends on being on an enhancement's tab follows from that one input:
 * the enhancement's own references first, chipped beside the title, then the base's, each
 * URL once, and the explainer's sentence on how that list is built.
 */

/** A pane's explainer. `enhancement` is shown only on an enhancement's tab, after the pane's
 *  own paragraphs; `closing` lines, such as when the links were verified, come last. */
export interface ReferencesInfo extends InfoContent {
  enhancement?: string;
  closing?: string[];
}

/** A reference as the panes render it. `scope` is set only on an enhancement's
 *  tab: "enhancement" for one it cites itself, "base" for one inherited from its base. */
export interface RenderedLink {
  label: string;
  url: string;
  domain?: string;
  descriptor?: string | null;
  citation?: string | null;
  scope?: "enhancement" | "base";
}

// The panes' inheritance rule lives beside uniqueByUrl so the export record applies the same one.
export { withBaseLinks };

function EnhancementChip() {
  return (
    <span className="inline-flex h-4 shrink-0 items-center rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
      {product.enhancementSpecificChip}
    </span>
  );
}

function LinkAnchor({ link }: { link: RenderedLink }) {
  // The label is the link; the descriptor (what it leads to) and the citation
  // sit beneath it in muted text so a reader can check the destination before
  // clicking. Both are optional: a link that carries neither renders its label alone.
  // An enhancement's own reference is chipped beside its title, so the citation
  // lines beneath read the same on every entry.
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"
    >
      <ExternalLink
        size={14}
        className="mt-0.5 shrink-0 transition-transform group-hover:translate-x-0.5"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="group-hover:underline">{link.label}</span>
          {link.scope === "enhancement" && <EnhancementChip />}
        </span>
        {link.descriptor && (
          <span className="block text-xs font-normal text-slate-500">
            {link.descriptor}
          </span>
        )}
        {link.citation && (
          <span
            className="line-clamp-2 block text-xs font-normal text-slate-400"
            title={link.citation}
          >
            {link.citation}
          </span>
        )}
      </span>
    </a>
  );
}

/** The provenance line of the explainer, from the retrieval date the seed carries. */
export function verifiedLine(
  checkedOn: Date | string | null | undefined,
): string {
  if (!checkedOn)
    return "These links have not yet been verified against their sites.";
  const d = typeof checkedOn === "string" ? new Date(checkedOn) : checkedOn;
  if (Number.isNaN(d.getTime()))
    return "These links have not yet been verified against their sites.";
  return `Links verified against their sites on ${d.toISOString().slice(0, 10)}.`;
}

/** Whether a group holds any of an enhancement's own references. */
function holdsOwn(group: HostGroup): boolean {
  return group.links.some((l) => l.scope === "enhancement");
}

/** One site's container: its host and its links, in list order. */
export interface HostGroup {
  host: string;
  links: RenderedLink[];
}

/**
 * The list grouped by site, each link once. Sites holding an enhancement's own references
 * come first, so its own references lead the pane as the explainer says; then larger groups,
 * then by name. Within a group the list order holds, so its own stay above its base's.
 */
export function groupByHost(links: RenderedLink[]): HostGroup[] {
  const groups = new Map<string, RenderedLink[]>();
  for (const link of uniqueByUrl(links)) {
    const host = linkHost(link.url);
    groups.set(host, [...(groups.get(host) ?? []), link]);
  }
  return [...groups.entries()]
    .map(([host, grouped]) => ({ host, links: grouped }))
    .sort(
      (a, b) =>
        Number(holdsOwn(b)) - Number(holdsOwn(a)) ||
        b.links.length - a.links.length ||
        a.host.localeCompare(b.host),
    );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A container's header: its site, how many references it holds, and what they are. On the
 * base tab every reference is the control's own, so the header names one kind: "doi.org (7):
 * 7 base references". On an enhancement's tab it names each kind present, the
 * enhancement's own first: "docs.example.gov (14): 4 enhancement references, 10 base
 * references". A kind with none is left out rather than counted as zero.
 */
export function containerHeader(
  group: HostGroup,
  onEnhancement: boolean,
): string {
  const count = group.links.length;
  if (!onEnhancement) {
    return `${group.host} (${count}): ${plural(count, "base reference")}`;
  }
  const own = group.links.filter((l) => l.scope === "enhancement").length;
  const kinds = [
    ...(own > 0 ? [plural(own, "enhancement reference")] : []),
    ...(count - own > 0 ? [plural(count - own, "base reference")] : []),
  ];
  return `${group.host} (${count}): ${kinds.join(", ")}`;
}

/**
 * A site's container. It starts open when it is the pane's only one, so a single site is
 * never a click away, or when it holds an enhancement's own reference, so the chip is never
 * hidden behind a closed container. Otherwise it starts closed with its header showing.
 */
function HostContainer({
  group,
  only,
  onEnhancement,
}: {
  group: HostGroup;
  only: boolean;
  onEnhancement: boolean;
}) {
  const open = only || holdsOwn(group);
  return (
    <details
      open={open}
      className="group/host rounded-lg border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="shrink-0 text-slate-400 transition-transform group-open/host:rotate-90"
          />
          <span className="min-w-0">
            {containerHeader(group, onEnhancement)}
          </span>
        </span>
      </summary>
      <ul className="space-y-2 px-3 pt-1 pb-3">
        {group.links.map((link) => (
          <li key={urlKey(link.url)}>
            <LinkAnchor link={link} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ReferenceLinks({
  links: own,
  base = null,
  emptyMessage,
  info,
}: {
  /** The control's own references. */
  links: RenderedLink[];
  /** On an enhancement's tab, its base control's references; null on the base tab. */
  base?: RenderedLink[] | null;
  emptyMessage: string;
  /** When given, the header carries an "i" toggle that opens this explainer. */
  info?: ReferencesInfo;
}) {
  // The list, the chip and the explainer's enhancement sentence all follow from `base`, so a
  // pane cannot show inherited references without saying which are the enhancement's own.
  const onEnhancement = base !== null;
  const given = withBaseLinks(own, base);
  const explainer: InfoContent | undefined = info && {
    toggleLabel: info.toggleLabel,
    title: info.title,
    paragraphs: [
      ...info.paragraphs,
      ...(onEnhancement && info.enhancement ? [info.enhancement] : []),
      ...(info.closing ?? []),
    ],
  };
  const groups = groupByHost(given);
  return (
    <div className="mt-5">
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase">
        <span>References</span>
        {explainer && <InfoToggle info={explainer} />}
      </h4>
      {groups.length === 0 ? (
        <p className="text-sm text-slate-400 italic">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <HostContainer
              key={group.host}
              group={group}
              only={groups.length === 1}
              onEnhancement={onEnhancement}
            />
          ))}
        </div>
      )}
    </div>
  );
}
