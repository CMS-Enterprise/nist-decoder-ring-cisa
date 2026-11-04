/**
 * The demo's controls, held to what `docs/Demo.md` says about them.
 *
 * The demo walks five controls, one per Zero Trust state, and reaches a few more through
 * them. Each describe below is a section of the demo, and each assertion is a sentence in
 * it, checked against the seeded catalog. When a reseed changes what a demo step would
 * show, this file fails, and the demo is updated with it rather than left to mislead.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import type { db as AppDb } from "~/server/db";
import { createTestDb } from "~/test/db/harness";

// The same three stubs as decoder.integration.test.ts: the module-level db and the
// env it validates are never used (the real client arrives through ctx.db), and
// publicProcedure never reads the session.
vi.mock("~/server/db", () => ({ db: {} }));
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});
vi.mock("~/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

const db = createTestDb();
const caller = createCallerFactory(appRouter)({
  db: db as unknown as typeof AppDb,
  session: null,
  headers: new Headers(),
});

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

const detail = (controlId: string) =>
  caller.decoder.getControlById({ controlId });
type Detail = Awaited<ReturnType<typeof detail>>;
const tab = (d: Detail, id: string) => {
  const e = d.enhancements.find((x) => x.id === id);
  if (!e) throw new Error(`${d.id} has no tab ${id}`);
  return e;
};
const urls = (links: Array<{ url: string }>) =>
  new Set(links.map((l) => l.url));
const successorsOf = (d: { lineage: Detail["lineage"] }) =>
  (d.lineage?.successors ?? []).map((s) => s.controlNumber);

describe("the five demo controls on the layer cake", () => {
  it("cover the four chip states, with the facets the filter steps use", async () => {
    const { families } = await caller.decoder.getBridgeData();
    const card = (id: string) => {
      const c = families.flatMap((f) => f.controls).find((x) => x.id === id);
      if (!c) throw new Error(`${id} is not on the cake`);
      return c;
    };
    expect(card("AC-02").status).toBe("zt-aligned-with-enhancements");
    expect(card("SI-02").status).toBe("zt-aligned-with-enhancements");
    expect(card("CA-03").status).toBe("zero-trust-aligned");
    expect(card("SR-04").status).toBe("zt-via-enhancements");
    expect(card("IA-13").status).toBe("compliance");
    // Designation → Informative keeps CA-03 and drops AC-02 and SI-02.
    expect(card("CA-03").designations).toEqual(["INFORMATIVE"]);
    expect(card("AC-02").designations).not.toContain("INFORMATIVE");
    expect(card("SI-02").designations).not.toContain("INFORMATIVE");
    // Baseline → In no baseline keeps SR-04 and IA-13.
    expect(card("SR-04").baselines).toEqual([]);
    expect(card("IA-13").baselines).toEqual([]);
    expect(card("AC-02").baselines).toEqual(["Low", "Moderate", "High"]);
    // Family → SR is where SA-12's chain ends, and SR-04 is on it.
    expect(card("SR-04").family).toBe("SR");
  });
});

describe("AC-02: the full modal, and its lineage", () => {
  it("has twelve live tabs, six of them mapped, and one withdrawn", async () => {
    const ac02 = await detail("AC-02");
    expect(ac02.name).toBe("Account Management");
    const live = ac02.enhancements.filter((e) => e.catalogStatus === "live");
    expect(live).toHaveLength(12);
    expect(live.filter((e) => e.ztMapping)).toHaveLength(6);
    expect(
      ac02.enhancements
        .filter((e) => e.catalogStatus === "withdrawn")
        .map((e) => e.id),
    ).toEqual(["AC-02(10)"]);
  });

  it("asks for a frequency in item (j), which AC-02(01) inherits", async () => {
    const ac02 = await detail("AC-02");
    expect(ac02.frequency.nist.map((f) => f.part)).toEqual(["(j)"]);
    expect(ac02.frequency.nist[0]!.before).toContain(
      "accounts for compliance with account management requirements",
    );
    expect(tab(ac02, "AC-02(01)").frequency.nist).toEqual([]);
  });

  it("carries six tuples, Key and Supporting, guidance led by Agency, and all three methods", async () => {
    const ac02 = await detail("AC-02");
    const tuples = ac02.ztMapping!.affinities;
    expect(tuples).toHaveLength(6);
    expect(new Set(tuples.map((t) => t.designation))).toEqual(
      new Set(["KEY", "SUPPORTING"]),
    );
    expect(tuples.some((t) => t.guidance.includes("Agency"))).toBe(true);
    expect(ac02.assessment.objectives).toHaveLength(26);
    expect(
      ac02.assessment.methods.map((m) => [m.method, m.text !== null]),
    ).toEqual([
      ["EXAMINE", true],
      ["INTERVIEW", true],
      ["TEST", true],
    ]);
  });

  it("sends (10) to AC-02 item k, and lists what it took in, AC-13 among them", async () => {
    const ac02 = await detail("AC-02");
    const ten = tab(ac02, "AC-02(10)");
    expect(ten.catalogStatus).toBe("withdrawn");
    expect(ten.lineage!.successors).toHaveLength(1);
    expect(ten.lineage!.successors[0]).toMatchObject({
      controlNumber: "AC-02",
      part: "ac-2_smt.k",
    });
    expect(ten.lineage!.successors[0]!.ztPillars).toContain("IDENTITY");
    expect(ac02.lineage!.incorporates.map((i) => i.controlNumber)).toEqual([
      "AC-02(10)",
      "AC-13",
      "SC-14",
      "SI-09",
    ]);
  });

  it("ends AC-13's chain at AC-02 and AU-06, both mapped", async () => {
    const ac13 = await detail("AC-13");
    expect(ac13.catalogStatus).toBe("withdrawn");
    expect(successorsOf(ac13)).toEqual(["AC-02", "AU-06"]);
    for (const s of ac13.lineage!.successors) {
      expect(s.ztPillars?.length).toBeGreaterThan(0);
    }
  });
});

describe("SI-02: references, an enhancement's own frequency, and what is new", () => {
  it("lists the base's references in both panes, and asks for no frequency itself", async () => {
    const si02 = await detail("SI-02");
    expect(si02.name).toBe("Flaw Remediation");
    expect(si02.nistLinks).toHaveLength(8);
    expect(si02.ztLinks).toHaveLength(2);
    expect(si02.frequency.nist).toEqual([]);
  });

  it("gives SI-02(02) three Zero Trust references of its own, one shared with its base", async () => {
    const si02 = await detail("SI-02");
    const two = tab(si02, "SI-02(02)");
    const own = urls(two.ztLinks);
    const base = urls(si02.ztLinks);
    expect(own.size).toBe(3);
    expect([...own].filter((u) => base.has(u))).toHaveLength(1);
    // So the pane lists four, three chipped: the shared one once, as the enhancement's.
    expect(own.size + [...base].filter((u) => !own.has(u)).length).toBe(4);
    expect(two.nistLinks).toEqual([]);
    expect(two.frequency.nist).toHaveLength(1);
  });

  it("marks SI-02(07) new in 5.2.0 and sends (01) to PL-09", async () => {
    const si02 = await detail("SI-02");
    expect(tab(si02, "SI-02(07)").lineage!.addedIn).toEqual({
      release: "5.2.0",
      sinceRelease: "5.1.1+u4",
    });
    expect(successorsOf(tab(si02, "SI-02(01)"))).toEqual(["PL-09"]);
  });
});

describe("CA-03: the base alone is mapped", () => {
  it("is Informative throughout, If applicable once, and has no test method", async () => {
    const ca03 = await detail("CA-03");
    expect(ca03.name).toBe("Information Exchange");
    expect(
      ca03.enhancements.filter(
        (e) => e.catalogStatus === "live" && e.ztMapping,
      ),
    ).toEqual([]);
    const tuples = ca03.ztMapping!.affinities;
    expect(tuples).toHaveLength(4);
    expect(tuples.every((t) => t.designation === "INFORMATIVE")).toBe(true);
    expect(tuples.filter((t) => t.ifApplicable).map((t) => t.function)).toEqual(
      ["Application Access"],
    );
    expect(
      ca03.assessment.methods.find((m) => m.method === "TEST")!.text,
    ).toBeNull();
    expect(ca03.frequency.nist.map((f) => f.part)).toEqual(["(c)"]);
  });

  it("sends each of its five withdrawn tabs to an SC-07 enhancement", async () => {
    const ca03 = await detail("CA-03");
    const withdrawn = ca03.enhancements.filter(
      (e) => e.catalogStatus === "withdrawn",
    );
    expect(withdrawn.map((e) => e.id)).toEqual([
      "CA-03(01)",
      "CA-03(02)",
      "CA-03(03)",
      "CA-03(04)",
      "CA-03(05)",
    ]);
    expect(withdrawn.map((e) => successorsOf(e))).toEqual([
      ["SC-07(25)"],
      ["SC-07(26)"],
      ["SC-07(27)"],
      ["SC-07(28)"],
      ["SC-07(05)"],
    ]);
  });
});

describe("SR-04: only an enhancement is mapped", () => {
  it("has no mapping of its own, no baseline, and SR-04(04) mapped with its own reference", async () => {
    const sr04 = await detail("SR-04");
    expect(sr04.name).toBe("Provenance");
    expect(sr04.ztMapping).toBeFalsy();
    expect(sr04.baselines).toEqual([]);
    expect(sr04.nistLinks).toHaveLength(10);
    const four = tab(sr04, "SR-04(04)");
    expect(
      four.ztMapping!.affinities.map((t) => [
        t.pillar,
        t.function,
        t.maturity,
        t.designation,
      ]),
    ).toEqual([
      ["DEVICES", "Asset and Supply Chain", "ADVANCED", "SUPPORTING"],
    ]);
    expect(four.ztLinks).toHaveLength(1);
    expect(sr04.ztLinks).toEqual([]);
  });
});

describe("IA-13: not in CISA's mapping", () => {
  it("is unmapped, in no baseline, and its references are IA-13(03)'s own", async () => {
    const ia13 = await detail("IA-13");
    expect(ia13.name).toBe("Identity Providers and Authorization Servers");
    expect(ia13.ztMapping).toBeFalsy();
    expect(ia13.enhancements.some((e) => e.ztMapping)).toBe(false);
    expect(ia13.baselines).toEqual([]);
    expect(ia13.nistLinks).toEqual([]);
    expect(tab(ia13, "IA-13(03)").nistLinks).toHaveLength(3);
  });
});

describe("the withdrawn search, and where its chains end", () => {
  it("finds SA-12 only when asked, and never narrows the cake with it", async () => {
    const current = await caller.decoder.searchControls({ q: "SA-12" });
    expect(current.hits.map((h) => h.controlNumber)).not.toContain("SA-12");
    const all = await caller.decoder.searchControls({
      q: "SA-12",
      includeWithdrawn: true,
    });
    expect(all.hits[0]).toMatchObject({
      controlNumber: "SA-12",
      withdrawn: true,
    });
    expect(all.hits.filter((h) => h.withdrawn)).toHaveLength(16);
    expect(all.matchingIds).toEqual(current.matchingIds);
  });

  it("ends SA-12 at the SR family, and SA-12(14) on SR-04's tabs", async () => {
    const sa12 = await detail("SA-12");
    expect(sa12.lineage!.successors).toHaveLength(1);
    expect(sa12.lineage!.successors[0]).toMatchObject({
      controlNumber: "SR",
      family: true,
    });
    const fourteen = tab(sa12, "SA-12(14)");
    expect(
      fourteen.lineage!.successors.map((s) => [s.controlNumber, s.kind]),
    ).toEqual([
      ["SR-04(01)", "incorporated-into"],
      ["SR-04(02)", "incorporated-into"],
    ]);
    expect(successorsOf(tab(sa12, "SA-12(01)"))).toEqual(["SR-05"]);
  });

  it("ends SC-19 with no successor", async () => {
    const sc19 = await detail("SC-19");
    expect(sc19.catalogStatus).toBe("withdrawn");
    expect(sc19.lineage).not.toBeNull();
    expect(sc19.lineage!.successors).toEqual([]);
  });
});
