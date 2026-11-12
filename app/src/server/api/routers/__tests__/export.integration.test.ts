/**
 * getExportRecord against a real seeded Postgres, for five selections:
 * one base, one enhancement, a base with its enhancements, a filtered set and the whole
 * framework. The filtered set is checked against the diagram's own predicate over
 * getBridgeData, so the export cannot drift from what the filter bar shows.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  matchesQuery,
  type FilterQuery,
} from "~/app/_components/decoder-ring/filterPredicate";
import { lineageLines } from "~/app/_components/decoder-ring/lineage-text";
import { withBaseLinks } from "~/app/_components/decoder-ring/link-identity";
import { EXPORT_DATASETS, EXPORT_FIELDS } from "~/lib/export/record";
import type { ExportSelection } from "~/lib/export/selection";
import { appRouter, createExportCaller } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import type { db as AppDb } from "~/server/db";
import type { Prisma } from "../../../../../generated/prisma";
import { createTestDb } from "~/test/db/harness";

// The same three stubs decoder.integration.test.ts explains: the router's import graph
// reaches ~/server/db, ~/env and next-auth, none of which this suite connects through.
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
const exporter = createExportCaller({
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

const NO_FILTER: FilterQuery = {
  pillar: [],
  maturity: [],
  designation: [],
  baseline: [],
  family: [],
  status: [],
  q: "",
};
const select = (over: Partial<ExportSelection>): ExportSelection => ({
  ...NO_FILTER,
  pick: [],
  enhancements: "with",
  data: [...EXPORT_DATASETS],
  fields: [...EXPORT_FIELDS],
  ...over,
});
const ids = (r: { controls: Array<{ id: string }> }) =>
  r.controls.map((c) => c.id);

describe("the export page's queries", () => {
  it("counts exactly the controls the export carries, for every kind of selection", async () => {
    const withdrawn = await db.nistControl.findFirstOrThrow({
      where: { status: "WITHDRAWN", nistVersion: { isActive: true } },
      orderBy: { controlNumber: "asc" },
    });
    for (const over of [
      {},
      { family: ["AC"] },
      { family: ["AC"], enhancements: "without" as const },
      { pillar: ["IDENTITY"], baseline: ["MODERATE"] },
      { pillar: ["IDENTITY"], maturity: ["OPTIMAL"] },
      { q: "audit" },
      { pick: ["AC-02", "ia-5.1"], enhancements: "only" as const },
      // This catalog's own: the designation facet, which also filters enhancements, and a
      // withdrawn pick, which the live-only rules would otherwise leave out.
      { designation: ["KEY"] },
      { designation: ["KEY"], enhancements: "only" as const },
      { pick: [withdrawn.controlNumber] },
      { pick: [withdrawn.controlNumber, "AC-02"], designation: ["KEY"] },
    ]) {
      const s = select(over);
      const [{ count }, record] = await Promise.all([
        caller.decoder.countExport(s),
        exporter.export.getExportRecord(s),
      ]);
      expect(count, JSON.stringify(over)).toBe(record.controls.length);
    }
  });

  it("lists every control and enhancement for the picker, withdrawn ones marked", async () => {
    const all = await caller.decoder.listControls();
    const whole = await exporter.export.getExportRecord(select({}));
    // The whole catalog is the live controls; the picker adds the withdrawn ones, marked.
    expect(
      all
        .filter((c) => !c.withdrawn)
        .map((c) => c.id)
        .sort(),
    ).toEqual(ids(whole).sort());
    const withdrawn = all.filter((c) => c.withdrawn);
    expect(withdrawn.length).toBe(
      await db.nistControl.count({
        where: { status: "WITHDRAWN", nistVersion: { isActive: true } },
      }),
    );
    const picked = await exporter.export.getExportRecord(
      select({ pick: [withdrawn[0]!.id] }),
    );
    expect(ids(picked)).toEqual([withdrawn[0]!.id]);
  });
});

describe("getExportRecord", () => {
  it("one base control, alone", async () => {
    const r = await exporter.export.getExportRecord(
      select({ pick: ["AC-02"], enhancements: "without" }),
    );
    expect(ids(r)).toEqual(["AC-02"]);
    expect(r.controls[0]!.baseId).toBeNull();
  });

  it("one enhancement, alone, however the id is spelled", async () => {
    const r = await exporter.export.getExportRecord(
      select({ pick: ["ac-2.1"] }),
    );
    expect(ids(r)).toEqual(["AC-02(01)"]);
    expect(r.controls[0]!.baseId).toBe("AC-02");
  });

  it("a base with its enhancements, base first", async () => {
    const detail = await caller.decoder.getControlById({ controlId: "AC-02" });
    // The live enhancements: a base's withdrawn ones are reached by picking them.
    const live = detail.enhancements.filter((e) => e.catalogStatus === "live");
    const r = await exporter.export.getExportRecord(
      select({ pick: ["AC-02"], enhancements: "with" }),
    );
    expect(ids(r)).toEqual(["AC-02", ...live.map((e) => e.id)]);
    expect(r.controls.slice(1).every((c) => c.baseId === "AC-02")).toBe(true);

    const only = await exporter.export.getExportRecord(
      select({ pick: ["AC-02"], enhancements: "only" }),
    );
    expect(ids(only)).toEqual(live.map((e) => e.id));
  });

  it("applies no facet to picks or what they bring", async () => {
    const plain = await exporter.export.getExportRecord(
      select({ pick: ["AC-02"] }),
    );
    const faceted = await exporter.export.getExportRecord(
      select({ pick: ["AC-02"], baseline: ["LOW"], pillar: ["DATA"] }),
    );
    expect(plain.controls.length).toBeGreaterThan(1);
    expect(ids(faceted)).toEqual(ids(plain));
  });

  it("refuses picks that match no control, naming them", async () => {
    await expect(
      exporter.export.getExportRecord(
        select({ pick: ["AC-02", "ZZ-99", " "] }),
      ),
    ).rejects.toThrow('No control matches ZZ-99, "".');
  });

  it("a filtered set is exactly what the diagram's predicate shows", async () => {
    const query: FilterQuery = {
      ...NO_FILTER,
      family: ["AC", "SI"],
      status: ["zero-trust-aligned"],
    };
    const bridge = await caller.decoder.getBridgeData();
    const shown = bridge.families
      .flatMap((f) => f.controls)
      .filter((c) => matchesQuery(c, query))
      .map((c) => c.id);
    expect(shown.length).toBeGreaterThan(0);

    const r = await exporter.export.getExportRecord(
      select({ ...query, enhancements: "without" }),
    );
    expect(ids(r).sort()).toEqual(shown.sort());
  });

  it("keeps only the Zero Trust rows a maturity or pillar filter selects, and none on a pick", async () => {
    const whole = await exporter.export.getExportRecord(
      select({ enhancements: "without", data: ["zeroTrust"] }),
    );
    // A control with rows at two maturities, so a trimmed pick would show.
    const mixed = whole.controls.find(
      (c) => new Set(c.zeroTrust!.map((t) => t.maturity)).size > 1,
    )!;
    const maturity = mixed.zeroTrust![0]!.maturity;
    const r = await exporter.export.getExportRecord(
      select({ maturity: [maturity] }),
    );
    expect(r.zeroTrustFiltered).toBe(true);
    expect(r.controls.length).toBeGreaterThan(0);
    for (const c of r.controls) {
      expect(c.zeroTrust!.length, c.id).toBeGreaterThan(0);
      for (const t of c.zeroTrust!) expect(t.maturity, c.id).toBe(maturity);
    }

    const picked = await exporter.export.getExportRecord(
      select({
        pick: [mixed.id],
        enhancements: "without",
        maturity: [maturity],
      }),
    );
    expect(picked.zeroTrustFiltered).toBeUndefined();
    expect(picked.controls[0]!.zeroTrust).toEqual(mixed.zeroTrust);

    const multi = whole.controls.find(
      (c) => new Set(c.zeroTrust!.map((t) => t.pillar)).size > 1,
    )!;
    const pillar = multi.zeroTrust![0]!.pillar;
    const byPillar = await exporter.export.getExportRecord(
      select({ pillar: [pillar], enhancements: "without" }),
    );
    expect(ids(byPillar)).toContain(multi.id);
    for (const c of byPillar.controls) {
      expect(c.zeroTrust!.length, c.id).toBeGreaterThan(0);
      for (const t of c.zeroTrust!) expect(t.pillar, c.id).toBe(pillar);
    }
  });

  it("keeps only the rows a designation filter selects, alone or with a pillar", async () => {
    const whole = await exporter.export.getExportRecord(
      select({ enhancements: "without", data: ["zeroTrust"] }),
    );
    const sample = whole.controls
      .flatMap((c) => c.zeroTrust!)
      .find((t) => t.designation)!;
    const designation = sample.designation!;
    const bridge = await caller.decoder.getBridgeData();
    for (const query of [
      { designation: [designation] },
      { designation: [designation], pillar: [sample.pillar] },
    ]) {
      const r = await exporter.export.getExportRecord(
        select({ ...query, enhancements: "without" }),
      );
      const shown = bridge.families
        .flatMap((f) => f.controls)
        .filter((c) => matchesQuery(c, { ...NO_FILTER, ...query }))
        .map((c) => c.id);
      expect(ids(r).sort(), JSON.stringify(query)).toEqual(shown.sort());
      for (const c of r.controls) {
        if (!query.pillar) expect(c.zeroTrust!.length, c.id).toBeGreaterThan(0);
        for (const t of c.zeroTrust!) {
          expect(t.designation, c.id).toBe(designation);
          if (query.pillar) expect(t.pillar, c.id).toBe(sample.pillar);
        }
      }
    }
  });

  it("with pillar and maturity both on, exports what the diagram shows, each with only the rows that match both", async () => {
    // A control that has the pillar and the maturity on different rows: the diagram shows it.
    const whole = await exporter.export.getExportRecord(
      select({ enhancements: "without", data: ["zeroTrust"] }),
    );
    const split = whole.controls.flatMap((c) => {
      const zt = c.zeroTrust!;
      return zt.flatMap((a) =>
        zt
          .filter(
            (b) =>
              !zt.some(
                (t) => t.pillar === a.pillar && t.maturity === b.maturity,
              ),
          )
          .map((b) => ({ id: c.id, pillar: a.pillar, maturity: b.maturity })),
      );
    })[0];
    expect(
      split,
      "the seed has a control whose facets match on different rows",
    ).toBeDefined();
    const query = { pillar: [split!.pillar], maturity: [split!.maturity] };

    const r = await exporter.export.getExportRecord(
      select({ ...query, enhancements: "without" }),
    );
    const bridge = await caller.decoder.getBridgeData();
    const shown = bridge.families
      .flatMap((f) => f.controls)
      .filter((c) => matchesQuery(c, { ...NO_FILTER, ...query }))
      .map((c) => c.id);
    expect(ids(r).sort()).toEqual(shown.sort());

    for (const c of r.controls) {
      const all = whole.controls.find((w) => w.id === c.id)!.zeroTrust!;
      const both = all.filter(
        (t) => t.pillar === split!.pillar && t.maturity === split!.maturity,
      );
      expect(c.zeroTrust, c.id).toEqual(both);
    }
  });

  it("free-text search narrows on the server's prose match, as the diagram does", async () => {
    const { matchingIds } = await caller.decoder.searchControls({
      q: "account",
    });
    const r = await exporter.export.getExportRecord(
      select({ q: "account", enhancements: "without" }),
    );
    const bridge = await caller.decoder.getBridgeData();
    const shown = bridge.families
      .flatMap((f) => f.controls)
      .filter((c) =>
        matchesQuery(c, { ...NO_FILTER, q: "account" }, new Set(matchingIds)),
      )
      .map((c) => c.id);
    expect(ids(r).sort()).toEqual(shown.sort());
  });

  it("the whole framework: every live control in the active version", async () => {
    const version = await db.nistVersion.findFirstOrThrow({
      where: { isActive: true },
    });
    const live = await db.nistControl.count({
      where: { nistVersionId: version.id, status: "LIVE" },
    });
    const r = await exporter.export.getExportRecord(select({}));
    expect(r.controls).toHaveLength(live);
    expect(r.catalog).toBe(version.displayLabel);
  });

  it("exports a withdrawn control when it is picked", async () => {
    const withdrawn = await db.nistControl.findFirstOrThrow({
      where: { status: "WITHDRAWN", nistVersion: { isActive: true } },
      select: { controlNumber: true },
    });
    const r = await exporter.export.getExportRecord(
      select({ pick: [withdrawn.controlNumber] }),
    );
    expect(ids(r)).toEqual([withdrawn.controlNumber]);
  });

  it("carries a withdrawn control's lineage as the modal's Copy prints it", async () => {
    const withdrawn = await db.nistControl.findFirstOrThrow({
      where: {
        status: "WITHDRAWN",
        lineage: { some: {} },
        nistVersion: { isActive: true },
      },
      select: { controlNumber: true },
    });
    const detail = await caller.decoder.getControlById({
      controlId: withdrawn.controlNumber,
    });
    const r = await exporter.export.getExportRecord(
      select({ pick: [withdrawn.controlNumber] }),
    );
    expect(r.controls[0]!.lineage).toEqual(
      lineageLines(detail.catalogStatus, detail.lineage),
    );
    expect(r.controls[0]!.lineage![0]).toMatch(/^Status: Withdrawn/);
  });

  describe("carries every kind of lineage the catalog records", () => {
    const exported = async (controlNumber: string) => {
      const detail = await caller.decoder.getControlById({
        controlId: controlNumber,
      });
      const r = await exporter.export.getExportRecord(
        select({ pick: [controlNumber], enhancements: "without" }),
      );
      const lineage = r.controls[0]!.lineage!;
      expect(lineage).toEqual(
        lineageLines(detail.catalogStatus, detail.lineage),
      );
      return lineage.join("\n");
    };
    const row = (where: Prisma.ControlLineageWhereInput) =>
      db.controlLineage.findFirstOrThrow({
        where: {
          controlId: { not: null },
          nistVersion: { isActive: true },
          ...where,
        },
        orderBy: { controlNumber: "asc" },
      });

    it("a withdrawn control with several successors", async () => {
      const text = await exported("AC-03(06)");
      expect(text).toMatch(/^Status: Withdrawn, incorporated into /);
      expect(text).toContain("MP-04");
      expect(text).toContain("SC-28");
    });

    it("a withdrawn control moved to another", async () => {
      const moved = await row({
        kind: "MOVED_TO",
        relatedControlNumber: { not: null },
      });
      expect(await exported(moved.controlNumber)).toContain(
        `moved to ${moved.relatedControlNumber}`,
      );
    });

    it("a control new in this release", async () => {
      const added = await row({ kind: "ADDED" });
      expect(await exported(added.controlNumber)).toContain(
        `New in ${added.release}`,
      );
    });

    it("a live control that took a withdrawn one's content", async () => {
      const taken = await row({
        kind: "INCORPORATED_INTO",
        relatedControl: { status: "LIVE" },
      });
      const text = await exported(taken.relatedControlNumber!);
      expect(text).toMatch(/Incorporates withdrawn: .*/);
      expect(text).toContain(taken.controlNumber);
    });
  });

  it("gives an enhancement with no frequency of its own its base's, as the modal does", async () => {
    const detail = await caller.decoder.getControlById({ controlId: "AC-02" });
    const enh = detail.enhancements.find(
      (e) => e.catalogStatus === "live" && e.frequency?.nist.length === 0,
    );
    expect(enh).toBeDefined();
    expect(detail.frequency.nist.length).toBeGreaterThan(0);
    const r = await exporter.export.getExportRecord(
      select({ pick: [enh!.id] }),
    );
    expect(r.controls[0]!.frequency!.map((f) => f.label)).toEqual(
      detail.frequency.nist.map(
        (f) => `AC-02 ${f.part ? `item ${f.part}` : "statement"}`,
      ),
    );

    const none = await exporter.export.getExportRecord(
      select({ pick: [enh!.id], fields: [] }),
    );
    expect(none.fields).toEqual([]);
    expect(none.controls[0]!.frequency).toBeUndefined();
    expect(none.controls[0]!.lineage).toBeUndefined();
  });

  it("carries SP 800-53A content as the modal labels it", async () => {
    const r = await exporter.export.getExportRecord(
      select({
        pick: ["AC-02"],
        enhancements: "without",
        data: ["assessment"],
      }),
    );
    const a = r.controls[0]!.assessment!;
    expect(a.objectives.length).toBeGreaterThan(0);
    expect(a.objectives.every((o) => !o.identifier.startsWith("DS-"))).toBe(
      true,
    );
    expect(a.methods.map((m) => m.method)).toEqual([
      "Examine",
      "Interview",
      "Test",
    ]);
  });

  it("leaves an unchosen dataset out", async () => {
    const r = await exporter.export.getExportRecord(
      select({
        pick: ["AC-02"],
        enhancements: "without",
        data: ["assessment", "zeroTrust"],
      }),
    );
    expect(r.datasets).toEqual(["assessment", "zeroTrust"]);
    const [ac2] = r.controls;
    expect(ac2!.assessment).toBeDefined();
    expect(ac2!.statement).toBeUndefined();
    expect(ac2!.references).toBeUndefined();
    expect(ac2!.zeroTrust!.length).toBeGreaterThan(0);
  });

  it("carries the statement, parameters, tuples and references the modal shows", async () => {
    const detail = await caller.decoder.getControlById({ controlId: "AC-02" });
    const r = await exporter.export.getExportRecord(
      select({ pick: ["AC-02"], enhancements: "without" }),
    );
    const [ac2] = r.controls;
    expect(ac2!.statement!.text).toBe(detail.description);
    expect(ac2!.statement!.discussion).toBe(detail.discussion);
    expect(ac2!.zeroTrust).toEqual(detail.ztMapping?.affinities);
    expect(ac2!.zeroTrust!.every((t) => t.designation !== undefined)).toBe(
      true,
    );
    expect(ac2!.references!.map((x) => x.url)).toEqual([
      ...detail.ztLinks.map((l) => l.url),
      ...detail.nistLinks.map((l) => l.url),
    ]);
  });

  it("writes discussion cross-references as their labels", async () => {
    const detail = await caller.decoder.getControlById({
      controlId: "AC-02(05)",
    });
    expect(detail.discussion).toMatch(/\]\(#/);
    const r = await exporter.export.getExportRecord(
      select({ pick: ["AC-02(05)"] }),
    );
    expect(r.controls[0]!.statement!.discussion).not.toMatch(/\]\(/);
  });

  it("lists an enhancement's references as the modal does: its own, then its base's", async () => {
    const detail = await caller.decoder.getControlById({ controlId: "AC-02" });
    const r = await exporter.export.getExportRecord(
      select({
        pick: ["AC-02"],
        enhancements: "only",
        data: ["references"],
      }),
    );
    const live = detail.enhancements.filter((e) => e.catalogStatus === "live");
    for (const [i, enh] of live.entries()) {
      const shown = [
        ...withBaseLinks(enh.ztLinks, detail.ztLinks),
        ...withBaseLinks(enh.nistLinks, detail.nistLinks),
      ];
      expect(r.controls[i]!.references!.map((x) => [x.url, x.scope])).toEqual(
        shown.map((l) => [l.url, l.scope]),
      );
    }
  });

  it("keeps only the enhancements in a filtered baseline, though their base stays", async () => {
    const all = await exporter.export.getExportRecord(
      select({ family: ["AC"], enhancements: "only" }),
    );
    const low = await exporter.export.getExportRecord(
      select({
        family: ["AC"],
        baseline: ["MODERATE"],
        enhancements: "only",
      }),
    );
    expect(low.controls.length).toBeGreaterThan(0);
    expect(low.controls.length).toBeLessThan(all.controls.length);
    // NIST's Low baseline takes no AC enhancement, so Moderate is the one that narrows.
    for (const c of low.controls) expect(c.baselines).toContain("Moderate");
  });
});
