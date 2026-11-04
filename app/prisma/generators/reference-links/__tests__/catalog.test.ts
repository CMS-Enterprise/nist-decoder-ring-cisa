import { describe, expect, it } from "vitest";
import type { OscalCatalog } from "../../catalog/types.js";
import {
  collectControlReferences,
  extractCatalogUrls,
  liveControlNumbers,
  parseBackMatter,
} from "../lib/catalog.js";

const A130 = "27847491-5ce1-4f6a-a1e4-9e483782f0ef";
const SP39 = "e3cc0520-a366-4fc9-abc2-5272db7e3564";
const NOLINK = "00000000-0000-0000-0000-000000000000";

function catalog(): OscalCatalog {
  return {
    catalog: {
      uuid: "cat",
      metadata: {
        title: "T",
        version: "5.2.0",
        "oscal-version": "1.2.2",
        "last-modified": "x",
      },
      groups: [
        {
          id: "ac",
          title: "Access Control",
          controls: [
            {
              id: "ac-1",
              title: "Policy",
              props: [
                { name: "label", value: "AC-1" },
                { name: "label", value: "AC-01", class: "zero-padded" },
              ],
              links: [
                { href: `#${A130}`, rel: "reference" },
                { href: `#${SP39}`, rel: "reference" },
                { href: `#${A130}`, rel: "reference" },
                { href: "#ac-2", rel: "related" },
              ],
              controls: [
                {
                  id: "ac-1.1",
                  title: "Withdrawn",
                  props: [
                    { name: "label", value: "AC-1(1)" },
                    { name: "label", value: "AC-01(01)", class: "zero-padded" },
                    { name: "status", value: "withdrawn" },
                  ],
                  links: [{ href: `#${SP39}`, rel: "reference" }],
                },
              ],
            },
            {
              id: "ac-2",
              title: "Accounts",
              props: [
                { name: "label", value: "AC-2" },
                { name: "label", value: "AC-02", class: "zero-padded" },
              ],
              links: [{ href: "#missing-uuid", rel: "reference" }],
            },
            {
              id: "ac-3",
              title: "No label",
              links: [{ href: `#${SP39}`, rel: "reference" }],
            },
          ],
        },
      ],
      "back-matter": {
        resources: [
          {
            uuid: A130,
            title: "OMB A-130",
            citation: {
              text: "Office of Management and Budget Circular A-130, July 2016.",
            },
            rlinks: [{ href: "https://www.whitehouse.gov/omb/a130.pdf" }],
          },
          {
            uuid: SP39,
            title: "SP 800-39",
            rlinks: [{ href: "https://doi.org/10.6028/NIST.SP.800-39" }],
          },
          { uuid: NOLINK, title: "No link" },
        ],
      },
    },
  };
}

describe("parseBackMatter", () => {
  it("reads title, citation and the one URL, and names resources with no link", () => {
    const out = parseBackMatter(catalog());
    expect(out.resources.map((r) => r.uuid)).toEqual([A130, SP39]);
    expect(out.resources[0]!.title).toBe("OMB A-130");
    expect(out.resources[0]!.citation).toContain("Circular A-130");
    expect(out.resources[1]!.citation).toBeNull();
    expect(out.withoutLink).toEqual([NOLINK]);
  });
});

describe("extractCatalogUrls", () => {
  it("attributes every resource link to its resource", () => {
    expect(extractCatalogUrls(catalog())).toEqual([
      {
        id: A130,
        source: "catalog:OMB A-130",
        url: "https://www.whitehouse.gov/omb/a130.pdf",
      },
      {
        id: SP39,
        source: "catalog:SP 800-39",
        url: "https://doi.org/10.6028/NIST.SP.800-39",
      },
    ]);
  });

  it("returns nothing for a catalog without back-matter", () => {
    const c = catalog();
    delete c.catalog["back-matter"];
    expect(extractCatalogUrls(c)).toEqual([]);
  });
});

describe("collectControlReferences", () => {
  it("keys by the zero-padded label, keeps catalog order, dedupes, and skips withdrawn controls", () => {
    const { resources } = parseBackMatter(catalog());
    const out = collectControlReferences(catalog(), resources);
    expect(out.references).toEqual([
      { controlNumber: "AC-01", resourceUuid: A130, order: 1 },
      { controlNumber: "AC-01", resourceUuid: SP39, order: 2 },
    ]);
    expect(out.unresolved).toEqual([
      { controlNumber: "AC-02", href: "#missing-uuid" },
    ]);
    expect(out.onWithdrawn).toBe(1);
    expect(out.unlabeled).toEqual(["ac-3"]);
  });
});

describe("liveControlNumbers", () => {
  it("lists every live control by its zero-padded number and skips the withdrawn", () => {
    const numbers = liveControlNumbers(catalog());
    expect(numbers.has("AC-01")).toBe(true);
    expect(numbers.has("AC-02")).toBe(true);
    // AC-01(01) is withdrawn in the fixture; a corpus must not attach a link to it.
    expect(numbers.has("AC-01(01)")).toBe(false);
    // ac-3 carries no zero-padded label and cannot be joined to the seed.
    expect([...numbers].some((n) => n.startsWith("AC-03"))).toBe(false);
  });
});
