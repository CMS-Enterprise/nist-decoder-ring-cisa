/**
 * The slots, exercised as Standard fills them.
 *
 * A slot that ignored its argument and returned a literal would pass a test that
 * only checks the literal appears. These render the shared components with the
 * product's config and assert the vocabulary is the product's, which is the only
 * way to tell a filled slot from a hard-coded string.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("~/trpc/react", () => ({ api: {} }));

import { Discussion, ReferenceLinks } from "../ControlModal";
import { StructuredStatement, type PartNode } from "../statement";
import { STANDARD_SLOTS } from "~/config/product-slots";
import { CATALOG_VOCABULARY } from "~/config/catalog-vocabulary";
import { product } from "~/config/product";

describe("the product slots under Standard", () => {
  it("draws baselines in no catalog's vocabulary when the product fills no slot", () => {
    // The finding this pins: the modal imported the badge module directly, so every
    // build got one catalog's abbreviations through a slot that exists to withhold them. The
    // seam was real in the type system and decorative in fact.
    const part: PartNode = {
      id: "p1",
      oscalPartId: "ac-2_smt.e",
      label: "e",
      name: "item",
      prose: "Assignment: [organization-defined time period].",
      sortOrder: 0,
      ztCovered: false,
      parameters: [
        {
          id: "param-1",
          label: "AC-02e.",
          position: 0,
          values: [
            { baselines: ["LOW", "MODERATE", "TAILORED"], value: "30 days" },
          ],
        },
      ],
      children: [],
    };
    render(<StructuredStatement parts={[part]} {...STANDARD_SLOTS} />);
    // Canonical spelling, not the raw enum: the two columns that feed this renderer
    // disagree at source, and the neutral default settles on one of them.
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("TAILORED")).toBeInTheDocument();
    expect(screen.queryByText("LOW")).not.toBeInTheDocument();
    for (const abbrev of ["L", "M", "T"]) {
      expect(screen.queryByText(abbrev)).not.toBeInTheDocument();
    }
    // And nothing expands a token the catalog never defined: the badge's title is
    // the token itself, not a meaning supplied by the UI.
    expect(screen.getByText("TAILORED")).toHaveAttribute("title", "TAILORED");
  });

  it("titles the discussion pane with the catalog's own word for it", () => {
    const { container } = render(
      <Discussion text="Guidance on this control." />,
    );
    expect(screen.getByText("Discussion")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(CATALOG_VOCABULARY);
  });

  it("names the Zero Trust empty state and explainer without naming a catalog", () => {
    render(
      <ReferenceLinks
        links={[]}
        emptyMessage={product.noZtLinksMessage}
        info={{
          toggleLabel: product.ztReferencesInfoLabel,
          title: product.ztReferencesInfoTitle,
          paragraphs: Object.values(product.ztReferencesInfoBody),
        }}
      />,
    );
    expect(screen.getByText(product.noZtLinksMessage)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(CATALOG_VOCABULARY);
  });

  it("names the empty reference state without naming a catalog", () => {
    render(
      <ReferenceLinks links={[]} emptyMessage="No reference links available" />,
    );
    expect(
      screen.getByText("No reference links available"),
    ).toBeInTheDocument();
  });
});
