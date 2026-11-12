/**
 * Regression tests for the ControlModal ZT pane + control statement rendering.
 *
 * Covers three bugs found in UI testing:
 *  - the ZT-coverage teal marker (a className that silently merged into an invalid token),
 *  - "ZT guidance present but no linked resources" must render guidance and simply omit the
 *    Linked Resources section (distinct from "links are broken / all missing"),
 *  - single- and multi-tuple controls must render with the same compact block layout.
 *
 * These render the exported sub-components directly with props, so no tRPC is exercised;
 * the client import is stubbed only to satisfy module load.
 *
 * Also covers StructuredStatement / PartItem / ProseBlock paths for:
 *  - statement-type root nodes with prose + children
 *  - item nodes with complex (multi-line / decorated / numbered) prose
 *  - structured parameter badges (StructuredParameterBadges)
 *  - nested children (recursive depth rendering)
 *  - hasAnyCoverage via nested covered children
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { product } from "~/config/product";

vi.mock("~/trpc/react", () => ({ api: {} }));

import {
  partRowClassName,
  StructuredStatement,
  ZTPane,
  Discussion,
  ReferenceLinks,
  type PartNode,
  type ControlDetail,
  verifiedLine,
} from "../ControlModal";

function makePart(overrides: Partial<PartNode> = {}): PartNode {
  return {
    id: "p1",
    oscalPartId: "au-5_smt.a",
    label: "a",
    name: "item",
    prose: "Alert on audit logging failure.",
    sortOrder: 0,
    ztCovered: false,
    parameters: [],
    children: [],
    ...overrides,
  };
}

type ZtMapping = NonNullable<ControlDetail["ztMapping"]>;

function makeDetail(
  ztMapping: ZtMapping | null,
  ztLinks: ControlDetail["ztLinks"] = [],
  nistLinks: ControlDetail["nistLinks"] = [],
): ControlDetail {
  return {
    id: "AU-05",
    name: "Response to Audit Logging Process Failures",
    description: "",
    baselines: [],
    discussion: null,
    reviewFrequency: null,
    assessmentFrequency: null,
    status: "zero-trust-aligned",
    parts: [],
    ztLinks,
    nistLinks,
    ztMapping: ztMapping ?? undefined,
  };
}

const baseZt: ZtMapping = {
  pillar: "IDENTITY",
  function: "Identity Management",
  maturity: "ADVANCED",
  guidance: "Use a centralized IdP.",
  affinities: [],
};

// --- teal coverage marker (className) ------------------------------------

describe("partRowClassName (ZT coverage teal marker)", () => {
  it("joins the teal border classes as separate tokens when covered", () => {
    const tokens = partRowClassName("ml-2", true).split(/\s+/).filter(Boolean);
    expect(tokens).toContain("border-l-2");
    expect(tokens).toContain("border-zt");
    expect(tokens).toContain("pl-2");
    expect(tokens).toContain("pt-2");
    // Regression: base + conditional must NOT merge into an invalid "pt-2border-l-2" token.
    expect(partRowClassName("ml-2", true)).not.toContain("pt-2border-l-2");
  });

  it("adds the highlight as separate tokens when the item is in focus", () => {
    const tokens = partRowClassName("ml-2", true, true).split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(["border-zt", "bg-highlight", "ring-2"]),
    );
    expect(partRowClassName("ml-2", false)).not.toContain("ring-2");
  });

  it("omits the teal border classes when not covered", () => {
    const cls = partRowClassName("ml-2", false);
    expect(cls).not.toContain("border-zt");
    expect(cls).not.toContain("border-l-2");
  });
});

describe("StructuredStatement teal rendering", () => {
  it("renders a teal left border on a ZT-covered part", () => {
    const { container } = render(
      <StructuredStatement
        parts={[makePart({ ztCovered: true, prose: "Covered subcontrol." })]}
      />,
    );
    expect(screen.getByText("Covered subcontrol.")).toBeInTheDocument();
    expect(container.querySelector(".border-zt")).not.toBeNull();
  });

  it("renders no teal border on an uncovered part", () => {
    const { container } = render(
      <StructuredStatement
        parts={[makePart({ ztCovered: false, prose: "Plain subcontrol." })]}
      />,
    );
    expect(container.querySelector(".border-zt")).toBeNull();
  });
});

// --- ReferenceLinks component --------------------------------------------

describe("ReferenceLinks", () => {
  it("renders the descriptor and the citation beneath a link, and the citation in full on hover", () => {
    render(
      <ReferenceLinks
        links={[
          {
            label: "SP 800-39",
            url: "https://doi.org/10.6028/NIST.SP.800-39",
            descriptor: "PDF · nvlpubs.nist.gov · via doi.org",
            citation:
              "Joint Task Force (2011) Managing Information Security Risk.",
          },
        ]}
        emptyMessage="No reference links available"
      />,
    );
    const link = screen.getByRole("link", { name: /SP 800-39/ });
    expect(link).toHaveAttribute(
      "href",
      "https://doi.org/10.6028/NIST.SP.800-39",
    );
    expect(
      screen.getByText("PDF · nvlpubs.nist.gov · via doi.org"),
    ).toBeInTheDocument();
    const citation = screen.getByText(/Managing Information Security Risk/);
    expect(citation).toHaveClass("line-clamp-2");
    expect(citation).toHaveAttribute(
      "title",
      "Joint Task Force (2011) Managing Information Security Risk.",
    );
  });

  it("renders no descriptor or citation line when a link carries neither", () => {
    render(
      <ReferenceLinks
        links={[{ label: "Plain", url: "https://a.gov/x" }]}
        emptyMessage="none"
      />,
    );
    const link = screen.getByRole("link", { name: /Plain/ });
    // The text block beside the icon holds the title row and nothing beneath it.
    const body = link.lastElementChild!;
    expect(body.children).toHaveLength(1);
    expect(body).toHaveTextContent(/^Plain$/);
  });

  it("shows an explainer toggle only when info is given, opening and closing it on Escape and on an outside click", () => {
    const info = {
      toggleLabel: "About these references",
      title: "About these references",
      paragraphs: [
        "Where they come from.",
        "Links verified against their sites on 2026-09-30.",
      ],
    };
    const { rerender } = render(
      <ReferenceLinks links={[]} emptyMessage="none" info={info} />,
    );
    const toggle = screen.getByLabelText("About these references");
    const details = toggle.closest("details")!;
    expect(details.open).toBe(false);
    expect(
      screen.getByText("Links verified against their sites on 2026-09-30."),
    ).toBeInTheDocument();

    details.open = true;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(details.open).toBe(false);

    details.open = true;
    fireEvent.mouseDown(document.body);
    expect(details.open).toBe(false);

    details.open = true;
    fireEvent.mouseDown(toggle);
    expect(details.open).toBe(true);

    rerender(<ReferenceLinks links={[]} emptyMessage="none" />);
    expect(screen.queryByLabelText("About these references")).toBeNull();
  });

  it("stops an Escape inside the open explainer from reaching the modal", () => {
    const info = { toggleLabel: "About", title: "About", paragraphs: ["x"] };
    render(<ReferenceLinks links={[]} emptyMessage="none" info={info} />);
    const details = screen.getByLabelText("About").closest("details")!;
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    details.open = true;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(outer).toHaveBeenCalledOnce();
    document.removeEventListener("keydown", outer);
  });

  it("renders 'References' heading and a link with correct href", () => {
    render(
      <ReferenceLinks
        links={[
          {
            label: "ZT Reference",
            url: "https://docs.example.gov/zt",
            domain: "NIST",
          },
        ]}
        emptyMessage="No ZT links available"
      />,
    );
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ZT Reference/ })).toHaveAttribute(
      "href",
      "https://docs.example.gov/zt",
    );
  });

  it("groups links by the site they open on, largest first, each container showing its count", () => {
    render(
      <ReferenceLinks
        links={[
          { label: "Memo", url: "https://www.whitehouse.gov/memo" },
          { label: "SP 800-63", url: "https://doi.org/10.6028/a" },
          { label: "SP 800-53", url: "https://doi.org/10.6028/b" },
        ]}
        emptyMessage="none"
      />,
    );
    const containers = screen
      .getAllByRole("group")
      .map((d) => d.querySelector("summary")!.textContent);
    expect(containers).toEqual([
      "doi.org (2): 2 base references",
      "whitehouse.gov (1): 1 base reference",
    ]);
    // Inside a container the list order holds.
    const first = screen.getByRole("link", { name: /SP 800-63/ });
    const second = screen.getByRole("link", { name: /SP 800-53/ });
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps different subdomains apart and folds www into its site", () => {
    render(
      <ReferenceLinks
        links={[
          { label: "A", url: "https://security.example.gov/a" },
          { label: "B", url: "https://cloud.example.gov/b" },
          { label: "C", url: "https://www.example.gov/c" },
          { label: "D", url: "https://example.gov/d" },
        ]}
        emptyMessage="none"
      />,
    );
    const hosts = screen
      .getAllByRole("group")
      .map((d) => d.querySelector("summary")!.textContent);
    expect(hosts).toEqual([
      "example.gov (2): 2 base references",
      "cloud.example.gov (1): 1 base reference",
      "security.example.gov (1): 1 base reference",
    ]);
  });

  it("opens a pane's only container, and starts several closed", () => {
    const { unmount } = render(
      <ReferenceLinks
        links={[{ label: "Only", url: "https://example.gov/only" }]}
        emptyMessage="none"
      />,
    );
    expect(screen.getByRole("group")).toHaveAttribute("open");
    unmount();
    render(
      <ReferenceLinks
        links={[
          { label: "A", url: "https://a.example.gov/x" },
          { label: "B", url: "https://b.example.gov/x" },
        ]}
        emptyMessage="none"
      />,
    );
    for (const d of screen.getAllByRole("group")) {
      expect(d).not.toHaveAttribute("open");
    }
  });

  it("opens a container holding an enhancement's own reference, so its chip shows", () => {
    render(
      <ReferenceLinks
        links={[{ label: "Own", url: "https://own.example.gov/x" }]}
        base={[
          { label: "Base 1", url: "https://base.example.gov/1" },
          { label: "Base 2", url: "https://base.example.gov/2" },
        ]}
        emptyMessage="none"
      />,
    );
    // The site holding the own reference sorts first, ahead of the larger one.
    const [own, base] = screen.getAllByRole("group");
    expect(base).not.toHaveAttribute("open");
    expect(own).toHaveAttribute("open");
    expect(own!.querySelector("summary")).toHaveTextContent(
      "own.example.gov (1): 1 enhancement reference",
    );
    expect(base!.querySelector("summary")).toHaveTextContent(
      "base.example.gov (2): 2 base references",
    );
  });

  it("renders the emptyMessage when links array is empty — does NOT return null", () => {
    const { container } = render(
      <ReferenceLinks links={[]} emptyMessage="No ZT links available" />,
    );
    // Must NOT be empty — always renders the "References" header
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByText("No ZT links available")).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("renders the emptyMessage (control pane, flat) when links array is empty — does NOT return null", () => {
    const { container } = render(
      <ReferenceLinks links={[]} emptyMessage="No reference links available" />,
    );
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(
      screen.getByText("No reference links available"),
    ).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });
});

// --- single vs multi consistency -----------------------------------------

describe("ZTPane single/multi consistency", () => {
  it("single tuple: one guidance block, no ZT Coverage summary", () => {
    render(
      <ZTPane
        detail={makeDetail({
          ...baseZt,
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: "Single-tuple guidance.",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Single-tuple guidance.")).toBeInTheDocument();
    expect(screen.queryByText("ZT Coverage")).toBeNull();
  });

  it("multi tuple: a ZT Coverage summary plus a block per tuple", () => {
    render(
      <ZTPane
        detail={makeDetail({
          ...baseZt,
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: "Identity guidance.",
            },
            {
              pillar: "DATA",
              function: "Data Encryption",
              maturity: "OPTIMAL",
              guidance: "Data guidance.",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("ZT Coverage")).toBeInTheDocument();
    expect(screen.getByText("Identity guidance.")).toBeInTheDocument();
    expect(screen.getByText("Data guidance.")).toBeInTheDocument();
  });

  it("pending-guidance block renders muted: no emerald maturity, no CheckCircle 'aligned' affordance", () => {
    const PENDING = "Zero Trust guidance for this function is pending.";
    const { container } = render(
      <ZTPane
        detail={makeDetail({
          ...baseZt,
          guidance: PENDING,
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: PENDING,
            },
          ],
        })}
      />,
    );
    // The pending sentinel text is shown...
    expect(screen.getByText(PENDING)).toBeInTheDocument();
    // ...but NOT as an "aligned" block: no green maturity color for this block.
    expect(container.querySelector(".text-success")).toBeNull();
    // The maturity label still shows, in a muted treatment.
    expect(screen.getByText("ADVANCED")).toBeInTheDocument();
  });

  it("resolved-guidance block keeps the emerald maturity + CheckCircle affordance", () => {
    const { container } = render(
      <ZTPane
        detail={makeDetail({
          ...baseZt,
          guidance: "Real resolved guidance.",
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: "Real resolved guidance.",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Real resolved guidance.")).toBeInTheDocument();
    // Resolved guidance keeps the emerald "aligned" treatment.
    expect(container.querySelector(".text-success")).not.toBeNull();
  });

  it("shows CISA's designation and If Applicable flag on each tuple that carries them", () => {
    render(
      <ZTPane
        detail={makeDetail({
          ...baseZt,
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Access Management",
              maturity: "TRADITIONAL",
              guidance: "Access guidance.",
              designation: "KEY",
              ifApplicable: false,
            },
            {
              pillar: "DATA",
              function: "Encryption",
              maturity: "INITIAL",
              guidance: "Encryption guidance.",
              designation: "INFORMATIVE",
              ifApplicable: true,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Key")).toHaveAttribute(
      "title",
      expect.stringMatching(/^Key: directly provides/),
    );
    expect(screen.getByText("Informative")).toBeInTheDocument();
    // If Applicable is on the second tuple only.
    expect(screen.getAllByText("If applicable")).toHaveLength(1);
    // A screen reader hears each label once: the hidden text carries the definition alone.
    expect(
      screen.getByText(/CISA designation: directly provides the function/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/designation\W+Key:/)).toBeNull();
    expect(screen.queryByText(/^If applicable:/)).toBeNull();
  });

  it("shows Unassigned on a tuple whose designation is not one of CISA's three", () => {
    render(
      <ZTPane
        detail={makeDetail({
          ...baseZt,
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: "No designation.",
              designation: null,
            },
            {
              pillar: "DATA",
              function: "Encryption",
              maturity: "INITIAL",
              guidance: "Unknown designation.",
              designation: "PRIMARY",
            },
          ],
        })}
      />,
    );
    expect(screen.getAllByText("Unassigned")).toHaveLength(2);
    for (const label of ["Key", "Supporting", "Informative", "If applicable"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("shows no designation on the layer-cake pre-load, which has not fetched one", () => {
    render(<ZTPane detail={makeDetail(baseZt)} />);
    expect(screen.queryByText("Unassigned")).toBeNull();
    expect(screen.queryByText("Key")).toBeNull();
  });

  it("no ZT mapping: shows compact note PLUS a ZT References section with emptyMessage", () => {
    // ZTPane no longer early-returns when ztMapping is absent; it renders the compact
    // "No Zero Trust Mapping" note AND always renders the ZT ReferenceLinks section.
    render(<ZTPane detail={makeDetail(null)} />);
    expect(screen.getByText("No Zero Trust Mapping")).toBeInTheDocument();
    // Always-present References section with the product's empty-state message
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByText(product.noZtLinksMessage)).toBeInTheDocument();
  });

  it("explains its references with the Zero Trust slots and the retrieval date", () => {
    render(
      <ZTPane
        detail={makeDetail(baseZt, [
          {
            label: "Zero Trust Maturity Model, Version 2.0",
            url: "https://docs.example.gov/ztmm.pdf",
            domain: "FEDERAL",
            descriptor: "PDF · docs.example.gov",
            citation: "The publisher, April 2023.",
          },
        ])}
        provenance={{ checkedOn: "2026-10-01" }}
      />,
    );
    const toggle = screen.getByLabelText(product.ztReferencesInfoLabel);
    expect(toggle.closest("details")!.open).toBe(false);
    expect(
      screen.getByText("Links verified against their sites on 2026-10-01."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(product.ztReferencesInfoBody.source),
    ).toBeInTheDocument();
    expect(screen.getByText("PDF · docs.example.gov")).toBeInTheDocument();
    expect(screen.getByText("The publisher, April 2023.")).toBeInTheDocument();
  });

  it("says the references are unverified when no retrieval has been recorded", () => {
    render(<ZTPane detail={makeDetail(baseZt)} />);
    expect(
      screen.getByText(
        "These links have not yet been verified against their sites.",
      ),
    ).toBeInTheDocument();
  });

  it("ZT mapped with ztLinks: References section shows the link (not emptyMessage)", () => {
    render(
      <ZTPane
        detail={makeDetail(baseZt, [
          {
            label: "ZT Doc",
            url: "https://docs.example.gov/zt",
            domain: "NIST",
          },
        ])}
      />,
    );
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ZT Doc/ })).toHaveAttribute(
      "href",
      "https://docs.example.gov/zt",
    );
    expect(screen.queryByText(product.noZtLinksMessage)).toBeNull();
  });
});

// --- Discussion section (left pane, under the statement) -----------------

describe("Discussion", () => {
  it("renders the heading and the discussion text", () => {
    render(<Discussion text="Publisher interpretation of this control." />);
    expect(screen.getByText("Discussion")).toBeInTheDocument();
    expect(
      screen.getByText("Publisher interpretation of this control."),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no discussion text", () => {
    const { container } = render(<Discussion text={null} />);
    expect(screen.queryByText("Discussion")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a cross-referenced control, keyed by its OSCAL id, and shows no markup", () => {
    const open = vi.fn();
    render(
      <Discussion
        text="Audit records are defined in accordance with [AU-02](#au-2) and reviewed."
        onOpenControl={open}
      />,
    );
    const link = screen.getByRole("button", { name: "AU-02" });
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith("au-2");
    expect(screen.queryByText(/\]\(#/)).toBeNull();
  });

  it("opens an enhancement by its own id, so the page can land on its tab", () => {
    const open = vi.fn();
    render(
      <Discussion
        text="See [AC-17(1)](#ac-17.1) for the monitored session."
        onOpenControl={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AC-17(1)" }));
    expect(open).toHaveBeenCalledWith("ac-17.1");
  });

  it("renders a bibliography or family anchor as its label, with nothing to click", () => {
    render(
      <Discussion
        text="Defined in [OMB A-130](#2956e175-3eb3-4a5a-95bb-4d7c1b2a9f00) and the [PE](#pe) family."
        onOpenControl={vi.fn()}
      />,
    );
    expect(screen.getByText(/OMB A-130/)).toBeInTheDocument();
    expect(screen.getByText(/PE family/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a control cross-reference as plain text when there is nowhere to open it", () => {
    render(<Discussion text="See [AC-03](#ac-3)." />);
    expect(screen.getByText(/See AC-03\./)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a labelled outward link as a link to its target", () => {
    render(
      <Discussion text="See [the validated modules](https://csrc.nist.gov/validated-modules/search)." />,
    );
    expect(
      screen.getByRole("link", { name: "the validated modules" }),
    ).toHaveAttribute("href", "https://csrc.nist.gov/validated-modules/search");
  });

  it("linkifies a bare URL in parentheses", () => {
    render(
      <Discussion
        text={
          "The CMVP (https://csrc.nist.gov/Projects/cmvp) validates modules."
        }
      />,
    );
    expect(
      screen.getByRole("link", { name: "https://csrc.nist.gov/Projects/cmvp" }),
    ).toHaveAttribute("href", "https://csrc.nist.gov/Projects/cmvp");
  });

  it("keeps the characters it trims off a bare URL in the text", () => {
    // The trim gives the sentence's ")" back to the prose; the text must not lose it.
    const text =
      "The CMVP (https://csrc.nist.gov/Projects/cmvp) validates modules.";
    render(<Discussion text={text} />);
    expect(screen.getByRole("link").parentElement).toHaveTextContent(text, {
      normalizeWhitespace: false,
    });
  });

  it("keeps a balanced trailing paren inside a bare URL but trims the sentence's closing paren", () => {
    render(
      <Discussion
        text={
          "See the doc (https://docs.example.gov/foo_(bar)/page) for details."
        }
      />,
    );
    expect(
      screen.getByRole("link", {
        name: "https://docs.example.gov/foo_(bar)/page",
      }),
    ).toHaveAttribute("href", "https://docs.example.gov/foo_(bar)/page");
    expect(screen.getByText(/for details\./)).toBeInTheDocument();
  });

  it("never turns a non-http target into a live link", () => {
    // A markdown link can carry any scheme; a "javascript:" target must render as its
    // label and nothing else, and a bare non-http token is never matched at all.
    const { container } = render(
      <Discussion
        text={
          'Click [here](javascript:alert) or HYPERLINK "javascript:alert(1)" to continue'
        }
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toContain(
      'Click here or HYPERLINK "javascript:alert(1)" to continue',
    );
  });
});

// --- StructuredStatement: statement-type root node --------------------------

describe("StructuredStatement — statement-type root node", () => {
  it("renders prose from a statement-type node directly (no label badge)", () => {
    const smt: PartNode = {
      id: "smt1",
      oscalPartId: "ac-2_smt",
      label: null,
      name: "statement",
      prose: "The organization shall manage accounts.",
      sortOrder: 0,
      ztCovered: false,
      parameters: [],
      children: [],
    };
    render(<StructuredStatement parts={[smt]} />);
    expect(
      screen.getByText("The organization shall manage accounts."),
    ).toBeInTheDocument();
    // No label badge for statement nodes
    expect(screen.queryByText(/\.$/)?.tagName).not.toBe("SPAN");
  });

  it("renders children of a statement-type node", () => {
    const child: PartNode = {
      id: "item-a",
      oscalPartId: "ac-2_smt.a",
      label: "a",
      name: "item",
      prose: "Child item prose.",
      sortOrder: 0,
      ztCovered: false,
      parameters: [],
      children: [],
    };
    const smt: PartNode = {
      id: "smt1",
      oscalPartId: "ac-2_smt",
      label: null,
      name: "statement",
      prose: "Root statement prose.",
      sortOrder: 0,
      ztCovered: false,
      parameters: [],
      children: [child],
    };
    render(<StructuredStatement parts={[smt]} />);
    expect(screen.getByText("Root statement prose.")).toBeInTheDocument();
    expect(screen.getByText("Child item prose.")).toBeInTheDocument();
  });

  it("renders a statement-type node with no prose (prose=null)", () => {
    const child: PartNode = makePart({ prose: "Only child." });
    const smt: PartNode = {
      id: "smt1",
      oscalPartId: "ac-2_smt",
      label: null,
      name: "statement",
      prose: null,
      sortOrder: 0,
      ztCovered: false,
      parameters: [],
      children: [child],
    };
    render(<StructuredStatement parts={[smt]} />);
    expect(screen.getByText("Only child.")).toBeInTheDocument();
  });
});

// --- StructuredStatement: complex prose in item nodes -----------------------

describe("StructuredStatement — complex prose (multi-line / numbered)", () => {
  it("renders a multi-line prose via ProseBlock (non-simple path)", () => {
    // Multi-line prose → isSimpleProse=false → ProseBlock used
    const part: PartNode = makePart({
      prose: "Line one.\nLine two.",
      label: "b",
    });
    render(<StructuredStatement parts={[part]} />);
    expect(screen.getByText("Line one.")).toBeInTheDocument();
    expect(screen.getByText("Line two.")).toBeInTheDocument();
  });

  it("renders numbered list items in ProseBlock", () => {
    const part: PartNode = makePart({
      prose: "1. First item\n2. Second item",
      label: "c",
    });
    render(<StructuredStatement parts={[part]} />);
    expect(screen.getByText("First item")).toBeInTheDocument();
    expect(screen.getByText("Second item")).toBeInTheDocument();
    // Numbered prefixes rendered by ProseBlock
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
  });
});

// --- StructuredStatement: item node with NO prose (label-only) --------------

describe("StructuredStatement — item node with no prose", () => {
  it("renders the label badge with no prose when prose is null", () => {
    const part: PartNode = makePart({ prose: null, label: "d" });
    const { container } = render(<StructuredStatement parts={[part]} />);
    // The label badge should render
    expect(container.querySelector(".bg-surface-strong")).not.toBeNull();
  });
});

// --- StructuredStatement: structured parameter badges -----------------------

describe("StructuredStatement — structured parameter badges (StructuredParameterBadges)", () => {
  it("renders parameter badge groups when a part has parameters", () => {
    const part: PartNode = {
      id: "p-param",
      oscalPartId: "ac-2_smt.e",
      label: "e",
      name: "item",
      // Deliberately short so isSimpleProse would be true without params — params force ProseBlock
      prose: "Assignment: [organization-defined time period].",
      sortOrder: 4,
      ztCovered: false,
      parameters: [
        {
          id: "param-1",
          label: "AC-02e.",
          position: 0,
          values: [
            {
              baselines: ["LOW", "MODERATE", "HIGH", "TAILORED"],
              value: "30 days",
            },
          ],
        },
      ],
      children: [],
    };
    render(<StructuredStatement parts={[part]} />);
    // All four values identical → grouped into one group. With no slot filled the badge
    // shows the raw token, not an abbreviation: this branch supplies no baseline
    // vocabulary, and a one-letter badge here would be the leak, not the feature.
    // One spelling, whichever column the token came from: the neutral renderer
    // canonicalises the enum spelling so a control carrying both surfaces cannot show
    // "LOW" beside "Low" for the same thing. A token it was never taught stays as
    // published.
    for (const token of ["Low", "Moderate", "High", "TAILORED"]) {
      expect(screen.getByText(token)).toBeInTheDocument();
    }
    expect(screen.queryByText("LOW")).not.toBeInTheDocument();
    for (const abbrev of ["L", "M", "H", "T"]) {
      expect(screen.queryByText(abbrev)).not.toBeInTheDocument();
    }
    // Value rendered
    expect(screen.getAllByText("30 days").length).toBeGreaterThan(0);
  });

  it("renders separate badge groups when parameter values differ across baselines", () => {
    const part: PartNode = {
      id: "p-param2",
      oscalPartId: "ac-2_smt.e2",
      label: "f",
      name: "item",
      prose: "Account removal time.",
      sortOrder: 5,
      ztCovered: false,
      parameters: [
        {
          id: "param-2",
          label: "AC-02f.",
          position: 0,
          // Distinct values per baseline; PRIVACY undefined (no row).
          values: [
            { baselines: ["LOW"], value: "90 days" },
            { baselines: ["MODERATE"], value: "60 days" },
            { baselines: ["HIGH"], value: "30 days" },
          ],
        },
      ],
      children: [],
    };
    render(<StructuredStatement parts={[part]} />);
    // Different values → separate groups
    expect(screen.getByText("90 days")).toBeInTheDocument();
    expect(screen.getByText("60 days")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    // An undefined baseline has no value row — no "(Not defined)" placeholder, no badge.
    expect(screen.queryByText("(Not defined)")).not.toBeInTheDocument();
    expect(screen.queryByText("Privacy")).not.toBeInTheDocument();
  });

  it("renders parameter badges via ProseBlock structured path (numbered line + params)", () => {
    const part: PartNode = {
      id: "p-num-param",
      oscalPartId: "ac-2_smt.g",
      label: "g",
      name: "item",
      prose: "1. Notify account managers.\n2. Disable the account.",
      sortOrder: 6,
      ztCovered: false,
      parameters: [
        {
          id: "param-3",
          label: "AC-02g.",
          position: 0,
          values: [
            {
              baselines: ["LOW", "MODERATE", "HIGH", "PRIVACY"],
              value: "1 hour",
            },
          ],
        },
      ],
      children: [],
    };
    render(<StructuredStatement parts={[part]} />);
    // Numbered items rendered
    expect(screen.getByText("Notify account managers.")).toBeInTheDocument();
    expect(screen.getByText("Disable the account.")).toBeInTheDocument();
    expect(screen.getAllByText("1 hour").length).toBeGreaterThan(0);
  });
});

// --- StructuredStatement: the product-supplied decoration check ------------

describe("StructuredStatement — prose decoration check", () => {
  // A stand-in for whatever a product treats as decorated prose, deliberately not any
  // catalog's real marker. What is under test is that the renderer honours a supplied
  // predicate — a property of the seam, not of anyone's vocabulary. This branch fills
  // the slot with nothing, so there is no real check here to borrow.
  const BADGED = "\u2756: 30 days";
  const isDecorated = (text: string) => text.includes("\u2756");

  // Single-line, parameter-free prose normally renders as a bare span. Whether a given
  // piece of prose is "decorated" and must go through ProseBlock instead is the product's
  // question to answer, so the renderer takes a predicate rather than knowing any markup.
  it("routes decorated prose through ProseBlock when the product supplies a check", () => {
    const part: PartNode = makePart({ prose: BADGED, label: "h" });
    const { container } = render(
      <StructuredStatement parts={[part]} isProseDecorated={isDecorated} />,
    );
    expect(container.querySelector("p.pt-0\\.5")?.textContent).toBe(BADGED);
  });

  it("renders that same prose as plain text when no check is supplied", () => {
    const part: PartNode = makePart({ prose: BADGED, label: "h" });
    const { container } = render(<StructuredStatement parts={[part]} />);
    expect(container.querySelector("p.pt-0\\.5")).toBeNull();
    expect(screen.getByText(BADGED).tagName).toBe("SPAN");
  });

  it("takes the plain-span path for undecorated prose even with a check supplied", () => {
    const part: PartNode = makePart({
      prose: "Alert on audit failure.",
      label: "a",
    });
    const { container } = render(
      <StructuredStatement parts={[part]} isProseDecorated={isDecorated} />,
    );
    expect(container.querySelector("p.pt-0\\.5")).toBeNull();
    expect(screen.getByText("Alert on audit failure.").tagName).toBe("SPAN");
  });

  it("applies the check to nested children, not just top-level parts", () => {
    const child: PartNode = makePart({ id: "c1", prose: BADGED, label: "1" });
    const parent: PartNode = makePart({
      id: "p-parent",
      prose: "Parent line.",
      label: "a",
      children: [child],
    });
    const { container } = render(
      <StructuredStatement parts={[parent]} isProseDecorated={isDecorated} />,
    );
    expect(container.querySelector("p.pt-0\\.5")?.textContent).toBe(BADGED);
  });
});

// --- StructuredStatement: nested children (recursive depth) -----------------

describe("StructuredStatement — nested children (recursive depth)", () => {
  it("renders a grandchild part at depth=2", () => {
    const grandchild: PartNode = makePart({
      id: "gc",
      label: "1",
      prose: "Grandchild prose.",
    });
    const child: PartNode = makePart({
      id: "child",
      label: "a",
      prose: "Child prose.",
      children: [grandchild],
    });
    const root: PartNode = makePart({
      id: "root",
      label: null,
      name: "statement",
      prose: "Root prose.",
      children: [child],
    });
    render(<StructuredStatement parts={[root]} />);
    expect(screen.getByText("Root prose.")).toBeInTheDocument();
    expect(screen.getByText("Child prose.")).toBeInTheDocument();
    expect(screen.getByText("Grandchild prose.")).toBeInTheDocument();
  });

  it("hasAnyCoverage detects covered grandchild through nested children", () => {
    // Render StructuredStatement with a covered grandchild — the teal border should appear
    const grandchild: PartNode = makePart({
      id: "gc-covered",
      label: "1",
      prose: "Covered nested.",
      ztCovered: true,
    });
    const child: PartNode = makePart({
      id: "child-uncov",
      label: "a",
      prose: "Uncovered child.",
      ztCovered: false,
      children: [grandchild],
    });
    const { container } = render(<StructuredStatement parts={[child]} />);
    // The grandchild itself has teal border; the uncovered child does not
    const tealBordered = container.querySelectorAll(".border-zt");
    expect(tealBordered.length).toBeGreaterThan(0);
  });
});

describe("verifiedLine", () => {
  it("dates the verification from the seed, and says so when there is none", () => {
    expect(verifiedLine(new Date("2026-09-30T12:00:00Z"))).toBe(
      "Links verified against their sites on 2026-09-30.",
    );
    expect(verifiedLine("2026-09-29")).toBe(
      "Links verified against their sites on 2026-09-29.",
    );
    expect(verifiedLine(null)).toBe(
      "These links have not yet been verified against their sites.",
    );
    expect(verifiedLine("not a date")).toBe(
      "These links have not yet been verified against their sites.",
    );
  });
});
