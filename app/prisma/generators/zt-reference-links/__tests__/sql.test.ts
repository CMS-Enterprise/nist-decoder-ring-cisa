import { describe, expect, it } from "vitest";
import { nistIdScheme } from "../../catalog/sql-writer.js";
import type { ReferenceLinkRow } from "../../reference-links/lib/resolve.js";
import type { Provenance } from "../../reference-links/lib/sql.js";
import { referenceLinkId, SEED_FILE, ztReferenceLinksSql } from "../lib/sql.js";

const scheme = nistIdScheme("5.2.0");
const PDF = "https://www.cisa.gov/files/ztmm.pdf";
const PAGE = "https://www.cisa.gov/zero-trust-maturity-model";
const provenance: Provenance = {
  id: "dsrc_zt-reference-links_cisa",
  name: "cisa zt reference links",
  type: "zt-reference-links",
  url: PAGE,
  checkedOn: "2026-09-30",
  description:
    "Zero Trust references authored per control: 2 documents, 3 links on 2 controls, 0 flagged for a manual check; live check of 2026-09-30.",
  createdById: "system_nist_gov",
};
const stats = { documents: 2, seededDocuments: 2, relocated: 0, manual: 0 };
const row = (
  controlNumber: string,
  url: string,
  title: string,
  displayOrder: number,
): ReferenceLinkRow => ({
  controlNumber,
  resourceUuid: "x",
  title,
  url,
  description: "CISA, April 2023.",
  resolvedUrl: null,
  contentType: null,
  displayOrder,
});
const rows = [
  row("AC-02", PDF, "Zero Trust Maturity Model, Version 2.0", 1),
  row("AC-02", PAGE, "Zero Trust Maturity Model", 2),
  row("IA-02", PDF, "Zero Trust Maturity Model, Version 2.0", 1),
];
const sql = ztReferenceLinksSql(
  rows,
  provenance,
  stats,
  scheme,
  "cisa",
  "Source: sources/reference-links/cisa/sources.csv, 3 rows on 2 controls; live results of 2026-09-30",
);

describe("referenceLinkId", () => {
  it("hashes the seeded URL into the document's id", () => {
    expect(referenceLinkId(PDF)).toMatch(/^rlink_[0-9a-f]{16}$/);
    expect(referenceLinkId(PDF)).toBe(referenceLinkId(PDF));
    expect(referenceLinkId(PDF)).not.toBe(referenceLinkId(PAGE));
  });
});

describe("ztReferenceLinksSql", () => {
  it("names the file it is and writes the provenance row first, typed for the Zero Trust pane", () => {
    expect(SEED_FILE).toBe("14-zt-reference-links.sql");
    expect(sql).toMatch(/^-- 14-zt-reference-links\.sql\n/);
    expect(sql).toContain(
      `('dsrc_zt-reference-links_cisa', 'cisa zt reference links', 'zt-reference-links', '${PAGE}', 'reference'::"AuthorityLevel", '2026-09-30'::timestamp, true,`,
    );
    expect(sql.indexOf('INSERT INTO "DataSource"')).toBeLessThan(
      sql.indexOf('INSERT INTO "ReferenceLink"'),
    );
    expect(sql.indexOf('INSERT INTO "ReferenceLink"')).toBeLessThan(
      sql.indexOf('INSERT INTO "NistControlLink"'),
    );
  });

  it("stores each document once, sorted by URL, with its domain, kind and provenance", () => {
    expect(sql).toContain(
      'INSERT INTO "ReferenceLink" ("id", "url", "title", "description", "domain", "linkType", "dataSourceId", "createdAt", "updatedAt")',
    );
    const documents = sql
      .split('INSERT INTO "ReferenceLink"')[1]!
      .split("ON CONFLICT")[0]!;
    expect(documents.match(/^\s+\('rlink_/gm)).toHaveLength(2);
    expect(documents).toContain(
      `('${referenceLinkId(PDF)}', '${PDF}', 'Zero Trust Maturity Model, Version 2.0', 'CISA, April 2023.', 'FEDERAL'::"LinkDomain", 'GUIDANCE'::"ReferenceLinkType", 'dsrc_zt-reference-links_cisa', NOW(), NOW())`,
    );
    expect(documents.indexOf(PDF)).toBeLessThan(documents.indexOf(PAGE));
    expect(sql).toContain('ON CONFLICT ("url") DO NOTHING;');
  });

  it("attaches each document to its controls in the authored order", () => {
    expect(sql).toContain(
      'INSERT INTO "NistControlLink" ("nistControlId", "linkId", "displayOrder")',
    );
    expect(sql).toContain(`('ctrl_ac-02_r520', '${referenceLinkId(PDF)}', 1)`);
    expect(sql).toContain(`('ctrl_ac-02_r520', '${referenceLinkId(PAGE)}', 2)`);
    expect(sql).toContain(`('ctrl_ia-02_r520', '${referenceLinkId(PDF)}', 1)`);
    expect(sql.trimEnd()).toMatch(
      /ON CONFLICT \("nistControlId", "linkId"\) DO NOTHING;$/,
    );
  });

  it("carries the counts in its header", () => {
    expect(sql).toContain(
      "-- 3 reference links on 2 live controls, from 2 of 2 authored documents; live check of 2026-09-30",
    );
  });

  it("puts no URL and no apostrophe in a comment line", () => {
    for (const line of sql.split("\n").filter((l) => l.startsWith("--"))) {
      expect(line).not.toMatch(/https?:\/\//);
      expect(line).not.toContain("'");
    }
  });

  it("still writes the provenance row when there are no rows", () => {
    const empty = ztReferenceLinksSql(
      [],
      provenance,
      { ...stats, seededDocuments: 0 },
      scheme,
      "cisa",
      "note",
    );
    expect(empty).toContain('INSERT INTO "DataSource"');
    expect(empty).toContain("-- No reference links.");
    expect(empty).not.toContain('INSERT INTO "ReferenceLink"');
  });
});
