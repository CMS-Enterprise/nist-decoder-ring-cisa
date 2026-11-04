import { describe, expect, it } from "vitest";
import {
  linkDomainOf,
  parseSources,
  probeGroups,
  resourceId,
  SOURCES_HEADER,
  sourceIssues,
  toReferences,
  toResources,
  ZT_REGISTRY_HEADER,
} from "../lib/sources.js";

const HEADER = SOURCES_HEADER.join(",");
const PDF = "https://www.cisa.gov/files/ztmm.pdf";
const PAGE = "https://www.cisa.gov/zero-trust-maturity-model";

function table(...lines: string[]): string {
  return [HEADER, ...lines].join("\n") + "\n";
}

const LIVE = new Set(["AC-02", "AC-03", "IA-02"]);

describe("parseSources", () => {
  it("reads one row per line, trims fields, and reads an empty citation as null", () => {
    const rows = parseSources(
      table(
        `AC-02,${PDF},"Zero Trust Maturity Model, Version 2.0","CISA, April 2023.",1`,
        `AC-02, ${PAGE} ,Zero Trust Maturity Model,,2`,
      ),
    );
    expect(rows).toEqual([
      {
        controlNumber: "AC-02",
        url: PDF,
        title: "Zero Trust Maturity Model, Version 2.0",
        citation: "CISA, April 2023.",
        displayOrder: 1,
        line: 2,
      },
      {
        controlNumber: "AC-02",
        url: PAGE,
        title: "Zero Trust Maturity Model",
        citation: null,
        displayOrder: 2,
        line: 3,
      },
    ]);
  });

  it("refuses a table whose header is not the one it reads", () => {
    expect(() => parseSources("control,url,title\nAC-02,x,y\n")).toThrow(
      /must start with the header control_number,url,title,citation,display_order/,
    );
  });

  it("reads a display order that is not a number as NaN, for the gate to name", () => {
    const [row] = parseSources(table(`AC-02,${PDF},T,,first`));
    expect(Number.isNaN(row!.displayOrder)).toBe(true);
  });
});

describe("resources and references", () => {
  const rows = parseSources(
    table(
      `AC-02,${PDF},Model,Cite.,1`,
      `AC-02,${PAGE},Page,,2`,
      `AC-03,${PDF},Model,Cite.,1`,
    ),
  );

  it("stores a document once, keyed by a hash of its URL, with the first row's title and citation", () => {
    const resources = toResources(rows);
    expect(resources).toHaveLength(2);
    expect(resources[0]).toEqual({
      uuid: resourceId(PDF),
      title: "Model",
      citation: "Cite.",
      url: PDF,
    });
    expect(resourceId(PDF)).toMatch(/^[0-9a-f]{40}$/);
    expect(resourceId(PDF)).toBe(resourceId(PDF));
  });

  it("emits one citation per row in the authored order", () => {
    expect(toReferences(rows)).toEqual([
      { controlNumber: "AC-02", resourceUuid: resourceId(PDF), order: 1 },
      { controlNumber: "AC-02", resourceUuid: resourceId(PAGE), order: 2 },
      { controlNumber: "AC-03", resourceUuid: resourceId(PDF), order: 1 },
    ]);
  });

  it("names the registry columns for a document rather than a catalog resource", () => {
    expect(ZT_REGISTRY_HEADER[0]).toBe("resource_id");
    expect(ZT_REGISTRY_HEADER[3]).toBe("source_url");
    expect(ZT_REGISTRY_HEADER).toHaveLength(15);
  });
});

describe("probeGroups", () => {
  it("requests an address once however many page anchors cite it, and keeps every authored URL", () => {
    const groups = probeGroups([
      `${PDF}#page=14`,
      `${PDF}#page=27`,
      `${PDF}#page=14`,
      PAGE,
      PDF,
    ]);
    expect([...groups.keys()]).toEqual([PDF, PAGE]);
    expect(groups.get(PDF)).toEqual([`${PDF}#page=14`, `${PDF}#page=27`, PDF]);
    expect(groups.get(PAGE)).toEqual([PAGE]);
  });
});

describe("linkDomainOf", () => {
  it.each([
    ["https://csrc.nist.gov/pubs/sp/800/207/final", "NIST"],
    ["https://nvlpubs.nist.gov/x.pdf", "NIST"],
    ["https://www.cisa.gov/zero-trust-maturity-model", "FEDERAL"],
    ["https://www.whitehouse.gov/omb/m-22-09.pdf", "FEDERAL"],
    ["https://dodcio.defense.gov/zero-trust/", "FEDERAL"],
    ["https://www.esd.whs.mil/x", "FEDERAL"],
    ["https://www.iso.org/standard/1.html", "EXTERNAL"],
    ["not a url", "EXTERNAL"],
  ])("%s is %s", (url, domain) => {
    expect(linkDomainOf(url)).toBe(domain);
  });
});

describe("sourceIssues", () => {
  it("is empty for a well-authored table", () => {
    const rows = parseSources(
      table(
        `AC-02,${PDF},Model,,1`,
        `AC-02,${PAGE},Page,,2`,
        `IA-02,${PDF},Model,,1`,
      ),
    );
    expect(sourceIssues(rows, LIVE)).toEqual({
      unknownControls: [],
      duplicatePairs: [],
      badOrders: [],
      emptyTitles: [],
      conflictingDocuments: [],
      urlDefects: [],
    });
  });

  it("names each way a table goes wrong", () => {
    const rows = parseSources(
      table(
        `AC-02,${PDF},Model,,1`,
        `AC-02,${PDF},Model,,1`,
        `AC-02,https://www.cisa.gov/other,,,0`,
        `AC-99,${PAGE},Page,,x`,
        `IA-02,${PDF},Another title,,1`,
        `IA-02,https://a.gov/https://b.gov/x,Broken,,2`,
      ),
    );
    const issues = sourceIssues(rows, LIVE);
    expect(issues.unknownControls).toEqual(["AC-99"]);
    expect(issues.duplicatePairs).toEqual([`AC-02 ${PDF}`]);
    expect(issues.badOrders).toEqual(["AC-02:1", "AC-02:0", "AC-99:NaN"]);
    expect(issues.emptyTitles).toEqual(["line 4"]);
    expect(issues.conflictingDocuments).toEqual([PDF]);
    expect(issues.urlDefects).toEqual(["https://a.gov/https://b.gov/x"]);
  });
});
