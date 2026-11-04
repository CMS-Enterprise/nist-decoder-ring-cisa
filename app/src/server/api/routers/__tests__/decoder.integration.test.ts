/**
 * The three decoder procedures the UI leans on, run against a real seeded
 * Postgres. Asserts the SHAPE the client receives — exact key sets, enum
 * membership, join strings — so a renamed or dropped field fails here instead of
 * at request time.
 *
 * Why this exists alongside decoder.test.ts: the mocked suite supplies the very
 * row shape it then asserts, so it cannot notice when the database stops
 * producing that shape. It stays, because it covers branches seed data never
 * reaches (empty pillars, TBD maturity, a missing children key). This file
 * covers the contract.
 *
 * Anchors are chosen to survive data churn. Counts come from the seed's own
 * headers; the per-control anchor is AC-02, the richest control in the catalog.
 * Ordering within a family is asserted as a SET, never positionally — control
 * numbers sort differently under C and en_US collation, and the compose file
 * pins neither.
 *
 * This catalog carries no Zero Trust overlay yet, so the assertions that need
 * mapping rows pin the unmapped contract instead of passing vacuously. Each one
 * says what it will assert once an overlay is seeded.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  MATURITY_VALUES,
  PILLAR_VALUES,
  STATUS_VALUES,
} from "~/app/_components/decoder-ring/useDecoderQuery";
import {
  baselineKey,
  FAMILY_CODES,
  passesFacets,
  type FilterQuery,
} from "~/app/_components/decoder-ring/filterPredicate";
import { product } from "~/config/product";
import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import type { db as AppDb } from "~/server/db";
import { createTestDb } from "~/test/db/harness";
import { ZT_GUIDANCE_PENDING } from "../decoder";

// The router's import graph reaches ~/server/db, which imports ~/env, whose zod
// schema demands DATABASE_URL at import time — before inject() can supply the
// container's URL. The module-level `db` is never used here (the real client
// arrives through ctx.db), so stubbing the module stops the env validation
// without changing what the router queries. Same pattern as decoder.test.ts.
vi.mock("~/server/db", () => ({ db: {} }));

// ~/config/product reaches ~/env too, and the db stub above does not cover that
// path. The container's URL only arrives later, through inject(), so a
// placeholder satisfies the schema at import. Nothing connects through it: the
// real client arrives through ctx.db.
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});

// Same graph reaches next-auth through ~/server/auth. publicProcedure never
// reads the session, so a stub is enough.
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

// The exact key set the client reads from each shape. A renamed field changes
// one of these sets, and toEqual on sorted keys is what turns that into a
// failure rather than an undefined the component silently renders.
//
// Exact equality rather than "contains at least these", deliberately. A looser
// assertion would let an ADDED key through, and the added key is the failure
// this program most needs to catch: the Standard product must carry no other
// catalog's content, so a product-specific field leaking into a shared payload has to fail a
// test rather than ship. The cost is that a legitimately additive field fails
// here until the list is updated — which is the intended review moment, where
// someone confirms every client can handle the new field.
const BRIDGE_CONTROL_KEYS = [
  "baselines",
  "designations",
  "enhancementBaselines",
  "family",
  "functions",
  "id",
  "maturities",
  "name",
  "oscalId",
  "pillars",
  "status",
  "ztMapping",
];
// Alphabetical, because keysOf() sorts. The rename from arsLinks/cmsDiscussion
// to nistLinks/discussion moved two entries, so the literal is re-sorted to match.
const DETAIL_KEYS = [
  "assessment",
  "assessmentFrequency",
  "baselines",
  "catalogStatus",
  "description",
  "discussion",
  "enhancements",
  "frequency",
  "id",
  "lineage",
  "name",
  "nistLinks",
  "oscalId",
  "parts",
  "priority",
  "referenceProvenance",
  "reviewFrequency",
  "status",
  "ztLinks",
  "ztMapping",
  "ztReferenceProvenance",
];
// An enhancement is a control detail without the top-level-only fields: the
// enhancements list itself, and the two reference-link provenances, one row per
// corpus each, reported once with the base control.
const ENHANCEMENT_KEYS = DETAIL_KEYS.filter(
  (k) =>
    k !== "enhancements" &&
    k !== "referenceProvenance" &&
    k !== "ztReferenceProvenance",
);
// A reference-link entry: the label and href, what the link leads to, and the
// catalog's citation. The Zero Trust pane's entries add the domain that groups them.
const NIST_LINK_KEYS = ["citation", "descriptor", "label", "url"];
const ZT_LINK_KEYS = ["citation", "descriptor", "domain", "label", "url"];
const PART_KEYS = [
  "children",
  "id",
  "label",
  "name",
  "oscalPartId",
  "parameters",
  "prose",
  "sortOrder",
  "ztCovered",
];

const keysOf = (o: object) => Object.keys(o).sort();

describe("catalog identity against the seeded catalog", () => {
  // The one place the migration, the seed writer and the payload have to agree. A mock
  // supplies whatever shape it then asserts, so it cannot notice a column the migration
  // added under a different name than the generator writes, or a NOT NULL the seed leaves
  // empty. This reads the real row through the real client.
  it("resolves one catalog carrying its full identity", async () => {
    const v = await caller.decoder.getActiveVersion();

    expect(v.catalogKey).toBe("nist-800-53-r5");
    expect(v.displayLabel).toBe("NIST SP 800-53 Rev 5");
    expect(v.upstreamRevision).toBe("NIST SP 800-53 Rev 5.2.0");
    // Null carries meaning: a stock catalog applies no tailoring, which is not
    // the same as applying one and failing to describe it.
    expect(v.tailoringNote).toBeNull();
    expect(v.version).toBe("800-53r5.2.0");
  });

  it("labels the bridge from the catalog row rather than a composed template", async () => {
    const [bridge, version] = await Promise.all([
      caller.decoder.getBridgeData(),
      caller.decoder.getActiveVersion(),
    ]);
    // getBridgeData used to compose this string from a template. It now reads the
    // column, so the two must be the same string rather than merely look alike.
    expect(bridge.version).toBe(version.displayLabel);
  });

  it("holds exactly one active catalog, since a deployment serves one", async () => {
    const active = await db.nistVersion.findMany({ where: { isActive: true } });
    expect(active).toHaveLength(1);
    expect(active[0]!.catalogKey).toBe("nist-800-53-r5");
  });

  it("carries the catalogKey unique index the schema declares", async () => {
    const rows = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'NistVersion' AND indexname = 'NistVersion_catalogKey_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain("UNIQUE");
  });
});

describe("getBridgeData against the seeded catalog", () => {
  it("recognises every family the catalog actually ships as an identifier query", async () => {
    // Two independent lists that must agree: the families the seed produces, and the
    // codes the search predicate treats as identifier queries. They live on opposite
    // sides of the app and nothing else compares them, so a family added to a catalog
    // would silently become un-searchable by its own code — the query would fall through
    // to the free-text path and match on names instead.
    const data = await caller.decoder.getBridgeData();
    const seeded = data.families.map((f) => f.id).sort();
    expect(seeded).toEqual([...FAMILY_CODES].sort());
    // Each one has controls behind it, so the identifier path is reachable for all of
    // them rather than merely declared.
    for (const family of data.families) {
      expect(family.controls.length).toBeGreaterThan(0);
    }
  });

  it("returns the active version and the full family set", async () => {
    const data = await caller.decoder.getBridgeData();
    expect(data.version).toBe("NIST SP 800-53 Rev 5");
    expect(data.families).toHaveLength(20);
    // 1,014 live controls, of which 714 are enhancements, leaves 300 base
    // controls on the cake. The 182 withdrawn controls are seeded, 24 of them base
    // controls, and the cake leaves them out: they are reached from the modal.
    const all = data.families.flatMap((f) => f.controls);
    expect(all).toHaveLength(300);
    expect(all.map((c) => c.id)).not.toContain("AC-13");
  });

  it("populates every status bucket, and each bucket's control has the exact key set", async () => {
    const { families } = await caller.decoder.getBridgeData();
    const all = families.flatMap((f) => f.controls);
    const byStatus = new Map<string, typeof all>();
    for (const c of all) {
      byStatus.set(c.status, [...(byStatus.get(c.status) ?? []), c]);
    }
    // All four buckets are reachable now that the Zero Trust overlay is seeded
    // against this catalog. Each bucket's size is recomputed from the seeded
    // rows rather than pinned, so a new edition of the mapping moves the
    // numbers without failing the suite, while a roll-up that disagrees with
    // the rows it reads still fails here as a number.
    expect([...byStatus.keys()].sort()).toEqual([...STATUS_VALUES].sort());
    // The cake's own definition: live base controls, and their live enhancements.
    const bases = await db.nistControl.findMany({
      where: { parentControlId: null, status: "LIVE" },
      select: {
        ztMapping: { select: { id: true } },
        children: {
          where: { ztMapping: { isNot: null }, status: "LIVE" },
          select: { id: true },
          take: 1,
        },
      },
    });
    const expected = {
      compliance: 0,
      "zero-trust-aligned": 0,
      "zt-aligned-with-enhancements": 0,
      "zt-via-enhancements": 0,
    };
    for (const b of bases) {
      const own = b.ztMapping !== null;
      const viaChild = b.children.length > 0;
      const status = own
        ? viaChild
          ? "zt-aligned-with-enhancements"
          : "zero-trust-aligned"
        : viaChild
          ? "zt-via-enhancements"
          : "compliance";
      expected[status] += 1;
    }
    for (const [status, n] of Object.entries(expected)) {
      expect(byStatus.get(status) ?? [], status).toHaveLength(n);
    }
    for (const [, controls] of byStatus) {
      // `ztMapping` is present-but-undefined on compliance controls, so it is
      // in the key set either way. That is part of the contract.
      expect(keysOf(controls[0]!)).toEqual(BRIDGE_CONTROL_KEYS);
    }
  });

  it("carries each base control's baselines for the baseline filter", async () => {
    // The layer cake shows base controls only; the facet matches their own baselines.
    const { families } = await caller.decoder.getBridgeData();
    const bases = families.flatMap((f) => f.controls);
    const count = (b: string) =>
      bases.filter((c) => c.baselines.includes(b)).length;
    expect(bases.find((c) => c.id === "AC-01")!.baselines).toEqual([
      "Low",
      "Moderate",
      "High",
      "Privacy",
    ]);
    expect(count("Low")).toBeGreaterThan(0);
    expect(count("Moderate")).toBeGreaterThanOrEqual(count("Low"));
    expect(count("High")).toBeGreaterThanOrEqual(count("Moderate"));
    expect(bases.some((c) => c.baselines.length === 0)).toBe(true);
  });

  it("knows every seeded baseline value, and matches a base control through its enhancements", async () => {
    const { families } = await caller.decoder.getBridgeData();
    const bases = families.flatMap((f) => f.controls);
    // A value outside the product's list would draw no chip and match no option.
    const known = new Set(product.catalogBaselines);
    expect(
      bases.flatMap((c) =>
        [...c.baselines, ...c.enhancementBaselines].filter(
          (b) => !known.has(b),
        ),
      ),
    ).toEqual([]);
    const EMPTY_QUERY: FilterQuery = {
      pillar: [],
      maturity: [],
      designation: [],
      baseline: [],
      family: [],
      status: [],
      q: "",
    };
    const gains = product.catalogBaselines.map((b) => {
      const q = { ...EMPTY_QUERY, baseline: [baselineKey(b)] };
      const own = bases.filter((c) => c.baselines.includes(b));
      const matched = bases.filter((c) => passesFacets(c, q));
      expect(own.every((c) => matched.includes(c))).toBe(true);
      return matched.length - own.length;
    });
    expect(gains.some((g) => g > 0)).toBe(true);

    // The six base controls outside Privacy whose enhancements are in it.
    const privacy = { ...EMPTY_QUERY, baseline: [baselineKey("Privacy")] };
    for (const id of ["AC-03", "AU-03", "PE-08", "PM-05", "SA-08", "SC-07"]) {
      const c = bases.find((b) => b.id === id)!;
      expect(c.baselines).not.toContain("Privacy");
      expect(passesFacets(c, privacy)).toBe(true);
    }
  });

  it("emits only pillar and maturity names the client's filters recognize", async () => {
    // The nuqs parsers in useDecoderQuery drop any value outside these unions
    // silently. An enum member added to the schema but not to the client is
    // therefore an unfilterable control, and only a real driver round-trips the
    // actual enum NAME to check.
    const { families } = await caller.decoder.getBridgeData();
    const pillars = new Set(
      families.flatMap((f) => f.controls.flatMap((c) => c.pillars)),
    );
    const maturities = new Set(
      families.flatMap((f) => f.controls.flatMap((c) => c.maturities)),
    );
    for (const p of pillars) expect(PILLAR_VALUES).toContain(p);
    for (const m of maturities) expect(MATURITY_VALUES).toContain(m);
    // Pin the set sizes so an empty result can never masquerade as a passing
    // check: the loops above are satisfied by zero values as readily as by five.
    // CISA's mapping uses the model's five pillars and no standalone capability.
    expect(pillars.size).toBe(5);
    expect(maturities.size).toBeGreaterThan(0);
  });

  it("resolves guidance for every mapped control — the sentinel never reaches the bridge", async () => {
    const { families } = await caller.decoder.getBridgeData();
    const mapped = families
      .flatMap((f) => f.controls)
      .filter((c) => c.ztMapping !== undefined);
    // As many as the base controls the seed maps, and more than none, so the
    // loop below cannot pass by iterating nothing, which is what it did before
    // the overlay existed.
    const mappedBases = await db.zeroTrustMapping.count({
      where: { nistControl: { parentControlId: null } },
    });
    expect(mappedBases).toBeGreaterThan(0);
    expect(mapped).toHaveLength(mappedBases);
    for (const c of mapped) {
      expect(c.ztMapping!.guidance).not.toBe(ZT_GUIDANCE_PENDING);
    }
  });

  it("returns family membership that is order-independent", async () => {
    // Deliberately a set. Control numbers sort differently under C and en_US
    // collation, so positional assertions here would pass on one machine and
    // fail in CI.
    const { families } = await caller.decoder.getBridgeData();
    const ma = families.find((f) => f.id === "MA")!;
    const ids = new Set(ma.controls.map((c) => c.id));
    expect(ids.has("MA-01")).toBe(true);
    expect(ids.has("MA-04")).toBe(true);
    expect(ma.controls).toHaveLength(7);
  });
});

describe("getControlById against the seeded catalog", () => {
  it("returns AC-02 with the exact key set at every level", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(keysOf(ctrl)).toEqual(DETAIL_KEYS);
    expect(keysOf(ctrl.enhancements[0]!)).toEqual(ENHANCEMENT_KEYS);
    expect(keysOf(ctrl.parts[0]!)).toEqual(PART_KEYS);
    expect(keysOf(ctrl.parts[0]!.children[0]!)).toEqual(PART_KEYS);
    expect(keysOf(ctrl.nistLinks[0]!)).toEqual(NIST_LINK_KEYS);
    expect(keysOf(ctrl.referenceProvenance!)).toEqual([
      "checkedOn",
      "description",
      "name",
    ]);
  });

  it("carries AC-02's SP 800-53A assessment procedures, attached to the parts they assess", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    // 26 determination statements at the pin, every one attached to a lettered item because AC-02's root statement carries no prose of its own.
    expect(ctrl.assessment.objectives).toHaveLength(26);
    expect(ctrl.assessment.objectives.every((o) => o.partId !== null)).toBe(
      true,
    );
    expect(ctrl.assessment.objectives[0]).toMatchObject({
      identifier: "DS-AC-02a.[01]",
      text: "account types allowed for use within the system are defined and documented;",
    });
    // Rendered, not raw: no <XX-00_ODP[00] ...> markup reaches the client.
    for (const o of ctrl.assessment.objectives)
      expect(o.text).not.toMatch(/<[A-Z]{2}-\d{2}/);
    expect(ctrl.assessment.methods.map((m) => m.method)).toEqual([
      "EXAMINE",
      "INTERVIEW",
      "TEST",
    ]);
    for (const m of ctrl.assessment.methods)
      expect(m.text?.startsWith("[SELECT FROM:")).toBe(true);
    // An enhancement with a single-block statement attaches its determination to the control's root, which the client sees as a null partId.
    const first = ctrl.enhancements.find((e) => e.id === "AC-02(01)")!;
    expect(first.assessment.objectives).toHaveLength(1);
    expect(first.assessment.objectives[0]!.partId).toBeNull();
  });

  it("names the absent method kind rather than omitting it, for each of the three gaps NIST has", async () => {
    // The shape of NIST's unevenness, asserted against the seeded data rather than described: every live control carries at least one method, and the gaps are specific. All three kinds always come back; the missing one carries a null.
    const [ac1, sa1004, pm12, cm308] = await Promise.all([
      caller.decoder.getControlById({ controlId: "AC-01" }),
      caller.decoder.getControlById({ controlId: "SA-10(04)" }),
      caller.decoder.getControlById({ controlId: "PM-12" }),
      caller.decoder.getControlById({ controlId: "CM-03(08)" }),
    ]);
    const shape = (c: {
      assessment: { methods: Array<{ method: string; text: string | null }> };
    }) =>
      c.assessment.methods.map((m) => [
        m.method,
        m.text === null ? null : "present",
      ]);

    // A policy control: nothing to test technically, 108 controls like it.
    expect(shape(ac1)).toEqual([
      ["EXAMINE", "present"],
      ["INTERVIEW", "present"],
      ["TEST", null],
    ]);
    // Two controls carry no interview; this is the one that carries the other two.
    expect(shape(sa1004)).toEqual([
      ["EXAMINE", "present"],
      ["INTERVIEW", null],
      ["TEST", "present"],
    ]);
    // One control carries no examine.
    expect(shape(pm12)).toEqual([
      ["EXAMINE", null],
      ["INTERVIEW", "present"],
      ["TEST", "present"],
    ]);
    // The other no-interview control is also one of the 108 without a test, so it sits in two gap lists at once and still carries a method: two nulls, never three.
    expect(shape(cm308)).toEqual([
      ["EXAMINE", "present"],
      ["INTERVIEW", null],
      ["TEST", null],
    ]);
  });

  it("carries each control's own baselines, base and enhancement alike", async () => {
    // The column was seeded for every control and selected by nothing, so nothing proved
    // it reached a client. Asserted against the real seed rather than a fixture, because
    // the values are the catalog's own spelling and a fixture could agree with a mapper
    // that was wrong.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(ctrl.baselines).toEqual(["Low", "Moderate", "High"]);
    // An enhancement is frequently in a narrower set than its base.
    const enh = ctrl.enhancements.find((e) => e.id === "AC-02(01)")!;
    expect(enh.baselines).toEqual(["Moderate", "High"]);
  });

  it("reads each organization-defined frequency from the statement, base and enhancement alike", async () => {
    // Read from the seeded prose: CA-02 at (d), CA-02(02) its own, CA-02(01) none.
    const ac2 = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(ac2.frequency.nist.map((f) => [f.part, f.parameter])).toEqual([
      ["(j)", "organization-defined frequency"],
    ]);
    const ca2 = await caller.decoder.getControlById({ controlId: "CA-02" });
    expect(ca2.frequency.nist.map((f) => [f.part, f.parameter])).toEqual([
      ["(d)", "organization-defined assessment frequency"],
    ]);
    const enh = (id: string) => ca2.enhancements.find((e) => e.id === id)!;
    expect(enh("CA-02(01)").frequency.nist).toEqual([]);
    expect(enh("CA-02(02)").frequency.nist.map((f) => f.parameter)).toEqual([
      "organization-defined specialized assessment frequency",
    ]);
    const ac1 = await caller.decoder.getControlById({ controlId: "AC-01" });
    expect(ac1.frequency.nist.map((f) => f.part)).toEqual(["(c)(1)", "(c)(2)"]);
  });

  it("carries the Privacy baseline, which only this catalog has", async () => {
    // NIST publishes a privacy baseline alongside the three FIPS-199 levels, and 96 of
    // the 1,014 live controls are in it. It had nowhere to surface before the control-level
    // array was selected, so this is the case the port exists to make renderable.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-01" });
    expect(ctrl.baselines).toContain("Privacy");
  });

  it("returns AC-02's twelve live enhancements and (10), marked withdrawn", async () => {
    // NIST withdrew AC-02(10) into AC-02's item k. It comes back in place, marked, so
    // the modal can show it as a withdrawn tab that leads to its successor.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(
      ctrl.enhancements
        .filter((e) => e.catalogStatus === "live")
        .map((e) => e.id),
    ).toEqual([
      "AC-02(01)",
      "AC-02(02)",
      "AC-02(03)",
      "AC-02(04)",
      "AC-02(05)",
      "AC-02(06)",
      "AC-02(07)",
      "AC-02(08)",
      "AC-02(09)",
      "AC-02(11)",
      "AC-02(12)",
      "AC-02(13)",
    ]);
    const ten = ctrl.enhancements.find((e) => e.id === "AC-02(10)")!;
    expect(ten.catalogStatus).toBe("withdrawn");
    // Down to the item the catalog names, and with AC-02's Zero Trust pillars, which
    // the pane of a withdrawn control points at.
    expect(ten.lineage!.successors).toHaveLength(1);
    const [successor] = ten.lineage!.successors;
    expect(successor).toMatchObject({
      controlNumber: "AC-02",
      kind: "incorporated-into",
      family: false,
      part: "ac-2_smt.k",
    });
    expect(successor!.ztPillars).toContain("IDENTITY");
  });

  it("lists the withdrawn controls a live control incorporates", async () => {
    // AC-02 took AC-02(10) (through its item k) and AC-13, among others.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    const incorporates = ctrl.lineage!.incorporates.map((l) => l.controlNumber);
    expect(incorporates).toEqual(
      expect.arrayContaining(["AC-02(10)", "AC-13"]),
    );
    expect(
      ctrl.lineage!.incorporates.find((l) => l.controlNumber === "AC-02(10)"),
    ).toEqual({
      controlNumber: "AC-02(10)",
      kind: "incorporated-into",
      part: "ac-2_smt.k",
    });
    expect(ctrl.catalogStatus).toBe("live");
  });

  it("serves a withdrawn base control with its successors, including a family", async () => {
    const sa12 = await caller.decoder.getControlById({ controlId: "SA-12" });
    expect(sa12.catalogStatus).toBe("withdrawn");
    expect(sa12.lineage!.successors).toEqual([
      {
        controlNumber: "SR",
        kind: "incorporated-into",
        family: true,
        part: null,
        ztPillars: null,
      },
    ]);
    const ac13 = await caller.decoder.getControlById({ controlId: "AC-13" });
    expect(ac13.lineage!.successors.map((s) => s.controlNumber)).toEqual([
      "AC-02",
      "AU-06",
    ]);
  });

  it("marks a control 5.2.0 added since 5.1.1", async () => {
    const sa24 = await caller.decoder.getControlById({ controlId: "SA-24" });
    expect(sa24.lineage!.addedIn).toEqual({
      release: "5.2.0",
      sinceRelease: "5.1.1+u4",
    });
    const ac02 = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(ac02.lineage!.addedIn).toBeNull();
  });

  it("returns AC-02's statement tree with labels kept as published", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(ctrl.parts).toHaveLength(1);
    const root = ctrl.parts[0]!;
    expect(root.name).toBe("statement");
    expect(root.children).toHaveLength(12);
    // Verbatim, with the trailing period NIST publishes. Reducing these to a
    // bare letter is lossy — it maps "a." and "(a)" onto the same string — so
    // the marker that carries the nesting depth is stored exactly as published.
    expect(root.children.map((c) => c.label)).toEqual(
      "abcdefghijkl".split("").map((l) => `${l}.`),
    );
    // CISA's mapping maps whole controls and names no statement item, so neither
    // the root nor any lettered item reports Zero Trust coverage.
    expect(root.ztCovered).toBe(false);
    for (const child of root.children) expect(child.ztCovered).toBe(false);
    // NIST declares parameters but assigns no values, so no ControlParameter
    // rows exist; placeholders are rendered into the prose instead.
    for (const child of root.children) expect(child.parameters).toEqual([]);
    const c = root.children.find((x) => x.label === "c.")!;
    expect(c.prose).toContain("[Assignment: organization-defined");
    // `description` is composed from parts; the statement root has no prose of
    // its own, so it starts at item a.
    expect(ctrl.description.startsWith("a. ")).toBe(true);
  });

  it("carries the seeded Zero Trust mapping, across all of its pillars", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(ctrl.ztMapping).toBeDefined();
    // The API joins the pillar array into one display string, so a control on
    // several pillars is the case that proves the join survives the round trip —
    // a single-pillar assumption anywhere in the chain truncates here first.
    // Order is the array's, not sorted: the representative's pillar first, as
    // the generator writes it. Compared with the seeded row rather than pinned,
    // so a new edition of the mapping does not fail the join's test.
    const seeded = await db.zeroTrustMapping.findFirstOrThrow({
      where: { nistControl: { controlNumber: "AC-02" } },
      select: { pillars: true, _count: { select: { affinities: true } } },
    });
    expect(seeded.pillars.length).toBeGreaterThanOrEqual(3);
    expect(ctrl.ztMapping!.pillar).toBe(seeded.pillars.join(", "));
    // Every (pillar, function, maturity) tuple arrives, each resolving to
    // authored guidance rather than the pending sentinel.
    expect(ctrl.ztMapping!.affinities).toHaveLength(seeded._count.affinities);
    for (const a of ctrl.ztMapping!.affinities) {
      expect(a.guidance).not.toBe(ZT_GUIDANCE_PENDING);
    }
    // The Zero Trust pane's links come from the sources table authored per
    // control (14-zt-reference-links.sql): AC-02 cites the maturity model's page
    // for each of its functions, its representative pillar first, then M-22-09 at
    // that pillar's section and at the task-matrix page that names it, in the
    // authored order, each described from its URL and carrying the
    // citation. The retrieval that verified them is reported once.
    expect(ctrl.ztLinks.map((l) => l.label)).toEqual([
      "Zero Trust Maturity Model v2, Identity (p. 14)",
      "Zero Trust Maturity Model v2, Identity (p. 15)",
      "Zero Trust Maturity Model v2, Applications and Workloads (p. 23)",
      "Zero Trust Maturity Model v2, Data (p. 27)",
      "OMB M-22-09, Identity",
      "OMB M-22-09, Appendix B task matrix (p. 28)",
    ]);
    for (const l of ctrl.ztLinks) expect(keysOf(l)).toEqual(ZT_LINK_KEYS);
    expect(ctrl.ztLinks[0]).toMatchObject({
      domain: "FEDERAL",
      descriptor: "PDF · cisa.gov",
      url: "https://www.cisa.gov/sites/default/files/2023-04/zero_trust_maturity_model_v2_508.pdf#page=14",
      citation:
        "CISA, Zero Trust Maturity Model Version 2.0, April 2023, section 5.1 Identity, page 14: Identity Stores; Risk Assessments; Access Management.",
    });
    expect(ctrl.ztLinks[4]).toMatchObject({
      domain: "FEDERAL",
      descriptor: "PDF · whitehouse.gov",
    });
    expect(ctrl.ztLinks[5]).toMatchObject({
      domain: "FEDERAL",
      descriptor: "PDF · whitehouse.gov",
      url: "https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf#page=28",
    });
    expect(keysOf(ctrl.ztReferenceProvenance!)).toEqual([
      "checkedOn",
      "description",
      "name",
    ]);
    expect(ctrl.ztReferenceProvenance!.name).toBe("cisa zt reference links");
    // The NIST pane's links come from the catalog's own back-matter
    // (10-reference-links.sql): AC-02 cites three publications, in the order
    // the catalog lists them.
    expect(ctrl.nistLinks.map((l) => l.label)).toEqual([
      "SP 800-162",
      "SP 800-178",
      "SP 800-192",
    ]);
    for (const l of ctrl.nistLinks)
      expect(l.url).toMatch(/^https:\/\/doi\.org\/10\.6028\//);
    expect(ctrl.status).toBe("zero-trust-aligned");
  });

  it("cites the SASE and TIC 3.0 guide on encryption, and the task matrix in place of the bare memo", async () => {
    const memo =
      "https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf";
    // SC-08(01): the memo's section, then its task-matrix page, then the guide,
    // then the cloud architecture page the hand-maintained CISA file adds.
    const sc = await caller.decoder.getControlById({ controlId: "SC-08(01)" });
    const guide = sc.ztLinks.find((l) =>
      l.url.includes("Using_SAS_in_a_Modern_TIC3.0"),
    );
    expect(guide).toMatchObject({
      descriptor: "PDF · cisa.gov",
      domain: "FEDERAL",
    });
    expect(sc.ztLinks.indexOf(guide!)).toBe(
      sc.ztLinks.findIndex((l) => l.url === `${memo}#page=28`) + 1,
    );
    expect(sc.ztLinks.at(-1)?.label).toBe(
      "Cloud Security Technical Reference Architecture, Data Protection (p. 35)",
    );
    // CM-08: the task-matrix page replaces the memo itself, which it no longer cites.
    const cm = await caller.decoder.getControlById({ controlId: "CM-08" });
    expect(cm.ztLinks.map((l) => l.url)).toContain(`${memo}#page=28`);
    expect(cm.ztLinks.map((l) => l.url)).not.toContain(memo);
  });

  it("shows the hand-maintained references after the generated ones, each with its one-sentence summary", async () => {
    // IA-02(08): the generated references first, then the SP 800-63B-4 page that
    // 17-zt-references-nist.sql attaches, carrying its summary as the citation.
    const ia = await caller.decoder.getControlById({ controlId: "IA-02(08)" });
    const replay = ia.ztLinks.at(-1);
    expect(replay).toMatchObject({
      label: "NIST SP 800-63B-4, Replay Resistance (p. 36)",
      url: "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf#page=47",
      domain: "NIST",
      descriptor: "PDF · nvlpubs.nist.gov",
    });
    expect(replay!.citation).toMatch(
      /^NIST, SP 800-63B-4, .+, section 3\.2\.7 Replay Resistance, page 36: /,
    );
    expect(ia.ztLinks.length).toBeGreaterThan(1);
    // CM-07: the two SCuBA baselines, pinned to their releases, are external links.
    const cm = await caller.decoder.getControlById({ controlId: "CM-07" });
    expect(
      cm.ztLinks.filter((l) => l.domain === "EXTERNAL").map((l) => l.url),
    ).toEqual([
      "https://github.com/cisagov/ScubaGear/blob/v2.0.0/PowerShell/ScubaGear/baselines/aad.md#1-legacy-authentication",
      "https://github.com/cisagov/ScubaGoggles/blob/v1.1.0/scubagoggles/baselines/commoncontrols.md#11-authorized-google-marketplace-apps",
    ]);
    // The pane dates its references by the oldest check across the files that
    // seed them: the generated file and the three hand-maintained ones.
    const checks = await db.dataSource.findMany({
      where: { type: "zt-reference-links", isActive: true },
      select: { lastCrawled: true },
    });
    expect(checks).toHaveLength(4);
    const oldest = Math.min(...checks.map((c) => c.lastCrawled!.getTime()));
    expect(ia.ztReferenceProvenance!.checkedOn).toEqual(new Date(oldest));
  });

  it("seeds a reference at its current location when the published URL is gone", async () => {
    // OMB A-130 is the most-cited resource in the catalog and its published URL
    // returns 404; the seed carries the verified replacement from the override
    // table, so the pane never renders the dead link. The DOI-addressed
    // publications keep their DOI, which is the stable name by design.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-01" });
    const a130 = ctrl.nistLinks.find((l) => l.label === "OMB A-130");
    expect(a130).toBeDefined();
    expect(a130!.url).toBe(
      "https://www.whitehouse.gov/wp-content/uploads/legacy_drupal_files/omb/circulars/A130/a130revised.pdf",
    );
    expect(ctrl.nistLinks.map((l) => l.label)).toEqual([
      "OMB A-130",
      "SP 800-12",
      "SP 800-30",
      "SP 800-39",
      "SP 800-100",
      "IR 7874",
    ]);
  });

  it("renders every parameter placeholder, leaving no raw OSCAL markup", async () => {
    // NIST ships {{ insert: param, ... }} markers rather than values. The
    // generator renders them to display strings; a marker surviving into the
    // payload means the resolver silently skipped one, which is visible on the
    // page and is exactly the failure this catches.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    const blob = JSON.stringify(ctrl);
    expect(blob).not.toContain("{{ insert");
    expect(blob).toContain("[Assignment: organization-defined");
  });

  it("reports a different status from each procedure, and that is the contract", async () => {
    // mapControl computes status from !!ztMapping alone, so getControlById can
    // only ever say zero-trust-aligned or compliance, while getBridgeData also
    // folds in whether any enhancement is mapped. AC-02 is mapped AND has nine
    // mapped enhancements, so the two procedures disagree by design. This was
    // unobservable while nothing was mapped; asserting it now stops a later
    // "fix" from collapsing the two and flattening the layer cake's teal state.
    const detail = await caller.decoder.getControlById({ controlId: "AC-02" });
    const { families } = await caller.decoder.getBridgeData();
    const bridge = families
      .flatMap((f) => f.controls)
      .find((c) => c.id === "AC-02")!;
    expect(detail.status).toBe("zero-trust-aligned");
    expect(bridge.status).toBe("zt-aligned-with-enhancements");
  });

  it("matches the control number exactly, so AC-2 is not AC-02", async () => {
    await expect(
      caller.decoder.getControlById({ controlId: "AC-2" }),
    ).rejects.toThrow("Control AC-2 not found");
  });
});

describe("searchControls against the seeded catalog", () => {
  it("ranks an exact control number first and labels it as an id match", async () => {
    const { hits, matchingIds } = await caller.decoder.searchControls({
      q: "AC-02",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(25);
    expect(matchingIds.length).toBeGreaterThanOrEqual(hits.length);
    expect(matchingIds).toContain("AC-02");
    expect(hits[0]).toEqual({
      controlNumber: "AC-02",
      controlName: "Account Management",
      matchedIn: "id",
      withdrawn: false,
    });
    for (const h of hits) {
      expect(keysOf(h)).toEqual([
        "controlName",
        "controlNumber",
        "matchedIn",
        "withdrawn",
      ]);
      expect(["id", "name", "text"]).toContain(h.matchedIn);
      expect(h.withdrawn).toBe(false);
    }
  });

  it("finds withdrawn controls only when asked, and never narrows the diagram with them", async () => {
    const current = await caller.decoder.searchControls({ q: "SA-12" });
    expect(current.hits.map((h) => h.controlNumber)).not.toContain("SA-12");
    const all = await caller.decoder.searchControls({
      q: "SA-12",
      includeWithdrawn: true,
    });
    // SA-12 and its fifteen enhancements, all withdrawn, the exact number first.
    expect(all.hits[0]).toMatchObject({
      controlNumber: "SA-12",
      withdrawn: true,
    });
    expect(all.hits.filter((h) => h.withdrawn)).toHaveLength(16);
    expect(all.matchingIds).toEqual(current.matchingIds);
  });

  it("reaches controls through statement prose, proving the text where-clause is real", async () => {
    // "privileged" appears in statement prose but in no control number or name,
    // so every hit has to come from the prose-to-where-clause round-trip, which
    // the mocked suite cannot execute.
    const { hits, matchingIds } = await caller.decoder.searchControls({
      q: "privileged",
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.matchedIn).toBe("text");
    // The whole point of the change: these ids are what lets the diagram narrow on a
    // term that appears in no control number or name, so the cake stops looking broken.
    // The dropdown is the first 25 of what the cake narrows to; the term also
    // matches guidance text, so the matches outnumber the dropdown's cap.
    expect(matchingIds.length).toBeGreaterThanOrEqual(hits.length);
    expect(hits.map((h) => h.controlNumber)).toEqual(matchingIds.slice(0, 25));
  });

  it("rejects a query shorter than two characters before touching the database", async () => {
    await expect(caller.decoder.searchControls({ q: "a" })).rejects.toThrow();
  });
});
