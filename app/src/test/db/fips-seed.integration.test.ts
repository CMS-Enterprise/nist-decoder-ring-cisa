/**
 * The FIPS 199 and FIPS 200 rows, held to what 20-fips.sql says about them.
 *
 * Both tables are hand-written seed from the published standards, so nothing regenerates
 * them and no gate measures them. These assertions pin the shape a reader of either table
 * can rely on: three impact levels in rank order, one FIPS 200 area per family that answers
 * one, and each area's deep link opening the page its row names.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "~/test/db/harness";

const db = createTestDb();

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

const FIPS_199 = "https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.199.pdf";
const FIPS_200 = "https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.200.pdf";

describe("FIPS 199 impact levels against the seeded catalog", () => {
  it("seeds the three levels, ranked low to high, each from the FIPS 199 PDF", async () => {
    const levels = await db.fipsImpactLevel.findMany({
      orderBy: { rank: "asc" },
    });
    expect(levels.map((l) => l.id)).toEqual(["LOW", "MODERATE", "HIGH"]);
    expect(levels.map((l) => l.rank)).toEqual([1, 2, 3]);
    // PDF page indices: LOW and MODERATE are defined on the PDF's sixth page, HIGH on
    // its seventh (the printed pages 2 and 3), read from the published file.
    expect(levels.map((l) => l.pdfPage)).toEqual([6, 6, 7]);
    for (const level of levels) {
      expect(level.sourceUrl).toBe(FIPS_199);
      expect(level.definitionText).toContain(level.effectPhrase);
      expect(
        level.amplificationText.startsWith(
          `A ${level.effectPhrase} means that, for example, `,
        ),
      ).toBe(true);
    }
  });
});

describe("FIPS 200 minimum security requirements against the seeded catalog", () => {
  it("seeds seventeen areas, one per family that answers one, in FIPS 200's order", async () => {
    const areas = await db.fips200Requirement.findMany({
      orderBy: { sortOrder: "asc" },
      include: { controlFamily: true },
    });
    expect(areas).toHaveLength(17);
    expect(areas.map((a) => a.sortOrder)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
    expect(areas.map((a) => a.controlFamilyId)).toEqual([
      "AC",
      "AT",
      "AU",
      "CA",
      "CM",
      "CP",
      "IA",
      "IR",
      "MA",
      "MP",
      "PE",
      "PL",
      "PS",
      "RA",
      "SA",
      "SC",
      "SI",
    ]);
    for (const area of areas) {
      expect(area.controlFamily.id).toBe(area.controlFamilyId);
      expect(area.requirementText.startsWith("Organizations must")).toBe(true);
    }
  });

  it("leaves the three families FIPS 200 predates without an area", async () => {
    const families = await db.controlFamily.findMany({
      where: { fips200Requirement: null },
      orderBy: { id: "asc" },
    });
    expect(families.map((f) => f.id)).toEqual(["PM", "PT", "SR"]);
  });

  it("names each area as FIPS 200 does, and deep-links to the page its row names", async () => {
    const areas = await db.fips200Requirement.findMany();
    for (const area of areas) {
      expect(area.sourceUrl).toBe(FIPS_200);
      expect(area.deepLink).toBe(`${FIPS_200}#page=${area.pdfPage}`);
    }
    const ca = areas.find((a) => a.controlFamilyId === "CA");
    expect(ca?.areaName).toBe(
      "Certification, Accreditation, and Security Assessments",
    );
    // The PDF page each area sits on, read from the published file: the first four on
    // the eighth page, the next eleven on the ninth, the last two on the tenth.
    const pageOf = Object.fromEntries(
      areas.map((a) => [a.controlFamilyId, a.pdfPage]),
    );
    expect(pageOf).toEqual({
      AC: 8,
      AT: 8,
      AU: 8,
      CA: 8,
      CM: 9,
      CP: 9,
      IA: 9,
      IR: 9,
      MA: 9,
      MP: 9,
      PE: 9,
      PL: 9,
      PS: 9,
      RA: 9,
      SA: 9,
      SC: 10,
      SI: 10,
    });
  });

  it("records when its links were last checked, as the other hand-maintained files do", async () => {
    const source = await db.dataSource.findUnique({
      where: { id: "dsrc_fips" },
    });
    expect(source?.type).toBe("fips");
    expect(source?.isActive).toBe(true);
    expect(source?.lastCrawled).not.toBeNull();
  });
});
