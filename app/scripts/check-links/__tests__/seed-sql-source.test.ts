/**
 * The seed-sql collector reads every single-quoted literal in a seed directory.
 * These pin the two ways that went wrong: an apostrophe in a comment inverting
 * every literal boundary after it, and a URL in a comment being checked as if
 * it were seeded.
 */

import { describe, expect, it } from "vitest";
import { extractUrlsFromSql, selectSeedFiles } from "../sources.js";

describe("extractUrlsFromSql", () => {
  it("attributes each URL literal to the nearest preceding id literal", () => {
    const sql = `INSERT INTO "NistLink" ("id", "nistControlId", "url")\nVALUES\n  ('nlink_ac-01_27847491_r520', 'ctrl_ac-01_r520', 'https://a.gov/one'),\n  ('nlink_ac-02_e3cc0520_r520', 'ctrl_ac-02_r520', 'https://b.gov/two');\n`;
    expect(extractUrlsFromSql("10-reference-links.sql", sql)).toEqual([
      {
        id: "ctrl_ac-01_r520",
        source: "seed-sql:10-reference-links.sql",
        url: "https://a.gov/one",
      },
      {
        id: "ctrl_ac-02_r520",
        source: "seed-sql:10-reference-links.sql",
        url: "https://b.gov/two",
      },
    ]);
  });

  it("is not thrown off by an apostrophe in a comment line", () => {
    const sql = `-- the catalog's back-matter, joined to each control's links\nINSERT INTO "NistLink" ("id", "url")\nVALUES\n  ('nlink_ac-01_x_r520', 'https://a.gov/one');\n`;
    expect(extractUrlsFromSql("f.sql", sql).map((r) => r.url)).toEqual([
      "https://a.gov/one",
    ]);
  });

  it("does not treat a URL inside a comment as seeded", () => {
    const sql = `-- was 'https://old.gov/dead' before the move\nINSERT INTO "NistLink" ("id", "url") VALUES ('nlink_a', 'https://a.gov/new');\n`;
    expect(extractUrlsFromSql("f.sql", sql).map((r) => r.url)).toEqual([
      "https://a.gov/new",
    ]);
  });

  it("reads a hand-maintained file's link list, attributing each URL to its control", () => {
    const sql = [
      "-- 17-zt-references-nist.sql (hand-maintained)",
      'INSERT INTO "ReferenceLink" ("id", "url", "title", "description", "domain", "linkType", "dataSourceId", "createdAt", "updatedAt")',
      "SELECT 'rlink_' || left(md5(d.url), 16), d.url, d.title, d.description, d.domain::\"LinkDomain\", 'GUIDANCE'::\"ReferenceLinkType\", 'dsrc_zt-references_nist', NOW(), NOW()",
      "FROM (VALUES",
      "  ('https://a.gov/doc.pdf#page=6', 'Doc, Tenets (p. 6)', 'NIST, Doc, August 2020, section 2.1, page 6: the tenets.', 'NIST')",
      ") AS d (url, title, description, domain);",
      'INSERT INTO "NistControlLink" ("nistControlId", "linkId", "displayOrder")',
      'SELECT v.control_id, (SELECT r.id FROM "ReferenceLink" r WHERE r.url = v.url), v.ord',
      "FROM (VALUES",
      "  ('ctrl_ac-03_r520', 'https://a.gov/doc.pdf#page=6', 1),",
      "  ('ctrl_sc-07_r520', 'https://a.gov/doc.pdf#page=6', 1)",
      ") AS v (control_id, url, ord);",
    ].join("\n");
    expect(extractUrlsFromSql("17-zt-references-nist.sql", sql)).toEqual([
      {
        id: "dsrc_zt-references_nist",
        source: "seed-sql:17-zt-references-nist.sql",
        url: "https://a.gov/doc.pdf#page=6",
      },
      {
        id: "ctrl_ac-03_r520",
        source: "seed-sql:17-zt-references-nist.sql",
        url: "https://a.gov/doc.pdf#page=6",
      },
      {
        id: "ctrl_sc-07_r520",
        source: "seed-sql:17-zt-references-nist.sql",
        url: "https://a.gov/doc.pdf#page=6",
      },
    ]);
  });
});

describe("selectSeedFiles", () => {
  const folder = [
    "14-zt-reference-links.sql",
    "00-cleanup.sql",
    "README.md",
    "17-zt-references-nist.sql",
  ];

  it("reads every .sql file, in name order, when no filter is given", () => {
    expect(selectSeedFiles(folder, undefined)).toEqual([
      "00-cleanup.sql",
      "14-zt-reference-links.sql",
      "17-zt-references-nist.sql",
    ]);
    expect(selectSeedFiles(folder, " ")).toEqual([
      "00-cleanup.sql",
      "14-zt-reference-links.sql",
      "17-zt-references-nist.sql",
    ]);
  });

  it("narrows to the named files", () => {
    expect(
      selectSeedFiles(
        folder,
        "17-zt-references-nist.sql, 14-zt-reference-links.sql",
      ),
    ).toEqual(["14-zt-reference-links.sql", "17-zt-references-nist.sql"]);
  });

  it("fails on a name the folder does not hold rather than scanning nothing", () => {
    expect(() => selectSeedFiles(folder, "18-missing.sql")).toThrow(
      /18-missing.sql, not in the seed folder/,
    );
  });
});
