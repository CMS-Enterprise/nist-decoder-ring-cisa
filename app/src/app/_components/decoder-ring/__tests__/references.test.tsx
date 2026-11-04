import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { product } from "~/config/product";
import { linkHost } from "../link-identity";
import {
  ReferenceLinks,
  containerHeader,
  verifiedLine,
  withBaseLinks,
} from "../references";

const own = [{ label: "Own guide", url: "https://example.gov/own" }];
const base = [
  { label: "Base guide", url: "https://example.gov/base" },
  { label: "Shared", url: "https://example.gov/own/" },
];
const info = {
  toggleLabel: "About these references",
  title: "About these references",
  paragraphs: ["Where they come from."],
  enhancement: "How an enhancement's list is built.",
  closing: ["Links verified."],
};

describe("withBaseLinks", () => {
  it("returns the own list, each URL once and unscoped, on the base tab", () => {
    expect(withBaseLinks([...own, ...own], null)).toEqual(own);
  });

  it("lists the enhancement's own first, then the base's, a link both cite once as its own", () => {
    const list = withBaseLinks(own, base);
    expect(list.map((l) => [l.label, l.scope])).toEqual([
      ["Own guide", "enhancement"],
      ["Base guide", "base"],
    ]);
  });
});

describe("ReferenceLinks", () => {
  it("on the base tab: no chip, and no enhancement sentence in the explainer", () => {
    render(<ReferenceLinks links={own} emptyMessage="none" info={info} />);
    expect(
      screen.queryByText(product.enhancementSpecificChip),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(info.toggleLabel));
    expect(screen.queryByText(info.enhancement)).not.toBeInTheDocument();
    expect(screen.getByText(info.closing[0]!)).toBeInTheDocument();
  });

  it("on an enhancement's tab: chips its own beside the title and explains the order before the closing line", () => {
    render(
      <ReferenceLinks
        links={own}
        base={base}
        emptyMessage="none"
        info={info}
      />,
    );
    const chip = screen.getByText(product.enhancementSpecificChip);
    expect(chip.parentElement).toContainElement(screen.getByText("Own guide"));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(
      /Where they come from\.How an enhancement's list is built\.Links verified\./,
    );
  });

  it("renders every link with no cap: 50 in one container, own and inherited", () => {
    const ownMany = Array.from({ length: 20 }, (_, i) => ({
      label: `Own ${i}`,
      url: `https://example.gov/own/${i}`,
    }));
    const baseMany = Array.from({ length: 30 }, (_, i) => ({
      label: `Base ${i}`,
      url: `https://example.gov/base/${i}`,
    }));
    render(
      <ReferenceLinks links={ownMany} base={baseMany} emptyMessage="none" />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(50);
    expect(
      screen.getByRole("group").querySelector("summary"),
    ).toHaveTextContent(
      "example.gov (50): 20 enhancement references, 30 base references",
    );
    expect(screen.getAllByText(product.enhancementSpecificChip)).toHaveLength(
      20,
    );
  });

  it("puts a site holding the enhancement's own references first, ahead of larger ones", () => {
    render(
      <ReferenceLinks
        links={[{ label: "Own", url: "https://small.example.gov/own" }]}
        base={[
          { label: "Base 1", url: "https://big.example.gov/1" },
          { label: "Base 2", url: "https://big.example.gov/2" },
        ]}
        emptyMessage="none"
      />,
    );
    const headers = screen
      .getAllByRole("group")
      .map((d) => d.querySelector("summary")!.textContent);
    expect(headers).toEqual([
      "small.example.gov (1): 1 enhancement reference",
      "big.example.gov (2): 2 base references",
    ]);
  });

  it("lists a link both cite once, as the enhancement's own", () => {
    render(
      <ReferenceLinks
        links={[{ label: "Shared", url: "https://example.gov/shared" }]}
        base={[
          { label: "Shared", url: "https://example.gov/shared/" },
          { label: "Base only", url: "https://example.gov/base-only" },
        ]}
        emptyMessage="none"
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Shared/ })).toHaveTextContent(
      product.enhancementSpecificChip,
    );
  });

  it("chips across site containers too", () => {
    render(
      <ReferenceLinks
        links={[{ ...own[0]!, domain: "FEDERAL" }]}
        base={[{ ...base[0]!, domain: "NIST" }]}
        emptyMessage="none"
      />,
    );
    expect(screen.getByRole("link", { name: /Own guide/ })).toHaveTextContent(
      product.enhancementSpecificChip,
    );
    expect(
      screen.getByRole("link", { name: /Base guide/ }),
    ).not.toHaveTextContent(product.enhancementSpecificChip);
  });
});

describe("linkHost", () => {
  it("lower-cases the host and drops a leading www", () => {
    expect(linkHost("https://WWW.Example.gov/a")).toBe("example.gov");
    expect(linkHost(" https://sub.example.gov/a ")).toBe("sub.example.gov");
  });

  it("groups a URL that does not parse as other", () => {
    expect(linkHost("not a url")).toBe("other");
  });
});

describe("verifiedLine", () => {
  it("dates the check when there is one, and says so when there is not", () => {
    expect(verifiedLine("2026-09-30T12:00:00Z")).toBe(
      "Links verified against their sites on 2026-09-30.",
    );
    for (const missing of [null, undefined, "not a date"]) {
      expect(verifiedLine(missing)).toBe(
        "These links have not yet been verified against their sites.",
      );
    }
  });

  describe("container header", () => {
    const own = (url: string) => ({
      label: url,
      url,
      scope: "enhancement" as const,
    });
    const inherited = (url: string) => ({
      label: url,
      url,
      scope: "base" as const,
    });
    const plain = (url: string) => ({ label: url, url });

    it("names one kind on the base tab, singular and plural", () => {
      expect(
        containerHeader(
          { host: "doi.org", links: [plain("a"), plain("b")] },
          false,
        ),
      ).toBe("doi.org (2): 2 base references");
      expect(
        containerHeader({ host: "doi.org", links: [plain("a")] }, false),
      ).toBe("doi.org (1): 1 base reference");
    });

    it("splits an enhancement's tab into its own and its base's, own first", () => {
      expect(
        containerHeader(
          {
            host: "docs.example.gov",
            links: [
              ...["1", "2", "3", "4"].map(own),
              ...Array.from({ length: 10 }, (_, i) => inherited(`b${i}`)),
            ],
          },
          true,
        ),
      ).toBe(
        "docs.example.gov (14): 4 enhancement references, 10 base references",
      );
    });

    it("leaves out a kind with none rather than counting it as zero", () => {
      expect(
        containerHeader(
          { host: "guide.example.gov", links: [own("a"), own("b")] },
          true,
        ),
      ).toBe("guide.example.gov (2): 2 enhancement references");
      expect(
        containerHeader(
          { host: "policy.example.gov", links: [inherited("a")] },
          true,
        ),
      ).toBe("policy.example.gov (1): 1 base reference");
    });
  });
});
