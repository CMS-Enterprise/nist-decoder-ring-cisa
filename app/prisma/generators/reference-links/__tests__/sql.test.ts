/**
 * The seed file is a reviewable artifact, so these assert what the SQL says.
 */

import { describe, expect, it } from "vitest";
import { nistIdScheme } from "../../catalog/sql-writer.js";
import {
  provenanceUpsertSql,
  referenceLinkId,
  referenceLinksSql,
  type Provenance,
} from "../lib/sql.js";

const scheme = nistIdScheme("5.2.0");
const provenance: Provenance = {
  id: "dsrc_reference-links_nist-800-53",
  name: "nist-800-53 reference links",
  type: "reference-links",
  url: "https://github.com/usnistgov/oscal-content/tree/78650f02ad9321bb7b817846f8fbd4f2bcd620de/nist.gov/SP800-53/rev5/json",
  checkedOn: "2026-09-29",
  description:
    "Reference links from the back-matter: 201 resources, 198 seeded, 3 held out, 20 flagged; live check of 2026-09-29.",
  createdById: "system_nist_gov",
};
const stats = {
  resources: 201,
  seededResources: 198,
  notSeeded: 3,
  relocated: 135,
  manual: 20,
};

describe("referenceLinkId", () => {
  it("derives the id from the control and the resource, scoped to the revision", () => {
    expect(
      referenceLinkId(
        "AC-02(01)",
        "27847491-5ce1-4f6a-a1e4-9e483782f0ef",
        scheme.token,
      ),
    ).toBe("nlink_ac-02_01__27847491_r520");
  });
});

describe("provenanceUpsertSql", () => {
  it("inserts the DataSource row and updates the date on conflict, so a re-seed never adds a row", () => {
    const sql = provenanceUpsertSql(provenance);
    expect(sql).toContain(
      'INSERT INTO "DataSource" ("id", "name", "type", "url", "authorityLevel", "lastCrawled", "isActive", "description", "createdById", "createdAt", "updatedAt")',
    );
    expect(sql).toContain(
      "('dsrc_reference-links_nist-800-53', 'nist-800-53 reference links', 'reference-links', 'https://github.com/usnistgov/oscal-content/tree/78650f02ad9321bb7b817846f8fbd4f2bcd620de/nist.gov/SP800-53/rev5/json', 'reference'::\"AuthorityLevel\", '2026-09-29'::timestamp, true,",
    );
    expect(sql).toContain("'system_nist_gov', NOW(), NOW())");
    expect(sql).toMatch(
      /ON CONFLICT \("id"\) DO UPDATE SET "url" = EXCLUDED\."url", "lastCrawled" = EXCLUDED\."lastCrawled", "description" = EXCLUDED\."description", "updatedAt" = NOW\(\);/,
    );
  });
});

describe("referenceLinksSql", () => {
  const rows = [
    {
      controlNumber: "AC-01",
      resourceUuid: "27847491-5ce1-4f6a-a1e4-9e483782f0ef",
      title: "OMB A-130",
      url: "https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf",
      description:
        "OMB Circular A-130, *Managing Information as a Strategic Resource*, July 2016.",
      resolvedUrl:
        "https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf",
      contentType: "application/pdf",
      displayOrder: 1,
    },
    {
      controlNumber: "AC-01",
      resourceUuid: "e3cc0520-a366-4fc9-abc2-5272db7e3564",
      title: "SP 800-39",
      url: "https://doi.org/10.6028/NIST.SP.800-39",
      description: null,
      resolvedUrl:
        "https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-39.pdf",
      contentType: "application/pdf",
      displayOrder: 2,
    },
  ];

  it("writes the provenance row first, then one NistLink row per citation pointing at it", () => {
    const sql = referenceLinksSql(
      rows,
      provenance,
      stats,
      scheme,
      "Source: test; live results of 2026-09-29",
    );
    expect(sql).toMatch(
      /^-- 10-reference-links\.sql\n-- Source: test; live results of 2026-09-29\n-- 2 reference links on 1 live controls, from 198 of 201 back-matter resources; live check of 2026-09-29\n/,
    );
    expect(sql.indexOf('INSERT INTO "DataSource"')).toBeLessThan(
      sql.indexOf('INSERT INTO "NistLink"'),
    );
    expect(sql).toContain(
      'INSERT INTO "NistLink" ("id", "nistControlId", "title", "url", "description", "resolvedUrl", "contentType", "displayOrder", "dataSourceId", "createdAt", "updatedAt")',
    );
    expect(sql).toContain(
      "('nlink_ac-01_27847491_r520', 'ctrl_ac-01_r520', 'OMB A-130', 'https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf', 'OMB Circular A-130, *Managing Information as a Strategic Resource*, July 2016.', 'https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf', 'application/pdf', 1, 'dsrc_reference-links_nist-800-53', NOW(), NOW())",
    );
    expect(sql).toContain(
      "('nlink_ac-01_e3cc0520_r520', 'ctrl_ac-01_r520', 'SP 800-39', 'https://doi.org/10.6028/NIST.SP.800-39', NULL, 'https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-39.pdf', 'application/pdf', 2, 'dsrc_reference-links_nist-800-53', NOW(), NOW())",
    );
    expect(sql).toMatch(/ON CONFLICT \("id"\) DO NOTHING;\n$/);
    expect(sql).toContain("Not seeded: 3 resources");
    expect(sql).toContain("Flagged for a manual check: 20 resources");
  });

  it("keeps every URL and every apostrophe out of the comments", () => {
    const sql = referenceLinksSql(rows, provenance, stats, scheme, "n");
    const comments = sql.split("\n").filter((l) => l.startsWith("--"));
    expect(comments.some((l) => /https?:\/\//.test(l))).toBe(false);
    expect(comments.some((l) => l.includes("'"))).toBe(false);
  });

  it("still writes the provenance row when there is nothing to seed", () => {
    const sql = referenceLinksSql(
      [],
      provenance,
      { ...stats, seededResources: 0 },
      scheme,
      "n",
    );
    expect(sql).toContain('INSERT INTO "DataSource"');
    expect(sql).toContain("-- No reference links.");
    expect(sql).not.toContain('INSERT INTO "NistLink"');
  });
});
