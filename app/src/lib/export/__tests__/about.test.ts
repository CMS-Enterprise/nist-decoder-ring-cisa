import { describe, expect, it, vi } from "vitest";

// The selection's parsers read the product config, which validates ~/env at import; nothing here connects.
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});

const { controlLink, exportFileName, selectionLines, selectionSlug } =
  await import("../about");
const { loadExportSelection } = await import("../selection");

const at = new Date("2026-11-09T14:05:00Z");

describe("the file name", () => {
  it("carries the catalog, the day and a short form of the filters", () => {
    expect(
      exportFileName(
        "Example Catalog 5.2",
        "xlsx",
        loadExportSelection("?maturity=OPTIMAL"),
        at,
      ),
    ).toBe("example-catalog-5.2-2026-11-09-optimal.xlsx");
    expect(
      exportFileName(
        "Example Catalog 5.2",
        "docx",
        loadExportSelection(""),
        at,
      ),
    ).toBe("example-catalog-5.2-2026-11-09.docx");
  });

  it("names picks by their count and says what a long filter set left out", () => {
    expect(
      selectionSlug(loadExportSelection("?pick=AC-02,AC-03&pillar=DATA")),
    ).toBe("2-picked");
    expect(
      selectionSlug(
        loadExportSelection(
          "?pillar=IDENTITY,DEVICES,NETWORKS,APPLICATIONS,DATA&maturity=OPTIMAL",
        ),
      ),
    ).toBe("identity-devices-networks-applications-and-2-more");
    expect(selectionSlug(loadExportSelection("?q=Least Privilege!"))).toBe(
      "least-privilege",
    );
  });
});

describe("the selection, as lines", () => {
  it("names each filter as the filter bar does", () => {
    expect(
      selectionLines(
        loadExportSelection("?pillar=APPLICATIONS,DATA&family=AC&q=audit"),
      ),
    ).toEqual([
      "Pillar: Apps & Workloads, Data",
      "Family: AC",
      'Search: "audit"',
    ]);
  });

  it("names the designation filter as the bar does", () => {
    expect(
      selectionLines(loadExportSelection("?designation=KEY,SUPPORTING")),
    ).toEqual(["Designation: Key, Supporting"]);
  });

  it("lists the picks alone, since the filters only narrowed what was picked from", () => {
    expect(
      selectionLines(loadExportSelection("?pick=AC-02&pillar=DATA")),
    ).toEqual(["Picked: AC-02"]);
  });

  it("names every spelling of a selection one way, as they share one cached file", () => {
    expect(
      selectionLines(loadExportSelection("?pick=ac-3,AC-02,ac-2")),
    ).toEqual(["Picked: AC-02, AC-03"]);
    expect(selectionSlug(loadExportSelection("?pick=ac-3,AC-02,ac-2"))).toBe(
      "2-picked",
    );
    expect(
      selectionLines(loadExportSelection("?pillar=DATA,IDENTITY&q= Audit ")),
    ).toEqual(["Pillar: Identity, Data", 'Search: "audit"']);
  });

  it("says when nothing narrows the catalog", () => {
    expect(selectionLines(loadExportSelection(""))).toEqual([
      "None: every control in the catalog",
    ]);
  });
});

describe("a control's link", () => {
  it("opens a base control, or an enhancement on its tab", () => {
    expect(controlLink("https://app.example.gov", "AC-02")).toBe(
      "https://app.example.gov/control/AC-02",
    );
    expect(controlLink("https://app.example.gov", "AC-02(01)")).toBe(
      "https://app.example.gov/control/AC-02?enh=01",
    );
  });
});
